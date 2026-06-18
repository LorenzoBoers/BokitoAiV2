"""App API group: workspaces and invites."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services.workspaces_portal import (
    create_workspace,
    create_workspace_invite,
    delete_workspace,
    list_invites,
    list_members,
    list_workspaces,
    resolve_tenant_for_workspace,
    update_workspace,
)

router = APIRouter(tags=["app-workspaces"])


class WorkspaceCreateBody(BaseModel):
    name: str
    timezone: str = "Europe/Amsterdam"
    logo: str | None = None
    subdomain: str | None = None


class WorkspaceUpdateBody(BaseModel):
    name: str | None = None
    timezone: str | None = None
    logo: str | None = None
    slug: str | None = None
    brand_color: str | None = None
    require_2fa: bool | None = None


class WorkspaceInviteBody(BaseModel):
    workspace_id: str | int
    email: EmailStr
    role: str = "member"


@router.get("/workspaces")
async def get_workspaces(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await list_workspaces(session, auth.user, is_staff=auth.is_staff)


@router.post("/workspaces")
async def post_workspace(
    body: WorkspaceCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await create_workspace(
        session,
        auth.user,
        name=body.name,
        timezone=body.timezone,
        subdomain=body.subdomain,
        logo=body.logo,
    )


@router.post("/workspaces/{workspace_id}")
async def post_workspace_update(
    workspace_id: str,
    body: WorkspaceUpdateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant, role = await resolve_tenant_for_workspace(
        session, workspace_id, auth.user, is_staff=auth.is_staff
    )
    auth.require_role("owner", "admin")
    payload: dict[str, Any] = body.model_dump(exclude_none=True)
    return await update_workspace(session, tenant, role, payload)


@router.delete("/workspaces/{workspace_id}")
async def delete_workspace_endpoint(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant, _role = await resolve_tenant_for_workspace(
        session, workspace_id, auth.user, is_staff=auth.is_staff
    )
    auth.require_role("owner")
    await delete_workspace(session, tenant)
    return {"ok": True}


@router.get("/workspaces/{workspace_id}/members")
async def get_workspace_members(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant, _role = await resolve_tenant_for_workspace(
        session, workspace_id, auth.user, is_staff=auth.is_staff
    )
    return await list_members(session, tenant.id)


@router.get("/workspaces/{workspace_id}/invites")
async def get_workspace_invites(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant, _role = await resolve_tenant_for_workspace(
        session, workspace_id, auth.user, is_staff=auth.is_staff
    )
    auth.require_role("owner", "admin")
    return await list_invites(session, tenant.id, auth.user)


@router.post("/workspace-invites")
async def post_workspace_invite(
    body: WorkspaceInviteBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    tenant, _role = await resolve_tenant_for_workspace(
        session, str(body.workspace_id), auth.user, is_staff=auth.is_staff
    )
    return await create_workspace_invite(
        session,
        tenant,
        email=str(body.email),
        role=body.role,
        inviter=auth.user,
    )
