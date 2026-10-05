"""Workspace Bin: list, restore, purge, retention settings."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import trash as trash_svc

router = APIRouter(prefix="/trash", tags=["trash"])


class TrashSettingsBody(BaseModel):
    retention_days: int | None = Field(default=None, ge=1, le=365)


class EmptyBinBody(BaseModel):
    confirm: str = ""


@router.get("")
async def list_trash(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    type: str | None = Query(None),
    q: str | None = Query(None),
    cursor: int = Query(0, ge=0),
):
    return await trash_svc.list_entries(
        session,
        auth.tenant.id,
        resource_type=type,
        q=q,
        offset=cursor,
    )


@router.get("/settings")
async def get_trash_settings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    auth.require_role("owner", "admin")
    return {"settings": trash_svc.trash_settings_from_tenant(auth.tenant)}


@router.patch("/settings")
async def patch_trash_settings(
    body: TrashSettingsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    settings = trash_svc.merge_trash_settings(auth.tenant, body.model_dump(exclude_none=True))
    session.add(auth.tenant)
    await session.commit()
    return {"settings": settings}


@router.post("/empty")
async def empty_trash(
    body: EmptyBinBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    if body.confirm.strip().lower() not in ("empty", "leeg"):
        raise HTTPException(status_code=400, detail="Type empty to confirm")
    return await trash_svc.empty_bin(session, auth.tenant, user_id=auth.user.id if auth.user else None)


@router.post("/{entry_id}/restore")
async def restore_trash_item(
    entry_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    entry = await trash_svc.get_entry(session, auth.tenant.id, entry_id)
    return await trash_svc.restore_entry(
        session, auth.tenant, entry, user_id=auth.user.id if auth.user else None
    )


@router.delete("/{entry_id}")
async def purge_trash_item(
    entry_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    entry = await trash_svc.get_entry(session, auth.tenant.id, entry_id)
    return await trash_svc.purge_entry(
        session, auth.tenant, entry, user_id=auth.user.id if auth.user else None
    )
