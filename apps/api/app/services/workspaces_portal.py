"""Workspace control plane: Tenant maps to dashboard Workspace."""

from __future__ import annotations

import base64
import json
import re
import time
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import AppError
from app.models.auth import Invite, Membership, Tenant, User
from app.models.auth import user_numeric_id
from app.services.auth import create_invite_token
from app.services.tenant_bootstrap import (
    bootstrap_tenant,
    default_tenant_settings,
    resolve_brand_color,
    serialize_settings,
)
from app.services.workforce_runtime import tenant_numeric_id

MAX_UPLOAD_BYTES = 512_000


def parse_settings(tenant: Tenant) -> dict[str, Any]:
    try:
        data = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def allows_platform_support(settings_or_tenant: dict[str, Any] | Tenant) -> bool:
    """Whether Bokito operators may enter this workspace. Missing key = allow."""
    settings = (
        parse_settings(settings_or_tenant)
        if isinstance(settings_or_tenant, Tenant)
        else settings_or_tenant
    )
    security = settings.get("security") if isinstance(settings.get("security"), dict) else {}
    return bool(security.get("allow_platform_support", True))


async def first_allowed_support_tenant(
    session: AsyncSession,
    *,
    preferred_id: UUID | None = None,
) -> Tenant | None:
    """Tenant a staff user may land in (preferred if still allowed)."""
    if preferred_id:
        preferred = (
            await session.execute(select(Tenant).where(Tenant.id == preferred_id))
        ).scalar_one_or_none()
        if preferred and allows_platform_support(preferred):
            return preferred
    result = await session.execute(select(Tenant).order_by(Tenant.created_at))
    for tenant in result.scalars().all():
        if allows_platform_support(tenant):
            return tenant
    return None


def save_settings(tenant: Tenant, settings: dict[str, Any]) -> None:
    tenant.settings_json = serialize_settings(settings)


def _asset_object(url: str | None) -> dict[str, str] | None:
    if not url or not str(url).strip():
        return None
    return {"url": str(url).strip(), "path": str(url).strip()}


def workspace_payload(tenant: Tenant, role: str) -> dict[str, Any]:
    settings = parse_settings(tenant)
    appearance = settings.get("appearance") if isinstance(settings.get("appearance"), dict) else {}
    livechat = settings.get("livechat_settings")
    if not isinstance(livechat, dict):
        livechat = {}
    livechat_appearance = livechat.get("appearance") if isinstance(livechat.get("appearance"), dict) else {}
    main_color = resolve_brand_color(
        str(livechat_appearance.get("main_color") or appearance.get("main_color") or livechat.get("main_color") or "")
    )
    logo_url = tenant.logo_url or str(livechat.get("logo_url") or "")
    favicon_url = str(livechat.get("favicon_url") or settings.get("favicon_url") or "")
    merged_livechat: dict[str, Any] = {
        **livechat,
        "subdomain": tenant.slug,
        "main_color": main_color,
        "appearance": {**appearance, **livechat_appearance, "main_color": main_color},
    }
    if logo_url:
        merged_livechat["logo"] = _asset_object(logo_url)
    if favicon_url:
        merged_livechat["favicon"] = _asset_object(favicon_url)
    security = settings.get("security") if isinstance(settings.get("security"), dict) else {}
    return {
        "id": str(tenant.id),
        "workspace_id": tenant_numeric_id(tenant.id),
        "name": tenant.name,
        "slug": tenant.slug,
        "timezone": str(settings.get("timezone") or "Europe/Amsterdam"),
        "logo": logo_url or None,
        "favicon": favicon_url or None,
        "brand_color": main_color,
        "require_2fa": bool(security.get("require_2fa", False)),
        "allow_platform_support": allows_platform_support(settings),
        "livechat_settings": merged_livechat,
        "role": role,
        "created_at": tenant.created_at.isoformat() if tenant.created_at else None,
        "updated_at": datetime.utcnow().isoformat(),
    }


