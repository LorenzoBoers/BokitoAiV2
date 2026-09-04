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
    onboarding_status,
    remove_member,
    resend_invite,
    resolve_tenant_for_workspace,
    revoke_invite,
    update_member_role,
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
    allow_platform_support: bool | None = None


class WorkspaceInviteBody(BaseModel):
    workspace_id: str | int
    email: EmailStr
    role: str = "member"


@router.get("/onboarding")
async def get_onboarding_status(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await onboarding_status(session, auth.tenant.id)


@router.post("/onboarding/demo-thread")
async def create_demo_thread(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Opt-in demo conversation with a pending decision card. Idempotent."""
    from app.services.onboarding_demo import seed_demo_thread

    return await seed_demo_thread(session, auth.tenant.id)


@router.delete("/onboarding/demo-thread")
async def delete_demo_thread(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.onboarding_demo import remove_demo_threads

    removed = await remove_demo_threads(session, auth.tenant.id)
    return {"removed": removed}


@router.get("/mail-status")
async def get_mail_status(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    """Whether a transactional mail provider is configured. Admin surfaces use
    this to warn that invite/notification mails will not be delivered."""
    from app.services.transactional_mail import mail_configured

    return {"configured": mail_configured()}


@router.get("/assistant/threads")
async def get_assistant_threads(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = 50,
):
    """The signed-in person's Bokito helper threads across their workspaces."""
    from app.services.personal_assistant import list_user_assistant_threads

    items = await list_user_assistant_threads(
        session, auth.user.id, limit=max(1, min(limit, 100))
    )
    return {"items": items}


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
    before = {"name": tenant.name, "slug": tenant.slug}
    result = await update_workspace(session, tenant, role, payload)
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant.id,
        action="workspace:settings_updated",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="tenant",
        resource_id=tenant.id,
        before=before,
        after={"name": tenant.name, "slug": tenant.slug, "fields": sorted(payload.keys())},
    )
    return result


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


class MemberRolePatchBody(BaseModel):
    role: str


@router.patch("/workspaces/{workspace_id}/members/{member_id}")
async def patch_workspace_member(
    workspace_id: str,
    member_id: str,
    body: MemberRolePatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant, _role = await resolve_tenant_for_workspace(
        session, workspace_id, auth.user, is_staff=auth.is_staff
    )
    auth.require_role("owner", "admin")
    if body.role == "owner":
        # Only an owner can promote someone to owner.
        auth.require_role("owner")
    updated = await update_member_role(session, tenant.id, member_id, body.role)
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant.id,
        action="user:role_changed",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="membership",
        resource_id=member_id,
        payload={"role": body.role},
    )
    return updated


@router.delete("/workspaces/{workspace_id}/members/{member_id}")
async def delete_workspace_member(
    workspace_id: str,
    member_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant, _role = await resolve_tenant_for_workspace(
        session, workspace_id, auth.user, is_staff=auth.is_staff
    )
    auth.require_role("owner", "admin")
    await remove_member(session, tenant.id, member_id, acting_user=auth.user)
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant.id,
        action="user:member_removed",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="membership",
        resource_id=member_id,
    )
    return {"ok": True}


@router.post("/workspaces/{workspace_id}/invites/{invite_id}/resend")
async def resend_workspace_invite(
    workspace_id: str,
    invite_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant, _role = await resolve_tenant_for_workspace(
        session, workspace_id, auth.user, is_staff=auth.is_staff
    )
    auth.require_role("owner", "admin")
    result = await resend_invite(session, tenant, invite_id, auth.user)
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant.id,
        action="invite:resent",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="invite",
        resource_id=invite_id,
    )
    return result


@router.delete("/workspaces/{workspace_id}/invites/{invite_id}")
async def delete_workspace_invite(
    workspace_id: str,
    invite_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant, _role = await resolve_tenant_for_workspace(
        session, workspace_id, auth.user, is_staff=auth.is_staff
    )
    auth.require_role("owner", "admin")
    await revoke_invite(session, tenant.id, invite_id)
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant.id,
        action="invite:revoked",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="invite",
        resource_id=invite_id,
    )
    return {"ok": True}


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
    result = await create_workspace_invite(
        session,
        tenant,
        email=str(body.email),
        role=body.role,
        inviter=auth.user,
    )
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant.id,
        action="invite:created",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="invite",
        resource_id=(result or {}).get("id", "") if isinstance(result, dict) else "",
        summary=f"{body.email} as {body.role}",
    )
    return result
