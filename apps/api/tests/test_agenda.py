from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient

from app.services.agenda import compute_next_run_at, expand_event_occurrences
from app.models.agenda import AgendaEvent


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_compute_next_run_at_hourly():
    base = datetime(2026, 6, 4, 10, 0, 0)
    nxt = compute_next_run_at(base, "hourly", 2)
    assert nxt == datetime(2026, 6, 4, 12, 0, 0)


def test_expand_daily_recurrence():
    row = AgendaEvent(
        tenant_id=__import__("uuid").uuid4(),
        calendar_id=__import__("uuid").uuid4(),
        title="Daily",
        starts_at=datetime(2026, 6, 1, 9, 0, 0),
        recurrence_freq="daily",
        recurrence_interval=1,
    )
    occ = expand_event_occurrences(
        row,
        datetime(2026, 6, 1, 0, 0, 0),
        datetime(2026, 6, 5, 0, 0, 0),
    )
    assert len(occ) >= 4


@pytest.mark.asyncio
async def test_agenda_calendars_and_events_crud(client: AsyncClient):
    headers = await _auth_headers(client)

    cals = await client.get("/api/agenda/calendars", headers=headers)
    assert cals.status_code == 200
    body = cals.json()
    assert any(c["name"] == "My agenda" for c in body)
    assert any(c["name"] == "Orchestrator" for c in body)
    user_cal = next(c for c in body if c["kind"] == "user")

    start = datetime.utcnow().isoformat() + "Z"
    end = (datetime.utcnow() + timedelta(days=30)).isoformat() + "Z"
    empty = await client.get(f"/api/agenda/events?start={start}&end={end}", headers=headers)
    assert empty.status_code == 200
    assert "items" in empty.json()

    create = await client.post(
        "/api/agenda/events",
        headers=headers,
        json={
            "calendar_id": user_cal["id"],
            "title": "Test event",
            "starts_at": (datetime.utcnow() + timedelta(days=1)).isoformat() + "Z",
            "recurrence_freq": "none",
        },
    )
    assert create.status_code == 200
    event_id = create.json()["id"]

    detail = await client.get(f"/api/agenda/events/{event_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["title"] == "Test event"

    patch = await client.patch(
        f"/api/agenda/events/{event_id}",
        headers=headers,
        json={"title": "Updated event"},
    )
    assert patch.status_code == 200
    assert patch.json()["title"] == "Updated event"

    orch_cal = next(c for c in body if c["kind"] == "orchestrator")
    orch = await client.post(
        "/api/agenda/events",
        headers=headers,
        json={
            "calendar_id": orch_cal["id"],
            "kind": "orchestrator",
            "title": "Wake test",
            "starts_at": datetime.utcnow().isoformat() + "Z",
            "prompt": "Run a quick scan",
            "recurrence_freq": "hourly",
            "recurrence_interval": 1,
            "enabled": True,
        },
    )
    assert orch.status_code == 200
    orch_id = orch.json()["id"]
    assert orch.json().get("next_run_at")

    run = await client.post(f"/api/agenda/events/{orch_id}/run", headers=headers)
    assert run.status_code == 200
    assert "run_id" in run.json()

    delete = await client.delete(f"/api/agenda/events/{event_id}", headers=headers)
    assert delete.status_code == 200
