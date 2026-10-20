"""Conversation tags: registry, links, curated agent tagging and tag rules."""

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.signal import Signal
from app.services.signal_tags import normalize_tag, signal_tag_names


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


def test_normalize_tag_joins_words_with_underscores():
    assert normalize_tag("  Mistral AI ") == "mistral_ai"
    assert normalize_tag("#mistral-ai") == "mistral_ai"
    assert normalize_tag("mistral__ai") == "mistral_ai"
    assert normalize_tag("Billing") == "billing"


@pytest.mark.asyncio
async def test_thread_tags_are_normalized_and_registered(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    signal_id = await _ingest(client, headers, "Mixed case tags")

    patched = await client.patch(
        f"/api/signals/{signal_id}",
        headers=headers,
        json={"tags": ["  Billing ", "billing", "VIP", "mistral-ai"]},
    )
    assert patched.status_code == 200
    assert patched.json()["tags"] == ["billing", "mistral_ai", "vip"]

    detail = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert sorted(detail.json()["thread"]["tags"]) == ["billing", "mistral_ai", "vip"]


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
async def test_triage_files_the_category_as_ticket_not_tag(client: AsyncClient, session_override):
    """A triage category hit files the ticket; it is not repeated as a free tag."""
    headers = await _auth_headers(client)
    signal_id = await _ingest(client, headers, "Refund request")

    from app.models.auth import Tenant
    from app.services.interpretation import _file_from_triage

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    created = await client.post("/api/categories", headers=headers, json={"name": "refund"})
    category_id = UUID(created.json()["id"])
    await client.patch(
        f"/api/categories/{category_id}", headers=headers, json={"create_mode": "auto", "auto_threshold": 5}
    )
    from app.models.signal import SignalTag

    category = await session_override.get(SignalTag, category_id)
    await session_override.refresh(category)

    for _ in range(2):
        await _file_from_triage(
            session_override,
            tenant.id,
            signal_id=UUID(signal_id),
            category=category,
            summary="Customer wants a refund for order 123.",
            certainty=90,
        )
    signal = await session_override.get(Signal, UUID(signal_id))
    await session_override.refresh(signal)
    assert signal.ticket_tag_id == category_id
    assert signal.ticket_status == "open"
    assert await signal_tag_names(session_override, UUID(signal_id)) == []


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
async def test_merge_label_moves_conversations_and_rules(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    first = await _ingest(client, headers, "Invoice one")
    second = await _ingest(client, headers, "Invoice two")
    await client.patch(f"/api/signals/{first}", headers=headers, json={"tags": ["factuur"]})
    await client.patch(f"/api/signals/{second}", headers=headers, json={"tags": ["factuur", "facturen"]})
    rule = await client.post(
        "/api/signals/rules",
        headers=headers,
        json={"match_type": "domain", "match_value": "bills.test", "action": "tag", "tags": ["factuur"]},
    )
    assert rule.status_code == 200, rule.text
    assert rule.json()["labels"] == ["factuur"]

    registry = {row["name"]: row for row in (await client.get("/api/signals/tags", headers=headers)).json()}
    merged = await client.post(
        f"/api/signals/tags/{registry['factuur']['id']}/merge",
        headers=headers,
        json={"into_id": registry["facturen"]["id"]},
    )
    assert merged.status_code == 200, merged.text
    assert merged.json()["name"] == "facturen"

    names = [row["name"] for row in (await client.get("/api/signals/tags", headers=headers)).json()]
    assert "factuur" not in names
    assert (await client.get(f"/api/signals/{first}", headers=headers)).json()["thread"]["tags"] == ["facturen"]
    assert (await client.get(f"/api/signals/{second}", headers=headers)).json()["thread"]["tags"] == ["facturen"]
    rules = await client.get("/api/signals/rules", headers=headers)
    kept = next(row for row in rules.json() if row["id"] == rule.json()["id"])
    assert kept["labels"] == ["facturen"]


@pytest.mark.asyncio
async def test_tag_rule_tags_and_keeps_flow(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    rule = await client.post(
        "/api/signals/rules",
        headers=headers,
        json={"match_type": "domain", "match_value": "acme.test", "action": "tag", "tags": ["Key account"]},
    )
    assert rule.status_code == 200, rule.text
    assert rule.json()["labels"] == ["key_account"]

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
    assert added == ["key_account"]
    assert await signal_tag_names(session_override, signal.id) == ["key_account"]
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
    assert result["rejected"] == ["made_up_tag"]

    assert await signal_tag_names(session_override, UUID(target)) == ["billing"]

    # Only catalog tags are allowed: all-unknown input is refused.
    refused = await spec.handler(ctx, {"signal_id": target, "tags": ["another-new-tag"]})
    assert "error" in refused


@pytest.mark.asyncio
async def test_set_thread_tags_falls_back_when_signal_id_missing(
    client: AsyncClient, session_override
):
    """Stale/wrong explicit signal_id must still tag the current thread."""
    headers = await _auth_headers(client)
    catalog_seed = await _ingest(client, headers, "Catalog for fallback")
    await client.patch(f"/api/signals/{catalog_seed}", headers=headers, json={"tags": ["docs"]})
    target = await _ingest(client, headers, "Needs a tag despite bad id")

    from uuid import UUID

    from app.models.auth import Tenant, User
    from app.tools.registry import ToolContext, get_tool_spec

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User))).scalars().first()
    spec = get_tool_spec("set_thread_tags")
    assert spec is not None

    ctx = ToolContext(
        session=session_override,
        tenant_id=tenant.id,
        user_id=user.id,
        signal_id=UUID(target),
    )
    missing = "00000000-0000-4000-8000-000000000099"
    result = await spec.handler(
        ctx, {"signal_id": missing, "tags": ["docs"]}
    )
    assert result.get("ok") is True
    assert result.get("signal_id") == target
    assert "docs" in (result.get("added") or result.get("tags") or [])
    assert await signal_tag_names(session_override, UUID(target)) == ["docs"]


