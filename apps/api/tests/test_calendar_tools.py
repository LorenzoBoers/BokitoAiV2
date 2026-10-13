"""Calendar tools refuse create/update decisions when sync is broken."""

from __future__ import annotations

import json
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.calendar import CalendarEvent
from app.models.integration import IntegrationConnection
from app.models.notification import DecisionRequest
from app.services.crypto import set_connection_credentials
from app.tools.calendar import (
    _calendar_propose_event,
    _calendar_propose_update,
    _write_readiness_error,
)
from app.tools.registry import ToolContext


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = (await session.execute(select(Tenant))).scalars().first()
    if tenant is None:
        tenant = Tenant(name="Cal Tools", slug=f"cal-tools-{uuid4().hex[:8]}")
        session.add(tenant)
        await session.commit()
        await session.refresh(tenant)
    return tenant


def _ctx(session: AsyncSession, tenant: Tenant) -> ToolContext:
    return ToolContext(session=session, tenant_id=tenant.id, user_id=None)


async def _calendar_conn(
    session: AsyncSession,
    tenant: Tenant,
    *,
    meta: dict,
) -> IntegrationConnection:
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="google_calendar",
        display_name="Google Calendar",
        status="active",
        metadata_json=json.dumps(meta),
    )
    set_connection_credentials(conn, {"mock": True})
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return conn


HEALTHY_META = {
    "email": "ops@example.com",
    "sync_status": "ok",
    "calendars": [
        {
            "id": "primary",
            "name": "Primary",
            "primary": True,
            "writable": True,
            "enabled": True,
        }
    ],
    "default_write_calendar": "primary",
}


def test_write_readiness_blocks_sync_error():
    err = _write_readiness_error(
        {
            "id": "c1",
            "sync_status": "error",
            "sync_error": "The Google Calendar API is not enabled for this OAuth app.",
            "default_write_calendar": "primary",
        }
    )
    assert err is not None
    assert err["error"] == "calendar_sync"
    assert "not enabled" in err["message"]
    assert err["repair_path"] == "/connections?kind=calendar"


def test_write_readiness_blocks_missing_writable_calendar():
    err = _write_readiness_error(
        {"id": "c1", "sync_status": "ok", "sync_error": "", "default_write_calendar": None}
    )
    assert err is not None
    assert err["error"] == "no_writable_calendar"


def test_write_readiness_allows_healthy_connection():
    assert (
        _write_readiness_error(
            {
                "id": "c1",
                "sync_status": "ok",
                "sync_error": "",
                "default_write_calendar": "primary",
            }
        )
        is None
    )


@pytest.mark.asyncio
async def test_propose_event_refuses_broken_named_connection(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = await _calendar_conn(
        session_override,
        tenant,
        meta={
            "email": "lorenzo@bokito.ai",
            "sync_status": "error",
            "sync_error": "The Google Calendar API is not enabled for this OAuth app.",
        },
    )
    ctx = _ctx(session_override, tenant)
    result = await _calendar_propose_event(
        ctx,
        {
            "title": "Testafspraak",
            "start_at": "2026-10-14T10:00:00",
            "end_at": "2026-10-14T11:00:00",
            "connection_id": str(conn.id),
        },
    )
    assert result["ok"] is False
    assert result["error"] == "calendar_sync"
    assert "not enabled" in result["message"]
    decisions = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.tenant_id == tenant.id)
        )
    ).scalars().all()
    assert decisions == []


@pytest.mark.asyncio
async def test_propose_event_refuses_empty_calendars_even_when_named(
    session_override: AsyncSession,
):
    tenant = await _tenant(session_override)
    conn = await _calendar_conn(
        session_override,
        tenant,
        meta={"email": "ops@example.com", "sync_status": "ok", "calendars": []},
    )
    result = await _calendar_propose_event(
        _ctx(session_override, tenant),
        {
            "title": "Standup",
            "start_at": "2026-10-14T10:00:00",
            "end_at": "2026-10-14T10:30:00",
            "connection_id": str(conn.id),
        },
    )
    assert result["ok"] is False
    assert result["error"] == "no_writable_calendar"


@pytest.mark.asyncio
async def test_propose_event_creates_decision_when_healthy(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await _calendar_conn(session_override, tenant, meta=HEALTHY_META)
    result = await _calendar_propose_event(
        _ctx(session_override, tenant),
        {
            "title": "Standup",
            "start_at": "2026-10-14T10:00:00",
            "end_at": "2026-10-14T10:30:00",
        },
    )
    assert result["ok"] is True
    assert result.get("decision_id")
    decisions = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.tenant_id == tenant.id)
        )
    ).scalars().all()
    assert len(decisions) == 1
    assert "Standup" in (decisions[0].title or "")
    summary = decisions[0].summary or ""
    assert "T10:00" not in summary
    assert "Standup" in summary
    assert "·" in summary


def test_format_event_when_humanizes_naive_iso():
    from app.tools.calendar import format_event_when, humanize_iso_in_text

    when = format_event_when("2026-10-14T14:00:00", "2026-10-14T15:00:00")
    assert "T14:00" not in when
    assert "14:00" in when
    assert "15:00" in when
    legacy = humanize_iso_in_text(
        "Testafspraak from 2026-10-14T14:00:00 to 2026-10-14T15:00:00 in lorenzo@bokito.ai"
    )
    assert "T14:00" not in legacy
    assert "Testafspraak" in legacy


@pytest.mark.asyncio
async def test_propose_update_refuses_broken_connection(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = await _calendar_conn(
        session_override,
        tenant,
        meta={
            **HEALTHY_META,
            "sync_status": "reconnect",
            "sync_error": "Sign in again to keep this calendar in sync",
        },
    )
    from datetime import datetime, timedelta

    start = datetime.utcnow().replace(microsecond=0)
    event = CalendarEvent(
        tenant_id=tenant.id,
        connection_id=conn.id,
        calendar_id="primary",
        external_id="evt-1",
        title="Old",
        start_at=start,
        end_at=start + timedelta(hours=1),
        status="confirmed",
    )
    session_override.add(event)
    await session_override.commit()
    await session_override.refresh(event)

    result = await _calendar_propose_update(
        _ctx(session_override, tenant),
        {"event_id": str(event.id), "title": "New title"},
    )
    assert result["ok"] is False
    assert result["error"] == "calendar_sync"
