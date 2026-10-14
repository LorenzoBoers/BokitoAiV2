"""Calendar connections and events API (Google Calendar / Outlook Calendar).

Each connection is one OAuth account (``manage``: pick calendars, reconnect,
disconnect). Each synced calendar is a tenant calendar with its own
``use``/``manage`` access, tags and sync toggle.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.integration import IntegrationConnection
from app.services import calendar_access, calendar_sync
from app.services import tenant_calendars as tc_svc

router = APIRouter(prefix="/calendars", tags=["calendars"])


class CalendarEventCreateBody(BaseModel):
    connection_id: str
    calendar_id: str | None = Field(
        default=None, description="Calendar inside the account; default: the connection's default"
    )
    title: str = Field(min_length=1, max_length=500)
    start_at: datetime
    end_at: datetime
    description: str = ""
    location: str = ""
    all_day: bool = False


class CalendarEventUpdateBody(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    start_at: datetime | None = None
    end_at: datetime | None = None
    description: str | None = None
    location: str | None = None
    all_day: bool | None = None


class CalendarChoice(BaseModel):
    id: str
    enabled: bool


class CalendarSelectionBody(BaseModel):
    calendars: list[CalendarChoice] | None = None
    default_write_calendar: str | None = None


class TenantCalendarPatchBody(BaseModel):
    sync_enabled: bool | None = None


class CalendarAccessBody(BaseModel):
    entries: list[dict[str, Any]] | None = None
    reset: bool = False


class CalendarTagsBody(BaseModel):
    tags: list[str] = Field(default_factory=list)


def _viewer(auth: AuthContext) -> calendar_sync.CalendarViewer:
    return calendar_sync.CalendarViewer(user_id=auth.user.id, role=auth.role)


async def _tenant_cal(
    session: AsyncSession, auth: AuthContext, calendar_id: UUID, *, need: str
):
    cal = await tc_svc.get_calendar(session, auth.tenant.id, calendar_id)
    if cal is None:
        raise HTTPException(status_code=404, detail="Calendar not found")
    level = await tc_svc.calendar_level(session, cal, _viewer(auth))
    if level is None:
        raise HTTPException(status_code=404, detail="Calendar not found")
    if need == "manage" and level != "manage":
        raise HTTPException(
            status_code=403,
            detail="You cannot manage this calendar. Ask an owner or admin.",
        )
    return cal, level


async def _connection(
    session: AsyncSession, auth: AuthContext, connection_id: UUID, *, need: str
) -> IntegrationConnection:
    conn = await session.get(IntegrationConnection, connection_id)
    if (
        conn is None
        or conn.tenant_id != auth.tenant.id
        or calendar_sync._calendar_slug(conn) is None
    ):
        raise HTTPException(status_code=404, detail="Calendar connection not found")
    level = await calendar_sync.connection_level(session, conn, _viewer(auth))
    if level is None:
        raise HTTPException(status_code=404, detail="Calendar connection not found")
    if need == "manage" and level != "manage":
        raise HTTPException(
            status_code=403,
            detail="You cannot manage this calendar. Ask the person who connected it or an admin.",
        )
    return conn


def _provider_error(exc: Exception) -> HTTPException:
    if isinstance(exc, calendar_sync.CalendarReconnectError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ValueError):
        detail = str(exc)
        return HTTPException(status_code=404 if "not found" in detail.lower() else 400, detail=detail)
    return HTTPException(status_code=502, detail=calendar_sync._error_text(exc))


@router.get("/connections")
async def list_connections(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Calendar accounts the caller may use, with their calendars and level."""
    return {
        "connections": await calendar_sync.list_calendar_connections(
            session, auth.tenant.id, _viewer(auth)
        )
    }


