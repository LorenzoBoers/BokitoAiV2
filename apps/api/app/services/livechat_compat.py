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
from app.services.tenant_bootstrap import resolve_brand_color

settings = get_settings()


def _is_platform_mark(url: str) -> bool:
    path = url.split("?", 1)[0].rstrip("/")
    return path.endswith("bokito-logo.svg")


def _asset_url(value: Any) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, dict):
        for key in ("url", "path", "src"):
            v = value.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return ""


MESSENGER_MODULE_KEYS = ("home", "messages", "help", "tools")

# One widget bundle, two surfaces. ``site`` is the embed a tenant puts on
# their own website for their visitors; ``in_app`` is the same widget running
# inside the dashboard as the operator's personal Bokito helper. The surface
# decides which agent answers, whose branding the chrome shows, and whether
# the help tab serves the tenant's help center or Bokito's product help.
SURFACE_SITE = "site"
SURFACE_IN_APP = "in_app"
WIDGET_SURFACES = (SURFACE_SITE, SURFACE_IN_APP)


def normalize_surface(value: str | None) -> str:
    raw = (value or "").strip().lower().replace("-", "_")
    return raw if raw in WIDGET_SURFACES else SURFACE_SITE


def _messenger_modules(appearance: dict[str, Any]) -> dict[str, bool]:
    """Which widget tabs the tenant enabled; unknown/missing keys default on."""
    raw = appearance.get("modules")
    raw = raw if isinstance(raw, dict) else {}
    return {key: bool(raw.get(key, True)) for key in MESSENGER_MODULE_KEYS}


# Platform helper chrome: Bokito's own identity, not the tenant's messenger
# branding. Only the accent colour is inherited from the workspace.
PLATFORM_HELPER_NAME = "Bokito"
PLATFORM_HELPER_WELCOME: dict[str, dict[str, str]] = {
    "en": {"title": "Hi, I am Bokito", "subtitle": "Ask me anything about your workspace."},
    "nl": {"title": "Hoi, ik ben Bokito", "subtitle": "Vraag me alles over je workspace."},
}


# Bootstrap seeds the company agent as "Assistant"; that generic name is not a
# deliberate choice, so the widget falls through to the tenant name instead.
GENERIC_ASSISTANT_NAMES = {"assistant", "assistent"}

# Welcome copy shown until the tenant customizes it, keyed by workspace language.
WELCOME_DEFAULTS: dict[str, dict[str, str]] = {
    "en": {"title": "Welcome", "subtitle": "How can we help?"},
    "nl": {"title": "Welkom", "subtitle": "Hoe kunnen we je helpen?"},
}


def welcome_defaults_for_locale(locale: str) -> dict[str, str]:
    return WELCOME_DEFAULTS.get(locale, WELCOME_DEFAULTS["en"])


async def widget_assistant_name(session: AsyncSession, tenant_id: UUID) -> str:
    """Name of the agent that actually answers the widget (binding, else lead).

    Empty when unset or still generic, so callers fall back to the tenant name.
    """
    agent = await widget_assistant_agent(session, tenant_id)
    name = (agent.name or "").strip() if agent else ""
    if name.lower() in GENERIC_ASSISTANT_NAMES:
        return ""
    return name


async def widget_assistant_agent(session: AsyncSession, tenant_id: UUID):
    """Company agent bound to the widget channel (else lead)."""
    from app.services.routing import resolve_agent_for_channel

    return await resolve_agent_for_channel(session, tenant_id, "widget")


