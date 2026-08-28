"""Cycle 12: full-text search, snooze, bulk actions and saved replies."""

from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient, email: str, password: str) -> dict:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _create_thread(
    client: AsyncClient,
    headers: dict,
    *,
    subject: str = "Order question",
    body_text: str = "Where is my package?",
    contact_email: str = "customer@example.com",
    contact_name: str = "Customer",
) -> str:
    r = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "test",
            "subject": subject,
            "body_text": body_text,
            "contact_email": contact_email,
            "contact_name": contact_name,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _list(client: AsyncClient, headers: dict, **params) -> list[dict]:
    r = await client.get("/api/signals", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()["items"]


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_matches_message_bodies(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    hit = await _create_thread(
        client, owner, subject="Generic subject", body_text="My tracking code is ZX-9981."
    )
    await _create_thread(client, owner, subject="Other thread", body_text="Unrelated text")

    items = await _list(client, owner, search="ZX-9981", view="all")
    assert [t["id"] for t in items] == [hit]


@pytest.mark.asyncio
async def test_search_matches_contact_name(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    hit = await _create_thread(client, owner, contact_name="Miriam Vandenberg")
    await _create_thread(client, owner, contact_name="Someone Else")

    items = await _list(client, owner, search="vandenberg", view="all")
    assert [t["id"] for t in items] == [hit]


# ---------------------------------------------------------------------------
# Snooze
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_snooze_sets_pending_and_wake_time(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    signal_id = await _create_thread(client, owner)

    until = (datetime.utcnow() + timedelta(hours=2)).isoformat()
    r = await client.patch(
        f"/api/signals/{signal_id}", headers=owner, json={"snoozed_until": until}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["snoozed_until"] is not None

    # Shows up in the snoozed view.
    items = await _list(client, owner, view="snoozed")
    assert signal_id in [t["id"] for t in items]

    # Reopening clears the wake time.
    r = await client.patch(f"/api/signals/{signal_id}", headers=owner, json={"status": "open"})
    assert r.status_code == 200
    assert r.json()["snoozed_until"] is None


@pytest.mark.asyncio
async def test_reply_send_and_pending_with_snooze_minutes(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    signal_id = await _create_thread(client, owner)

    r = await client.post(
        f"/api/signals/{signal_id}/reply",
        headers=owner,
        json={"body_text": "We will follow up.", "action": "send_and_pending", "snooze_minutes": 90},
    )
    assert r.status_code == 200, r.text

    r = await client.get(f"/api/signals/{signal_id}", headers=owner)
    thread = r.json()["thread"]
    assert thread["status"] == "pending"
    assert thread["snoozed_until"] is not None


@pytest.mark.asyncio
async def test_wake_snoozed_threads_reopens_due(client: AsyncClient, session_override):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    signal_id = await _create_thread(client, owner)

    past = (datetime.utcnow() - timedelta(minutes=5)).isoformat()
    r = await client.patch(
        f"/api/signals/{signal_id}", headers=owner, json={"snoozed_until": past}
    )
    assert r.status_code == 200

    from app.services.signal_threads import wake_snoozed_threads

    woken = await wake_snoozed_threads(session_override)
    assert woken == 1

    r = await client.get(f"/api/signals/{signal_id}", headers=owner)
    thread = r.json()["thread"]
    assert thread["status"] == "open"
    assert thread["snoozed_until"] is None
    assert thread["has_unread"] is True


# ---------------------------------------------------------------------------
# Scheduled send + soft undo
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scheduled_reply_can_be_cancelled(client: AsyncClient, session_override):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    signal_id = await _create_thread(client, owner)

    r = await client.post(
        f"/api/signals/{signal_id}/reply",
        headers=owner,
        json={"body_text": "Hold this reply", "send_after_seconds": 60},
    )
    assert r.status_code == 200, r.text
    msg = r.json()
    assert msg["send_status"] == "scheduled"
    assert msg["send_after"] is not None

    # Not yet due: the scheduler tick must leave it alone.
    from app.services.signal_threads import deliver_due_outbound_messages

    assert await deliver_due_outbound_messages(session_override) == 0

    # Undo removes the message before delivery and returns the draft body.
    r = await client.post(f"/api/signals/messages/{msg['id']}/cancel", headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["body_text"] == "Hold this reply"

    # Second cancel is a 404 (already gone), and the thread no longer shows it.
    r = await client.post(f"/api/signals/messages/{msg['id']}/cancel", headers=owner)
    assert r.status_code == 404
    r = await client.get(f"/api/signals/{signal_id}", headers=owner)
    assert all(m["id"] != msg["id"] for m in r.json()["messages"])


@pytest.mark.asyncio
async def test_scheduled_reply_delivers_when_due(client: AsyncClient, session_override):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    signal_id = await _create_thread(client, owner)

    r = await client.post(
        f"/api/signals/{signal_id}/reply",
        headers=owner,
        json={"body_text": "Delayed answer", "send_after_seconds": 60},
    )
    assert r.status_code == 200, r.text
    msg_id = r.json()["id"]

    # Rewind the send time so the scheduler considers it due.
    from uuid import UUID

    from app.models.signal import SignalMessage
    from app.services.signal_threads import deliver_due_outbound_messages

    row = await session_override.get(SignalMessage, UUID(msg_id))
    row.send_after = datetime.utcnow() - timedelta(minutes=1)
    session_override.add(row)
    await session_override.commit()

    assert await deliver_due_outbound_messages(session_override) == 1

    r = await client.get(f"/api/signals/{signal_id}", headers=owner)
    delivered = next(m for m in r.json()["messages"] if m["id"] == msg_id)
    assert delivered["send_status"] == "sent"
    assert delivered["send_after"] is None


# ---------------------------------------------------------------------------
# Bulk actions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_close_and_spam(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    a = await _create_thread(client, owner, subject="A")
    b = await _create_thread(client, owner, subject="B")
    c = await _create_thread(client, owner, subject="C")

    r = await client.post(
        "/api/signals/bulk", headers=owner, json={"signal_ids": [a, b], "action": "close"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == 2

    closed_ids = [t["id"] for t in await _list(client, owner, view="closed")]
    assert a in closed_ids and b in closed_ids

    r = await client.post(
        "/api/signals/bulk", headers=owner, json={"signal_ids": [c], "action": "spam"}
    )
    assert r.status_code == 200
    spam_ids = [t["id"] for t in await _list(client, owner, view="spam")]
    assert c in spam_ids


@pytest.mark.asyncio
async def test_bulk_snooze(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    a = await _create_thread(client, owner, subject="Snooze me")
    wake = "2026-09-01T07:00:00Z"
    r = await client.post(
        "/api/signals/bulk",
        headers=owner,
        json={"signal_ids": [a], "action": "snooze", "snoozed_until": wake},
    )
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == 1
    pending = await _list(client, owner, view="snoozed")
    row = next(t for t in pending if t["id"] == a)
    assert row["status"] == "pending"
    assert row["snoozed_until"]


@pytest.mark.asyncio
async def test_bulk_assign_and_read(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    a = await _create_thread(client, owner, subject="Assign me")

    r = await client.get("/api/signals/members", headers=owner)
    me = next(m["id"] for m in r.json() if m["email"] == TEST_EMAIL)

    r = await client.post(
        "/api/signals/bulk",
        headers=owner,
        json={"signal_ids": [a], "action": "assign", "assignee_id": me},
    )
    assert r.status_code == 200, r.text

    r = await client.post(
        "/api/signals/bulk", headers=owner, json={"signal_ids": [a], "action": "read"}
    )
    assert r.status_code == 200

    items = await _list(client, owner, view="mine")
    row = next(t for t in items if t["id"] == a)
    assert row["assigned_to_user_id"] == me
    assert row["has_unread"] is False


@pytest.mark.asyncio
async def test_bulk_close_defers_open_reply_suggestions(client: AsyncClient, session_override):
    """Closing threads in bulk must clear their pending reply-suggestion cards."""
    from uuid import UUID

    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.models.notification import DecisionRequest, Notification
    from app.models.signal import Signal

    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    thread_id = await _create_thread(client, owner, subject="Bulk close with pending card")

    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    signal = (
        await session_override.execute(select(Signal).where(Signal.id == UUID(thread_id)))
    ).scalar_one()
    notification = Notification(
        tenant_id=tenant.id, kind="decision_request", title="Suggested reply", body=""
    )
    session_override.add(notification)
    await session_override.flush()
    decision = DecisionRequest(
        tenant_id=tenant.id,
        notification_id=notification.id,
        signal_id=signal.id,
        title="Suggested reply",
        summary="Draft",
        options_json="[]",
        status="awaiting_human",
    )
    session_override.add(decision)
    await session_override.commit()

    r = await client.post(
        "/api/signals/bulk", headers=owner, json={"signal_ids": [thread_id], "action": "close"}
    )
    assert r.status_code == 200, r.text

    await session_override.refresh(decision)
    assert decision.status == "deferred"
    assert decision.chosen_option_id == "thread_closed"


@pytest.mark.asyncio
async def test_bulk_rejects_unknown_action(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    a = await _create_thread(client, owner)
    r = await client.post(
        "/api/signals/bulk", headers=owner, json={"signal_ids": [a], "action": "explode"}
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Saved replies
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_saved_replies_crud(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)

    r = await client.post(
        "/api/signals/saved-replies",
        headers=owner,
        json={"title": "Refund policy", "body_text": "Refunds take 5 business days."},
    )
    assert r.status_code == 200, r.text
    reply_id = r.json()["id"]

    r = await client.get("/api/signals/saved-replies", headers=owner)
    assert r.status_code == 200
    rows = r.json()
    assert any(row["id"] == reply_id for row in rows)

    r = await client.patch(
        f"/api/signals/saved-replies/{reply_id}",
        headers=owner,
        json={"title": "Refund policy v2", "body_text": "Refunds take 3 business days."},
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Refund policy v2"

    r = await client.delete(f"/api/signals/saved-replies/{reply_id}", headers=owner)
    assert r.status_code == 200

    r = await client.get("/api/signals/saved-replies", headers=owner)
    assert all(row["id"] != reply_id for row in r.json())


@pytest.mark.asyncio
async def test_saved_reply_requires_title_and_body(client: AsyncClient):
    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    r = await client.post(
        "/api/signals/saved-replies", headers=owner, json={"title": " ", "body_text": ""}
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Thread delete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_thread_cleans_referencing_rows(client: AsyncClient, session_override):
    """Deleting a thread must not leave FK references behind (Postgres 500s).

    Decisions attached to the thread are deleted with it; tasks, triggers,
    outcomes, and platform changes survive but lose their link.
    """
    from uuid import UUID

    from sqlalchemy import select

    from app.models.notification import DecisionRequest
    from app.models.orchestration import AgentTask
    from app.models.outcome import OperationalOutcome
    from app.models.platform_change import PlatformChange
    from app.models.signal import Signal
    from app.models.trigger import Trigger

    owner = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    signal_id = await _create_thread(client, owner, subject="Thread with attachments")
    sig_uuid = UUID(signal_id)

    signal = (
        await session_override.execute(select(Signal).where(Signal.id == sig_uuid))
    ).scalar_one()
    tenant_id = signal.tenant_id

    decision = DecisionRequest(tenant_id=tenant_id, signal_id=sig_uuid, title="Approve reply?")
    session_override.add(decision)
    await session_override.flush()
    change = PlatformChange(
        tenant_id=tenant_id, resource_type="signal", decision_id=decision.id
    )
    task = AgentTask(tenant_id=tenant_id, signal_id=sig_uuid, title="Follow up")
    trigger = Trigger(tenant_id=tenant_id, name="Daily scan", signal_id=sig_uuid)
    outcome = OperationalOutcome(tenant_id=tenant_id, signal_id=sig_uuid)
    session_override.add_all([change, task, trigger, outcome])
    await session_override.commit()
    decision_id = decision.id

    r = await client.delete(f"/api/signals/{signal_id}", headers=owner)
    assert r.status_code == 200, r.text

    # Thread and its decision are gone.
    assert (
        await session_override.execute(select(Signal).where(Signal.id == sig_uuid))
    ).scalar_one_or_none() is None
    assert (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.id == decision_id)
        )
    ).scalar_one_or_none() is None

    # Referencing records survive with the link detached.
    await session_override.refresh(change)
    await session_override.refresh(task)
    await session_override.refresh(trigger)
    await session_override.refresh(outcome)
    assert change.decision_id is None
    assert task.signal_id is None
    assert trigger.signal_id is None
    assert outcome.signal_id is None