async def accessible_tenants(session: AsyncSession, user: User, *, is_staff: bool) -> list[tuple[Tenant, str]]:
    if is_staff:
        result = await session.execute(select(Tenant).order_by(Tenant.name))
        return [(t, "admin") for t in result.scalars().all() if allows_platform_support(t)]
    result = await session.execute(
        select(Tenant, Membership.role)
        .join(Membership, Membership.tenant_id == Tenant.id)
        .where(Membership.user_id == user.id)
        .order_by(Tenant.name)
    )
    return [(tenant, role) for tenant, role in result.all()]


async def resolve_tenant_for_workspace(
    session: AsyncSession,
    workspace_key: str,
    user: User,
    *,
    is_staff: bool,
) -> tuple[Tenant, str]:
    key = str(workspace_key).strip()
    if not key:
        raise AppError("Invalid workspace id", status_code=400)

    tenants = await accessible_tenants(session, user, is_staff=is_staff)
    if is_staff:
        # Staff may still resolve an opted-out workspace they are already in
        # (e.g. to turn platform support back on). Entering stays gated.
        extras = (await session.execute(select(Tenant))).scalars().all()
        seen = {tenant.id for tenant, _role in tenants}
        for tenant in extras:
            if tenant.id not in seen:
                tenants.append((tenant, "admin"))
    for tenant, role in tenants:
        if key == str(tenant.id) or key == tenant.slug:
            return tenant, role
        if key.isdigit() and tenant_numeric_id(tenant.id) == int(key):
            return tenant, role
    try:
        as_uuid = UUID(key)
    except ValueError:
        raise AppError("Workspace not found", status_code=404) from None
    for tenant, role in tenants:
        if tenant.id == as_uuid:
            return tenant, role
    raise AppError("Workspace not found", status_code=404)


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return (base or "workspace")[:63]


async def list_workspaces(session: AsyncSession, user: User, *, is_staff: bool) -> list[dict[str, Any]]:
    tenants = await accessible_tenants(session, user, is_staff=is_staff)
    return [workspace_payload(tenant, role) for tenant, role in tenants]


async def create_workspace(
    session: AsyncSession,
    user: User,
    *,
    name: str,
    timezone: str = "Europe/Amsterdam",
    subdomain: str | None = None,
    logo: str | None = None,
) -> dict[str, Any]:
    slug_base = _slugify(subdomain or name)
    slug = slug_base
    suffix = 1
    while True:
        existing = await session.execute(select(Tenant).where(Tenant.slug == slug))
        if not existing.scalar_one_or_none():
            break
        slug = f"{slug_base}-{suffix}"[:63]
        suffix += 1
    settings = default_tenant_settings()
    settings["timezone"] = timezone
    tenant = Tenant(
        slug=slug,
        name=name.strip() or slug,
        logo_url=logo,
        settings_json=serialize_settings(settings),
    )
    session.add(tenant)
    await session.flush()
    session.add(Membership(tenant_id=tenant.id, user_id=user.id, role="owner"))
    user.last_tenant_id = tenant.id
    session.add(user)
    await bootstrap_tenant(session, tenant.id)
    await session.commit()
    await session.refresh(tenant)
    from app.services.auth import create_access_token

    payload = workspace_payload(tenant, "owner")
    # The dashboard applies this token immediately so the UI and every API
    # call are scoped to the new workspace (JWT is the source of truth).
    payload["session"] = {
        "access_token": create_access_token(user.id, tenant.id, user.email, staff=user.is_staff),
        "tenant": {"id": str(tenant.id), "slug": tenant.slug, "name": tenant.name},
    }
    return payload


