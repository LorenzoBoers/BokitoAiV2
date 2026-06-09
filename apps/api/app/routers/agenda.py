"""Unified agenda API (calendars, events, external connect stub)."""

from datetime import datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.agenda import AgendaCalendar, AgendaEvent
from app.models.integration import IntegrationConnection
from app.services.agenda import (
    RECURRENCE_FREQS,
    compute_next_run_at,
    ensure_system_calendars,
    init_orchestrator_schedule,
    list_events_in_range,
    serialize_calendar,
    serialize_event,
    trigger_orchestrator_event,
)
from app.services.integrations_platform import mock_authorize_url

router = APIRouter(prefix="/agenda", tags=["agenda"])


class CalendarCreate(BaseModel):
    name: str
    kind: str = "user"
    color: str = "#6366f1"


class CalendarPatch(BaseModel):
    name: str | None = None
    color: str | None = None


class EventCreate(BaseModel):
    calendar_id: str
    kind: str = "user"
    title: str
    description: str = ""
    location: str = ""
    starts_at: str
    ends_at: str | None = None
    all_day: bool = False
    timezone: str = "UTC"
    status: str = "confirmed"
    priority: str = "normal"
    assigned_to_user_id: str | None = None
    recurrence_freq: str = "none"
    recurrence_interval: int = 1
    recurrence_until: str | None = None
    prompt: str = ""
    agent_role: str = "orchestra"
    enabled: bool = True


