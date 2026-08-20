"""Govern audit coverage for human-initiated mutations.

Every consequential operator action (thread lifecycle, agent CRUD, invites,
workspace settings, budget caps, password change) must land in audit_events
so the Govern audit page shows one unified "who did what" trail.
"""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.audit import AuditEvent
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login_headers(client: AsyncClient) -> dict:
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _seed_thread(client: AsyncClient, headers: dict, subject: str = "Audit me") -> str:
    r = await client.post(
        "/api/email/mock/inbound",
        json={
            "from_address": "customer@example.com",
            "subject": subject,
            "body_text": "Please help.",
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()["thread_id"]


async def _audit_events(session, action: str) -> list[AuditEvent]:
    rows = await session.execute(select(AuditEvent).where(AuditEvent.action == action))
    return list(rows.scalars().all())


# --- Thread lifecycle ----------------------------------------------------------


@pytest.mark.asyncio
async def test_thread_status_change_is_audited(client: AsyncClient, session_override):
    headers = await _login_headers(client)
    signal_id = await _seed_thread(client, headers)

    r = await client.patch(
        f"/api/signals/{signal_id}", json={"status": "closed"}, headers=headers
    )
    assert r.status_code == 200, r.text

    events = await _audit_events(session_override, "signal:updated")
    assert len(events) == 1
    event = events[0]
    assert event.actor_type == "user"
    assert event.resource_id == str(signal_id)
    assert json.loads(event.after_json)["status"] == "closed"

    # Tag-only tweaks stay out of the govern audit (noise control).
    r = await client.patch(
        f"/api/signals/{signal_id}", json={"tags": ["vip"]}, headers=headers
    )
    assert r.status_code == 200, r.text
    events = await _audit_events(session_override, "signal:updated")
    assert len(events) == 1


@pytest.mark.asyncio
async def test_bulk_close_is_audited_once(client: AsyncClient, session_override):
    headers = await _login_headers(client)
    first = await _seed_thread(client, headers, subject="Bulk one")
    second = await _seed_thread(client, headers, subject="Bulk two")

    r = await client.post(
        "/api/signals/bulk",
        json={"signal_ids": [first, second], "action": "close"},
        headers=headers,
    )
    assert r.status_code == 200, r.text

    events = await _audit_events(session_override, "signal:bulk_close")
    assert len(events) == 1
    assert "2 thread(s)" in events[0].summary

    # Mark-read churn must not create audit rows.
    r = await client.post(
        "/api/signals/bulk",
        json={"signal_ids": [first], "action": "read"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert await _audit_events(session_override, "signal:bulk_read") == []


@pytest.mark.asyncio
async def test_thread_delete_and_takeover_are_audited(client: AsyncClient, session_override):
    headers = await _login_headers(client)
    signal_id = await _seed_thread(client, headers)

    r = await client.post(f"/api/signals/{signal_id}/takeover", headers=headers)
    assert r.status_code == 200, r.text
    assert len(await _audit_events(session_override, "signal:takeover")) == 1

    r = await client.post(f"/api/signals/{signal_id}/release", headers=headers)
    assert r.status_code == 200, r.text
    assert len(await _audit_events(session_override, "signal:handback")) == 1

    r = await client.delete(f"/api/signals/{signal_id}", headers=headers)
    assert r.status_code == 200, r.text
    deleted = await _audit_events(session_override, "signal:deleted")
    assert len(deleted) == 1
    assert deleted[0].actor_type == "user"


# --- Agent CRUD ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_agent_crud_is_audited(client: AsyncClient, session_override):
    headers = await _login_headers(client)

    r = await client.post(
        "/api/workforce/agents",
        json={"name": "Audit Agent", "role": "communication"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    agent_id = r.json()["agent"]["id"]
    created = await _audit_events(session_override, "agent:created")
    assert len(created) == 1
    assert created[0].resource_id == agent_id
    assert created[0].summary == "Audit Agent"

    r = await client.patch(
        f"/api/workforce/agents/{agent_id}",
        json={"name": "Audit Agent v2"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert len(await _audit_events(session_override, "agent:updated")) == 1

    r = await client.delete(f"/api/workforce/agents/{agent_id}", headers=headers)
    assert r.status_code == 200, r.text
    archived = await _audit_events(session_override, "agent:archived")
    assert len(archived) == 1
    assert archived[0].resource_id == agent_id


# --- Invites & workspace settings ------------------------------------------------


@pytest.mark.asyncio
async def test_invite_create_and_revoke_are_audited(client: AsyncClient, session_override):
    headers = await _login_headers(client)
    r = await client.get("/api/app/workspaces", headers=headers)
    ws = r.json()[0]["id"]

    r = await client.post(
        "/api/app/workspace-invites",
        json={"workspace_id": ws, "email": "newbie@example.com", "role": "member"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    invite_id = r.json()["id"]
    created = await _audit_events(session_override, "invite:created")
    assert len(created) == 1
    assert created[0].resource_id == invite_id
    assert "newbie@example.com" in created[0].summary

    r = await client.delete(
        f"/api/app/workspaces/{ws}/invites/{invite_id}", headers=headers
    )
    assert r.status_code == 200, r.text
    revoked = await _audit_events(session_override, "invite:revoked")
    assert len(revoked) == 1
    assert revoked[0].resource_id == invite_id


@pytest.mark.asyncio
async def test_workspace_settings_update_is_audited(client: AsyncClient, session_override):
    headers = await _login_headers(client)
    r = await client.get("/api/app/workspaces", headers=headers)
    ws = r.json()[0]["id"]

    r = await client.post(
        f"/api/app/workspaces/{ws}", json={"name": "Renamed Tenant"}, headers=headers
    )
    assert r.status_code == 200, r.text
    events = await _audit_events(session_override, "workspace:settings_updated")
    assert len(events) == 1
    after = json.loads(events[0].after_json)
    assert after["name"] == "Renamed Tenant"
    assert "name" in after["fields"]


# --- Budget & account security ----------------------------------------------------


@pytest.mark.asyncio
async def test_budget_update_is_audited(client: AsyncClient, session_override):
    headers = await _login_headers(client)
    r = await client.patch(
        "/api/cockpit/budget", json={"daily_token_cap": 123456}, headers=headers
    )
    assert r.status_code == 200, r.text
    events = await _audit_events(session_override, "billing:budget_updated")
    assert len(events) == 1
    assert json.loads(events[0].after_json)["daily_token_cap"] == 123456


@pytest.mark.asyncio
async def test_unified_activity_includes_human_audit(client: AsyncClient, session_override):
    """The Cockpit activity timeline merges human audit events with run events."""
    headers = await _login_headers(client)
    signal_id = await _seed_thread(client, headers, subject="Activity feed check")

    r = await client.patch(
        f"/api/signals/{signal_id}", json={"status": "closed"}, headers=headers
    )
    assert r.status_code == 200, r.text

    r = await client.get("/api/cockpit/activity", headers=headers)
    assert r.status_code == 200, r.text
    items = r.json()
    audit_items = [i for i in items if i.get("kind") == "audit"]
    assert audit_items, items
    updated = [i for i in audit_items if i["event_type"] == "signal:updated"]
    assert len(updated) == 1
    # The acting operator is resolved to a display name for the feed.
    assert updated[0]["actor_name"] == "Test"


@pytest.mark.asyncio
async def test_password_change_is_audited(client: AsyncClient, session_override):
    headers = await _login_headers(client)
    r = await client.post(
        "/api/auth/change-password",
        json={
            "current_password": TEST_PASSWORD,
            "new_password": TEST_PASSWORD,
            "password_confirmation": TEST_PASSWORD,
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    events = await _audit_events(session_override, "user:password_changed")
    assert len(events) == 1
    assert events[0].actor_type == "user"
