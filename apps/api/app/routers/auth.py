import base64
import logging
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
from app.middleware.rate_limit import rate_limit
from app.models.auth_token import AuthToken
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
    allows_platform_support,
    apply_branding,
    first_allowed_support_tenant,
    resolve_tenant_for_workspace,
    tenant_by_subdomain,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()
logger = logging.getLogger(__name__)


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
    # True marks first-time onboarding as done (persisted as `onboarded_at`
    # in User.settings_json). Sent by the accept-invite welcome step.
    onboarded: bool | None = None
    # Personal email signature (HTML), appended to replies sent as this user.
    email_signature_html: str | None = None


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


class TotpEnableRequest(BaseModel):
    code: str


class TotpDisableRequest(BaseModel):
    # Password proves account ownership; SSO-only accounts (no password)
    # confirm with a current TOTP code instead.
    password: str = ""
    code: str = ""


class TotpVerifyRequest(BaseModel):
    challenge_token: str
    code: str


def _user_dict(user: User, tenant: Tenant, role: str, is_staff: bool = False) -> dict:
    from app.services.signatures import user_signature_html

    return {
        "id": str(user.id),
        "numeric_id": user_numeric_id(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "role": role,
        "is_staff": is_staff,
        "email_verified": user.email_verified,
        "totp_enabled": user.totp_enabled,
        "email_signature_html": user_signature_html(user),
        "tenant": {"id": str(tenant.id), "slug": tenant.slug, "name": tenant.name},
    }


def _tenant_dict(tenant: Tenant) -> dict:
    return {"id": str(tenant.id), "slug": tenant.slug, "name": tenant.name, "logo": tenant.logo_url}


@router.post("/signup", response_model=LoginResponse, dependencies=[Depends(rate_limit("auth-signup", limit=5))])
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
    user.last_tenant_id = tenant.id
    await bootstrap_tenant(session, tenant.id)
    await session.commit()

    # Soft verification gate: the account works immediately, but outbound
    # actions stay locked until the emailed link is clicked.
    verify_token = await _issue_auth_token(session, user, "email_verify", ttl_minutes=60 * 24)
    await session.commit()
    from app.services.transactional_mail import send_verification_mail

    await send_verification_mail(
        user.email, verify_link=_absolute_app_link("/verify-email", verify_token)
    )

    access_token = create_access_token(user.id, tenant.id, user.email)
    refresh_token, _ = await create_refresh_session(session, user.id)
    _set_refresh_cookie(response, refresh_token)
    return LoginResponse(
        access_token=access_token,
        user=_user_dict(user, tenant, "owner"),
        tenant=_tenant_dict(tenant),
    )


@router.post("/login", response_model=LoginResponse, dependencies=[Depends(rate_limit("auth-login", limit=10))])
async def login(
    body: LoginRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user = await authenticate_user(session, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if user.totp_enabled:
        # Password checked out, but the session is only minted after the TOTP
        # step. The challenge token carries no API access.
        from fastapi.responses import JSONResponse

        from app.services.auth import create_totp_challenge_token

        return JSONResponse(
            {"requires_2fa": True, "challenge_token": create_totp_challenge_token(user.id)}
        )
    return await _complete_login(session, response, user)


async def _pending_invites_for_email(session: AsyncSession, email: str) -> list[dict]:
    """Open (unaccepted, unexpired) invites for this email across all tenants."""
    result = await session.execute(
        select(Invite, Tenant)
        .join(Tenant, Tenant.id == Invite.tenant_id)
        .where(
            Invite.email == email,
            Invite.accepted_at.is_(None),
            Invite.expires_at > datetime.utcnow(),
        )
        .order_by(Invite.created_at.desc())
    )
    rows = result.all()
    inviter_ids = {inv.invited_by_user_id for inv, _ in rows if inv.invited_by_user_id}
    names: dict[UUID, str] = {}
    if inviter_ids:
        users = await session.execute(select(User).where(User.id.in_(inviter_ids)))
        names = {u.id: (u.display_name or u.email) for u in users.scalars().all()}
    return [
        {
            "id": str(invite.id),
            "tenant_name": tenant.name,
            "role": invite.role,
            "invited_by_name": names.get(invite.invited_by_user_id, "")
            if invite.invited_by_user_id
            else "",
        }
        for invite, tenant in rows
    ]


async def _workspace_required_response(session: AsyncSession, user: User):
    """Login succeeded but the account has no workspace membership.

    The account keeps existing when its memberships are removed; instead of a
    hard 403 the client gets a limited setup token plus any pending invites so
    the user can join a workspace or create a new one (ClickUp-style)."""
    from fastapi.responses import JSONResponse

    from app.services.auth import create_workspace_setup_token

    return JSONResponse(
        {
            "requires_workspace": True,
            "setup_token": create_workspace_setup_token(user.id),
            "email": user.email,
            "display_name": user.display_name,
            "pending_invites": await _pending_invites_for_email(session, user.email),
        }
    )


async def _staff_landing_tenant(session: AsyncSession, user: User) -> Tenant | None:
    return await first_allowed_support_tenant(session, preferred_id=user.last_tenant_id)


async def _complete_login(
    session: AsyncSession, response: Response, user: User
):
    tenant_ctx = await get_tenant_for_user(session, user.id, preferred_tenant_id=user.last_tenant_id)
    tenant: Tenant | None = None
    role = "member"
    if tenant_ctx:
        tenant, membership = tenant_ctx
        role = "admin" if user.is_staff else membership.role
        if user.is_staff and not allows_platform_support(tenant):
            tenant = await _staff_landing_tenant(session, user)
            role = "admin" if tenant else role
    elif user.is_staff:
        tenant = await _staff_landing_tenant(session, user)
        role = "admin"
    if not tenant:
        return await _workspace_required_response(session, user)
    if user.last_tenant_id != tenant.id:
        user.last_tenant_id = tenant.id
        session.add(user)
        await session.commit()
    access_token = create_access_token(user.id, tenant.id, user.email, staff=user.is_staff)
    refresh_token, _ = await create_refresh_session(session, user.id)
    _set_refresh_cookie(response, refresh_token)
    return LoginResponse(
        access_token=access_token,
        user=_user_dict(user, tenant, role, is_staff=user.is_staff),
        tenant=_tenant_dict(tenant),
    )


@router.post("/2fa/verify", response_model=LoginResponse, dependencies=[Depends(rate_limit("auth-2fa", limit=10))])
async def totp_verify_login(
    body: TotpVerifyRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Second login step: exchange challenge token + TOTP code for a session."""
    from app.services.auth import decode_totp_challenge_token
    from app.services.crypto import decrypt_secret
    from app.services.totp import verify_totp

    user_id = decode_totp_challenge_token(body.challenge_token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired challenge")
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not user.totp_enabled:
        raise HTTPException(status_code=401, detail="Invalid or expired challenge")
    if not verify_totp(decrypt_secret(user.totp_secret), body.code):
        raise HTTPException(status_code=401, detail="Invalid verification code")
    return await _complete_login(session, response, user)


@router.post("/2fa/setup")
async def totp_setup(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Start enrollment: returns the secret + otpauth URI for authenticator
    apps. Nothing is enforced until the first code is verified via enable."""
    from app.services.crypto import encrypt_secret
    from app.services.totp import generate_secret, otpauth_uri

    if auth.user.totp_enabled:
        raise HTTPException(status_code=400, detail="Two-factor authentication is already enabled")
    secret = generate_secret()
    auth.user.totp_pending_secret = encrypt_secret(secret)
    session.add(auth.user)
    await session.commit()
    return {
        "secret": secret,
        "otpauth_uri": otpauth_uri(secret, account=auth.user.email),
    }


@router.post("/2fa/enable")
async def totp_enable(
    body: TotpEnableRequest,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Confirm enrollment with a code from the authenticator app."""
    from app.services.crypto import decrypt_secret
    from app.services.totp import verify_totp

    if auth.user.totp_enabled:
        raise HTTPException(status_code=400, detail="Two-factor authentication is already enabled")
    secret = decrypt_secret(auth.user.totp_pending_secret)
    if not secret:
        raise HTTPException(status_code=400, detail="Start 2FA setup first")
    if not verify_totp(secret, body.code):
        raise HTTPException(status_code=400, detail="Invalid verification code")
    auth.user.totp_secret = auth.user.totp_pending_secret
    auth.user.totp_pending_secret = ""
    auth.user.totp_enabled = True
    session.add(auth.user)
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="user:2fa_enabled",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="user",
        resource_id=auth.user.id,
        commit=False,
    )
    await session.commit()
    return {"ok": True, "totp_enabled": True}


@router.post("/2fa/disable")
async def totp_disable(
    body: TotpDisableRequest,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.crypto import decrypt_secret
    from app.services.totp import verify_totp

    if not auth.user.totp_enabled:
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")
    if auth.user.password_hash:
        if not verify_password(body.password, auth.user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
    elif not verify_totp(decrypt_secret(auth.user.totp_secret), body.code):
        # SSO-only accounts have no password; a current code confirms instead.
        raise HTTPException(status_code=400, detail="Invalid verification code")
    auth.user.totp_enabled = False
    auth.user.totp_secret = ""
    auth.user.totp_pending_secret = ""
    session.add(auth.user)
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="user:2fa_disabled",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="user",
        resource_id=auth.user.id,
        commit=False,
    )
    await session.commit()
    return {"ok": True, "totp_enabled": False}


@router.get("/microsoft/start", dependencies=[Depends(rate_limit("auth-sso", limit=20))])
async def microsoft_sso_start(
    session: Annotated[AsyncSession, Depends(get_session)],
    return_url: str = "",
):
    """Public entry point for "Sign in with Microsoft".

    Returns the Entra authorize URL; the browser is redirected there and comes
    back through the shared OAuth callback, which mints the session cookie.
    """
    from app.services.oauth_flow import start_real_oauth

    authorize_url = await start_real_oauth(
        session,
        tenant_id=None,
        user_id=None,
        provider="outlook",
        flow="login",
        return_url=return_url or settings.public_app_url,
    )
    if not authorize_url:
        raise HTTPException(
            status_code=503,
            detail="Microsoft sign-in is not configured on this server.",
        )
    return {"authorize_url": authorize_url}


@router.post("/staff-login", response_model=LoginResponse, dependencies=[Depends(rate_limit("auth-login", limit=10))])
async def staff_login(
    body: StaffLoginRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user = await authenticate_user(session, body.email, body.password)
    if not user or not user.is_staff:
        raise HTTPException(status_code=401, detail="Invalid staff credentials")
    tenant = await first_allowed_support_tenant(session, preferred_id=user.last_tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="No workspace allows platform support")
    if user.last_tenant_id != tenant.id:
        user.last_tenant_id = tenant.id
        session.add(user)
        await session.commit()
    access_token = create_access_token(user.id, tenant.id, user.email, staff=True)
    refresh_token, _ = await create_refresh_session(session, user.id)
    _set_refresh_cookie(response, refresh_token)
    return LoginResponse(
        access_token=access_token,
        user=_user_dict(user, tenant, "admin", is_staff=True),
        tenant=_tenant_dict(tenant),
    )


async def _switch_workspace_response(
    auth: AuthContext,
    session: AsyncSession,
    tenant_id: UUID,
) -> LoginResponse:
    """Issue a fresh access token scoped to the requested workspace.

    Staff may enter any workspace that allows platform support (logged);
    members may only switch to tenants where they hold a membership.
    `last_tenant_id` is persisted so refresh and the next login keep the same workspace.
    """
    tenant_result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if auth.user.is_staff:
        if not allows_platform_support(tenant):
            raise HTTPException(
                status_code=403,
                detail="This workspace does not allow platform support.",
            )
        previous_id = auth.user.last_tenant_id
        if previous_id and previous_id != tenant.id:
            session.add(
                StaffAccessLog(
                    staff_user_id=auth.user.id,
                    tenant_id=previous_id,
                    action="leave",
                )
            )
        role = "admin"
        session.add(StaffAccessLog(staff_user_id=auth.user.id, tenant_id=tenant.id, action="enter"))
    else:
        membership_result = await session.execute(
            select(Membership).where(
                Membership.user_id == auth.user.id,
                Membership.tenant_id == tenant.id,
            )
        )
        membership = membership_result.scalar_one_or_none()
        if not membership:
            raise HTTPException(status_code=403, detail="No membership for this workspace")
        role = membership.role

    auth.user.last_tenant_id = tenant.id
    session.add(auth.user)
    await session.commit()
    access_token = create_access_token(
        auth.user.id, tenant.id, auth.user.email, staff=auth.user.is_staff
    )
    return LoginResponse(
        access_token=access_token,
        user=_user_dict(auth.user, tenant, role, is_staff=auth.user.is_staff),
        tenant=_tenant_dict(tenant),
    )


@router.post("/switch-workspace", response_model=LoginResponse)
async def switch_workspace(
    body: SwitchTenantRequest,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await _switch_workspace_response(auth, session, body.tenant_id)


@router.post("/switch-tenant", response_model=LoginResponse)
async def switch_tenant(
    body: SwitchTenantRequest,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await _switch_workspace_response(auth, session, body.tenant_id)


@router.get("/tenants")
async def list_tenants(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    if not auth.user.is_staff:
        raise HTTPException(status_code=403, detail="Staff only")
    result = await session.execute(select(Tenant).order_by(Tenant.name))
    return [
        {
            "id": str(t.id),
            "slug": t.slug,
            "name": t.name,
            "support_allowed": allows_platform_support(t),
        }
        for t in result.scalars().all()
    ]


@router.post("/invite")
async def invite_user(
    body: InviteRequest,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    # Shared with the workspace portal path: dedupes pending invites for the
    # same email, blocks inviting existing members, sends the invite mail.
    from app.services.workspaces_portal import create_workspace_invite

    invite = await create_workspace_invite(
        session,
        auth.tenant,
        email=body.email,
        role=body.role if body.role in ("admin", "member") else "member",
        inviter=auth.user,
    )
    return {
        "token": invite["token"],
        "email": invite["email"],
        "expires_at": invite["expires_at"],
        "invite_link": invite["invite_link"],
        "mail_sent": invite["mail_sent"],
    }


@router.get("/invite-info")
async def invite_info(
    token: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Public preview for the accept-invite page: who is invited, to which workspace."""
    result = await session.execute(
        select(Invite).where(Invite.token == token, Invite.expires_at > datetime.utcnow())
    )
    invite = result.scalar_one_or_none()
    if not invite or invite.accepted_at:
        raise HTTPException(status_code=400, detail="Invalid or expired invite")
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == invite.tenant_id))
    ).scalar_one()
    existing = (
        await session.execute(select(User).where(User.email == invite.email))
    ).scalar_one_or_none()
    return {
        "email": invite.email,
        "role": invite.role,
        "tenant_name": tenant.name,
        "existing_user": existing is not None,
    }


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
        if len(body.password or "") < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
        user = User(
            email=invite.email,
            password_hash=hash_password(body.password),
            display_name=body.display_name or invite.email.split("@")[0],
        )
        session.add(user)
        await session.flush()
    else:
        # Existing account: the invite token alone must not grant a session.
        # The invitee proves ownership with their current password. SSO-only
        # accounts have no password; possession of the emailed token suffices.
        if user.password_hash and not verify_password(body.password or "", user.password_hash):
            raise HTTPException(
                status_code=400,
                detail="An account with this email already exists. Enter its current password to join.",
            )
    existing_membership = (
        await session.execute(
            select(Membership).where(
                Membership.tenant_id == invite.tenant_id, Membership.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if not existing_membership:
        session.add(Membership(tenant_id=invite.tenant_id, user_id=user.id, role=invite.role))
    user.last_tenant_id = invite.tenant_id
    # Reaching the tokenized link proves control of the invited mailbox.
    user.email_verified = True
    invite.accepted_at = datetime.utcnow()
    tenant_result = await session.execute(select(Tenant).where(Tenant.id == invite.tenant_id))
    tenant = tenant_result.scalar_one()
    from app.services.audit import record_audit

    await record_audit(
        session,
        invite.tenant_id,
        action="invite:accepted",
        actor_type="user",
        actor_id=user.id,
        resource_type="invite",
        resource_id=invite.id,
        summary=invite.email,
        commit=False,
    )
    await session.commit()

    from app.services.transactional_mail import send_welcome_mail

    await send_welcome_mail(
        user.email, tenant_name=tenant.name, app_url=settings.public_app_url
    )
    access_token = create_access_token(user.id, tenant.id, user.email)
    refresh_token, _ = await create_refresh_session(session, user.id)
    _set_refresh_cookie(response, refresh_token)
    return LoginResponse(
        access_token=access_token,
        user=_user_dict(user, tenant, invite.role),
        tenant=_tenant_dict(tenant),
    )


class WorkspaceSetupAcceptRequest(BaseModel):
    setup_token: str
    invite_id: str


class WorkspaceSetupCreateRequest(BaseModel):
    setup_token: str
    workspace_name: str


async def _setup_token_user(session: AsyncSession, setup_token: str) -> User:
    from app.services.auth import decode_workspace_setup_token

    user_id = decode_workspace_setup_token(setup_token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired setup token")
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired setup token")
    return user


@router.post(
    "/workspace-setup/accept-invite",
    response_model=LoginResponse,
    dependencies=[Depends(rate_limit("auth-ws-setup", limit=10))],
)
async def workspace_setup_accept_invite(
    body: WorkspaceSetupAcceptRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Accept a pending invite from the no-workspace login state.

    The setup token proves a completed password login, so no invite token or
    password re-entry is needed; the invite must match the account email."""
    user = await _setup_token_user(session, body.setup_token)
    try:
        invite_uuid = UUID(body.invite_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite = (
        await session.execute(
            select(Invite).where(
                Invite.id == invite_uuid,
                Invite.email == user.email,
                Invite.accepted_at.is_(None),
                Invite.expires_at > datetime.utcnow(),
            )
        )
    ).scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found or expired")

    existing_membership = (
        await session.execute(
            select(Membership).where(
                Membership.tenant_id == invite.tenant_id, Membership.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if not existing_membership:
        session.add(Membership(tenant_id=invite.tenant_id, user_id=user.id, role=invite.role))
    user.last_tenant_id = invite.tenant_id
    invite.accepted_at = datetime.utcnow()
    from app.services.audit import record_audit

    await record_audit(
        session,
        invite.tenant_id,
        action="invite:accepted",
        actor_type="user",
        actor_id=user.id,
        resource_type="invite",
        resource_id=invite.id,
        summary=invite.email,
        commit=False,
    )
    await session.commit()
    return await _complete_login(session, response, user)


@router.post(
    "/workspace-setup/create",
    response_model=LoginResponse,
    dependencies=[Depends(rate_limit("auth-ws-setup", limit=10))],
)
async def workspace_setup_create(
    body: WorkspaceSetupCreateRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create a fresh workspace from the no-workspace login state."""
    from app.services.workspaces_portal import create_workspace

    user = await _setup_token_user(session, body.setup_token)
    name = body.workspace_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Workspace name is required")
    await create_workspace(session, user, name=name)
    return await _complete_login(session, response, user)


@router.post("/refresh", response_model=LoginResponse, dependencies=[Depends(rate_limit("auth-refresh", limit=60))])
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
    if user.is_staff:
        staff_tenant = await first_allowed_support_tenant(session, preferred_id=user.last_tenant_id)
        if staff_tenant:
            if user.last_tenant_id != staff_tenant.id:
                user.last_tenant_id = staff_tenant.id
                session.add(user)
                await session.commit()
            access_token = create_access_token(user.id, staff_tenant.id, user.email, staff=True)
            return LoginResponse(
                access_token=access_token,
                user=_user_dict(user, staff_tenant, "admin", is_staff=True),
                tenant=_tenant_dict(staff_tenant),
            )
    tenant_ctx = await get_tenant_for_user(session, user.id, preferred_tenant_id=user.last_tenant_id)
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
            if not allows_platform_support(tenant):
                continue
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
        "email_verified": auth.user.email_verified,
        "totp_enabled": auth.user.totp_enabled,
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
        # Channel kinds parked platform-wide; the dashboard hides their connect
        # and filter surfaces instead of shipping its own copy of the list.
        "parked_channels": sorted(get_settings().parked_channel_set()),
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
    if body.onboarded or body.email_signature_html is not None:
        import json as _json

        try:
            stored = _json.loads(user.settings_json or "{}")
        except (TypeError, ValueError):
            stored = {}
        if not isinstance(stored, dict):
            stored = {}
        if body.onboarded:
            stored.setdefault("onboarded_at", datetime.utcnow().isoformat())
        if body.email_signature_html is not None:
            from app.services.signatures import MAX_SIGNATURE_LENGTH, SIGNATURE_KEY

            signature = body.email_signature_html.strip()
            if len(signature) > MAX_SIGNATURE_LENGTH:
                raise HTTPException(status_code=400, detail="Signature too long")
            if signature:
                stored[SIGNATURE_KEY] = signature
            else:
                stored.pop(SIGNATURE_KEY, None)
        user.settings_json = _json.dumps(stored)
    email_changed = False
    if body.email is not None:
        email = str(body.email).strip().lower()
        if email != user.email:
            existing = await session.execute(select(User).where(User.email == email))
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Email already in use")
            user.email = email
            # A new address is unverified until the owner confirms it.
            user.email_verified = False
            email_changed = True
    session.add(user)

    verification_extras: dict = {}
    if email_changed:
        token = await _issue_auth_token(session, user, "email_verify", ttl_minutes=60 * 24)
        from app.services.transactional_mail import send_verification_mail

        await send_verification_mail(
            user.email, verify_link=_absolute_app_link("/verify-email", token)
        )
        verification_extras = _dev_magic_link("/verify-email", token)

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
    payload = _me_payload(scoped, memberships)
    if verification_extras:
        payload.update(verification_extras)
        payload["verification_required"] = True
    return payload


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    response: Response,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    # SSO-only accounts (empty hash) may set an initial password directly.
    if auth.user.password_hash and not verify_password(
        body.current_password, auth.user.password_hash
    ):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    confirm = body.password_confirmation or body.new_password
    if body.new_password != confirm:
        raise HTTPException(status_code=400, detail="Password confirmation does not match")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    auth.user.password_hash = hash_password(body.new_password)
    session.add(auth.user)
    # Sign out every other device, then reissue a session for this one so the
    # user changing their password stays logged in.
    from app.services.auth import revoke_user_sessions

    await revoke_user_sessions(session, auth.user.id, commit=False)
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="user:password_changed",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="user",
        resource_id=auth.user.id,
        commit=False,
    )
    await session.commit()
    refresh_token, _ = await create_refresh_session(session, auth.user.id)
    _set_refresh_cookie(response, refresh_token)

    from app.services.transactional_mail import send_password_changed_mail

    await send_password_changed_mail(auth.user.email)
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
    clear_logo: str | None = Form(None),
    clear_favicon: str | None = Form(None),
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
            clear_logo=(clear_logo or "").lower() in ("1", "true", "yes"),
            clear_favicon=(clear_favicon or "").lower() in ("1", "true", "yes"),
        )
        payload["role"] = role
        return payload
    except AppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


async def _issue_auth_token(
    session: AsyncSession, user: User, kind: str, ttl_minutes: int
) -> str:
    """Create a single-use token row and return the opaque token string.

    Any prior unused tokens of the same kind for this user are invalidated so a
    fresh request always supersedes an older link."""
    now = datetime.utcnow()
    prior = await session.execute(
        select(AuthToken).where(
            AuthToken.user_id == user.id,
            AuthToken.kind == kind,
            AuthToken.used_at.is_(None),
        )
    )
    for stale in prior.scalars().all():
        stale.used_at = now

    token = await create_invite_token()
    session.add(
        AuthToken(
            user_id=user.id,
            kind=kind,
            token=token,
            expires_at=now + timedelta(minutes=ttl_minutes),
        )
    )
    return token


async def _consume_auth_token(
    session: AsyncSession, token: str, kind: str
) -> User:
    """Validate and burn a token, returning the owning user."""
    result = await session.execute(
        select(AuthToken).where(AuthToken.token == token, AuthToken.kind == kind)
    )
    row = result.scalar_one_or_none()
    if row is None or row.used_at is not None or row.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired token.")
    user = await session.get(User, row.user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid or expired token.")
    row.used_at = datetime.utcnow()
    return user


def _dev_magic_link(path: str, token: str) -> dict[str, str]:
    """In non-production, surface the token + link so flows are testable without SMTP."""
    if settings.is_production:
        return {}
    link = f"{path}?token={token}"
    logger.info("[auth] dev magic link: %s", link)
    return {"dev_token": token, "dev_link": link}


def _absolute_app_link(path: str, token: str) -> str:
    return f"{settings.public_app_url.rstrip('/')}{path}?token={token}"


@router.post("/password-reset-request", dependencies=[Depends(rate_limit("auth-pw-reset", limit=5))])
async def password_reset_request(
    body: PasswordResetRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    response: dict = {"message": "If the email exists, a reset link has been sent."}
    if user is not None:
        token = await _issue_auth_token(session, user, "password_reset", ttl_minutes=60)
        await session.commit()
        from app.services.transactional_mail import send_password_reset_mail

        await send_password_reset_mail(
            user.email, reset_link=_absolute_app_link("/reset-password", token)
        )
        response.update(_dev_magic_link("/reset-password", token))
    return response


@router.post("/password-reset")
async def password_reset(
    body: PasswordResetConfirm,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    if body.password_confirmation is not None and body.password != body.password_confirmation:
        raise HTTPException(status_code=400, detail="Passwords do not match.")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    user = await _consume_auth_token(session, body.token, "password_reset")
    user.password_hash = hash_password(body.password)
    # A reset usually means the old credentials are suspect: sign out every
    # active session so only the new password grants access.
    from app.services.auth import revoke_user_sessions

    await revoke_user_sessions(session, user.id, commit=False)
    await session.commit()

    from app.services.transactional_mail import send_password_changed_mail

    await send_password_changed_mail(user.email)
    return {"message": "Password reset successfully."}


@router.post("/verify-email")
async def verify_email(
    body: VerifyEmailRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    user = await _consume_auth_token(session, body.token, "email_verify")
    user.email_verified = True
    await session.commit()
    return {"message": "Email verified.", "email_verified": True}


@router.post("/resend-verification")
async def resend_verification(
    body: ResendVerificationRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    response: dict = {"message": "Verification email sent if applicable."}
    if user is not None and not user.email_verified:
        token = await _issue_auth_token(session, user, "email_verify", ttl_minutes=60 * 24)
        await session.commit()
        from app.services.transactional_mail import send_verification_mail

        await send_verification_mail(
            user.email, verify_link=_absolute_app_link("/verify-email", token)
        )
        response.update(_dev_magic_link("/verify-email", token))
    return response


@router.post("/revoke")
async def revoke_session(
    request: Request,
    response: Response,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    raw = request.cookies.get(settings.refresh_cookie_name)
    if raw:
        from app.services.auth import revoke_refresh_session

        await revoke_refresh_session(session, raw)
    response.delete_cookie(settings.refresh_cookie_name)
    return {"ok": True}


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    # Kill the server-side session too, not just the cookie: a stolen or
    # cached refresh token must stop working after logout.
    raw = request.cookies.get(settings.refresh_cookie_name)
    if raw:
        from app.services.auth import revoke_refresh_session

        await revoke_refresh_session(session, raw)
    response.delete_cookie(settings.refresh_cookie_name)
    return {"ok": True}


class DeleteAccountRequest(BaseModel):
    password: str


@router.post("/delete-account")
async def delete_account(
    body: DeleteAccountRequest,
    response: Response,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Delete the calling user's account.

    Memberships, sessions and tokens are removed; the user row is anonymized
    (kept for FK integrity of historical messages/audit rows). Workspaces where
    the user is the only member are deleted entirely; workspaces with other
    members require another owner before this account can go.
    """
    import secrets as _secrets

    from app.models.auth_token import AuthToken as _AuthToken
    from app.services.workspaces_portal import delete_workspace

    user = auth.user
    # SSO-only accounts have no password; the authenticated session suffices.
    if user.password_hash and not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Password is incorrect")

    memberships_result = await session.execute(
        select(Membership).where(Membership.user_id == user.id)
    )
    memberships = memberships_result.scalars().all()
    for membership in memberships:
        others_result = await session.execute(
            select(Membership).where(
                Membership.tenant_id == membership.tenant_id,
                Membership.user_id != user.id,
            )
        )
        others = others_result.scalars().all()
        if not others:
            # Sole member: the workspace goes with the account.
            tenant = (
                await session.execute(select(Tenant).where(Tenant.id == membership.tenant_id))
            ).scalar_one_or_none()
            if tenant:
                await delete_workspace(session, tenant)
            continue
        if membership.role == "owner" and not any(o.role == "owner" for o in others):
            raise HTTPException(
                status_code=400,
                detail="You are the only owner of a shared workspace. Promote another owner first.",
            )
        await session.delete(membership)

    # Kill sessions and one-time tokens.
    from app.models.auth import Session as _RefreshSession

    sessions_result = await session.execute(
        select(_RefreshSession).where(_RefreshSession.user_id == user.id)
    )
    for row in sessions_result.scalars().all():
        await session.delete(row)
    tokens_result = await session.execute(
        select(_AuthToken).where(_AuthToken.user_id == user.id)
    )
    for row in tokens_result.scalars().all():
        await session.delete(row)

    # Anonymize instead of hard delete: historical rows keep a valid FK.
    user.email = f"deleted-{user.id.hex[:12]}@deleted.invalid"
    user.display_name = "Deleted user"
    user.password_hash = hash_password(_secrets.token_urlsafe(24))
    user.avatar_url = None
    user.email_verified = False
    user.last_tenant_id = None
    await session.commit()

    response.delete_cookie(settings.refresh_cookie_name)
    return {"ok": True}
