from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import signal_tags as tag_svc

router = APIRouter(prefix="/signals/tags", tags=["signals"])


class TagRow(BaseModel):
    id: str
    name: str
    description: str
    count: int


class TagCreate(BaseModel):
    name: str
    description: str = ""


class TagUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


@router.get("", response_model=list[TagRow])
async def list_tags(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """The workspace tag registry with the number of conversations per tag."""
    return await tag_svc.registry_with_counts(session, auth.tenant.id)


@router.post("", response_model=TagRow)
async def create_tag(
    body: TagCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Register a tag. An existing name is returned as is."""
    try:
        row = await tag_svc.create_tag(
            session, auth.tenant.id, body.name, description=body.description, user_id=auth.user.id
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return tag_svc.serialize_tag(row)


@router.patch("/{tag_id}", response_model=TagRow)
async def update_tag(
    tag_id: UUID,
    body: TagUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Rename or describe a tag. Renaming onto an existing tag merges them."""
    try:
        row = await tag_svc.update_tag(
            session, auth.tenant.id, tag_id, name=body.name, description=body.description
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return tag_svc.serialize_tag(row)


@router.delete("/{tag_id}", status_code=204)
async def delete_tag(
    tag_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Remove a tag from the registry and from every conversation."""
    try:
        await tag_svc.delete_tag(session, auth.tenant.id, tag_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