async def update_workspace(
    session: AsyncSession,
    tenant: Tenant,
    role: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    settings = parse_settings(tenant)
    if "name" in data and isinstance(data["name"], str) and data["name"].strip():
        tenant.name = data["name"].strip()
    if "timezone" in data and isinstance(data["timezone"], str):
        settings["timezone"] = data["timezone"].strip() or "Europe/Amsterdam"
    if "logo" in data and isinstance(data["logo"], str):
        tenant.logo_url = data["logo"].strip() or None
    if "slug" in data and isinstance(data["slug"], str) and data["slug"].strip():
        new_slug = _slugify(data["slug"])
        clash = await session.execute(
            select(Tenant).where(Tenant.slug == new_slug, Tenant.id != tenant.id)
        )
        if clash.scalar_one_or_none():
            raise AppError("Subdomain already in use", status_code=409)
        tenant.slug = new_slug
    if "brand_color" in data and isinstance(data["brand_color"], str):
        appearance = settings.setdefault("appearance", {})
        if not isinstance(appearance, dict):
            appearance = {}
            settings["appearance"] = appearance
        appearance["main_color"] = data["brand_color"].strip()
        livechat = settings.setdefault("livechat_settings", {})
        if isinstance(livechat, dict):
            livechat["main_color"] = data["brand_color"].strip()
    if "require_2fa" in data and isinstance(data["require_2fa"], bool):
        security = settings.setdefault("security", {})
        if not isinstance(security, dict):
            security = {}
            settings["security"] = security
        security["require_2fa"] = data["require_2fa"]
    if "allow_platform_support" in data and isinstance(data["allow_platform_support"], bool):
        security = settings.setdefault("security", {})
        if not isinstance(security, dict):
            security = {}
            settings["security"] = security
        security["allow_platform_support"] = data["allow_platform_support"]
    save_settings(tenant, settings)
    await session.commit()
    await session.refresh(tenant)
    return workspace_payload(tenant, role)


async def delete_workspace(session: AsyncSession, tenant: Tenant) -> None:
    """Purge a tenant and every tenant-scoped row.

    All domain tables carry a `tenant_id` column, so we delete from each table
    that has one (children before parents) and finally the tenant itself.
    """
    from sqlalchemy import delete as sa_delete
    from sqlmodel import SQLModel

    tenant_id = tenant.id
    for table in reversed(SQLModel.metadata.sorted_tables):
        if table.name == "tenants":
            continue
        if "tenant_id" in table.c:
            await session.execute(sa_delete(table).where(table.c.tenant_id == tenant_id))
    await session.execute(sa_delete(Tenant.__table__).where(Tenant.__table__.c.id == tenant_id))
    await session.commit()


async def list_members(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.tenant_id == tenant_id)
        .order_by(User.display_name, User.email)
    )
    rows: list[dict[str, Any]] = []
    for user, membership in result.all():
        rows.append(
            {
                "id": user_numeric_id(user.id),
                "user_id": user_numeric_id(user.id),
                "uuid": str(user.id),
                "name": user.display_name or user.email,
                "email": user.email,
                "role": membership.role,
                "avatar_url": user.avatar_url,
                "joined_at": membership.created_at.isoformat() if membership.created_at else None,
            }
        )
    return rows


async def _resolve_membership(
    session: AsyncSession, tenant_id: UUID, member_id: str
) -> tuple[User, Membership]:
    """Find a member by UUID or by the derived numeric id used in the dashboard."""
    result = await session.execute(
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.tenant_id == tenant_id)
    )
    for user, membership in result.all():
        if str(user.id) == member_id or str(user_numeric_id(user.id)) == member_id:
            return user, membership
    raise AppError("Member not found", status_code=404)


async def _ensure_not_last_owner(
    session: AsyncSession, tenant_id: UUID, membership: Membership
) -> None:
    """Guard: a workspace must always keep at least one owner."""
    if membership.role != "owner":
        return
    result = await session.execute(
        select(Membership).where(
            Membership.tenant_id == tenant_id,
            Membership.role == "owner",
            Membership.id != membership.id,
        )
    )
    if result.scalars().first() is None:
        raise AppError("A workspace needs at least one owner.", status_code=400)


