"""Calendar connections and events API (Google Calendar / Outlook Calendar)."""

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
from app.services import calendar_sync

router = APIRouter(prefix="/calendars", tags=["calendars"])


class CalendarEventCreateBody(BaseModel):
    connection_id: str
    title: str = Field(min_length=1, max_length=500)
    start_at: datetime
    end_at: datetime
    description: str = ""
    location: str = ""


class CalendarEventUpdateBody(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    start_at: datetime | None = None
    end_at: datetime | None = None
    description: str | None = None
    location: str | None = None


@router.get("/connections")
async def list_connections(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return {
        "connections": await calendar_sync.list_calendar_connections(
            session, auth.tenant.id
        )
    }


@router.post("/connections/{connection_id}/sync")
async def sync_one(
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    conn = await session.get(IntegrationConnection, connection_id)
    if (
        conn is None
        or conn.tenant_id != auth.tenant.id
        or conn.provider not in calendar_sync.CALENDAR_PROVIDERS
    ):
        raise HTTPException(status_code=404, detail="Calendar connection not found")
    return await calendar_sync.sync_connection(session, conn)


@router.post("/sync")
async def sync_all(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from sqlalchemy import select

    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.tenant_id == auth.tenant.id,
            IntegrationConnection.provider.in_(list(calendar_sync.CALENDAR_PROVIDERS)),
            IntegrationConnection.status == "active",
        )
    )
    out: list[dict[str, Any]] = []
    for conn in result.scalars().all():
        out.append(await calendar_sync.sync_connection(session, conn))
    return {"results": out}


@router.post("/events")
async def create_event(
    body: CalendarEventCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        conn_id = UUID(body.connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid connection_id") from exc
    if body.end_at <= body.start_at:
        raise HTTPException(status_code=400, detail="end_at must be after start_at")
    try:
        created = await calendar_sync.create_external_event(
            session,
            auth.tenant.id,
            connection_id=conn_id,
            title=body.title.strip(),
            start_at=body.start_at,
            end_at=body.end_at,
            description=body.description.strip(),
            location=body.location.strip(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Calendar provider error: {exc}") from exc
    return {"event": created}


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
    ):
        raise HTTPException(status_code=400, detail="No fields to update")
    if body.start_at is not None and body.end_at is not None and body.end_at <= body.start_at:
        raise HTTPException(status_code=400, detail="end_at must be after start_at")
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
        )
    except ValueError as exc:
        detail = str(exc)
        status = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status, detail=detail) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Calendar provider error: {exc}") from exc
    return {"event": updated}


@router.delete("/events/{event_id}")
async def delete_event(
    event_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        await calendar_sync.delete_external_event(session, auth.tenant.id, event_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Calendar provider error: {exc}") from exc
    return {"ok": True}
