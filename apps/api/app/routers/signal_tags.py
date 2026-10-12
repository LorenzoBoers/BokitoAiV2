from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import signal_tags as tag_svc

router = APIRouter(prefix="/signals/tags", tags=["signals"])


class TagFolderRef(BaseModel):
    id: str
    name: str
    path: str


class TagRow(BaseModel):
    id: str
    name: str
    description: str
    count: int
    is_category: bool = False
    workstream_id: str | None = None
    workstream_name: str | None = None
    group_id: str | None = None
    group_name: str | None = None
    show_in_nav: bool = False
    ai_auto_tag: bool = True
    send_mode: str = "send"
    folders: list[TagFolderRef] = []


class TagCreate(BaseModel):
    name: str
    description: str = ""
    show_in_nav: bool = False
    group_id: UUID | None = None


class TagUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    show_in_nav: bool | None = None
    ai_auto_tag: bool | None = None
    group_id: UUID | None = None
    clear_group: bool = False


class TagPromote(BaseModel):
    workstream_id: UUID | None = None
    playbook_name: str = ""


class TagGroupRow(BaseModel):
    id: str
    name: str
    slug: str
    description: str = ""
    exclusive: bool = False
    sort_order: int = 0
    tag_count: int = 0


class TagGroupCreate(BaseModel):
    name: str
    description: str = ""
    exclusive: bool = False


class TagGroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    exclusive: bool | None = None
    sort_order: int | None = None


class ExclusiveViolation(BaseModel):
    signal_id: str
    subject: str
    count: int


# ---------------------------------------------------------------------------
# Groups (declared before ``/{tag_id}`` so ``/groups`` is not read as a tag id)


@router.get("/groups", response_model=list[TagGroupRow])
async def list_groups(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Tag groups: the dimensions tags belong to (Relatie, Documenttype, ...).

    An ``exclusive`` group allows one tag of the group per conversation. A
    folder with a child group shows one virtual child per tag in it.
    """
    return await tag_svc.list_groups(session, auth.tenant.id)


@router.post("/groups", response_model=TagGroupRow)
async def create_group(
    body: TagGroupCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create a tag group."""
    auth.require_role("owner", "admin")
    try:
        row = await tag_svc.create_group(
            session, auth.tenant.id, body.name, description=body.description, exclusive=body.exclusive
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return tag_svc.serialize_group(row)


@router.patch("/groups/{group_id}", response_model=TagGroupRow)
async def update_group(
    group_id: UUID,
    body: TagGroupUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Rename a group, change its description, order or exclusivity."""
    auth.require_role("owner", "admin")
    try:
        row = await tag_svc.update_group(
            session,
            auth.tenant.id,
            group_id,
            name=body.name,
            description=body.description,
            exclusive=body.exclusive,
            sort_order=body.sort_order,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return tag_svc.serialize_group(row)


@router.get("/groups/{group_id}/violations", response_model=list[ExclusiveViolation])
async def group_violations(
    group_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Conversations that carry more than one tag of this group (to resolve after turning it exclusive)."""
    return await tag_svc.exclusive_violations(session, auth.tenant.id, group_id)


@router.delete("/groups/{group_id}", status_code=204)
async def delete_group(
    group_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Remove a group. Its tags stay (ungrouped); group folders lose their virtual children."""
    auth.require_role("owner", "admin")
    try:
        await tag_svc.delete_group(session, auth.tenant.id, group_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Tags


@router.get("", response_model=list[TagRow])
async def list_tags(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Every hashtag with its number of conversations (links plus tickets).

    ``is_category`` marks tags with a flow, ``folders`` the folders that carry
    the tag, ``show_in_nav`` a workspace-default row in the Folders and tags rail.
    """
    return await tag_svc.registry_with_counts(session, auth.tenant.id)


@router.post("", response_model=TagRow)
async def create_tag(
    body: TagCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Register a hashtag. A leading ``#`` is dropped; an existing name is returned as is."""
    try:
        row = await tag_svc.create_tag(
            session,
            auth.tenant.id,
            body.name,
            description=body.description,
            show_in_nav=body.show_in_nav,
            group_id=body.group_id,
            user_id=auth.user.id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
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
    """Rename, describe, group, show in the rail, or toggle AI auto-tag. Renaming onto an existing free tag merges them."""
    if body.show_in_nav is not None or body.ai_auto_tag is not None or body.group_id is not None or body.clear_group:
        auth.require_role("owner", "admin")
    try:
        row = await tag_svc.update_tag(
            session,
            auth.tenant.id,
            tag_id,
            name=body.name,
            description=body.description,
            show_in_nav=body.show_in_nav,
            ai_auto_tag=body.ai_auto_tag,
            group_id=body.group_id,
            clear_group=body.clear_group,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return tag_svc.serialize_tag(row)


@router.post("/{tag_id}/promote", response_model=TagRow)
async def promote_tag(
    tag_id: UUID,
    body: TagPromote,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Make a tag an action tag: attach ``workstream_id`` or create a flow.

    The action tag shows in the rail. Conversations that already carry the
    tag keep it; they are not filed as tickets.
    """
    auth.require_role("owner", "admin")
    try:
        row = await tag_svc.promote_tag(
            session,
            auth.tenant.id,
            tag_id,
            workstream_id=body.workstream_id,
            playbook_name=body.playbook_name,
            user_id=auth.user.id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return tag_svc.serialize_tag(row)


@router.delete("/{tag_id}", status_code=204)
async def delete_tag(
    tag_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Remove a tag from the registry and from every conversation, contact and company.
    Refused while a folder carries the tag."""
    try:
        await tag_svc.delete_tag(session, auth.tenant.id, tag_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
