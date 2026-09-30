"""Workspace settings: name, language, members and invites."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from bokito.deps import DbSession, Operator, tenant_of
from bokito.domain.base import utcnow
from bokito.domain.identity import Invite, Membership, Role, User
from bokito.errors import Conflict, NotFound
from bokito.services import audit

router = APIRouter(prefix="/workspace", tags=["workspace"])


class WorkspaceOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    posture: str
    region: str
    language: str
    settings: dict[str, Any]


class WorkspacePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    language: str | None = Field(default=None, pattern="^(en|nl)$")
    settings: dict[str, Any] | None = None


def _ws_out(tenant) -> WorkspaceOut:
    return WorkspaceOut(
        id=tenant.id,
        slug=tenant.slug,
        name=tenant.name,
        posture=tenant.posture.value,
        region=tenant.region,
        language=tenant.language,
        settings=dict(tenant.settings or {}),
    )


@router.get("", response_model=WorkspaceOut, summary="Workspace")
async def get_workspace(session: DbSession, principal: Operator) -> WorkspaceOut:
    return _ws_out(await tenant_of(session, principal))


@router.patch("", response_model=WorkspaceOut, summary="Update workspace")
async def patch_workspace(
    body: WorkspacePatch, session: DbSession, principal: Operator
) -> WorkspaceOut:
    principal.require_role(Role.admin)
    tenant = await tenant_of(session, principal)
    if body.name is not None:
        tenant.name = body.name.strip()
    if body.language is not None:
        tenant.language = body.language
    if body.settings is not None:
        tenant.settings = {**(tenant.settings or {}), **body.settings}
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="workspace.update",
        target_kind="tenant",
        target_id=tenant.id,
        payload={"fields": [k for k, v in body.model_dump().items() if v is not None]},
    )
    await session.commit()
    return _ws_out(tenant)


class MemberOut(BaseModel):
    user_id: uuid.UUID
    email: str
    name: str
    role: str
    joined_at: datetime


@router.get("/members", response_model=list[MemberOut], summary="Members")
async def list_members(session: DbSession, principal: Operator) -> list[MemberOut]:
    rows = (
        await session.execute(
            select(Membership, User)
            .join(User, User.id == Membership.user_id)
            .where(Membership.tenant_id == principal.tenant_id)
            .order_by(Membership.created_at)
        )
    ).all()
    return [
        MemberOut(
            user_id=u.id, email=u.email, name=u.name, role=m.role.value, joined_at=m.created_at
        )
        for m, u in rows
    ]


class RoleIn(BaseModel):
    role: Role


@router.patch("/members/{user_id}", response_model=MemberOut, summary="Change a member role")
async def set_role(
    user_id: uuid.UUID, body: RoleIn, session: DbSession, principal: Operator
) -> MemberOut:
    principal.require_role(Role.admin)
    if body.role == Role.owner:
        principal.require_role(Role.owner)
    m = await session.scalar(
        select(Membership).where(
            Membership.tenant_id == principal.tenant_id, Membership.user_id == user_id
        )
    )
    if not m:
        raise NotFound("member not found", code="member_not_found")
    if m.role == Role.owner and body.role != Role.owner:
        owners = (
            await session.scalars(
                select(Membership).where(
                    Membership.tenant_id == principal.tenant_id, Membership.role == Role.owner
                )
            )
        ).all()
        if len(owners) <= 1:
            raise Conflict("a workspace needs at least one owner", code="last_owner")
    m.role = body.role
    user = await session.get(User, user_id)
    assert user is not None
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="member.role",
        target_kind="user",
        target_id=user_id,
        payload={"role": body.role.value},
    )
    await session.commit()
    return MemberOut(
        user_id=user.id, email=user.email, name=user.name, role=m.role.value, joined_at=m.created_at
    )


@router.delete("/members/{user_id}", status_code=204, summary="Remove a member")
async def remove_member(user_id: uuid.UUID, session: DbSession, principal: Operator) -> None:
    principal.require_role(Role.admin)
    m = await session.scalar(
        select(Membership).where(
            Membership.tenant_id == principal.tenant_id, Membership.user_id == user_id
        )
    )
    if not m:
        raise NotFound("member not found", code="member_not_found")
    if m.role == Role.owner:
        raise Conflict("transfer ownership before removing an owner", code="owner_removal")
    await session.delete(m)
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="member.remove",
        target_kind="user",
        target_id=user_id,
    )
    await session.commit()


class InviteIn(BaseModel):
    email: EmailStr
    role: Role = Role.member


class InviteOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    expires_at: datetime
    accepted_at: datetime | None
    created_at: datetime
    accept_url: str | None = None


def _invite_out(inv: Invite, accept_url: str | None = None) -> InviteOut:
    return InviteOut(
        id=inv.id,
        email=inv.email,
        role=inv.role.value,
        expires_at=inv.expires_at,
        accepted_at=inv.accepted_at,
        created_at=inv.created_at,
        accept_url=accept_url,
    )


@router.get("/invites", response_model=list[InviteOut], summary="Open invites")
async def list_invites(session: DbSession, principal: Operator) -> list[InviteOut]:
    principal.require_role(Role.admin)
    rows = (
        await session.scalars(
            select(Invite)
            .where(Invite.tenant_id == principal.tenant_id, Invite.accepted_at.is_(None))
            .order_by(Invite.created_at.desc())
        )
    ).all()
    return [_invite_out(i) for i in rows]


@router.post("/invites", response_model=InviteOut, status_code=201, summary="Invite a colleague")
async def create_invite(body: InviteIn, session: DbSession, principal: Operator) -> InviteOut:
    from bokito.config import get_settings

    principal.require_role(Role.admin)
    raw = secrets.token_urlsafe(24)
    inv = Invite(
        tenant_id=principal.tenant_id,
        email=str(body.email).lower(),
        role=body.role,
        token_digest=hashlib.sha256(raw.encode()).hexdigest(),
        invited_by_user_id=principal.user_id,
        expires_at=utcnow() + timedelta(days=7),
        created_at=utcnow(),
    )
    session.add(inv)
    await session.flush()
    await audit.record(
        session,
        principal.tenant_id,
        actor=principal.actor,
        trust=principal.trust,
        action="invite.create",
        target_kind="invite",
        target_id=inv.id,
        payload={"role": body.role.value},
    )
    await session.commit()
    url = f"{get_settings().public_app_url}/signup?invite={raw}"
    return _invite_out(inv, accept_url=url)


@router.delete("/invites/{invite_id}", status_code=204, summary="Withdraw an invite")
async def delete_invite(invite_id: uuid.UUID, session: DbSession, principal: Operator) -> None:
    principal.require_role(Role.admin)
    inv = await session.get(Invite, invite_id)
    if not inv or inv.tenant_id != principal.tenant_id:
        raise NotFound("invite not found", code="invite_not_found")
    await session.delete(inv)
    await session.commit()