def livechat_theme_from_tenant(
    tenant: Tenant,
    *,
    assistant_name: str = "",
    agent_avatar: dict[str, Any] | None = None,
    surface: str = SURFACE_SITE,
) -> dict[str, Any]:
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

    main_color = resolve_brand_color(
        str(appearance.get("main_color") or "").strip()
        or str(livechat.get("main_color") or "").strip()
        or str(flat_appearance.get("main_color") or "").strip()
    )
    favicon = (
        _asset_url(appearance.get("widget_favicon"))
        or _asset_url(appearance.get("widget_favicon_url"))
        or _asset_url(livechat.get("favicon"))
        or _asset_url(livechat.get("favicon_url"))
        or _asset_url(settings_data.get("favicon_url"))
        or _asset_url(getattr(tenant, "logo_url", None))
        or _asset_url(livechat.get("logo"))
        or _asset_url(livechat.get("logo_url"))
    )
    if _is_platform_mark(favicon):
        favicon = ""

    avatar = agent_avatar if isinstance(agent_avatar, dict) else {}
    from app.services.agent_avatar import absolutize_avatar_url

    agent_image = absolutize_avatar_url(str(avatar.get("avatar_image_url") or "") or None)
    agent_color = str(avatar.get("avatar_color") or "").strip()
    agent_icon = str(avatar.get("avatar_icon") or "").strip()
    agent_kind = str(avatar.get("avatar_kind") or "").strip()
    # Prefer the answering agent's photo in the header bubble when set.
    if agent_image:
        favicon = agent_image

    from app.services.language import resolve_workspace_language

    locale = resolve_workspace_language(tenant)
    defaults = welcome_defaults_for_locale(locale)

    # Name chain: explicit widget override -> customized assistant name ->
    # tenant name. The platform name is never shown on a tenant's widget.
    explicit_name = str(appearance.get("chatbot_name") or "").strip()
    if explicit_name.lower() in GENERIC_ASSISTANT_NAMES:
        explicit_name = ""
    chatbot_name = explicit_name or assistant_name.strip() or (tenant.name or "").strip()

    theme = {
        "main_color": main_color,
        "primary_color": main_color,
        "locale": locale,
        "welcome_title": str(appearance.get("welcome_title") or "").strip() or defaults["title"],
        "welcome_subtitle": str(appearance.get("welcome_subtitle") or "").strip()
        or defaults["subtitle"],
        "chatbot_name": chatbot_name,
        "widget_favicon_url": favicon,
        "agent_avatar_kind": agent_kind or None,
        "agent_avatar_icon": agent_icon or None,
        "agent_avatar_color": agent_color or None,
        "agent_avatar_image_url": agent_image or None,
        "modules": _messenger_modules(appearance),
        "surface": SURFACE_SITE,
        "help_source": "tenant",
    }
    if normalize_surface(surface) != SURFACE_IN_APP:
        return theme

    # In-app helper: Bokito's own face and name, the workspace accent colour,
    # and Bokito's product help instead of the tenant's customer help center.
    # The tenant's messenger branding is for their visitors, not their team.
    helper_welcome = PLATFORM_HELPER_WELCOME.get(locale, PLATFORM_HELPER_WELCOME["en"])
    # main_color is deliberately left as resolved above: that chain is the same
    # one `workspaces_portal` serializes as the workspace `brand_color`, so the
    # helper wears the accent the person already sees in the dashboard.
    theme.update(
        {
            "chatbot_name": PLATFORM_HELPER_NAME,
            "welcome_title": helper_welcome["title"],
            "welcome_subtitle": helper_welcome["subtitle"],
            # Empty so the animated Bokito mark in the widget wins.
            "widget_favicon_url": "",
            "agent_avatar_kind": None,
            "agent_avatar_icon": None,
            "agent_avatar_color": None,
            "agent_avatar_image_url": None,
            "modules": {"home": True, "messages": True, "help": True, "tools": True},
            "surface": SURFACE_IN_APP,
            "help_source": "product_help",
        }
    )
    return theme


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


def team_is_reachable(tenant: Tenant, *, surface: str = SURFACE_SITE) -> bool:
    """Whether a live human handoff is available on this surface."""
    if normalize_surface(surface) == SURFACE_IN_APP:
        return True
    return office_hours_open(widget_settings_from_tenant(tenant)["office_hours"])


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
    surface: str = SURFACE_SITE,
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
    # The surface is pinned into the session so every later call (conversation,
    # stream, history) keeps answering as the same assistant.
    if normalize_surface(surface) == SURFACE_IN_APP:
        payload["surface"] = SURFACE_IN_APP
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def surface_from_widget_token(token: str) -> str:
    """Which surface this widget session was opened on ("site" when unknown)."""
    try:
        return normalize_surface(decode_widget_session_token(token).get("surface"))
    except Exception:
        return SURFACE_SITE


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
    assistant_name: str = "",
    agent_avatar: dict[str, Any] | None = None,
    surface: str = SURFACE_SITE,
) -> dict[str, Any]:
    surface = normalize_surface(surface)
    theme = livechat_theme_from_tenant(
        tenant,
        assistant_name=assistant_name,
        agent_avatar=agent_avatar,
        surface=surface,
    )
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
        "surface": surface,
        "tool_display_names": {},
        "mcp_servers": [],
        "pre_chat_form": widget_cfg["pre_chat_form"],
        "office_open": is_open,
    }
    if surface == SURFACE_IN_APP:
        # The helper is always available to a signed-in teammate: no pre-chat
        # form, no office hours.
        agent_config["pre_chat_form"] = False
        agent_config["office_open"] = True
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
