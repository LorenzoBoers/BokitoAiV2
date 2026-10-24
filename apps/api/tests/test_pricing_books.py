"""Price book quote + seed."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.pricing import PriceBook, PriceBookRule
from app.services import pricing as pricing_svc
from app.services.model_catalog import seed_model_catalog
from app.services.model_resolution import record_usage, resolve_model_call
from app.services import platform_secrets


@pytest.mark.asyncio
async def test_ensure_default_book_and_quote(session_override):
    tenant = Tenant(slug="price-a", name="Price A")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    book = await pricing_svc.ensure_default_book(session_override)
    assert book.slug == "bokito-standard"
    assert book.is_default
    rules = (
        await session_override.execute(
            select(PriceBookRule).where(PriceBookRule.price_book_id == book.id)
        )
    ).scalars().all()
    assert any(r.match_kind == "managed_tier" and r.match_value == "bokito-maki" for r in rules)

    quote = await pricing_svc.quote(
        session_override,
        tenant.id,
        slug="bokito-maki",
        provider="mistral",
        billable=True,
        tokens_in=1_000_000,
        tokens_out=0,
        provider_input_cents=10,
        provider_output_cents=10,
        legacy_bill_input_cents=10,
        legacy_bill_output_cents=10,
        legacy_markup=1.0,
    )
    # 1M tokens × 10 cents/Mtok / 100 = 100_000 micros = $0.10
    assert quote.provider_cost_micros == 100_000
    assert quote.customer_cost_micros == 100_000
    assert quote.price_book_id == book.id


@pytest.mark.asyncio
async def test_record_usage_stores_book(session_override):
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="price-b", name="Price B")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)
    await platform_secrets.set_platform_secret(session_override, "mistral", "mi-platform-price")

    resolved = await resolve_model_call(
        session_override, tenant.id, kind="chat", model_slug="bokito-maki"
    )
    entry = await record_usage(
        session_override,
        tenant.id,
        resolved,
        tokens_in=1000,
        tokens_out=100,
        call_type="chat",
        commit=True,
    )
    assert entry.price_book_id is not None
    books = (await session_override.execute(select(PriceBook))).scalars().all()
    assert books