@router.get("/")
async def list_calendars(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Tenant calendars the caller may use (sync, tags, access)."""
    return {
        "calendars": await tc_svc.list_tenant_calendars(
            session, auth.tenant.id, _viewer(auth)
        )
    }


@router.patch("/{calendar_id}")
async def patch_calendar(
    calendar_id: UUID,
    body: TenantCalendarPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    cal, _ = await _tenant_cal(session, auth, calendar_id, need="manage")
    if body.sync_enabled is None:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = await tc_svc.patch_calendar(session, cal, sync_enabled=body.sync_enabled)
    sync: dict[str, Any] | None = None
    if body.sync_enabled:
        conn = await session.get(IntegrationConnection, updated.connection_id)
        if conn is not None:
            sync = await calendar_sync.sync_connection(session, conn)
    rows = await tc_svc.list_tenant_calendars(session, auth.tenant.id, _viewer(auth))
    row = next((r for r in rows if r["id"] == str(updated.id)), None)
    return {"calendar": row, "sync": sync}


@router.get("/{calendar_id}/access")
async def get_calendar_access(
    calendar_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    cal, _ = await _tenant_cal(session, auth, calendar_id, need="use")
    return {
        "entries": calendar_access.calendar_access(cal),
        "is_default": calendar_access.is_default_access(cal),
    }


@router.put("/{calendar_id}/access")
async def put_calendar_access(
    calendar_id: UUID,
    body: CalendarAccessBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    cal, _ = await _tenant_cal(session, auth, calendar_id, need="manage")
    entries = None if body.reset else body.entries
    saved = await calendar_access.set_calendar_access(session, cal, entries)
    await session.commit()
    return {"entries": saved, "is_default": calendar_access.is_default_access(cal)}


@router.get("/{calendar_id}/tags")
async def get_calendar_tags(
    calendar_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await _tenant_cal(session, auth, calendar_id, need="use")
    return {"tags": await tc_svc.list_calendar_tags(session, auth.tenant.id, calendar_id)}


@router.put("/{calendar_id}/tags")
async def put_calendar_tags(
    calendar_id: UUID,
    body: CalendarTagsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await _tenant_cal(session, auth, calendar_id, need="manage")
    tags = await tc_svc.set_calendar_tags(
        session, auth.tenant.id, calendar_id, body.tags, user_id=auth.user.id
    )
    await session.commit()
    return {"tags": tags}


@router.post("/connections/{connection_id}/sync")
async def sync_one(
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    conn = await _connection(session, auth, connection_id, need="manage")
    return await calendar_sync.sync_connection(session, conn)


@router.post("/sync")
async def sync_all(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Sync every calendar account the caller manages."""
    visible = await calendar_sync.visible_connections(session, auth.tenant.id, _viewer(auth))
    out: list[dict[str, Any]] = []
    for conn, level in visible:
        if level == "manage":
            out.append(await calendar_sync.sync_connection(session, conn))
    return {"results": out}


@router.get("/connections/{connection_id}/calendars")
async def list_account_calendars(
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Fresh calendar list from the provider (requires Manage)."""
    conn = await _connection(session, auth, connection_id, need="manage")
    try:
        calendars = await calendar_sync.refresh_calendar_list(session, conn)
    except Exception as exc:
        raise _provider_error(exc) from exc
    return {
        "calendars": calendars,
        "default_write_calendar": calendar_sync.default_write_calendar(conn),
    }


@router.put("/connections/{connection_id}/calendars")
async def put_account_calendars(
    connection_id: UUID,
    body: CalendarSelectionBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Choose which calendars sync and the default write calendar (requires
    Manage). Switching a calendar on syncs the account straight away."""
    conn = await _connection(session, auth, connection_id, need="manage")
    before = {c["id"] for c in calendar_sync.stored_calendars(conn) if c["enabled"]}
    try:
        calendars = await calendar_sync.set_calendar_selection(
            session,
            conn,
            enabled_ids=[c.id for c in body.calendars if c.enabled] if body.calendars is not None else None,
            default_write=body.default_write_calendar,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    after = {c["id"] for c in calendars if c["enabled"]}
    sync: dict[str, Any] | None = None
    if after - before:
        sync = await calendar_sync.sync_connection(session, conn)
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="calendar:calendars_set",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="integration_connection",
        resource_id=str(conn.id),
        before={"enabled": sorted(before)},
        after={"enabled": sorted(after), "default": body.default_write_calendar},
    )
    return {
        "calendars": calendar_sync.stored_calendars(conn),
        "default_write_calendar": calendar_sync.default_write_calendar(conn),
        "sync": sync,
    }


@router.post("/events")
async def create_event(
    body: CalendarEventCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create a calendar event on a connected Google or Outlook calendar.

    ``calendar_id`` picks a calendar inside the account; without it the
    connection's default write calendar is used. ``all_day`` writes a
    date-only event; timed events keep start and end clock times.
    """
    try:
        conn_id = UUID(body.connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid connection_id") from exc
    if body.end_at <= body.start_at and not body.all_day:
        raise HTTPException(status_code=400, detail="end_at must be after start_at")
    await _connection(session, auth, conn_id, need="use")
    try:
        created = await calendar_sync.create_external_event(
            session,
            auth.tenant.id,
            connection_id=conn_id,
            calendar_id=body.calendar_id or None,
            title=body.title.strip(),
            start_at=body.start_at,
            end_at=body.end_at,
            description=body.description.strip(),
            location=body.location.strip(),
            all_day=body.all_day,
        )
    except Exception as exc:
        raise _provider_error(exc) from exc
    return {"event": created}


async def _event_access(session: AsyncSession, auth: AuthContext, event_id: UUID) -> None:
    try:
        row, _ = await calendar_sync.event_connection(session, auth.tenant.id, event_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await _connection(session, auth, row.connection_id, need="use")
    if row.tenant_calendar_id:
        await _tenant_cal(session, auth, row.tenant_calendar_id, need="use")


@router.patch("/events/{event_id}")
async def update_event(
    event_id: UUID,
    body: CalendarEventUpdateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    if (
        body.title is None
        and body.start_at is None
        and body.end_at is None
        and body.description is None
        and body.location is None
        and body.all_day is None
    ):
        raise HTTPException(status_code=400, detail="No fields to update")
    if (
        body.start_at is not None
        and body.end_at is not None
        and body.end_at <= body.start_at
        and not body.all_day
    ):
        raise HTTPException(status_code=400, detail="end_at must be after start_at")
    await _event_access(session, auth, event_id)
    try:
        updated = await calendar_sync.update_external_event(
            session,
            auth.tenant.id,
            event_id,
            title=body.title.strip() if body.title is not None else None,
            start_at=body.start_at,
            end_at=body.end_at,
            description=body.description,
            location=body.location,
            all_day=body.all_day,
        )
    except Exception as exc:
        raise _provider_error(exc) from exc
    return {"event": updated}


@router.post("/events/{event_id}/thread")
async def open_event_thread(
    event_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Open the meeting as a conversation: a thread dated at the meeting.

    The second call returns the same thread. Prepare, take notes or hand the
    meeting to an agent from there.
    """
    from app.models.calendar import CalendarEvent
    from app.models.signal import Signal
    from app.services.thread_schedule import apply_thread_schedule

    await _event_access(session, auth, event_id)
    row = await session.get(CalendarEvent, event_id)
    if row is None or row.tenant_id != auth.tenant.id:
        raise HTTPException(status_code=404, detail="Calendar event not found")
    if row.signal_id:
        existing = await session.get(Signal, row.signal_id)
        if existing is not None and existing.deleted_at is None:
            return {"signal_id": str(existing.id)}
    signal, _ = await apply_thread_schedule(
        session,
        auth.tenant.id,
        title=row.title or "Meeting",
        at=row.start_at,
        ends_at=row.end_at,
        recipient=("user", auth.user.id),
        details={
            "note": row.description[:2000],
            "location": row.location,
            "html_link": row.html_link,
            "all_day": row.all_day,
            "calendar_event_id": str(row.id),
        },
        created_by_user_id=auth.user.id,
        actor_id=str(auth.user.id),
    )
    row.signal_id = signal.id
    session.add(row)
    await session.commit()
    return {"signal_id": str(signal.id)}


@router.delete("/events/{event_id}")
async def delete_event(
    event_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await _event_access(session, auth, event_id)
    try:
        await calendar_sync.delete_external_event(session, auth.tenant.id, event_id)
    except Exception as exc:
        raise _provider_error(exc) from exc
    return {"ok": True}
