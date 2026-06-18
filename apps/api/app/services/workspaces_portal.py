"""Workspace control plane: Tenant maps to dashboard Workspace."""

from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import AppError
from app.models.auth import Invite, Membership, Tenant, User
from app.models.auth import user_numeric_id
from app.services.auth import create_invite_token
from app.services.tenant_bootstrap import bootstrap_tenant, default_tenant_settings, serialize_settings
from app.services.workforce_runtime import tenant_numeric_id

MAX_UPLOAD_BYTES = 512_000


def parse_settings(tenant: Tenant) -> dict[str, Any]:
    try:
        data = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


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
    main_color = (
        str(livechat_appearance.get("main_color") or appearance.get("main_color") or livechat.get("main_color") or "")
    ).strip()
    logo_url = tenant.logo_url or str(livechat.get("logo_url") or "")
    favicon_url = str(livechat.get("favicon_url") or settings.get("favicon_url") or "")
    merged_livechat: dict[str, Any] = {
        **livechat,
        "subdomain": tenant.slug,
        "main_color": main_color or "#00FF99",
        "appearance": {**appearance, **livechat_appearance, "main_color": main_color or "#00FF99"},
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
        "brand_color": main_color or None,
        "require_2fa": bool(security.get("require_2fa", False)),
        "livechat_settings": merged_livechat,
        "role": role,
        "created_at": tenant.created_at.isoformat() if tenant.created_at else None,
        "updated_at": datetime.utcnow().isoformat(),
    }


async def accessible_tenants(session: AsyncSession, user: User, *, is_staff: bool) -> list[tuple[Tenant, str]]:
    if is_staff:
        result = await session.execute(select(Tenant).order_by(Tenant.name))
        return [(t, "admin") for t in result.scalars().all()]
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
    await bootstrap_tenant(session, tenant.id)
    from app.services.personal_agents import get_or_create_personal_agent

    await get_or_create_personal_agent(session, tenant.id, user, commit=False)
    await session.commit()
    await session.refresh(tenant)
    return workspace_payload(tenant, "owner")


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
                "name": user.display_name or user.email,
                "email": user.email,
                "role": membership.role,
            }
        )
    return rows


async def list_invites(session: AsyncSession, tenant_id: UUID, inviter: User | None) -> list[dict[str, Any]]:
    result = await session.execute(
        select(Invite)
        .where(Invite.tenant_id == tenant_id, Invite.accepted_at.is_(None))
        .order_by(Invite.created_at.desc())
    )
    inviter_name = (inviter.display_name or inviter.email) if inviter else "System"
    rows: list[dict[str, Any]] = []
    for invite in result.scalars().all():
        rows.append(
            {
                "id": str(invite.id),
                "email": invite.email,
                "role": invite.role,
                "invited_by_name": inviter_name,
                "invited_at": invite.created_at.isoformat() if invite.created_at else None,
            }
        )
    return rows


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
    token = await create_invite_token()
    invite = Invite(
        tenant_id=tenant.id,
        email=email.strip().lower(),
        role=normalized_role,
        token=token,
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    session.add(invite)
    await session.commit()
    await session.refresh(invite)
    return {
        "id": str(invite.id),
        "email": invite.email,
        "role": invite.role,
        "invited_by_name": inviter.display_name or inviter.email,
        "invited_at": invite.created_at.isoformat() if invite.created_at else None,
    }


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
    if logo_bytes:
        if len(logo_bytes) > MAX_UPLOAD_BYTES:
            raise AppError("Logo file too large", status_code=400)
        mime = logo_content_type or "image/png"
        encoded = base64.b64encode(logo_bytes).decode("ascii")
        tenant.logo_url = f"data:{mime};base64,{encoded}"
        livechat["logo"] = _asset_object(tenant.logo_url)
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


async def tenant_by_subdomain(session: AsyncSession, subdomain: str) -> Tenant | None:
    slug = _slugify(subdomain)
    result = await session.execute(select(Tenant).where(Tenant.slug == slug))
    return result.scalar_one_or_none()
