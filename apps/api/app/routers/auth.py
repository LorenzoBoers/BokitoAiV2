import base64
from datetime import datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.exceptions import AppError
from app.models.auth import Invite, Membership, Tenant, User
from app.models.auth import user_numeric_id
from app.models.staff import StaffAccessLog
from app.services.auth import (
    authenticate_user,
    create_access_token,
    create_invite_token,
    create_refresh_session,
    get_tenant_for_user,
    hash_password,
    verify_password,
    verify_refresh_token,
)
from app.services.tenant_bootstrap import bootstrap_tenant, default_tenant_settings, serialize_settings
from app.services.workspaces_portal import (
    apply_branding,
    resolve_tenant_for_workspace,
    tenant_by_subdomain,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """Set the httponly refresh cookie. Marked Secure in production so it is
    only sent over HTTPS."""
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=settings.is_production,
        max_age=settings.refresh_token_expire_days * 86400,
    )


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    tenant_slug: str
    tenant_name: str
    display_name: str = ""


class StaffLoginRequest(BaseModel):
    email: EmailStr
    password: str


class SwitchTenantRequest(BaseModel):
    tenant_id: UUID


class InviteRequest(BaseModel):
    email: EmailStr
    role: str = "member"


class AcceptInviteRequest(BaseModel):
    token: str
    password: str
    display_name: str = ""


class ProfilePatchRequest(BaseModel):
    name: str | None = None
    email: EmailStr | None = None
    job_title: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    password_confirmation: str | None = None


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    password: str
    password_confirmation: str | None = None


class VerifyEmailRequest(BaseModel):
    token: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict
    tenant: dict


def _user_dict(user: User, tenant: Tenant, role: str, is_staff: bool = False) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "role": role,
        "is_staff": is_staff,
        "tenant": {"id": str(tenant.id), "slug": tenant.slug, "name": tenant.name},
    }


def _tenant_dict(tenant: Tenant) -> dict:
    return {"id": str(tenant.id), "slug": tenant.slug, "name": tenant.name, "logo": tenant.logo_url}


