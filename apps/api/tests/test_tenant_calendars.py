"""First-class tenant calendars: sync, tags, per-calendar access."""

import json
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.calendar import CalendarEvent, CalendarTagLink, TenantCalendar
from app.models.integration import IntegrationConnection
from app.services.calendar_sync import CalendarViewer, calendar_events_in_window, sync_connection
from app.services.crypto import set_connection_credentials
from app.services import tenant_calendars as tc_svc


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = (await session.execute(select(Tenant))).scalars().first()
    if tenant is None:
        tenant = Tenant(name="TC Test", slug=f"tc-{uuid4().hex[:8]}")
        session.add(tenant)
        await session.commit()
        await session.refresh(tenant)
    return tenant


async def _conn(session: AsyncSession, tenant: Tenant, *, meta: dict | None = None) -> IntegrationConnection:
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="google_calendar",
        display_name="Google Calendar",
        status="active",
        metadata_json=json.dumps(
            meta
            or {
                "calendars": [
                    {
                        "id": "me@example.com",
                        "name": "Me",
                        "color": "#4285f4",
                        "primary": True,
                        "writable": True,
                        "enabled": True,
                    },
                    {
                        "id": "team",
                        "name": "Team",
                        "color": "#0b8043",
                        "primary": False,
                        "writable": True,
                        "enabled": True,
                    },
                ]
            }
        ),
    )
    set_connection_credentials(conn, {"mock": True})
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return conn


@pytest.mark.asyncio
async def test_selection_creates_tenant_calendars_and_purges(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = await _conn(session_override, tenant)
    await sync_connection(session_override, conn)

    rows = await tc_svc.rows_for_connection(session_override, conn.id)
    assert {r.external_id for r in rows} == {"me@example.com", "team"}
    assert all(r.sync_enabled for r in rows)

    await tc_svc.set_selection(session_override, conn, enabled_ids=["me@example.com"])
    rows = await tc_svc.rows_for_connection(session_override, conn.id)
    by_ext = {r.external_id: r for r in rows}
    assert by_ext["me@example.com"].sync_enabled is True
    assert by_ext["team"].sync_enabled is False
    events = (
        await session_override.execute(
            select(CalendarEvent).where(CalendarEvent.connection_id == conn.id)
        )
    ).scalars().all()
    assert all(e.calendar_id == "me@example.com" or e.calendar_id == "primary" for e in events)


@pytest.mark.asyncio
async def test_calendar_acl_hides_events(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    owner_id, other_id = uuid4(), uuid4()
    conn = await _conn(session_override, tenant)
    await sync_connection(session_override, conn)
    rows = await tc_svc.rows_for_connection(session_override, conn.id)
    team = next(r for r in rows if r.external_id == "team")
    # Bypass validate_entries (no User rows in this fixture).
    team.access_json = json.dumps(
        [{"kind": "user", "id": str(owner_id), "level": "manage"}]
    )
    session_override.add(team)
    await session_override.commit()

    window = {
        "start": datetime.utcnow() - timedelta(hours=1),
        "end": datetime.utcnow() + timedelta(days=3),
    }
    owner = CalendarViewer(user_id=owner_id, role="member")
    other = CalendarViewer(user_id=other_id, role="member")

    listed_owner = await tc_svc.list_tenant_calendars(session_override, tenant.id, owner)
    listed_other = await tc_svc.list_tenant_calendars(session_override, tenant.id, other)
    assert str(team.id) in {r["id"] for r in listed_owner}
    assert str(team.id) not in {r["id"] for r in listed_other}
    other_ids = {
        e.get("tenant_calendar_id")
        for e in await calendar_events_in_window(session_override, tenant.id, viewer=other, **window)
    }
    assert str(team.id) not in other_ids


@pytest.mark.asyncio
async def test_calendar_tags_filter(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = await _conn(session_override, tenant)
    await sync_connection(session_override, conn)
    rows = await tc_svc.rows_for_connection(session_override, conn.id)
    me = next(r for r in rows if r.external_id == "me@example.com")
    await tc_svc.set_calendar_tags(session_override, tenant.id, me.id, ["holidays"])
    await session_override.commit()

    links = (
        await session_override.execute(
            select(CalendarTagLink).where(CalendarTagLink.calendar_id == me.id)
        )
    ).scalars().all()
    assert len(links) == 1

    tagged = await tc_svc.list_tenant_calendars(session_override, tenant.id, None)
    me_row = next(r for r in tagged if r["id"] == str(me.id))
    assert [t["name"] for t in me_row["tags"]] == ["holidays"]

    window = {
        "start": datetime.utcnow() - timedelta(hours=1),
        "end": datetime.utcnow() + timedelta(days=3),
    }
    filtered = await calendar_events_in_window(
        session_override, tenant.id, tag_names=["holidays"], **window
    )
    assert all(e.get("tenant_calendar_id") == str(me.id) for e in filtered)


@pytest.mark.asyncio
async def test_backfill_from_meta_on_ensure(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = await _conn(session_override, tenant)
    rows = await tc_svc.ensure_from_snapshot(session_override, conn)
    await session_override.commit()
    assert len(rows) == 2
    assert isinstance(rows[0], TenantCalendar)
    again = await tc_svc.ensure_from_snapshot(session_override, conn)
    assert {r.id for r in again} == {r.id for r in rows}
