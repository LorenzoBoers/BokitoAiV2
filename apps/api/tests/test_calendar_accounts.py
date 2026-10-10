"""Calendar accounts: token refresh, reconnect, calendar choice, access."""

import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.calendar import CalendarEvent
from app.models.integration import IntegrationConnection
from app.services import calendar_sync
from app.services.calendar_sync import (
    CalendarAuthError,
    CalendarViewer,
    calendar_events_in_window,
    create_external_event,
    list_calendar_connections,
    set_calendar_selection,
    sync_connection,
)
from app.services.crypto import get_connection_credentials, set_connection_credentials


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = (await session.execute(select(Tenant))).scalars().first()
    if tenant is None:
        tenant = Tenant(name="Cal Test", slug=f"cal-test-{uuid4().hex[:8]}")
        session.add(tenant)
        await session.commit()
        await session.refresh(tenant)
    return tenant


async def _conn(
    session: AsyncSession,
    tenant: Tenant,
    *,
    creds: dict | None = None,
    meta: dict | None = None,
    provider: str = "google_calendar",
) -> IntegrationConnection:
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider=provider,
        display_name="Google Calendar" if provider == "google_calendar" else "Outlook Calendar",
        status="active",
        metadata_json=json.dumps(meta or {}),
    )
    set_connection_credentials(conn, creds or {"mock": True})
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return conn


def _event(ext: str, title: str, *, hours: int = 2) -> dict:
    start = datetime.utcnow().replace(microsecond=0) + timedelta(hours=hours)
    return {
        "external_id": ext,
        "ical_uid": f"{ext}@example.com",
        "title": title,
        "description": "",
        "location": "",
        "start_at": start,
        "end_at": start + timedelta(hours=1),
        "all_day": False,
        "status": "confirmed",
        "html_link": "",
        "attendees": [],
    }


CALENDARS = [
    {"id": "me@example.com", "name": "Me", "color": "#4285f4", "primary": True, "writable": True},
    {"id": "team@group.calendar", "name": "Team", "color": "#0b8043", "primary": False, "writable": True},
    {"id": "holidays", "name": "Holidays", "color": "", "primary": False, "writable": False},
]


def test_expiry_accepts_iso_and_epoch():
    iso = "2026-01-01T12:00:00"
    expected = datetime(2026, 1, 1, 12, tzinfo=timezone.utc).timestamp()
    assert calendar_sync._expiry_ts(iso) == expected
    assert calendar_sync._expiry_ts(iso + "+00:00") == expected
    assert calendar_sync._expiry_ts(expected) == expected
    assert calendar_sync._expiry_ts("") is None
    assert calendar_sync._expiry_ts(None) is None


def test_new_calendars_start_enabled_only_when_primary():
    merged = calendar_sync._merge_calendars([], CALENDARS)
    assert [c["enabled"] for c in merged] == [True, False, False]
    kept = calendar_sync._merge_calendars(
        [{**CALENDARS[1], "enabled": True}, {**CALENDARS[0], "enabled": False}], CALENDARS
    )
    assert [c["enabled"] for c in kept] == [False, True, False]


@pytest.mark.asyncio
async def test_expired_iso_token_refreshes(session_override: AsyncSession, monkeypatch):
    tenant = await _tenant(session_override)
    past = (datetime.utcnow() - timedelta(minutes=5)).isoformat()
    conn = await _conn(
        session_override,
        tenant,
        creds={"access_token": "old", "refresh_token": "r1", "expires_at": past},
    )

    async def fake_refresh(provider, *, refresh_token):
        assert refresh_token == "r1"
        return {"access_token": "new", "expires_in": 3600}

    monkeypatch.setattr(calendar_sync.oauth_providers, "refresh_access_token", fake_refresh)
    assert await calendar_sync._access_token(session_override, conn) == "new"
    stored = get_connection_credentials(conn)
    assert stored["access_token"] == "new"
    assert isinstance(stored["expires_at"], str)
    assert calendar_sync._expiry_ts(stored["expires_at"]) > datetime.now(timezone.utc).timestamp()


