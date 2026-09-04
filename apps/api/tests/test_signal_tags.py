"""Tag registry: catalog, create/rename/delete, curated AI tagging, folder prefs."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.signal import Signal


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _ingest(client: AsyncClient, headers: dict[str, str], subject: str) -> str:
    response = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "mock",
            "subject": subject,
            "body_text": "Body",
            "contact_email": "c@test.com",
        },
    )
    assert response.status_code == 200
    return response.json()["id"]


@pytest.mark.asyncio
async def test_tag_catalog_counts(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    first = await _ingest(client, headers, "Billing question")
    second = await _ingest(client, headers, "Another billing question")

    await client.patch(f"/api/signals/{first}", headers=headers, json={"tags": ["billing", "vip"]})
    await client.patch(f"/api/signals/{second}", headers=headers, json={"tags": ["billing"]})
    # Closed threads count in total but not in open.
    await client.patch(f"/api/signals/{second}", headers=headers, json={"status": "closed"})

    catalog = await client.get("/api/signals/tags", headers=headers)
    assert catalog.status_code == 200
    rows = {row["tag"]: row for row in catalog.json()["items"]}
    assert rows["billing"]["total"] == 2
    assert rows["billing"]["open"] == 1
    assert rows["vip"]["total"] == 1


@pytest.mark.asyncio
async def test_tag_rename_and_delete_bulk(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    first = await _ingest(client, headers, "Invoice issue")
    second = await _ingest(client, headers, "Invoice reminder")

    await client.patch(f"/api/signals/{first}", headers=headers, json={"tags": ["facturen"]})
    await client.patch(f"/api/signals/{second}", headers=headers, json={"tags": ["facturen", "vip"]})

    renamed = await client.patch(
        "/api/signals/tags/facturen", headers=headers, json={"new_tag": "billing"}
    )
    assert renamed.status_code == 200
    assert renamed.json()["changed"] == 2

    detail = await client.get(f"/api/signals/{second}", headers=headers)
    assert sorted(detail.json()["thread"]["tags"]) == ["billing", "vip"]

    deleted = await client.delete("/api/signals/tags/vip", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json()["changed"] == 1

    catalog = await client.get("/api/signals/tags", headers=headers)
    tags = {row["tag"] for row in catalog.json()["items"]}
    assert "billing" in tags
    assert "vip" not in tags
    assert "facturen" not in tags


@pytest.mark.asyncio
async def test_tag_created_in_settings_is_usable_before_any_thread(
    client: AsyncClient, session_override
):
    headers = await _auth_headers(client)
    created = await client.post(
        "/api/signals/tags",
        headers=headers,
        json={"name": "  Refund Request ", "description": "Customer asks money back"},
    )
    assert created.status_code == 200
    assert created.json()["tag"] == "refund request"

    catalog = await client.get("/api/signals/tags", headers=headers)
    row = next(r for r in catalog.json()["items"] if r["tag"] == "refund request")
    assert row["total"] == 0
    assert row["description"] == "Customer asks money back"

    # The registry — not thread usage — is the AI vocabulary.
    from app.models.auth import Tenant
    from app.services.signal_tags import allowed_tag_names

    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    assert "refund request" in await allowed_tag_names(session_override, tenant.id)


@pytest.mark.asyncio
async def test_thread_tags_are_normalized_and_registered(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    signal_id = await _ingest(client, headers, "Mixed case tags")

    patched = await client.patch(
        f"/api/signals/{signal_id}",
        headers=headers,
        json={"tags": ["  Billing ", "billing", "VIP"]},
    )
    assert patched.status_code == 200
    assert patched.json()["tags"] == ["billing", "vip"]

    catalog = await client.get("/api/signals/tags", headers=headers)
    rows = {row["tag"]: row for row in catalog.json()["items"]}
    assert rows["billing"]["registered"] is True
    assert rows["vip"]["registered"] is True


@pytest.mark.asyncio
async def test_tag_folder_lists_only_tagged_threads(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tagged = await _ingest(client, headers, "Invoice question")
    await _ingest(client, headers, "Onboarding question")
    await client.patch(f"/api/signals/{tagged}", headers=headers, json={"tags": ["billing"]})

    listed = await client.get("/api/signals?view=all&tag=billing", headers=headers)
    assert listed.status_code == 200
    ids = [row["id"] for row in listed.json()["items"]]
    assert ids == [tagged]


@pytest.mark.asyncio
async def test_triage_intent_creates_case_not_tag(client: AsyncClient, session_override):
    """Catalog hits from triage become Cases; tags_json stays untouched."""
    headers = await _auth_headers(client)
    signal_id = await _ingest(client, headers, "Refund request")

    from uuid import UUID

    from app.models.auth import Tenant
    from app.models.case import Case
    from app.models.signal import Signal
    from app.services.cases import create_case_type
    from app.services.interpretation import _create_cases_from_triage

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    case_type = await create_case_type(
        session_override,
        tenant.id,
        name="Refund request",
        slug="refund_request",
        description="Customer explicitly asks for money back.",
        create_mode="auto",
        auto_threshold=5,
    )

    await _create_cases_from_triage(
        session_override,
        tenant.id,
        signal_id=UUID(signal_id),
        slugs=["refund_request"],
        enabled_types=[case_type],
        summary="Customer wants a refund for order 123.",
        certainty=90,
    )

    cases = (
        await session_override.execute(
            select(Case).where(Case.signal_id == UUID(signal_id))
        )
    ).scalars().all()
    assert len(cases) == 1
    assert cases[0].case_type_id == case_type.id
    assert cases[0].status == "open"
    assert cases[0].created_by_type == "triage"

    signal = (
        await session_override.execute(select(Signal).where(Signal.id == UUID(signal_id)))
    ).scalar_one()
    assert json.loads(signal.tags_json or "[]") == []

    # Idempotent: a second triage pass never duplicates the case.
    await _create_cases_from_triage(
        session_override,
        tenant.id,
        signal_id=UUID(signal_id),
        slugs=["refund_request"],
        enabled_types=[case_type],
        summary="Customer wants a refund for order 123.",
        certainty=90,
    )
    cases = (
        await session_override.execute(
            select(Case).where(Case.signal_id == UUID(signal_id))
        )
    ).scalars().all()
    assert len(cases) == 1


@pytest.mark.asyncio
async def test_migration_maps_tags_to_case_types(client: AsyncClient, session_override):
    """migrate_tags_to_cases helpers: reuse by slug, billing template, dry-run."""
    await _auth_headers(client)  # seeds the tenant

    from app.models.auth import Tenant
    from app.services.cases import create_case_type
    from scripts.dev.migrate_tags_to_cases import _map_tag_to_type

    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()

    # "billing" prefers the installed accounting template over a new type.
    billing_type = await create_case_type(
        session_override,
        tenant.id,
        name="Billing inquiry",
        slug="billing_inquiry",  # stored slugified as billing-inquiry
        template_slug="billing_inquiry",
        module_slug="accounting",
    )
    mapped = await _map_tag_to_type(
        session_override, tenant.id, "billing", "", dry_run=False
    )
    assert mapped is not None and mapped.id == billing_type.id

    # Dry-run never creates a type.
    assert (
        await _map_tag_to_type(
            session_override, tenant.id, "refund request", "", dry_run=True
        )
        is None
    )

    # A fresh tag becomes a manual-only type with a slugified slug.
    created = await _map_tag_to_type(
        session_override, tenant.id, "refund request", "Money back", dry_run=False
    )
    assert created is not None
    assert created.slug == "refund-request"
    assert created.create_mode == "manual_only"
    # Re-running reuses the same type instead of duplicating it.
    again = await _map_tag_to_type(
        session_override, tenant.id, "refund request", "", dry_run=False
    )
    assert again is not None and again.id == created.id


@pytest.mark.asyncio
async def test_set_thread_tags_tool_curated_only(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    catalog_seed = await _ingest(client, headers, "Seeds the catalog")
    await client.patch(f"/api/signals/{catalog_seed}", headers=headers, json={"tags": ["billing"]})
    target = await _ingest(client, headers, "Agent will tag this")

    from uuid import UUID

    from app.models.auth import Tenant, User
    from app.tools.registry import ToolContext, get_tool_spec

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User))).scalars().first()
    spec = get_tool_spec("set_thread_tags")
    assert spec is not None

    ctx = ToolContext(session=session_override, tenant_id=tenant.id, user_id=user.id)
    result = await spec.handler(
        ctx, {"signal_id": target, "tags": ["billing", "made-up-tag"]}
    )
    assert result["ok"] is True
    assert result["added"] == ["billing"]
    assert result["rejected"] == ["made-up-tag"]

    signal = (
        await session_override.execute(select(Signal).where(Signal.id == UUID(target)))
    ).scalar_one()
    assert json.loads(signal.tags_json) == ["billing"]

    # Only catalog tags are allowed: all-unknown input is refused.
    refused = await spec.handler(ctx, {"signal_id": target, "tags": ["another-new-tag"]})
    assert "error" in refused


@pytest.mark.asyncio
async def test_inbox_folder_preferences_roundtrip(client: AsyncClient, session_override):
    headers = await _auth_headers(client)

    initial = await client.get("/api/me/preferences", headers=headers)
    assert initial.status_code == 200
    assert initial.json()["inbox_folders"]["default_queue"] == "open"

    patched = await client.patch(
        "/api/me/preferences",
        headers=headers,
        json={
            "inbox_folders": {
                "default_queue": "mine",
                "channel_defaults": {"channel:email:12": "closed", "bogus": "not-a-queue"},
                "sidebar_tags": ["Billing", "vip", "billing", "  ", 12],
            }
        },
    )
    assert patched.status_code == 200
    body = patched.json()["inbox_folders"]
    assert body["default_queue"] == "mine"
    # Invalid queue values are dropped, valid overrides kept.
    assert body["channel_defaults"] == {"channel:email:12": "closed"}
    # Tags are lowercased, trimmed, and de-duplicated.
    assert body["sidebar_tags"] == ["billing", "vip"]

    invalid = await client.patch(
        "/api/me/preferences",
        headers=headers,
        json={"inbox_folders": {"default_queue": "bogus"}},
    )
    assert invalid.status_code == 400

    outbound = await client.patch(
        "/api/me/preferences",
        headers=headers,
        json={"default_outbound_connection_id": 42},
    )
    assert outbound.status_code == 200
    assert outbound.json()["default_outbound_connection_id"] == 42
    cleared = await client.patch(
        "/api/me/preferences",
        headers=headers,
        json={"default_outbound_connection_id": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["default_outbound_connection_id"] is None
