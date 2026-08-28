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
async def test_apply_triage_merges_tags_union(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    signal_id = await _ingest(client, headers, "Tagged by operator")
    await client.patch(f"/api/signals/{signal_id}", headers=headers, json={"tags": ["operator-tag"]})

    from uuid import UUID

    from app.models.auth import Tenant
    from app.services.signals import apply_triage

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    signal = await apply_triage(
        session_override,
        tenant.id,
        UUID(signal_id),
        category="billing",
        urgency=50,
        impact=40,
        summary="Summary",
        certainty=80,
        tags=["billing", "operator-tag"],
    )
    tags = json.loads(signal.tags_json)
    # Union merge: operator tag kept, AI tag added, no duplicates.
    assert sorted(tags) == ["billing", "operator-tag"]


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
