from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import inbox_folders as svc
from app.services.channel_access import visible_channel_account_ids

router = APIRouter(prefix="/signals/folders", tags=["signals"])


class FolderRow(BaseModel):
    id: str
    kind: str  # saved | project
    name: str
    filter: dict[str, str]
    scope: str
    position: int | None
    count: int


class FolderCreate(BaseModel):
    name: str
    filter: dict[str, Any]
    scope: str = "workspace"


class FolderUpdate(BaseModel):
    name: str | None = None
    filter: dict[str, Any] | None = None
    position: int | None = None


@router.get("", response_model=list[FolderRow])
async def list_folders(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Saved folders (workspace and your personal ones), then one per project.

    Each folder's ``filter`` uses the conversation list's query parameters
    (``project_id``, ``category_id``, ``tag``, ``stage``). ``count`` is the
    number of open conversations in it that All communication shows you.
    """
    return await svc.list_folders(
        session,
        auth.tenant.id,
        auth.user.id,
        visible_account_ids=await visible_channel_account_ids(
            session, auth.tenant.id, user_id=auth.user.id, role=auth.role
        ),
    )


@router.post("", response_model=FolderRow)
async def create_folder(
    body: FolderCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Save a filter as a folder. ``scope`` is ``workspace`` or ``personal``."""
    try:
        return await svc.create_folder(
            session, auth.tenant.id, auth.user.id, name=body.name, filters=body.filter, scope=body.scope
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/{folder_id}", response_model=FolderRow)
async def update_folder(
    folder_id: UUID,
    body: FolderUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Rename a folder, change its filter or move it."""
    try:
        return await svc.update_folder(
            session,
            auth.tenant.id,
            auth.user.id,
            folder_id,
            name=body.name,
            filters=body.filter,
            position=body.position,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Delete a saved folder. Its conversations are untouched."""
    try:
        await svc.delete_folder(session, auth.tenant.id, auth.user.id, folder_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