@router.post("/signup", response_model=LoginResponse)
async def signup(body: SignupRequest, response: Response, session: Annotated[AsyncSession, Depends(get_session)]):
    existing = await session.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    slug_check = await session.execute(select(Tenant).where(Tenant.slug == body.tenant_slug))
    if slug_check.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Tenant slug taken")

    tenant = Tenant(
        slug=body.tenant_slug,
        name=body.tenant_name,
        settings_json=serialize_settings(default_tenant_settings()),
    )
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        display_name=body.display_name or body.email.split("@")[0],
    )
    session.add(tenant)
    session.add(user)
    await session.flush()
    session.add(Membership(tenant_id=tenant.id, user_id=user.id, role="owner"))
    await bootstrap_tenant(session, tenant.id)
    from app.services.personal_agents import get_or_create_personal_agent

    await get_or_create_personal_agent(session, tenant.id, user, commit=False)
    from app.models.signal import Signal

    session.add(
        Signal(
            tenant_id=tenant.id,
            owner_user_id=user.id,
            subject="Onboarding",
            channel="assistant",
            source="chat",
            contact_name=user.display_name or user.email,
            has_unread=False,
        )
    )
    await session.commit()

    access_token = create_access_token(user.id, tenant.id, user.email)
    refresh_token, _ = await create_refresh_session(session, user.id)
    _set_refresh_cookie(response, refresh_token)
    return LoginResponse(
        access_token=access_token,
        user=_user_dict(user, tenant, "owner"),
        tenant=_tenant_dict(tenant),
    )


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user = await authenticate_user(session, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    tenant_ctx = await get_tenant_for_user(session, user.id)
    if not tenant_ctx:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant membership")
    tenant, membership = tenant_ctx
    access_token = create_access_token(user.id, tenant.id, user.email)
    refresh_token, _ = await create_refresh_session(session, user.id)
    _set_refresh_cookie(response, refresh_token)
    return LoginResponse(
        access_token=access_token,
        user=_user_dict(user, tenant, membership.role),
        tenant=_tenant_dict(tenant),
    )


@router.post("/staff-login", response_model=LoginResponse)
async def staff_login(
    body: StaffLoginRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user = await authenticate_user(session, body.email, body.password)
    if not user or not user.is_staff:
        raise HTTPException(status_code=401, detail="Invalid staff credentials")
    tenant_result = await session.execute(select(Tenant).order_by(Tenant.created_at).limit(1))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="No tenant available")
    access_token = create_access_token(user.id, tenant.id, user.email, staff=True)
    refresh_token, _ = await create_refresh_session(session, user.id)
    _set_refresh_cookie(response, refresh_token)
    return LoginResponse(
        access_token=access_token,
        user=_user_dict(user, tenant, "admin", is_staff=True),
        tenant=_tenant_dict(tenant),
    )


@router.post("/switch-tenant", response_model=LoginResponse)
async def switch_tenant(
    body: SwitchTenantRequest,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    if not auth.user.is_staff:
        raise HTTPException(status_code=403, detail="Staff only")
    tenant_result = await session.execute(select(Tenant).where(Tenant.id == body.tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    session.add(StaffAccessLog(staff_user_id=auth.user.id, tenant_id=tenant.id, action="enter"))
    await session.commit()
    access_token = create_access_token(auth.user.id, tenant.id, auth.user.email, staff=True)
    return LoginResponse(
        access_token=access_token,
        user=_user_dict(auth.user, tenant, "admin", is_staff=True),
        tenant=_tenant_dict(tenant),
    )


@router.get("/tenants")
async def list_tenants(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    if not auth.user.is_staff:
        raise HTTPException(status_code=403, detail="Staff only")
    result = await session.execute(select(Tenant).order_by(Tenant.name))
    return [{"id": str(t.id), "slug": t.slug, "name": t.name} for t in result.scalars().all()]


@router.post("/invite")
async def invite_user(
    body: InviteRequest,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    token = await create_invite_token()
    invite = Invite(
        tenant_id=auth.tenant.id,
        email=body.email,
        role=body.role if body.role in ("admin", "member") else "member",
        token=token,
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    session.add(invite)
    await session.commit()
    return {"token": token, "email": body.email, "expires_at": invite.expires_at.isoformat()}


@router.post("/accept-invite", response_model=LoginResponse)
async def accept_invite(
    body: AcceptInviteRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(Invite).where(Invite.token == body.token, Invite.expires_at > datetime.utcnow())
    )
    invite = result.scalar_one_or_none()
    if not invite or invite.accepted_at:
        raise HTTPException(status_code=400, detail="Invalid or expired invite")
    user_result = await session.execute(select(User).where(User.email == invite.email))
    user = user_result.scalar_one_or_none()
    if not user:
        user = User(
            email=invite.email,
            password_hash=hash_password(body.password),
            display_name=body.display_name or invite.email.split("@")[0],
        )
        session.add(user)
        await session.flush()
    session.add(Membership(tenant_id=invite.tenant_id, user_id=user.id, role=invite.role))
    from app.services.personal_agents import get_or_create_personal_agent

    await get_or_create_personal_agent(session, invite.tenant_id, user, commit=False)
    invite.accepted_at = datetime.utcnow()
    tenant_result = await session.execute(select(Tenant).where(Tenant.id == invite.tenant_id))
    tenant = tenant_result.scalar_one()
    await session.commit()
    access_token = create_access_token(user.id, tenant.id, user.email)
    refresh_token, _ = await create_refresh_session(session, user.id)
    _set_refresh_cookie(response, refresh_token)
    return LoginResponse(
        access_token=access_token,
        user=_user_dict(user, tenant, invite.role),
        tenant=_tenant_dict(tenant),
    )


@router.post("/refresh", response_model=LoginResponse)
async def refresh(
    request: Request,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    raw = request.cookies.get(settings.refresh_cookie_name)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")
    user = await verify_refresh_token(session, raw)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    tenant_ctx = await get_tenant_for_user(session, user.id)
    if not tenant_ctx:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant membership")
    tenant, membership = tenant_ctx
    access_token = create_access_token(user.id, tenant.id, user.email, staff=user.is_staff)
    return LoginResponse(
        access_token=access_token,
        user=_user_dict(user, tenant, membership.role, is_staff=user.is_staff),
        tenant=_tenant_dict(tenant),
    )


async def _build_memberships(session: AsyncSession, user: User) -> list[dict]:
    """Tenant memberships for the dashboard AuthContext (staff sees all tenants)."""
    memberships: list[dict] = []
    if user.is_staff:
        result = await session.execute(select(Tenant).order_by(Tenant.name))
        for tenant in result.scalars().all():
            memberships.append(
                {
                    "tenant_id": str(tenant.id),
                    "tenant_slug": tenant.slug,
                    "tenant_name": tenant.name,
                    "role": "admin",
                    "status": "active",
                }
            )
        return memberships
    result = await session.execute(
        select(Membership, Tenant)
        .join(Tenant, Tenant.id == Membership.tenant_id)
        .where(Membership.user_id == user.id)
    )
    for membership, tenant in result.all():
        memberships.append(
            {
                "tenant_id": str(tenant.id),
                "tenant_slug": tenant.slug,
                "tenant_name": tenant.name,
                "role": membership.role,
                "status": "active",
            }
        )
    return memberships


def _me_payload(auth: AuthContext, memberships: list[dict]) -> dict:
    avatar = None
    if auth.user.avatar_url:
        avatar = {"url": auth.user.avatar_url, "path": auth.user.avatar_url}
    tenant_id = str(auth.tenant.id)
    return {
        "id": user_numeric_id(auth.user.id),
        "name": auth.user.display_name or auth.user.email,
        "email": auth.user.email,
        "job_title": auth.user.job_title or None,
        "role": auth.role,
        "organisation_id": tenant_id,
        "account_id": None,
        "is_staff": auth.is_staff,
        "avatar": avatar,
        "tenant": {
            "id": tenant_id,
            "slug": auth.tenant.slug,
            "name": auth.tenant.name,
            "logo": auth.tenant.logo_url,
            "logo_url": auth.tenant.logo_url,
        },
        "current_tenant": {
            "id": tenant_id,
            "slug": auth.tenant.slug,
            "name": auth.tenant.name,
            "logo": auth.tenant.logo_url,
            "logo_url": auth.tenant.logo_url,
        },
        "memberships": memberships,
        "user": _user_dict(auth.user, auth.tenant, auth.role, is_staff=auth.is_staff),
    }


@router.get("/me")
async def me(
    request: Request,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant = auth.tenant
    subdomain = request.query_params.get("tenant_subdomain")
    if subdomain:
        resolved = await tenant_by_subdomain(session, subdomain)
        if resolved:
            if auth.is_staff:
                tenant = resolved
            else:
                membership_result = await session.execute(
                    select(Membership).where(
                        Membership.user_id == auth.user.id,
                        Membership.tenant_id == resolved.id,
                    )
                )
                if membership_result.scalar_one_or_none():
                    tenant = resolved
    memberships = await _build_memberships(session, auth.user)
    scoped_auth = AuthContext(
        user=auth.user,
        tenant=tenant,
        membership=auth.membership,
        token=auth.token,
        is_staff=auth.is_staff,
    )
    return _me_payload(scoped_auth, memberships)


@router.patch("/profile")
async def patch_profile(
    body: ProfilePatchRequest,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user = auth.user
    if body.name is not None and body.name.strip():
        user.display_name = body.name.strip()
    if body.job_title is not None:
        user.job_title = body.job_title.strip()
    if body.email is not None:
        email = str(body.email).strip().lower()
        if email != user.email:
            existing = await session.execute(select(User).where(User.email == email))
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Email already in use")
            user.email = email
    session.add(user)
    await session.commit()
    await session.refresh(user)
    memberships = await _build_memberships(session, user)
    scoped = AuthContext(
        user=user,
        tenant=auth.tenant,
        membership=auth.membership,
        token=auth.token,
        is_staff=auth.is_staff,
    )
    return _me_payload(scoped, memberships)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    if not verify_password(body.current_password, auth.user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    confirm = body.password_confirmation or body.new_password
    if body.new_password != confirm:
        raise HTTPException(status_code=400, detail="Password confirmation does not match")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    auth.user.password_hash = hash_password(body.new_password)
    session.add(auth.user)
    await session.commit()
    return {"ok": True}


async def _store_avatar(user: User, upload: UploadFile, session: AsyncSession) -> dict:
    raw = await upload.read()
    if len(raw) > 512_000:
        raise HTTPException(status_code=400, detail="Avatar file too large")
    mime = upload.content_type or "image/png"
    user.avatar_url = f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
    session.add(user)
    await session.commit()
    return {"avatar": {"url": user.avatar_url, "path": user.avatar_url}}


@router.post("/users/me/avatar")
async def upload_me_avatar(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    avatar: UploadFile = File(...),
):
    return await _store_avatar(auth.user, avatar, session)


@router.post("/avatar")
async def upload_avatar_legacy(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    avatar: UploadFile = File(...),
):
    return await _store_avatar(auth.user, avatar, session)


@router.post("/workspaces/{workspace_id}/branding")
async def workspace_branding(
    workspace_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    name: str | None = Form(None),
    subdomain: str | None = Form(None),
    brand_color: str | None = Form(None),
    logo: UploadFile | None = File(None),
    favicon: UploadFile | None = File(None),
    appearance_json: str | None = Form(None),
    widget_favicon: UploadFile | None = File(None),
):
    auth.require_role("owner", "admin")
    try:
        tenant, role = await resolve_tenant_for_workspace(
            session, workspace_id, auth.user, is_staff=auth.is_staff
        )
        logo_bytes = await logo.read() if logo and logo.filename else None
        favicon_bytes = await favicon.read() if favicon and favicon.filename else None
        widget_favicon_bytes = (
            await widget_favicon.read() if widget_favicon and widget_favicon.filename else None
        )
        payload = await apply_branding(
            session,
            tenant,
            name=name,
            subdomain=subdomain,
            brand_color=brand_color,
            logo_bytes=logo_bytes,
            logo_content_type=logo.content_type if logo else None,
            favicon_bytes=favicon_bytes,
            favicon_content_type=favicon.content_type if favicon else None,
            appearance_json=appearance_json,
            widget_favicon_bytes=widget_favicon_bytes,
            widget_favicon_content_type=widget_favicon.content_type if widget_favicon else None,
        )
        payload["role"] = role
        return payload
    except AppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/auth/password-reset-request")
@router.post("/password-reset-request")
async def password_reset_request(body: PasswordResetRequest):
    return {"message": "If the email exists, a reset link has been sent."}


@router.post("/auth/password-reset")
@router.post("/password-reset")
async def password_reset(_body: PasswordResetConfirm):
    return {"message": "Password reset is not enabled in this environment."}


@router.post("/auth/verify-email")
@router.post("/verify-email")
async def verify_email(_body: VerifyEmailRequest):
    return {"message": "Email verified."}


@router.post("/auth/resend-verification")
@router.post("/resend-verification")
async def resend_verification(_body: ResendVerificationRequest):
    return {"message": "Verification email sent if applicable."}


@router.post("/auth/revoke")
@router.post("/revoke")
async def revoke_session(
    response: Response,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    response.delete_cookie(settings.refresh_cookie_name)
    return {"ok": True}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(settings.refresh_cookie_name)
    return {"ok": True}