@pytest.mark.asyncio
async def test_401_refreshes_once_then_syncs_enabled_calendars(
    session_override: AsyncSession, monkeypatch
):
    tenant = await _tenant(session_override)
    future = (datetime.utcnow() + timedelta(hours=1)).isoformat()
    conn = await _conn(
        session_override,
        tenant,
        creds={"access_token": "stale", "refresh_token": "r1", "expires_at": future},
        meta={"calendars": [{**CALENDARS[0], "enabled": True}, {**CALENDARS[1], "enabled": True}]},
    )

    async def fake_refresh(provider, *, refresh_token):
        return {"access_token": "fresh", "expires_in": 3600}

    async def fake_fetch(slug, token, stored):
        if token != "fresh":
            raise CalendarAuthError("401")
        calendars = calendar_sync._merge_calendars(stored, CALENDARS)
        return calendars, {
            "me@example.com": [_event("a1", "Mine")],
            "team@group.calendar": [_event("t1", "Team standup")],
        }

    monkeypatch.setattr(calendar_sync.oauth_providers, "refresh_access_token", fake_refresh)
    monkeypatch.setattr(calendar_sync, "_fetch_account", fake_fetch)

    result = await sync_connection(session_override, conn)
    assert result["status"] == "ok"
    assert result["synced"] == 2
    rows = (
        await session_override.execute(
            select(CalendarEvent).where(CalendarEvent.connection_id == conn.id)
        )
    ).scalars().all()
    assert {(r.calendar_id, r.calendar_name) for r in rows} == {
        ("me@example.com", "Me"),
        ("team@group.calendar", "Team"),
    }
    assert all(json.loads(r.metadata_json).get("ical_uid") for r in rows)

    await set_calendar_selection(session_override, conn, enabled_ids=["me@example.com"])
    rows = (
        await session_override.execute(
            select(CalendarEvent).where(CalendarEvent.connection_id == conn.id)
        )
    ).scalars().all()
    assert [r.calendar_id for r in rows] == ["me@example.com"]


@pytest.mark.asyncio
async def test_rejected_refresh_marks_reconnect_and_keeps_events(
    session_override: AsyncSession, monkeypatch
):
    tenant = await _tenant(session_override)
    conn = await _conn(
        session_override,
        tenant,
        creds={"access_token": "stale", "refresh_token": "revoked"},
    )
    start = datetime.utcnow() + timedelta(hours=3)
    session_override.add(
        CalendarEvent(
            tenant_id=tenant.id,
            connection_id=conn.id,
            provider="google_calendar",
            external_id="kept",
            title="Cached",
            start_at=start,
            end_at=start + timedelta(hours=1),
        )
    )
    await session_override.commit()

    async def fake_refresh(provider, *, refresh_token):
        raise RuntimeError("invalid_grant")

    async def fake_fetch(slug, token, stored):
        raise CalendarAuthError("401")

    monkeypatch.setattr(calendar_sync.oauth_providers, "refresh_access_token", fake_refresh)
    monkeypatch.setattr(calendar_sync, "_fetch_account", fake_fetch)

    result = await sync_connection(session_override, conn)
    assert result["status"] == "reconnect"
    await session_override.refresh(conn)
    assert json.loads(conn.metadata_json)["sync_status"] == "reconnect"
    kept = (
        await session_override.execute(
            select(CalendarEvent).where(CalendarEvent.connection_id == conn.id)
        )
    ).scalars().all()
    assert [r.external_id for r in kept] == ["kept"]


