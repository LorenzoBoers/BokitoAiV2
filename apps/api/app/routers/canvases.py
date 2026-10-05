"""Canvas nodes: project and tenant snapshot dashboards."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import project_canvas as canvas_svc

router = APIRouter(prefix="/workforce/canvases", tags=["canvases"])


class CanvasCreateBody(BaseModel):
    owner_kind: str
    owner_id: UUID
    title: str
    slug: str | None = None
    managing_agent_id: UUID | None = None
    refresh_minutes: int | None = None
    refresh_cadence: str | None = None
    notes: str | None = None


class CanvasMetaBody(BaseModel):
    title: str | None = None
    slug: str | None = None
    managing_agent_id: UUID | None = None
    refresh_minutes: int | None = None
    refresh_cadence: str | None = None
    notes: str | None = None


@router.get("")
async def list_canvases(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    owner_kind: str = Query(...),
    owner_id: UUID = Query(...),
):
    return {
        "items": await canvas_svc.list_canvases(
            session, auth.tenant.id, owner_kind=owner_kind, owner_id=owner_id
        )
    }


@router.post("")
async def create_canvas(
    body: CanvasCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await canvas_svc.create_canvas(
        session,
        auth.tenant.id,
        owner_kind=body.owner_kind,
        owner_id=body.owner_id,
        title=body.title,
        slug=body.slug,
        managing_agent_id=body.managing_agent_id,
        refresh_minutes=body.refresh_minutes,
        refresh_cadence=body.refresh_cadence,
        notes=body.notes,
        updated_by_type="user",
        updated_by_id=str(auth.user.id),
    )


@router.get("/{canvas_id}")
async def get_canvas(
    canvas_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await canvas_svc.get_canvas(session, auth.tenant.id, canvas_id=canvas_id)


@router.patch("/{canvas_id}")
async def patch_canvas(
    canvas_id: UUID,
    body: CanvasMetaBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await canvas_svc.patch_canvas_meta(
        session,
        auth.tenant.id,
        canvas_id,
        title=body.title,
        slug=body.slug,
        managing_agent_id=body.managing_agent_id,
        refresh_minutes=body.refresh_minutes,
        refresh_cadence=body.refresh_cadence,
        notes=body.notes,
    )


@router.delete("/{canvas_id}")
async def delete_canvas(
    canvas_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await canvas_svc.delete_canvas(
        session, auth.tenant.id, canvas_id, user_id=auth.user.id if auth.user else None
    )
