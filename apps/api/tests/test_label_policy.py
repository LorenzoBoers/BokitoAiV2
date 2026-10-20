"""Label policy: agents register reusable labels, not combos, twins or items."""

from uuid import uuid4

import pytest

from app.models.auth import Tenant
from app.models.channel import Company
from app.models.signal import SignalTag
from app.services.label_policy import check_new_label, stem

ABOUT = "Invoices and receipts from suppliers"


async def _tenant(session) -> Tenant:
    tenant = Tenant(slug=f"labels-{uuid4().hex[:6]}", name="Acme")
    session.add(tenant)
    await session.flush()
    session.add_all(
        [
            SignalTag(tenant_id=tenant.id, name="facturen"),
            SignalTag(tenant_id=tenant.id, name="administratie"),
            Company(tenant_id=tenant.id, name="Mistral AI", domain="mistral.ai"),
        ]
    )
    await session.flush()
    return tenant


def test_stem_meets_singular_and_plural():
    assert stem("factuur") == stem("facturen")
    assert stem("offerte") == stem("offertes")
    assert stem("support") != stem("sales")


@pytest.mark.asyncio
async def test_existing_and_fresh_labels_pass(session_override):
    tenant = await _tenant(session_override)
    assert await check_new_label(session_override, tenant.id, "facturen") is None
    assert await check_new_label(session_override, tenant.id, "offertes", "Quotes sent to clients") is None


@pytest.mark.asyncio
async def test_near_duplicate_points_at_the_existing_label(session_override):
    tenant = await _tenant(session_override)
    out = await check_new_label(session_override, tenant.id, "Factuur", ABOUT)
    assert out["error"] == "near_duplicate"
    assert out["use"] == ["facturen"]


@pytest.mark.asyncio
async def test_company_plus_type_is_two_labels(session_override):
    tenant = await _tenant(session_override)
    out = await check_new_label(session_override, tenant.id, "mistral_facturen", ABOUT)
    assert out["error"] == "combines_labels"
    assert "facturen" in out["use"]

    out = await check_new_label(session_override, tenant.id, "mistral_betaalbevestigingen", ABOUT)
    assert out["error"] == "combines_labels"
    assert "mistral" in out["message"]


@pytest.mark.asyncio
async def test_item_labels_are_refused(session_override):
    tenant = await _tenant(session_override)
    for name in ("factuur_0425", "april_kosten", "q3_rapport"):
        out = await check_new_label(session_override, tenant.id, name, ABOUT)
        assert out["error"] == "item_specific", name


@pytest.mark.asyncio
async def test_new_label_needs_a_description(session_override):
    tenant = await _tenant(session_override)
    out = await check_new_label(session_override, tenant.id, "offertes", "")
    assert out["error"] == "missing_description"


@pytest.mark.asyncio
async def test_rename_is_not_a_duplicate_of_itself(session_override):
    tenant = await _tenant(session_override)
    out = await check_new_label(session_override, tenant.id, "factuur", ABOUT, renaming="facturen")
    assert out is None
