"""Stage owner and check-up: a flow stage hands the ticket to an owner and
wakes on a rhythm while the ticket stays there; the Agenda shows it."""

import os
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant, User
from app.models.signal import Signal
from app.models.trigger import Trigger
from app.services.time_items import merge_calendar_events
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

os.environ["BOKITO_MOCK_EXECUTION"] = "true"

API = "/api/workstreams"


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _checkups(session, signal_id) -> list[Trigger]:
    rows = await session.execute(
        select(Trigger).where(Trigger.signal_id == signal_id, Trigger.purpose == "stage_checkup")
    )
    return list(rows.scalars().all())


@pytest.mark.asyncio
async def test_stage_owner_and_checkup_follow_the_ticket(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    me = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()

    flow = (await client.post(API, headers=headers, json={"name": "retour"})).json()
    stages = [
        {
            "key": "intake",
            "name": "Intake",
            "kind": "open",
            "owner": {"kind": "user", "id": str(me.id)},
            "checkup_minutes": 1440,
        },
        {"key": "wacht", "name": "Wacht", "kind": "waiting"},
        {"key": "klaar", "name": "Klaar", "kind": "done", "checkup_minutes": 60},
    ]
    saved = await client.patch(f"{API}/{flow['id']}", headers=headers, json={"stages": stages})
    assert saved.status_code == 200, saved.text
    by_key = {s["key"]: s for s in saved.json()["stages"]}
    assert by_key["intake"]["checkup_minutes"] == 1440
    assert by_key["intake"]["owner"] == {"kind": "user", "id": str(me.id)}
    assert by_key["klaar"]["checkup_minutes"] == 0

    signal = Signal(tenant_id=tenant.id, channel="widget", source="widget", subject="Kapotte pomp")
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)
    sid = signal.id

    filed = await client.put(f"/api/signals/{sid}/ticket", headers=headers, json={"tag": "retour"})
    assert filed.status_code == 200, filed.text
    ticket = (await client.get(f"/api/signals/{sid}/ticket", headers=headers)).json()["ticket"]
    assert ticket["stage_key"] == "intake"
    assert ticket["checkup"]["every_minutes"] == 1440
    await session_override.refresh(signal)
    assert signal.assignee_kind == "user" and signal.assigned_user_id == me.id

    agenda = await client.get("/api/agenda", headers=headers, params={"sources": "checkup,activity"})
    assert agenda.status_code == 200, agenda.text
    items = agenda.json()["items"]
    checkup = next(i for i in items if i["kind"] == "checkup")
    assert checkup["signal_id"] == str(sid)
    assert checkup["owner_kind"] == "user" and checkup["owner_id"] == str(me.id)
    assert any(i["kind"] == "activity" and i["status"] == "filed" for i in items)

    # Routines stay readable: check-ups are not listed as triggers.
    listed = (await client.get("/api/triggers", headers=headers)).json()["triggers"]
    assert all(t.get("purpose") != "stage_checkup" for t in listed)

    moved = await client.patch(f"/api/signals/{sid}/ticket", headers=headers, json={"stage_key": "wacht"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["ticket"]["checkup"] is None
    session_override.expire_all()
    assert await _checkups(session_override, sid) == []

    back = await client.patch(f"/api/signals/{sid}/ticket", headers=headers, json={"stage_key": "intake"})
    assert back.json()["ticket"]["checkup"] is not None

    # Due: the person's conversation turns unread and the rhythm continues.
    session_override.expire_all()
    (row,) = await _checkups(session_override, sid)
    row.next_run_at = datetime.utcnow() - timedelta(minutes=1)
    session_override.add(row)
    signal = await session_override.get(Signal, sid)
    signal.has_unread = False
    session_override.add(signal)
    await session_override.commit()

    fired = await client.post(f"/api/triggers/{row.id}/run", headers=headers)
    assert fired.status_code == 200, fired.text
    assert fired.json()["status"] == "due"
    session_override.expire_all()
    signal = await session_override.get(Signal, sid)
    assert signal.has_unread is True
    (row,) = await _checkups(session_override, sid)
    assert row.next_run_at > datetime.utcnow() + timedelta(hours=23)

    # Turning the rhythm off removes the check-up from every ticket in the stage.
    stages[0]["checkup_minutes"] = 0
    off = await client.patch(f"{API}/{flow['id']}", headers=headers, json={"stages": stages})
    assert off.status_code == 200, off.text
    session_override.expire_all()
    assert await _checkups(session_override, sid) == []


@pytest.mark.asyncio
async def test_stage_owner_must_belong_to_the_workspace(client: AsyncClient):
    headers = await _login(client)
    flow = (await client.post(API, headers=headers, json={"name": "storing"})).json()
    bad = await client.patch(
        f"{API}/{flow['id']}",
        headers=headers,
        json={
            "stages": [
                {
                    "key": "open",
                    "name": "Open",
                    "kind": "open",
                    "owner": {"kind": "agent", "id": "00000000-0000-0000-0000-000000000001"},
                },
                {"key": "done", "name": "Done", "kind": "done"},
            ]
        },
    )
    assert bad.status_code == 400
    assert "unknown owner" in bad.text


def test_calendar_events_merge_across_connections():
    base = {"start": "2026-10-06T09:00:00", "end": "2026-10-06T09:30:00"}
    events = [
        {"id": "cal:1", "title": "Team standup", "calendar_name": "Work", **base},
        {"id": "cal:2", "title": "Team Standup ", "calendar_name": "Shared", **base},
        {"id": "cal:3", "title": "Lunch", "calendar_name": "Work", **base},
    ]
    merged = merge_calendar_events(events)
    assert [e["id"] for e in merged] == ["cal:1", "cal:3"]
    assert merged[0]["calendars"] == ["Work", "Shared"]