class EventPatch(BaseModel):
    calendar_id: str | None = None
    title: str | None = None
    description: str | None = None
    location: str | None = None
    starts_at: str | None = None
    ends_at: str | None = None
    all_day: bool | None = None
    timezone: str | None = None
    status: str | None = None
    priority: str | None = None
    assigned_to_user_id: str | None = None
    recurrence_freq: str | None = None
    recurrence_interval: int | None = None
    recurrence_until: str | None = None
    prompt: str | None = None
    agent_role: str | None = None
    enabled: bool | None = None


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = value.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(raw).replace(tzinfo=None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid datetime: {value}") from exc


def _parse_calendar_ids(raw: str | None) -> list[UUID] | None:
    if not raw or not raw.strip():
        return None
    ids: list[UUID] = []
    for part in raw.split(","):
        part = part.strip()
        if part:
            ids.append(UUID(part))
    return ids or None


async def _get_calendar(session: AsyncSession, tenant_id: UUID, calendar_id: UUID) -> AgendaCalendar:
    result = await session.execute(
        select(AgendaCalendar).where(AgendaCalendar.id == calendar_id, AgendaCalendar.tenant_id == tenant_id)
    )
    cal = result.scalar_one_or_none()
    if not cal:
        raise HTTPException(status_code=404, detail="Calendar not found")
    return cal


async def _get_event(session: AsyncSession, tenant_id: UUID, event_id: UUID) -> AgendaEvent:
    result = await session.execute(
        select(AgendaEvent).where(AgendaEvent.id == event_id, AgendaEvent.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Event not found")
    return row


@router.get("/calendars")
async def list_calendars(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    rows = await ensure_system_calendars(session, auth.tenant.id)
    await session.commit()
    return [serialize_calendar(c) for c in rows]


@router.post("/calendars")
async def create_calendar(
    body: CalendarCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    if body.kind not in ("user", "team", "external"):
        raise HTTPException(status_code=400, detail="Invalid calendar kind")
    row = AgendaCalendar(
        tenant_id=auth.tenant.id,
        name=body.name.strip() or "Calendar",
        kind=body.kind,
        color=body.color,
        is_system=False,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return serialize_calendar(row)


@router.patch("/calendars/{calendar_id}")
async def patch_calendar(
    calendar_id: UUID,
    body: CalendarPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    row = await _get_calendar(session, auth.tenant.id, calendar_id)
    if row.is_system and body.name is not None:
        raise HTTPException(status_code=400, detail="Cannot rename system calendar")
    if body.name is not None:
        row.name = body.name.strip() or row.name
    if body.color is not None:
        row.color = body.color
    row.updated_at = datetime.utcnow()
    await session.commit()
    await session.refresh(row)
    return serialize_calendar(row)


@router.delete("/calendars/{calendar_id}")
async def delete_calendar(
    calendar_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    row = await _get_calendar(session, auth.tenant.id, calendar_id)
    if row.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system calendar")
    events = await session.execute(
        select(AgendaEvent).where(AgendaEvent.calendar_id == calendar_id, AgendaEvent.tenant_id == auth.tenant.id)
    )
    for ev in events.scalars().all():
        await session.delete(ev)
    await session.delete(row)
    await session.commit()
    return {"deleted": True}


@router.get("/calendars/connect/{provider}")
async def connect_external_calendar(
    provider: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    return_url: str = Query("http://127.0.0.1:5174/agenda/month"),
):
    if provider not in ("google", "outlook"):
        raise HTTPException(status_code=400, detail="Provider must be google or outlook")
    url = mock_authorize_url(
        return_url,
        {
            "oauth_provider": provider,
            "oauth_status": "success",
            "oauth_scope": "calendar",
        },
    )
    return {"authorize_url": url, "provider": provider}


@router.post("/calendars/connect/{provider}/complete")
async def complete_external_connect(
    provider: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Stub: create external calendar and sample events after mock OAuth."""
    if provider not in ("google", "outlook"):
        raise HTTPException(status_code=400, detail="Provider must be google or outlook")
    conn = IntegrationConnection(
        tenant_id=auth.tenant.id,
        provider=provider,
        display_name=f"{provider.title()} Calendar",
        status="active",
        metadata_json='{"scope":"calendar"}',
    )
    session.add(conn)
    await session.flush()
    cal = AgendaCalendar(
        tenant_id=auth.tenant.id,
        name=f"{provider.title()} Calendar",
        kind="external",
        color="#0ea5e9" if provider == "google" else "#0078d4",
        is_system=False,
        external_provider=provider,
        external_connection_id=conn.id,
    )
    session.add(cal)
    await session.flush()
    now = datetime.utcnow()
    for title, delta_hours in (
        ("External sync demo", 24),
        ("Follow-up (stub)", 48),
    ):
        starts = now + timedelta(hours=delta_hours)
        session.add(
            AgendaEvent(
                tenant_id=auth.tenant.id,
                calendar_id=cal.id,
                kind="external",
                title=title,
                starts_at=starts,
                ends_at=starts + timedelta(hours=1),
                external_id=f"stub-{title}",
            )
        )
    await session.commit()
    await session.refresh(cal)
    return serialize_calendar(cal)


@router.get("/events")
async def list_events(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    start: str = Query(...),
    end: str = Query(...),
    calendar_ids: str | None = Query(None),
):
    window_start = _parse_dt(start)
    window_end = _parse_dt(end)
    if not window_start or not window_end:
        raise HTTPException(status_code=400, detail="start and end are required")
    if window_end <= window_start:
        raise HTTPException(status_code=400, detail="end must be after start")
    ids = _parse_calendar_ids(calendar_ids)
    await ensure_system_calendars(session, auth.tenant.id)
    await session.commit()
    items = await list_events_in_range(session, auth.tenant.id, window_start, window_end, ids)
    return {"items": items}


@router.post("/events")
async def create_event(
    body: EventCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    if body.recurrence_freq not in RECURRENCE_FREQS:
        raise HTTPException(status_code=400, detail="Invalid recurrence_freq")
    cal_id = UUID(body.calendar_id)
    cal = await _get_calendar(session, auth.tenant.id, cal_id)
    starts = _parse_dt(body.starts_at)
    if not starts:
        raise HTTPException(status_code=400, detail="starts_at is required")
    kind = body.kind
    if cal.kind == "orchestrator":
        kind = "orchestrator"
    row = AgendaEvent(
        tenant_id=auth.tenant.id,
        calendar_id=cal_id,
        kind=kind,
        title=body.title.strip() or "Untitled",
        description=body.description,
        location=body.location,
        starts_at=starts,
        ends_at=_parse_dt(body.ends_at),
        all_day=body.all_day,
        timezone=body.timezone,
        status=body.status,
        priority=body.priority,
        assigned_to_user_id=UUID(body.assigned_to_user_id) if body.assigned_to_user_id else None,
        recurrence_freq=body.recurrence_freq,
        recurrence_interval=max(1, body.recurrence_interval),
        recurrence_until=_parse_dt(body.recurrence_until),
        prompt=body.prompt,
        agent_role=body.agent_role,
        enabled=body.enabled,
    )
    if kind == "orchestrator":
        init_orchestrator_schedule(row)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return serialize_event(row)


@router.get("/events/{event_id}")
async def get_event(
    event_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    row = await _get_event(session, auth.tenant.id, event_id)
    return serialize_event(row)


@router.patch("/events/{event_id}")
async def patch_event(
    event_id: UUID,
    body: EventPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    row = await _get_event(session, auth.tenant.id, event_id)
    if body.calendar_id is not None:
        await _get_calendar(session, auth.tenant.id, UUID(body.calendar_id))
        row.calendar_id = UUID(body.calendar_id)
    if body.title is not None:
        row.title = body.title.strip() or row.title
    if body.description is not None:
        row.description = body.description
    if body.location is not None:
        row.location = body.location
    if body.starts_at is not None:
        row.starts_at = _parse_dt(body.starts_at) or row.starts_at
    if body.ends_at is not None:
        row.ends_at = _parse_dt(body.ends_at)
    if body.all_day is not None:
        row.all_day = body.all_day
    if body.timezone is not None:
        row.timezone = body.timezone
    if body.status is not None:
        row.status = body.status
    if body.priority is not None:
        row.priority = body.priority
    if body.assigned_to_user_id is not None:
        row.assigned_to_user_id = UUID(body.assigned_to_user_id) if body.assigned_to_user_id else None
    if body.recurrence_freq is not None:
        if body.recurrence_freq not in RECURRENCE_FREQS:
            raise HTTPException(status_code=400, detail="Invalid recurrence_freq")
        row.recurrence_freq = body.recurrence_freq
    if body.recurrence_interval is not None:
        row.recurrence_interval = max(1, body.recurrence_interval)
    if body.recurrence_until is not None:
        row.recurrence_until = _parse_dt(body.recurrence_until)
    if body.prompt is not None:
        row.prompt = body.prompt
    if body.agent_role is not None:
        row.agent_role = body.agent_role
    if body.enabled is not None:
        row.enabled = body.enabled
    if row.kind == "orchestrator":
        if row.next_run_at is None:
            init_orchestrator_schedule(row)
        elif body.starts_at is not None or body.recurrence_freq is not None:
            row.next_run_at = row.starts_at
    row.updated_at = datetime.utcnow()
    await session.commit()
    await session.refresh(row)
    return serialize_event(row)


@router.delete("/events/{event_id}")
async def delete_event(
    event_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    row = await _get_event(session, auth.tenant.id, event_id)
    await session.delete(row)
    await session.commit()
    return {"deleted": True}


@router.post("/events/{event_id}/run")
async def run_orchestrator_event(
    event_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    row = await _get_event(session, auth.tenant.id, event_id)
    if row.kind != "orchestrator":
        raise HTTPException(status_code=400, detail="Only orchestrator events can be run")
    try:
        result = await trigger_orchestrator_event(session, row, auth.tenant.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result
