"""Calendar sync: mock seed, agenda merge, create/update/delete."""

from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.calendar import CalendarEvent
from app.models.integration import IntegrationConnection
from app.services.calendar_sync import (
    all_day_span,
    create_external_event,
    calendar_events_in_window,
    sync_connection,
    update_external_event,
)
from app.services.time_items import list_time_items


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = (await session.execute(select(Tenant))).scalars().first()
    if tenant is None:
        tenant = Tenant(name="Cal Test", slug=f"cal-test-{uuid4().hex[:8]}")
        session.add(tenant)
        await session.commit()
        await session.refresh(tenant)
    return tenant


@pytest.mark.asyncio
async def test_mock_sync_seeds_events(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="google_calendar",
        display_name="Google Calendar",
        status="active",
        credentials_json='{"mock": true}',
        metadata_json="{}",
    )
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)

    result = await sync_connection(session_override, conn)
    assert result.get("synced", 0) >= 1

    rows = (
        await session_override.execute(
            select(CalendarEvent).where(CalendarEvent.connection_id == conn.id)
        )
    ).scalars().all()
    assert len(rows) >= 1


@pytest.mark.asyncio
async def test_agenda_merges_calendar_events(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="outlook_calendar",
        display_name="Outlook Calendar",
        status="active",
        credentials_json='{"mock": true}',
        metadata_json="{}",
    )
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)

    start = datetime.utcnow() + timedelta(hours=2)
    end = start + timedelta(hours=1)
    session_override.add(
        CalendarEvent(
            tenant_id=tenant.id,
            connection_id=conn.id,
            provider="outlook_calendar",
            external_id=f"test-{uuid4().hex[:8]}",
            title="Team sync",
            start_at=start,
            end_at=end,
        )
    )
    await session_override.commit()

    items = await list_time_items(
        session_override,
        tenant.id,
        start=datetime.utcnow() - timedelta(hours=1),
        end=datetime.utcnow() + timedelta(days=2),
    )
    cal = [i for i in items if i.get("kind") == "calendar"]
    assert any(i.get("title") == "Team sync" for i in cal)


@pytest.mark.asyncio
async def test_create_and_delete_mock_event(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="google_calendar",
        display_name="Google Calendar",
        status="active",
        credentials_json='{"mock": true}',
        metadata_json="{}",
    )
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)

    start = datetime.utcnow() + timedelta(days=1)
    end = start + timedelta(hours=1)
    created = await create_external_event(
        session_override,
        tenant.id,
        connection_id=conn.id,
        title="Block",
        start_at=start,
        end_at=end,
    )
    assert created.get("id")
    event_id = created["id"]

    items = await calendar_events_in_window(
        session_override,
        tenant.id,
        start=start - timedelta(hours=1),
        end=end + timedelta(hours=1),
    )
    assert any(i.get("title") == "Block" for i in items)

    from app.services.calendar_sync import delete_external_event
    from uuid import UUID

    await delete_external_event(session_override, tenant.id, UUID(event_id))
    remaining = (
        await session_override.execute(
            select(CalendarEvent).where(CalendarEvent.id == UUID(event_id))
        )
    ).scalar_one_or_none()
    assert remaining is None


def test_all_day_span_same_day_is_exclusive_next_midnight():
    start = datetime(2026, 10, 6, 13, 0, 0)
    end = datetime(2026, 10, 6, 14, 0, 0)
    assert all_day_span(start, end) == (
        datetime(2026, 10, 6, 0, 0, 0),
        datetime(2026, 10, 7, 0, 0, 0),
    )


@pytest.mark.asyncio
async def test_create_all_day_mock_event(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="google_calendar",
        display_name="Google Calendar",
        status="active",
        credentials_json='{"mock": true}',
        metadata_json="{}",
    )
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)

    start = datetime(2026, 10, 6, 13, 0, 0)
    end = datetime(2026, 10, 6, 14, 0, 0)
    created = await create_external_event(
        session_override,
        tenant.id,
        connection_id=conn.id,
        title="Offsite",
        start_at=start,
        end_at=end,
        all_day=True,
    )
    assert created.get("all_day") is True
    row = await session_override.get(CalendarEvent, UUID(created["id"]))
    assert row is not None
    assert row.all_day is True
    assert row.start_at == datetime(2026, 10, 6, 0, 0, 0)
    assert row.end_at == datetime(2026, 10, 7, 0, 0, 0)

    items = await calendar_events_in_window(
        session_override,
        tenant.id,
        start=datetime(2026, 10, 6, 0, 0, 0),
        end=datetime(2026, 10, 7, 0, 0, 0),
    )
    match = next((i for i in items if i.get("title") == "Offsite"), None)
    assert match is not None
    assert match.get("all_day") is True


