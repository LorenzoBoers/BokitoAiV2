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


DEFAULT_OFFICE_HOURS: dict[str, Any] = {
    "enabled": False,
    "timezone": "Europe/Amsterdam",
    # Days the team is available: 0 = Monday .. 6 = Sunday.
    "days": [0, 1, 2, 3, 4],
    "start": "09:00",
    "end": "17:00",
}


def widget_settings_from_tenant(tenant: Tenant) -> dict[str, Any]:
    """Widget behaviour settings stored under tenant `livechat_settings`."""
    settings_data = tenant_settings(tenant)
    livechat = settings_data.get("livechat_settings")
    if not isinstance(livechat, dict):
        livechat = {}
    office_hours = livechat.get("office_hours")
    if not isinstance(office_hours, dict):
        office_hours = {}
    merged_hours = {**DEFAULT_OFFICE_HOURS, **office_hours}
    return {
        "pre_chat_form": bool(livechat.get("pre_chat_form", False)),
        "office_hours": merged_hours,
        "offline_message": str(livechat.get("offline_message") or "").strip(),
    }


def office_hours_open(office_hours: dict[str, Any], *, now: datetime | None = None) -> bool:
    """True when the widget should present the team as available.

    Hours disabled means always open. Invalid config fails open so a
    misconfiguration never silences the widget.
    """
    if not office_hours.get("enabled"):
        return True
    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo(str(office_hours.get("timezone") or "Europe/Amsterdam"))
        local = (now or datetime.now(tz)).astimezone(tz)
        days = office_hours.get("days")
        if not isinstance(days, list) or local.weekday() not in [int(d) for d in days]:
            return False
        start_h, start_m = str(office_hours.get("start") or "09:00").split(":")
        end_h, end_m = str(office_hours.get("end") or "17:00").split(":")
        minutes = local.hour * 60 + local.minute
        return int(start_h) * 60 + int(start_m) <= minutes < int(end_h) * 60 + int(end_m)
    except Exception:
        return True


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

    explicit_slug = (tenant_subdomain or "").strip().lower()
    if explicit_slug:
        tenant_result = await session.execute(select(Tenant).where(Tenant.slug == explicit_slug))
        tenant = tenant_result.scalar_one_or_none()
        if not tenant:
            # An explicit tenant must match exactly; falling back to another tenant
            # would silently attach a customer widget to the wrong workspace.
            raise LookupError(f"tenant not found: {explicit_slug}")
        return tenant, user

    # No tenant supplied. In production every embed must declare its tenant
    # (`data-tenant`); guessing would leak conversations across workspaces.
    if settings.is_production:
        raise LookupError("tenant_subdomain required")

    # Dev convenience: default to the seeded tenant, else the oldest tenant.
    tenant_result = await session.execute(select(Tenant).where(Tenant.slug == "bokito"))
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
    # Optional host sign-in link shown on the widget's "Sign in required" panel.
    login_url = ""
    livechat_settings = tenant_settings(tenant).get("livechat")
    if isinstance(livechat_settings, dict):
        login_url = str(livechat_settings.get("login_url") or "")
    widget_cfg = widget_settings_from_tenant(tenant)
    is_open = office_hours_open(widget_cfg["office_hours"])
    agent_config = {
        "auth_mode": auth_mode,
        "theme": theme,
        "tool_display_names": {},
        "mcp_servers": [],
        "pre_chat_form": widget_cfg["pre_chat_form"],
        "office_open": is_open,
    }
    if not is_open and widget_cfg["offline_message"]:
        agent_config["offline_message"] = widget_cfg["offline_message"]
    if login_url:
        agent_config["login_url"] = login_url
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