@pytest.mark.asyncio
async def test_no_demo_events_in_production(session_override: AsyncSession, monkeypatch):
    tenant = await _tenant(session_override)
    conn = await _conn(session_override, tenant)
    monkeypatch.setattr(calendar_sync, "_mock_allowed", lambda: False)

    result = await sync_connection(session_override, conn)
    assert result["status"] == "reconnect"
    rows = (
        await session_override.execute(
            select(CalendarEvent).where(CalendarEvent.connection_id == conn.id)
        )
    ).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_access_list_limits_people_and_agents(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    owner_id, other_id, agent_id = uuid4(), uuid4(), uuid4()
    conn = await _conn(
        session_override,
        tenant,
        meta={"access": calendar_sync.default_access_entries(owner_id)},
    )
    await sync_connection(session_override, conn)
    window = {
        "start": datetime.utcnow() - timedelta(hours=1),
        "end": datetime.utcnow() + timedelta(days=3),
    }

    def ids(rows):
        return {r["connection_id"] for r in rows}

    mine = CalendarViewer(user_id=owner_id, role="member")
    other = CalendarViewer(user_id=other_id, role="member")
    admin = CalendarViewer(user_id=other_id, role="admin")
    agent = CalendarViewer(agent_id=agent_id)

    assert str(conn.id) in ids(
        await calendar_events_in_window(session_override, tenant.id, viewer=mine, **window)
    )
    assert str(conn.id) not in ids(
        await calendar_events_in_window(session_override, tenant.id, viewer=other, **window)
    )
    assert str(conn.id) in ids(
        await calendar_events_in_window(session_override, tenant.id, viewer=agent, **window)
    )

    listed = {r["id"]: r for r in await list_calendar_connections(session_override, tenant.id, mine)}
    assert listed[str(conn.id)]["can_manage"] is True
    assert str(conn.id) not in {
        r["id"] for r in await list_calendar_connections(session_override, tenant.id, other)
    }
    assert {
        r["id"]: r for r in await list_calendar_connections(session_override, tenant.id, admin)
    }[str(conn.id)]["can_manage"] is True
    agent_rows = {
        r["id"]: r for r in await list_calendar_connections(session_override, tenant.id, agent)
    }
    assert agent_rows[str(conn.id)]["can_manage"] is False


@pytest.mark.asyncio
async def test_create_lands_on_chosen_or_default_calendar(
    session_override: AsyncSession, monkeypatch
):
    tenant = await _tenant(session_override)
    calendars = [
        {**CALENDARS[0], "enabled": True},
        {**CALENDARS[1], "enabled": True},
        {**CALENDARS[2], "enabled": True},
    ]
    conn = await _conn(
        session_override,
        tenant,
        creds={"access_token": "tok", "refresh_token": "r"},
        meta={"calendars": calendars, "default_write_calendar": "team@group.calendar"},
    )
    posted: list[str] = []

    class FakeResponse:
        status_code = 200

        def __init__(self, url):
            self.url = url

        def raise_for_status(self):
            return None

        def json(self):
            return {"id": f"ext-{len(posted)}", "htmlLink": "https://calendar.google.com/x"}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, headers=None, json=None):
            posted.append(url)
            return FakeResponse(url)

    monkeypatch.setattr(calendar_sync.httpx, "AsyncClient", FakeClient)
    start = datetime.utcnow() + timedelta(days=1)

    first = await create_external_event(
        session_override,
        tenant.id,
        connection_id=conn.id,
        title="Default target",
        start_at=start,
        end_at=start + timedelta(hours=1),
    )
    assert first["calendar_id"] == "team@group.calendar"
    assert "team%40group.calendar" in posted[-1]

    second = await create_external_event(
        session_override,
        tenant.id,
        connection_id=conn.id,
        calendar_id="me@example.com",
        title="Chosen target",
        start_at=start,
        end_at=start + timedelta(hours=1),
    )
    assert second["calendar_id"] == "me@example.com"

    with pytest.raises(ValueError):
        await create_external_event(
            session_override,
            tenant.id,
            connection_id=conn.id,
            calendar_id="holidays",
            title="Read-only",
            start_at=start,
            end_at=start + timedelta(hours=1),
        )


@pytest.mark.asyncio
async def test_api_hides_and_guards_other_peoples_calendars(
    client: AsyncClient, session_override: AsyncSession
):
    from app.models.auth import Membership, User
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    me = (
        await session_override.execute(select(User).where(User.email == TEST_EMAIL))
    ).scalar_one()
    membership = (
        await session_override.execute(select(Membership).where(Membership.user_id == me.id))
    ).scalars().first()
    tenant = await session_override.get(Tenant, membership.tenant_id)
    original_role = membership.role
    membership.role = "member"
    session_override.add(membership)
    await session_override.commit()
    try:
        private = await _conn(
            session_override, tenant, meta={"access": calendar_sync.default_access_entries(uuid4())}
        )
        mine = await _conn(
            session_override, tenant, meta={"access": calendar_sync.default_access_entries(me.id)}
        )
        listed = await client.get("/api/calendars/connections", headers=headers)
        assert listed.status_code == 200
        ids = {c["id"] for c in listed.json()["connections"]}
        assert str(mine.id) in ids
        assert str(private.id) not in ids

        hidden_sync = await client.post(
            f"/api/calendars/connections/{private.id}/sync", headers=headers
        )
        assert hidden_sync.status_code == 404
        start = datetime.utcnow() + timedelta(days=1)
        blocked = await client.post(
            "/api/calendars/events",
            headers=headers,
            json={
                "connection_id": str(private.id),
                "title": "Nope",
                "start_at": start.isoformat() + "Z",
                "end_at": (start + timedelta(hours=1)).isoformat() + "Z",
            },
        )
        assert blocked.status_code == 404

        calendars = await client.get(
            f"/api/calendars/connections/{mine.id}/calendars", headers=headers
        )
        assert calendars.status_code == 200, calendars.text
        assert calendars.json()["default_write_calendar"] == "primary"
    finally:
        membership.role = original_role
        session_override.add(membership)
        await session_override.commit()
