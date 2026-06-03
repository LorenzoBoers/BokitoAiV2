"""Workforce workspace doc router (blueprint / assistant edit canvas)."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import workspace_doc as svc

router = APIRouter(prefix="/workforce/workspace/doc", tags=["workspace-doc"])


class PageCreateBody(BaseModel):
    workspace_doc_id: str
    title: str
    slug: str
    kind: str = "custom"
    icon: str | None = None
    parent_page_id: str | None = None
    position: int = 0


class PagePatchBody(BaseModel):
    title: str | None = None
    kind: str | None = None
    icon: str | None = None
    parent_page_id: str | None = None
    position: int | None = None
    is_pinned: bool | None = None
    is_locked: bool | None = None
    lock_action: str | None = None


class BlockOpsBody(BaseModel):
    ops: list[dict[str, Any]]
    actor_label: str | None = None
    expected_version: int | None = None


class ChangeRequestBody(BaseModel):
    body: str
    title: str | None = None
    target_page_id: str | None = None
    priority: int = 2


class MigrateBody(BaseModel):
    project_id: str


@router.get("")
async def get_workspace_doc_tree(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.get_tree(session, auth.tenant.id)


@router.post("/pages")
async def create_workspace_doc_page(
    body: PageCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.create_page(
        session,
        auth.tenant.id,
        workspace_doc_id=body.workspace_doc_id,
        title=body.title,
        slug=body.slug,
        kind=body.kind,
        icon=body.icon,
        parent_page_id=body.parent_page_id,
        position=body.position,
    )


@router.patch("/pages/{page_id}")
async def patch_workspace_doc_page(
    page_id: UUID,
    body: PagePatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.patch_page(session, auth.tenant.id, page_id, body.model_dump(exclude_none=True))


@router.delete("/pages/{page_id}")
async def delete_workspace_doc_page(
    page_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await svc.delete_page(session, auth.tenant.id, page_id)
    return {"ok": True}


@router.get("/pages/{page_id}/blocks")
async def get_workspace_page_blocks(
    page_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_page_blocks(session, auth.tenant.id, page_id)


@router.post("/pages/{page_id}/blocks")
async def apply_workspace_block_ops(
    page_id: UUID,
    body: BlockOpsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.apply_block_ops(
        session,
        auth.tenant.id,
        auth.user.id,
        page_id,
        body.ops,
        actor_label=body.actor_label or auth.user.display_name or "User",
        expected_version=body.expected_version,
    )


@router.get("/pages/{page_id}/revisions")
async def list_workspace_revisions(
    page_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    block_id: str | None = Query(None),
):
    block_uuid = UUID(block_id) if block_id else None
    return await svc.list_revisions(session, auth.tenant.id, page_id, block_uuid)


@router.get("/change-requests")
async def list_workspace_change_requests(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: str | None = Query(None),
):
    return await svc.list_change_requests(session, auth.tenant.id, status=status)


@router.post("/change-requests")
async def create_workspace_change_request(
    body: ChangeRequestBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.create_change_request(
        session,
        auth.tenant.id,
        body=body.body,
        title=body.title,
        target_page_id=body.target_page_id,
        priority=body.priority,
    )


@router.post("/migrate-from-project")
async def migrate_from_project(
    body: MigrateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    # V1: no project docs in FastAPI yet; acknowledge for UI flows.
    return {"ok": True, "pages_copied": 0, "project_id": body.project_id}