@pytest.mark.asyncio
async def test_set_thread_tags_removes_own_free_label(client: AsyncClient, session_override):
    from types import SimpleNamespace
    from uuid import uuid4

    from app.models.auth import Tenant, User
    from app.models.channel import Contact
    from app.models.signal import ContactTagLink, Signal, SignalEvent, SignalTag
    from app.tools.registry import ToolContext, get_tool_spec

    headers = await _auth_headers(client)
    seed = await _ingest(client, headers, "Catalog seed")
    await client.patch(f"/api/signals/{seed}", headers=headers, json={"tags": ["bug", "vip"]})
    target = await _ingest(client, headers, "Payment receipt")
    tagged = await client.patch(f"/api/signals/{target}", headers=headers, json={"tags": ["bug"]})
    assert tagged.status_code == 200, tagged.text

    folder = await client.post(
        "/api/folders",
        headers=headers,
        json={"name": "Bugs", "slug": "bugs", "tags": ["bug"]},
    )
    assert folder.status_code == 200, folder.text
    filed = await client.get(f"/api/signals/{target}", headers=headers)
    assert filed.json()["thread"]["project_id"] == folder.json()["id"]

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User))).scalars().first()
    contact = Contact(tenant_id=tenant.id, channel="email", address="vip@acme.test", display_name="Vip")
    session_override.add(contact)
    await session_override.flush()
    vip = (
        await session_override.execute(
            select(SignalTag).where(SignalTag.tenant_id == tenant.id, SignalTag.name == "vip")
        )
    ).scalar_one()
    session_override.add(ContactTagLink(contact_id=contact.id, tag_id=vip.id, tenant_id=tenant.id))
    signal = await session_override.get(Signal, UUID(target))
    signal.contact_id = contact.id
    session_override.add(signal)
    await session_override.commit()

    category = await client.post("/api/categories", headers=headers, json={"name": "repair"})
    assert category.status_code == 200, category.text
    filed_ticket = await client.put(
        f"/api/signals/{target}/ticket",
        headers=headers,
        json={"tag_id": category.json()["id"]},
    )
    assert filed_ticket.status_code == 200, filed_ticket.text

    spec = get_tool_spec("set_thread_tags")
    agent = SimpleNamespace(id=uuid4(), name="Orchestrator")
    ctx = ToolContext(session=session_override, tenant_id=tenant.id, user_id=user.id, agent=agent)

    removed = await spec.handler(ctx, {"signal_id": target, "remove": ["bug"]})
    assert removed["ok"] is True
    assert removed["removed"] == ["bug"]
    assert "bug" not in await signal_tag_names(session_override, UUID(target))
    await session_override.refresh(signal)
    assert signal.project_id is None
    event = (
        await session_override.execute(
            select(SignalEvent)
            .where(SignalEvent.signal_id == UUID(target), SignalEvent.event_type == "thread_updated")
            .order_by(SignalEvent.created_at.desc())
        )
    ).scalars().first()
    assert event is not None
    assert event.actor_type == "agent"
    assert "bug" in (event.payload_json or "")

    action = await spec.handler(ctx, {"signal_id": target, "remove": ["repair"]})
    assert action["removed"] == []
    assert action["refused"][0]["reason"] == "action_tag"
    still = await session_override.get(Signal, UUID(target))
    await session_override.refresh(still)
    assert still.ticket_tag_id is not None

    inherited = await spec.handler(ctx, {"signal_id": target, "remove": ["vip"]})
    assert inherited["removed"] == []
    assert inherited["refused"][0]["reason"] == "inherited"
    catalog = await session_override.get(SignalTag, vip.id)
    assert catalog is not None


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

    rail = await client.patch(
        "/api/me/preferences",
        headers=headers,
        json={
            "rail_pins": [{"ref": "folder:abc", "position": 1}, {"ref": "tag:vip", "position": 0}],
            "rail_hidden_defaults": ["tag:old"],
            "sidebar": {"order": ["hashtags", "channels"], "hidden": ["projects"], "collapsed": []},
        },
    )
    assert rail.status_code == 200
    assert [row["ref"] for row in rail.json()["rail_pins"]] == ["tag:vip", "folder:abc"]
    assert rail.json()["rail_hidden_defaults"] == ["tag:old"]
    assert rail.json()["sidebar"]["order"][0] == "folders"
    assert "folders" in rail.json()["sidebar"]["hidden"]