async def update_member_role(
    session: AsyncSession,
    tenant_id: UUID,
    member_id: str,
    role: str,
) -> dict[str, Any]:
    if role not in ("owner", "admin", "member"):
        raise AppError("Role must be owner, admin or member.", status_code=400)
    user, membership = await _resolve_membership(session, tenant_id, member_id)
    if membership.role == "owner" and role != "owner":
        await _ensure_not_last_owner(session, tenant_id, membership)
    if role == "owner" and membership.role != "owner":
        # Single-owner model: promoting transfers ownership, so existing
        # owners step down to admin.
        owners_result = await session.execute(
            select(Membership).where(
                Membership.tenant_id == tenant_id,
                Membership.role == "owner",
                Membership.id != membership.id,
            )
        )
        for other in owners_result.scalars().all():
            other.role = "admin"
    membership.role = role
    await session.commit()
    return {
        "id": user_numeric_id(user.id),
        "uuid": str(user.id),
        "email": user.email,
        "role": membership.role,
    }


async def remove_member(
    session: AsyncSession,
    tenant_id: UUID,
    member_id: str,
    *,
    acting_user: User,
) -> None:
    from app.models.signal import Signal, SignalEvent
    from app.services.auth import revoke_user_sessions

    user, membership = await _resolve_membership(session, tenant_id, member_id)
    if user.id == acting_user.id:
        raise AppError("You cannot remove yourself from the workspace.", status_code=400)
    await _ensure_not_last_owner(session, tenant_id, membership)
    await session.delete(membership)
    if user.last_tenant_id == tenant_id:
        user.last_tenant_id = None

    # Threads assigned to the removed member go back to the unassigned queue;
    # each gets an audit event so the timeline explains the change.
    assigned = (
        await session.execute(
            select(Signal).where(
                Signal.tenant_id == tenant_id, Signal.assigned_user_id == user.id
            )
        )
    ).scalars().all()
    for signal in assigned:
        signal.assigned_user_id = None
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant_id,
                event_type="unassigned",
                actor_type="user",
                actor_id=str(acting_user.id),
                payload_json=json.dumps({"reason": "member_removed"}),
            )
        )

    # When this was the user's last workspace their refresh sessions are
    # useless-but-dangerous; revoke them so stale cookies cannot refresh.
    remaining = (
        await session.execute(
            select(Membership).where(
                Membership.user_id == user.id, Membership.id != membership.id
            )
        )
    ).scalars().first()
    if remaining is None:
        await revoke_user_sessions(session, user.id, commit=False)

    await session.commit()


async def revoke_invite(session: AsyncSession, tenant_id: UUID, invite_id: str) -> None:
    try:
        parsed = UUID(invite_id)
    except ValueError:
        raise AppError("Invite not found", status_code=404)
    result = await session.execute(
        select(Invite).where(Invite.id == parsed, Invite.tenant_id == tenant_id)
    )
    invite = result.scalar_one_or_none()
    if not invite or invite.accepted_at:
        raise AppError("Invite not found", status_code=404)
    await session.delete(invite)
    await session.commit()


def invite_link_for_token(token: str) -> str:
    """Absolute accept-invite URL on the dashboard for an invite token."""
    from app.config import get_settings

    base = get_settings().public_app_url.rstrip("/")
    return f"{base}/accept-invite?token={token}"


async def list_invites(session: AsyncSession, tenant_id: UUID, inviter: User | None) -> list[dict[str, Any]]:
    result = await session.execute(
        select(Invite)
        .where(Invite.tenant_id == tenant_id, Invite.accepted_at.is_(None))
        .order_by(Invite.created_at.desc())
    )
    invites = result.scalars().all()

    # Resolve inviter names per invite; fall back to the requesting admin for
    # legacy rows created before invited_by_user_id existed.
    inviter_ids = {i.invited_by_user_id for i in invites if i.invited_by_user_id}
    names_by_id: dict[UUID, str] = {}
    if inviter_ids:
        users_result = await session.execute(select(User).where(User.id.in_(inviter_ids)))
        names_by_id = {
            u.id: (u.display_name or u.email) for u in users_result.scalars().all()
        }
    fallback_name = (inviter.display_name or inviter.email) if inviter else "System"

    rows: list[dict[str, Any]] = []
    for invite in invites:
        rows.append(
            {
                "id": str(invite.id),
                "email": invite.email,
                "role": invite.role,
                "invited_by_name": names_by_id.get(invite.invited_by_user_id, fallback_name)
                if invite.invited_by_user_id
                else fallback_name,
                "invited_at": invite.created_at.isoformat() if invite.created_at else None,
                "invite_link": invite_link_for_token(invite.token),
            }
        )
    return rows