@pytest.mark.asyncio
async def test_update_mock_event(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="google_calendar",
        display_name="Google Calendar",
        status="active",
        credentials_json='{"mock": true}',
        metadata_json="{}",
    )
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)

    start = datetime.utcnow() + timedelta(days=2)
    end = start + timedelta(hours=1)
    created = await create_external_event(
        session_override,
        tenant.id,
        connection_id=conn.id,
        title="Draft block",
        start_at=start,
        end_at=end,
        description="before",
        location="Room A",
    )
    event_id = UUID(created["id"])
    new_start = start + timedelta(hours=3)
    new_end = new_start + timedelta(hours=2)
    updated = await update_external_event(
        session_override,
        tenant.id,
        event_id,
        title="Rescheduled block",
        start_at=new_start,
        end_at=new_end,
        description="after",
        location="Room B",
    )
    assert updated["title"] == "Rescheduled block"
    assert updated["id"] == str(event_id)

    row = await session_override.get(CalendarEvent, event_id)
    assert row is not None
    assert row.title == "Rescheduled block"
    assert row.description == "after"
    assert row.location == "Room B"
    assert row.start_at == new_start
    assert row.end_at == new_end

    items = await calendar_events_in_window(
        session_override,
        tenant.id,
        start=new_start - timedelta(hours=1),
        end=new_end + timedelta(hours=1),
    )
    match = next((i for i in items if i.get("title") == "Rescheduled block"), None)
    assert match is not None
    assert match.get("id", "").endswith(str(event_id)) or str(event_id) in str(match.get("id"))
    assert match.get("location") == "Room B"

    with pytest.raises(ValueError, match="end_at"):
        await update_external_event(
            session_override,
            tenant.id,
            event_id,
            start_at=new_start,
            end_at=new_start,
        )

    with pytest.raises(ValueError, match="not found"):
        await update_external_event(
            session_override,
            tenant.id,
            uuid4(),
            title="ghost",
        )


@pytest.mark.asyncio
async def test_calendars_api_patch_event(client: AsyncClient, session_override: AsyncSession):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    tenant = await _tenant(session_override)
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="outlook_calendar",
        display_name="Outlook Calendar",
        status="active",
        credentials_json='{"mock": true}',
        metadata_json="{}",
    )
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)

    start = datetime.utcnow() + timedelta(days=3)
    end = start + timedelta(hours=1)
    created = await create_external_event(
        session_override,
        tenant.id,
        connection_id=conn.id,
        title="API draft",
        start_at=start,
        end_at=end,
    )
    event_id = created["id"]

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    new_start = start + timedelta(hours=2)
    new_end = new_start + timedelta(hours=1)
    res = await client.patch(
        f"/api/calendars/events/{event_id}",
        headers=headers,
        json={
            "title": "API updated",
            "start_at": new_start.isoformat() + "Z",
            "end_at": new_end.isoformat() + "Z",
            "description": "moved",
            "location": "HQ",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()["event"]
    assert body["title"] == "API updated"
    assert body["id"] == event_id

    bad_range = await client.patch(
        f"/api/calendars/events/{event_id}",
        headers=headers,
        json={
            "start_at": new_end.isoformat() + "Z",
            "end_at": new_start.isoformat() + "Z",
        },
    )
    assert bad_range.status_code == 400

    empty = await client.patch(
        f"/api/calendars/events/{event_id}",
        headers=headers,
        json={},
    )
    assert empty.status_code == 400

    missing = await client.patch(
        f"/api/calendars/events/{uuid4()}",
        headers=headers,
        json={"title": "nope"},
    )
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_calendar_update_decision_apply(session_override: AsyncSession):
    import json
    from app.models.notification import DecisionRequest
    from app.services.notifications import resolve_decision

    tenant = await _tenant(session_override)
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="google_calendar",
        display_name="Google Calendar",
        status="active",
        credentials_json='{"mock": true}',
        metadata_json="{}",
    )
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)

    start = datetime.utcnow() + timedelta(days=4)
    end = start + timedelta(hours=1)
    created = await create_external_event(
        session_override,
        tenant.id,
        connection_id=conn.id,
        title="Decision draft",
        start_at=start,
        end_at=end,
    )
    event_id = created["id"]
    new_start = start + timedelta(hours=5)
    new_end = new_start + timedelta(hours=1)

    decision = DecisionRequest(
        tenant_id=tenant.id,
        title="Update calendar event: Decision draft",
        summary="Reschedule",
        status="awaiting_human",
        options_json=json.dumps(
            [
                {
                    "id": "approve",
                    "label": "Update event",
                    "action_type": "calendar_update_event",
                    "payload": {
                        "event_id": event_id,
                        "title": "Decision applied",
                        "start_at": new_start.isoformat() + "Z",
                        "end_at": new_end.isoformat() + "Z",
                        "location": "Boardroom",
                    },
                },
                {"id": "reject", "label": "Reject", "action_type": "reject"},
            ]
        ),
    )
    session_override.add(decision)
    await session_override.commit()
    await session_override.refresh(decision)

    await resolve_decision(
        session_override,
        tenant.id,
        decision.id,
        option_id="approve",
        action="approved",
        user_id=uuid4(),
    )

    row = await session_override.get(CalendarEvent, UUID(event_id))
    assert row is not None
    assert row.title == "Decision applied"
    assert row.location == "Boardroom"


@pytest.mark.asyncio
async def test_calendars_api_list(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    res = await client.get(
        "/api/calendars/connections",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert "connections" in body


@pytest.mark.asyncio
async def test_calendar_providers_in_catalog(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    res = await client.get(
        "/api/integrations/providers",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    slugs = {p["slug"] for p in res.json()["providers"]}
    assert "google_calendar" in slugs
    assert "outlook_calendar" in slugs
    google = next(p for p in res.json()["providers"] if p["slug"] == "google_calendar")
    assert google.get("capabilities", {}).get("calendar") is True


@pytest.mark.asyncio
async def test_list_calendar_connections_accepts_catalog_uuid(session_override: AsyncSession):
    from app.services.calendar_sync import list_calendar_connections
    from app.services.integrations_catalog import provider_id

    tenant = await _tenant(session_override)
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider=provider_id("google_calendar"),
        display_name="Google Calendar",
        status="active",
        credentials_json='{"mock": true}',
        metadata_json="{}",
    )
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)

    rows = await list_calendar_connections(session_override, tenant.id)
    match = next(row for row in rows if row["id"] == str(conn.id))
    assert match["provider"] == "google_calendar"

