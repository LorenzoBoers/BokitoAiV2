"""Conversation tags: registry, links, curated agent tagging and tag rules."""

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.signal import Signal
from app.services.signal_tags import signal_tag_names


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

    detail = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert sorted(detail.json()["thread"]["tags"]) == ["billing", "vip"]


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
    """Catalog hits from triage become Cases; the conversation gets no tags."""
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
    # No workstream binding: the category labels the conversation and is done.
    assert cases[0].status == "done"
    assert cases[0].created_by_type == "triage"

    assert await signal_tag_names(session_override, UUID(signal_id)) == []

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
async def test_tag_registry_rename_merges_and_delete_unlinks(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    first = await _ingest(client, headers, "Tagged vip")
    second = await _ingest(client, headers, "Tagged both")
    await client.patch(f"/api/signals/{first}", headers=headers, json={"tags": ["vip"]})
    await client.patch(f"/api/signals/{second}", headers=headers, json={"tags": ["vip", "gold"]})

    registry = (await client.get("/api/signals/tags", headers=headers)).json()
    by_name = {row["name"]: row for row in registry}
    assert by_name["vip"]["count"] == 2
    assert by_name["gold"]["count"] == 1

    created = await client.post(
        "/api/signals/tags", headers=headers, json={"name": " Partner ", "description": "Resellers"}
    )
    assert created.status_code == 200
    assert created.json()["name"] == "partner"

    # Renaming "gold" onto "vip" merges: one link per conversation survives.
    merged = await client.patch(
        f"/api/signals/tags/{by_name['gold']['id']}", headers=headers, json={"name": "VIP"}
    )
    assert merged.status_code == 200
    assert merged.json()["id"] == by_name["vip"]["id"]
    detail = (await client.get(f"/api/signals/{second}", headers=headers)).json()
    assert detail["thread"]["tags"] == ["vip"]

    removed = await client.delete(f"/api/signals/tags/{by_name['vip']['id']}", headers=headers)
    assert removed.status_code == 204
    detail = (await client.get(f"/api/signals/{first}", headers=headers)).json()
    assert detail["thread"]["tags"] == []
    names = [row["name"] for row in (await client.get("/api/signals/tags", headers=headers)).json()]
    assert names == ["partner"]


@pytest.mark.asyncio
async def test_tag_rule_tags_and_keeps_flow(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    rule = await client.post(
        "/api/signals/rules",
        headers=headers,
        json={"match_type": "domain", "match_value": "acme.test", "action": "tag", "tags": ["Key account"]},
    )
    assert rule.status_code == 200, rule.text
    assert rule.json()["labels"] == ["key account"]

    missing = await client.post(
        "/api/signals/rules",
        headers=headers,
        json={"match_type": "domain", "match_value": "other.test", "action": "tag"},
    )
    assert missing.status_code == 400

    from app.models.auth import Tenant
    from app.models.learning import InboxRule
    from app.services import inbox_rules

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    signal_id = await _ingest(client, headers, "From acme")
    signal = (
        await session_override.execute(select(Signal).where(Signal.id == UUID(signal_id)))
    ).scalar_one()

    # Tag rules never short-circuit the inbound flow.
    assert await inbox_rules.find_matching_rule(session_override, tenant.id, "anna@acme.test") is None
    rules = await inbox_rules.find_tag_rules(session_override, tenant.id, "anna@acme.test")
    assert [r.action for r in rules] == ["tag"]
    added = await inbox_rules.apply_tag_rules(session_override, tenant.id, signal, rules)
    assert added == ["key account"]
    assert await signal_tag_names(session_override, signal.id) == ["key account"]
    hit = await session_override.get(InboxRule, rules[0].id)
    assert hit.hit_count == 1


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

    assert await signal_tag_names(session_override, UUID(target)) == ["billing"]

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
                "default_queue": "for_you",
                "channel_defaults": {"channel:email:12": "closed", "bogus": "not-a-queue"},
                # Retired preference is ignored instead of reviving tag folders.
                "sidebar_tags": ["Billing", "vip", "billing", "  ", 12],
            }
        },
    )
    assert patched.status_code == 200
    body = patched.json()["inbox_folders"]
    assert body["default_queue"] == "for_you"
    # Invalid queue values are dropped, valid overrides kept.
    assert body["channel_defaults"] == {"channel:email:12": "closed"}
    assert "sidebar_tags" not in body

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