INVITE_TTL = timedelta(days=7)

# Per-invite resend throttle (in-memory, per process — plenty for this surface).
RESEND_WINDOW_SECONDS = 3600.0
RESEND_MAX_PER_WINDOW = 3
_resend_history: dict[str, list[float]] = {}


def _check_resend_rate(invite_id: str) -> None:
    now = time.monotonic()
    window = [t for t in _resend_history.get(invite_id, []) if now - t < RESEND_WINDOW_SECONDS]
    if len(window) >= RESEND_MAX_PER_WINDOW:
        raise AppError(
            "This invite was resent too often. Try again in an hour.", status_code=429
        )
    window.append(now)
    _resend_history[invite_id] = window


async def _send_invite(invite: Invite, tenant: Tenant, inviter: User) -> tuple[str, bool]:
    from app.services.transactional_mail import send_invite_mail

    link = invite_link_for_token(invite.token)
    mailed = await send_invite_mail(
        invite.email,
        invite_link=link,
        tenant_name=tenant.name,
        inviter_name=inviter.display_name or inviter.email,
    )
    return link, mailed


def _invite_response(
    invite: Invite, inviter: User, link: str, mailed: bool
) -> dict[str, Any]:
    return {
        "id": str(invite.id),
        "token": invite.token,
        "email": invite.email,
        "role": invite.role,
        "invited_by_name": inviter.display_name or inviter.email,
        "invited_at": invite.created_at.isoformat() if invite.created_at else None,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
        "invite_link": link,
        "mail_sent": mailed,
    }


async def create_workspace_invite(
    session: AsyncSession,
    tenant: Tenant,
    *,
    email: str,
    role: str,
    inviter: User,
) -> dict[str, Any]:
    normalized_role = role if role in ("owner", "admin", "member") else "member"
    if normalized_role == "owner":
        normalized_role = "admin"
    normalized_email = email.strip().lower()

    # Existing members cannot be invited again.
    existing_member = (
        await session.execute(
            select(User.id)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.tenant_id == tenant.id, User.email == normalized_email)
        )
    ).scalar_one_or_none()
    if existing_member:
        raise AppError(
            f"{normalized_email} is already a member of this workspace.", status_code=400
        )

    # Re-inviting a pending email replaces that invite (fresh token + expiry)
    # instead of stacking duplicate rows.
    invite = (
        await session.execute(
            select(Invite).where(
                Invite.tenant_id == tenant.id,
                Invite.email == normalized_email,
                Invite.accepted_at.is_(None),
            )
        )
    ).scalars().first()
    token = await create_invite_token()
    if invite:
        invite.token = token
        invite.role = normalized_role
        invite.invited_by_user_id = inviter.id
        invite.expires_at = datetime.utcnow() + INVITE_TTL
    else:
        invite = Invite(
            tenant_id=tenant.id,
            email=normalized_email,
            role=normalized_role,
            token=token,
            invited_by_user_id=inviter.id,
            expires_at=datetime.utcnow() + INVITE_TTL,
        )
        session.add(invite)
    await session.commit()
    await session.refresh(invite)

    link, mailed = await _send_invite(invite, tenant, inviter)
    return _invite_response(invite, inviter, link, mailed)


