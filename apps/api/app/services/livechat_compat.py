"""Map tenant settings to the livechat widget session contract."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.dependencies import tenant_settings
from app.models.auth import Tenant, User
from app.services.auth import decode_access_token

settings = get_settings()


def _asset_url(value: Any) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, dict):
        for key in ("url", "path", "src"):
            v = value.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return ""


def livechat_theme_from_tenant(tenant: Tenant) -> dict[str, str]:
    settings_data = tenant_settings(tenant)
    livechat = settings_data.get("livechat_settings")
    if not isinstance(livechat, dict):
        livechat = {}
    appearance = livechat.get("appearance")
    if not isinstance(appearance, dict):
        appearance = {}
    flat_appearance = settings_data.get("appearance")
    if not isinstance(flat_appearance, dict):
        flat_appearance = {}

    main_color = (
        str(appearance.get("main_color") or "").strip()
        or str(livechat.get("main_color") or "").strip()
        or str(flat_appearance.get("main_color") or "").strip()
        or "#00FF99"
    )
    favicon = _asset_url(appearance.get("widget_favicon")) or _asset_url(
        appearance.get("widget_favicon_url")
    )
    if not favicon:
        favicon = _asset_url(livechat.get("favicon")) or _asset_url(livechat.get("favicon_url"))

    return {
        "main_color": main_color,
        "primary_color": main_color,
        "welcome_title": str(appearance.get("welcome_title") or "").strip(),
        "welcome_subtitle": str(appearance.get("welcome_subtitle") or "").strip(),
        "chatbot_name": str(appearance.get("chatbot_name") or "").strip() or "Bokito AI",
        "widget_favicon_url": favicon,
    }


def create_widget_session_token(
    *,
    tenant_id: UUID,
    user_id: UUID | None = None,
    customer_id: str | None = None,
) -> str:
    expire = datetime.utcnow() + timedelta(hours=12)
    payload: dict[str, Any] = {
        "type": "widget_session",
        "tenant_id": str(tenant_id),
        "exp": expire,
    }
    if user_id:
        payload["sub"] = str(user_id)
    if customer_id:
        payload["customer_id"] = customer_id
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_widget_session_token(token: str) -> dict[str, Any]:
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("type") not in ("widget_session", "access"):
        raise ValueError("unsupported token type")
    return payload


async def resolve_tenant_for_livechat(
    session: AsyncSession,
    *,
    tenant_subdomain: str | None = None,
    host_auth_token: str | None = None,
) -> tuple[Tenant, User | None]:
    user: User | None = None
    if host_auth_token:
        try:
            payload = decode_access_token(host_auth_token)
            tenant_id = UUID(payload["tenant_id"])
            user_id = UUID(payload["sub"])
            tenant_result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
            tenant = tenant_result.scalar_one_or_none()
            user_result = await session.execute(select(User).where(User.id == user_id))
            user = user_result.scalar_one_or_none()
            if tenant and user:
                return tenant, user
        except Exception:
            pass

    slug = (tenant_subdomain or "").strip().lower() or "bokito"
    tenant_result = await session.execute(select(Tenant).where(Tenant.slug == slug))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        tenant_result = await session.execute(select(Tenant).order_by(Tenant.created_at))
        tenant = tenant_result.scalars().first()
    if not tenant:
        raise LookupError("no tenant")
    return tenant, user


def session_start_payload(
    tenant: Tenant,
    user: User | None,
    *,
    session_token: str,
    auth_mode: str = "optional",
    customer_id: str | None = None,
) -> dict[str, Any]:
    theme = livechat_theme_from_tenant(tenant)
    identity_type = "authenticated" if user else "anonymous"
    agent_config = {
        "auth_mode": auth_mode,
        "allow_registration": False,
        "theme": theme,
        "tool_display_names": {},
        "mcp_servers": [],
    }
    out: dict[str, Any] = {
        "session_token": session_token,
        "identity_type": identity_type,
        "expires_in": 43200,
        "agent_config": agent_config,
        "tenant": {
            "id": str(tenant.id),
            "slug": tenant.slug,
            "name": tenant.name,
        },
        "preferences": {
            "theme": "system",
            "sound_effects": True,
            "sound_notifications": True,
            "hidden_conversations": [],
        },
        "mcp_servers": [],
    }
    if customer_id:
        out["customer_id"] = customer_id
    if user:
        out["user"] = {
            "id": str(user.id),
            "email": user.email,
            "name": user.display_name or user.email,
        }
    return out
