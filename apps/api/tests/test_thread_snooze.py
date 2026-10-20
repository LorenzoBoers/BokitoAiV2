"""Planning with one owner, snoozing (hide until) and the Scheduled segment."""

from datetime import datetime, timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    r = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _create_thread(client: AsyncClient, headers: dict, *, email: str = "snooze@example.com") -> str:
    r = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "test",
            "subject": "Quote follow-up",
            "body_text": "Any news on the quote?",
            "contact_email": email,
            "contact_name": "Customer",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _ids(client: AsyncClient, headers: dict, **params) -> list[str]:
    r = await client.get("/api/signals", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return [row["id"] for row in r.json()["items"]]


async def _thread(client: AsyncClient, headers: dict, signal_id: str) -> dict:
    r = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["thread"]


@pytest.mark.asyncio
async def test_snooze_hides_then_surfaces_before_the_moment(client: AsyncClient, session_override):
    from app.models.signal import Signal
    from app.services.thread_schedule import wake_due_threads

    headers = await _login(client)
    signal_id = await _create_thread(client, headers)
    at = datetime.utcnow() + timedelta(hours=3)

    r = await client.put(
        f"/api/signals/{signal_id}/schedule",
        headers=headers,
        json={"at": at.isoformat(), "hide": True, "surface_before_minutes": 60},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "snoozed"
    assert body["hidden_until"] is not None

    assert signal_id not in await _ids(client, headers, view="all")
    assert signal_id not in await _ids(client, headers, view="all_open")
    assert signal_id in await _ids(client, headers, view="all_open", segment="scheduled")

    row = await session_override.get(Signal, UUID(signal_id))
    assert row.hidden_until is not None
    assert abs((row.next_at - row.hidden_until) - timedelta(minutes=60)) < timedelta(seconds=5)
    row.hidden_until = datetime.utcnow() - timedelta(minutes=1)
    session_override.add(row)
    await session_override.commit()

    assert await wake_due_threads(session_override) >= 1
    thread = await _thread(client, headers, signal_id)
    assert thread["status"] == "open"
    assert thread["has_unread"] is True
    assert thread["hidden_until"] is None
    assert thread["next_at"] is not None
    assert signal_id in await _ids(client, headers, view="all_open")

    # The moment itself only clears the date; it does not notify a second time.
    await session_override.refresh(row)
    row.next_at = datetime.utcnow() - timedelta(minutes=1)
    session_override.add(row)
    await session_override.commit()
    await wake_due_threads(session_override)
    thread = await _thread(client, headers, signal_id)
    assert thread["next_at"] is None
    assert thread["status"] == "open"


@pytest.mark.asyncio
async def test_inbound_message_wakes_a_snoozed_thread(client: AsyncClient):
    headers = await _login(client)
    signal_id = await _create_thread(client, headers, email="wake@example.com")
    at = (datetime.utcnow() + timedelta(days=1)).isoformat()
    r = await client.put(f"/api/signals/{signal_id}/schedule", headers=headers, json={"at": at, "hide": True})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "snoozed"

    again = await _create_thread(client, headers, email="wake@example.com")
    assert again == signal_id

    thread = await _thread(client, headers, signal_id)
    assert thread["status"] == "open"
    assert thread["hidden_until"] is None
    assert thread["next_at"] is not None


@pytest.mark.asyncio
async def test_without_hide_the_thread_stays_open(client: AsyncClient):
    headers = await _login(client)
    signal_id = await _create_thread(client, headers, email="visible@example.com")
    at = (datetime.utcnow() + timedelta(days=1)).isoformat()
    r = await client.put(f"/api/signals/{signal_id}/schedule", headers=headers, json={"at": at})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "open"
    assert signal_id in await _ids(client, headers, view="all_open")
    assert signal_id in await _ids(client, headers, view="all_open", segment="scheduled")


@pytest.mark.asyncio
async def test_notify_false_surfaces_without_notification(client: AsyncClient, session_override):
    from app.models.notification import Notification
    from app.models.signal import Signal
    from app.services.thread_schedule import wake_due_threads

    headers = await _login(client)
    signal_id = await _create_thread(client, headers, email="quiet@example.com")
    at = datetime.utcnow() + timedelta(hours=2)
    r = await client.put(
        f"/api/signals/{signal_id}/schedule",
        headers=headers,
        json={"at": at.isoformat(), "hide": True, "surface_before_minutes": 30, "notify": False},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "snoozed"
    assert body["schedule_details"].get("notify") is False

    row = await session_override.get(Signal, UUID(signal_id))
    assert row is not None
    assert abs((row.next_at - row.hidden_until) - timedelta(minutes=30)) < timedelta(seconds=5)
    row.hidden_until = datetime.utcnow() - timedelta(minutes=1)
    session_override.add(row)
    await session_override.commit()

    before = (
        await session_override.execute(select(Notification).where(Notification.signal_id == UUID(signal_id)))
    ).scalars().all()
    assert await wake_due_threads(session_override) >= 1
    after = (
        await session_override.execute(select(Notification).where(Notification.signal_id == UUID(signal_id)))
    ).scalars().all()
    assert len(after) == len(before)
    thread = await _thread(client, headers, signal_id)
    assert thread["status"] == "open"
    assert thread["has_unread"] is True


@pytest.mark.asyncio
async def test_agent_owner_runs_the_task(client: AsyncClient, session_override):
    from app.models.agent import Agent
    from app.models.signal import Signal
    from app.models.trigger import Trigger

    headers = await _login(client)
    signal_id = await _create_thread(client, headers, email="agent-owner@example.com")
    row = await session_override.get(Signal, UUID(signal_id))
    agent = Agent(tenant_id=row.tenant_id, name="Follow-up agent", kind="company")
    session_override.add(agent)
    await session_override.commit()
    await session_override.refresh(agent)

    at = (datetime.utcnow() + timedelta(hours=2)).isoformat()
    r = await client.put(
        f"/api/signals/{signal_id}/schedule",
        headers=headers,
        json={"at": at, "instructions": "Ask whether the quote landed.", "owner": {"kind": "agent", "id": str(agent.id)}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["owner"]["kind"] == "agent"
    assert body["schedule"]["agent_id"] == str(agent.id)

    rule = (
        await session_override.execute(select(Trigger).where(Trigger.signal_id == UUID(signal_id)))
    ).scalars().first()
    assert rule is not None and rule.agent_id == agent.id


@pytest.mark.asyncio
async def test_repeat_for_a_person_is_a_reminder(client: AsyncClient, session_override):
    from app.models.signal import Signal
    from app.models.trigger import Trigger
    from app.services.triggers import fire_trigger

    headers = await _login(client)
    signal_id = await _create_thread(client, headers, email="reminder@example.com")
    r = await client.put(
        f"/api/signals/{signal_id}/schedule",
        headers=headers,
        json={"cron": "0 9 * * 1", "note": "Check the bank export", "owner": {"kind": "user", "id": "me"}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["owner"]["kind"] == "user"
    assert body["schedule"]["agent_id"] is None

    rule = (
        await session_override.execute(select(Trigger).where(Trigger.signal_id == UUID(signal_id)))
    ).scalars().first()
    row = await session_override.get(Signal, UUID(signal_id))
    row.status = "closed"
    row.has_unread = False
    session_override.add(row)
    await session_override.commit()

    result = await fire_trigger(session_override, rule, manual=True)
    assert result.get("status") != "error", result
    await session_override.refresh(row)
    assert row.status == "open"
    assert row.has_unread is True
    assert row.next_at is not None


@pytest.mark.asyncio
async def test_scheduled_segment_keeps_the_for_you_scope(client: AsyncClient):
    headers = await _login(client)
    mine = await _create_thread(client, headers, email="mine@example.com")
    at = (datetime.utcnow() + timedelta(days=1)).isoformat()
    r = await client.put(
        f"/api/signals/{mine}/schedule",
        headers=headers,
        json={"at": at, "hide": True, "owner": {"kind": "user", "id": "me"}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["owner"]["kind"] == "user"

    assert mine in await _ids(client, headers, view="for_you", segment="scheduled")
    assert mine not in await _ids(client, headers, view="unassigned", segment="scheduled")