async def resend_invite(
    session: AsyncSession, tenant: Tenant, invite_id: str, inviter: User
) -> dict[str, Any]:
    """Rotate the token, reset the expiry and re-send the invite mail."""
    try:
        parsed = UUID(invite_id)
    except ValueError:
        raise AppError("Invite not found", status_code=404)
    invite = (
        await session.execute(
            select(Invite).where(Invite.id == parsed, Invite.tenant_id == tenant.id)
        )
    ).scalar_one_or_none()
    if not invite or invite.accepted_at:
        raise AppError("Invite not found", status_code=404)
    _check_resend_rate(str(invite.id))
    invite.token = await create_invite_token()
    invite.expires_at = datetime.utcnow() + INVITE_TTL
    await session.commit()
    await session.refresh(invite)

    link, mailed = await _send_invite(invite, tenant, inviter)
    return _invite_response(invite, inviter, link, mailed)


async def apply_branding(
    session: AsyncSession,
    tenant: Tenant,
    *,
    name: str | None,
    subdomain: str | None,
    brand_color: str | None,
    logo_bytes: bytes | None,
    logo_content_type: str | None,
    favicon_bytes: bytes | None,
    favicon_content_type: str | None,
    appearance_json: str | None = None,
    widget_favicon_bytes: bytes | None = None,
    widget_favicon_content_type: str | None = None,
    clear_logo: bool = False,
    clear_favicon: bool = False,
) -> dict[str, Any]:
    if name and name.strip():
        tenant.name = name.strip()
    if subdomain and subdomain.strip():
        new_slug = _slugify(subdomain)
        clash = await session.execute(
            select(Tenant).where(Tenant.slug == new_slug, Tenant.id != tenant.id)
        )
        if clash.scalar_one_or_none():
            raise AppError("Subdomain already in use", status_code=409)
        tenant.slug = new_slug
    settings = parse_settings(tenant)
    livechat = settings.setdefault("livechat_settings", {})
    if not isinstance(livechat, dict):
        livechat = {}
        settings["livechat_settings"] = livechat
    appearance = livechat.setdefault("appearance", {})
    if not isinstance(appearance, dict):
        appearance = {}
        livechat["appearance"] = appearance
    if appearance_json and appearance_json.strip():
        try:
            parsed = json.loads(appearance_json)
            if isinstance(parsed, dict):
                for key, value in parsed.items():
                    if value is not None:
                        appearance[str(key)] = value
        except json.JSONDecodeError as exc:
            raise AppError("Invalid appearance_json", status_code=400) from exc
    if brand_color and brand_color.strip():
        color = brand_color.strip()
        appearance["main_color"] = color
        livechat["main_color"] = color
    if clear_logo:
        tenant.logo_url = None
        livechat.pop("logo", None)
    elif logo_bytes:
        if len(logo_bytes) > MAX_UPLOAD_BYTES:
            raise AppError("Logo file too large", status_code=400)
        mime = logo_content_type or "image/png"
        encoded = base64.b64encode(logo_bytes).decode("ascii")
        tenant.logo_url = f"data:{mime};base64,{encoded}"
        livechat["logo"] = _asset_object(tenant.logo_url)
    if clear_favicon:
        settings.pop("favicon_url", None)
        livechat.pop("favicon", None)
        appearance.pop("widget_favicon", None)
        appearance.pop("widget_favicon_url", None)
    else:
        widget_favicon_source = widget_favicon_bytes if widget_favicon_bytes else favicon_bytes
        widget_favicon_mime = widget_favicon_content_type if widget_favicon_bytes else favicon_content_type
        if widget_favicon_source:
            if len(widget_favicon_source) > MAX_UPLOAD_BYTES:
                raise AppError("Favicon file too large", status_code=400)
            mime = widget_favicon_mime or "image/png"
            encoded = base64.b64encode(widget_favicon_source).decode("ascii")
            favicon_url = f"data:{mime};base64,{encoded}"
            if favicon_bytes and not widget_favicon_bytes:
                settings["favicon_url"] = favicon_url
                livechat["favicon"] = _asset_object(favicon_url)
            appearance["widget_favicon"] = _asset_object(favicon_url)
    livechat["subdomain"] = tenant.slug
    save_settings(tenant, settings)
    await session.commit()
    await session.refresh(tenant)
    return workspace_payload(tenant, "owner")


