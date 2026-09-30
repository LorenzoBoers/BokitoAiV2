"""Auth: signup, login, refresh, logout, workspace switch."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Cookie, Depends, Response
from pydantic import BaseModel, EmailStr, Field

from bokito.config import get_settings
from bokito.deps import DbSession, current_user_any_tenant
from bokito.domain.identity import User
from bokito.errors import Forbidden
from bokito.services import identity

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    name: str = Field(default="", max_length=200)
    workspace_name: str = Field(default="", max_length=200)
    language: str = Field(default="en", pattern="^(en|nl)$")
    invite: str | None = Field(default=None, description="Invite token to join a workspace")


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class WorkspaceOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    role: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    tenant_id: uuid.UUID | None
    user_id: uuid.UUID


def _set_refresh_cookie(response: Response, raw: str) -> None:
    s = get_settings()
    response.set_cookie(
        s.refresh_cookie_name,
        raw,
        httponly=True,
        secure=s.environment in ("staging", "production"),
        samesite="lax",
        max_age=s.refresh_token_days * 86400,
        path=f"{s.api_prefix}/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(s.refresh_cookie_name, path=f"{s.api_prefix}/auth")


async def _issue(session: DbSession, response: Response, user: User) -> TokenOut:
    tenant = await identity.resolve_tenant(session, user)
    raw = await identity.create_refresh_session(session, user.id)
    await session.commit()
    _set_refresh_cookie(response, raw)
    tid = tenant.id if tenant else None
    return TokenOut(
        access_token=identity.create_access_token(user.id, tid), tenant_id=tid, user_id=user.id
    )


@router.post(
    "/signup", response_model=TokenOut, status_code=201, summary="Create user and workspace"
)
async def signup(body: SignupIn, session: DbSession, response: Response) -> TokenOut:
    user = await identity.create_user(
        session, email=body.email, password=body.password, name=body.name
    )
    user.language = body.language
    if body.invite:
        await identity.accept_invite(session, user=user, raw=body.invite)
    else:
        if not body.workspace_name.strip():
            from bokito.errors import AppError

            raise AppError("workspace_name is required", code="workspace_name_required")
        await identity.create_workspace(
            session, owner=user, name=body.workspace_name, language=body.language
        )
    return await _issue(session, response, user)


@router.post("/login", response_model=TokenOut, summary="Log in with email and password")
async def login(body: LoginIn, session: DbSession, response: Response) -> TokenOut:
    user = await identity.authenticate(session, body.email, body.password)
    return await _issue(session, response, user)


@router.post("/refresh", response_model=TokenOut, summary="Rotate the access token")
async def refresh(
    session: DbSession,
    response: Response,
    bokito2_refresh: str | None = Cookie(default=None),
) -> TokenOut:
    from bokito.errors import Unauthorized

    if not bokito2_refresh:
        raise Unauthorized("no refresh cookie", code="refresh_missing")
    user = await identity.verify_refresh_session(session, bokito2_refresh)
    tenant = await identity.resolve_tenant(session, user)
    tid = tenant.id if tenant else None
    await session.commit()
    return TokenOut(
        access_token=identity.create_access_token(user.id, tid), tenant_id=tid, user_id=user.id
    )


@router.post("/logout", status_code=204, summary="Revoke the refresh session")
async def logout(
    session: DbSession,
    response: Response,
    bokito2_refresh: str | None = Cookie(default=None),
) -> Response:
    if bokito2_refresh:
        await identity.revoke_refresh_session(session, bokito2_refresh)
        await session.commit()
    _clear_refresh_cookie(response)
    return Response(status_code=204)


@router.get("/workspaces", response_model=list[WorkspaceOut], summary="Workspaces of the user")
async def workspaces(
    session: DbSession, user: User = Depends(current_user_any_tenant)
) -> list[WorkspaceOut]:
    rows = await identity.memberships_for(session, user.id)
    return [WorkspaceOut(id=t.id, slug=t.slug, name=t.name, role=m.role.value) for m, t in rows]


@router.post(
    "/workspaces/{tenant_id}/switch", response_model=TokenOut, summary="Switch active workspace"
)
async def switch_workspace(
    tenant_id: uuid.UUID, session: DbSession, user: User = Depends(current_user_any_tenant)
) -> TokenOut:
    if not await identity.membership_for(session, user.id, tenant_id) and not user.is_staff:
        raise Forbidden("not a member", code="not_member")
    user.last_tenant_id = tenant_id
    await session.commit()
    return TokenOut(
        access_token=identity.create_access_token(user.id, tenant_id),
        tenant_id=tenant_id,
        user_id=user.id,
    )