async def onboarding_status(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    """Computed onboarding checklist for a workspace, derived from real data.

    Steps: company profile documented, first assistant conversation, a channel
    connected, and team invited. No stored state — always reflects reality.
    """
    from sqlalchemy import func

    from app.models.channel import ChannelAccount
    from app.models.signal import Signal
    from app.models.workspace import WorkspaceDoc
    from app.services.tenant_bootstrap import DEFAULT_DOCS

    company_template = next(
        (content for path, _kind, content in DEFAULT_DOCS if path == "company.md"), ""
    )
    doc_result = await session.execute(
        select(WorkspaceDoc).where(
            WorkspaceDoc.tenant_id == tenant_id, WorkspaceDoc.path == "company.md"
        )
    )
    doc = doc_result.scalars().first()
    company_done = False
    if doc and doc.content.strip():
        if doc.content.strip() != company_template.strip():
            company_done = True
        elif getattr(doc, "updated_at", None) and getattr(doc, "created_at", None):
            # Any explicit save after bootstrap counts as "set up". Allow a
            # small tolerance for rows created before timestamps were aligned.
            company_done = (doc.updated_at - doc.created_at).total_seconds() > 1

    assistant_done = bool(
        (
            await session.execute(
                select(Signal.id)
                .where(Signal.tenant_id == tenant_id, Signal.channel == "assistant")
                .limit(1)
            )
        ).first()
    )

    # The core loop: a decision card on a thread that a human resolved. The
    # demo thread counts on purpose - resolving it IS the intended first
    # experience of the loop.
    from app.models.notification import DecisionRequest

    first_decision_done = bool(
        (
            await session.execute(
                select(DecisionRequest.id)
                .where(
                    DecisionRequest.tenant_id == tenant_id,
                    DecisionRequest.signal_id.is_not(None),
                    DecisionRequest.status != "awaiting_human",
                )
                .limit(1)
            )
        ).first()
    )

    # Any email channel counts: a Bokito relay address the workspace created
    # completes this step just like a connected Gmail/Outlook mailbox.
    email_done = bool(
        (
            await session.execute(
                select(ChannelAccount.id)
                .where(
                    ChannelAccount.tenant_id == tenant_id,
                    ChannelAccount.channel == "email",
                    ChannelAccount.provider.in_(["outlook", "gmail", "bokito"]),  # type: ignore[attr-defined]
                )
                .limit(1)
            )
        ).first()
    )

    member_count = (
        await session.execute(
            select(func.count()).select_from(Membership).where(Membership.tenant_id == tenant_id)
        )
    ).scalar_one()
    invite_count = (
        await session.execute(
            select(func.count()).select_from(Invite).where(Invite.tenant_id == tenant_id)
        )
    ).scalar_one()
    team_done = member_count > 1 or invite_count > 0

    from app.models.trigger import Trigger

    watching_done = bool(
        (
            await session.execute(
                select(Trigger.id)
                .where(
                    Trigger.tenant_id == tenant_id,
                    Trigger.kind == "heartbeat",
                    Trigger.enabled.is_(True),
                )
                .limit(1)
            )
        ).first()
    )

    # The generic "channel" step was dropped: the email step already covers
    # the flagship channel, and first_decision measures actual AI value.
    # Watching is the seeded platform check-in (enabled heartbeat).
    # Communication-first order: connect a channel, chat with an agent,
    # approve a decision, schedule a wake — then profile and team.
    steps = [
        {"id": "email", "done": email_done},
        {"id": "assistant", "done": assistant_done},
        {"id": "first_decision", "done": first_decision_done},
        {"id": "watching", "done": watching_done},
        {"id": "company", "done": company_done},
        {"id": "team", "done": team_done},
    ]
    return {"steps": steps, "completed": all(step["done"] for step in steps)}


async def tenant_by_subdomain(session: AsyncSession, subdomain: str) -> Tenant | None:
    slug = _slugify(subdomain)
    result = await session.execute(select(Tenant).where(Tenant.slug == slug))
    return result.scalar_one_or_none()
