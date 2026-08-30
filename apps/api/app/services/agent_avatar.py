"""Agent visual identity: icon, color, or uploaded image.

Stored in ``Agent.settings_json`` so we stay column-light during the build
phase. Surfaces (library, Messages, signatures, widget header) share the
same fields via ``avatar_payload`` / ``serialize_runtime_agent``.
"""

from __future__ import annotations

import re
from typing import Any

from app.models.agent import Agent

AVATAR_KIND_INITIALS = "initials"
AVATAR_KIND_ICON = "icon"
AVATAR_KIND_IMAGE = "image"
AVATAR_KINDS = (AVATAR_KIND_INITIALS, AVATAR_KIND_ICON, AVATAR_KIND_IMAGE)

# Curated Lucide keys mirrored in the dashboard picker.
ALLOWED_ICONS = frozenset(
    {
        "bot",
        "sparkles",
        "headset",
        "mail",
        "message-circle",
        "briefcase",
        "building-2",
        "wrench",
        "heart-handshake",
        "shield",
        "zap",
        "book-open",
        "scale",
        "stethoscope",
        "shopping-bag",
        "plane",
        "home",
        "users",
        "brain",
        "lightbulb",
    }
)

ALLOWED_COLORS = frozenset(
    {
        "#4652f2",
        "#7c3aed",
        "#0891b2",
        "#0d9488",
        "#059669",
        "#d97706",
        "#dc2626",
        "#db2777",
        "#9333ea",
        "#2563eb",
        "#16a34a",
        "#ea580c",
    }
)

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_UPLOAD_PATH_RE = re.compile(r"^/api/uploads/files/[0-9a-fA-F-]{36}/[^/?#]+$")


def _settings(raw: str | None) -> dict[str, Any]:
    import json

    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


def normalize_color(value: str | None) -> str | None:
    if not value:
        return None
    hex_color = value.strip()
    if not hex_color.startswith("#") and len(hex_color) == 6:
        hex_color = f"#{hex_color}"
    if not _HEX_RE.match(hex_color):
        return None
    return hex_color.lower()


def normalize_icon(value: str | None) -> str | None:
    if not value:
        return None
    key = value.strip().lower()
    return key if key in ALLOWED_ICONS else None


def normalize_image_url(value: str | None) -> str | None:
    if not value:
        return None
    url = value.strip()
    if _UPLOAD_PATH_RE.match(url):
        return url
    # Absolute same-origin uploads occasionally include a host in tests.
    if "/api/uploads/files/" in url:
        path = url[url.index("/api/uploads/files/") :]
        if _UPLOAD_PATH_RE.match(path.split("?", 1)[0]):
            return path.split("?", 1)[0]
    return None


def avatar_payload(agent: Agent | None) -> dict[str, Any]:
    """Public avatar fields for API / widget / thread payloads."""
    empty = {
        "avatar_kind": AVATAR_KIND_INITIALS,
        "avatar_icon": None,
        "avatar_color": None,
        "avatar_image_url": None,
    }
    if agent is None:
        return empty
    stored = _settings(agent.settings_json)
    kind = str(stored.get("avatar_kind") or AVATAR_KIND_INITIALS).strip().lower()
    if kind not in AVATAR_KINDS:
        kind = AVATAR_KIND_INITIALS
    icon = normalize_icon(str(stored.get("avatar_icon") or "") or None)
    color = normalize_color(str(stored.get("avatar_color") or "") or None)
    image = normalize_image_url(str(stored.get("avatar_image_url") or "") or None)
    if kind == AVATAR_KIND_IMAGE and not image:
        kind = AVATAR_KIND_ICON if icon else AVATAR_KIND_INITIALS
    if kind == AVATAR_KIND_ICON and not icon:
        kind = AVATAR_KIND_INITIALS
    return {
        "avatar_kind": kind,
        "avatar_icon": icon,
        "avatar_color": color,
        "avatar_image_url": image if kind == AVATAR_KIND_IMAGE else None,
    }


def apply_avatar_settings(
    stored: dict[str, Any],
    *,
    avatar_kind: str | None = None,
    avatar_icon: str | None = None,
    avatar_color: str | None = None,
    avatar_image_url: str | None = None,
) -> dict[str, Any]:
    """Merge avatar fields into settings_json; raises ValueError on bad input."""
    out = dict(stored)
    if avatar_kind is not None:
        kind = avatar_kind.strip().lower()
        if kind not in AVATAR_KINDS:
            raise ValueError("Invalid avatar_kind")
        out["avatar_kind"] = kind
    if avatar_icon is not None:
        icon = normalize_icon(avatar_icon) if avatar_icon.strip() else None
        if avatar_icon.strip() and icon is None:
            raise ValueError("Invalid avatar_icon")
        if icon:
            out["avatar_icon"] = icon
        else:
            out.pop("avatar_icon", None)
    if avatar_color is not None:
        color = normalize_color(avatar_color) if avatar_color.strip() else None
        if avatar_color.strip() and color is None:
            raise ValueError("Invalid avatar_color")
        if color:
            out["avatar_color"] = color
        else:
            out.pop("avatar_color", None)
    if avatar_image_url is not None:
        image = normalize_image_url(avatar_image_url) if avatar_image_url.strip() else None
        if avatar_image_url.strip() and image is None:
            raise ValueError("Avatar image must be an uploaded file URL")
        if image:
            out["avatar_image_url"] = image
        else:
            out.pop("avatar_image_url", None)
    # Keep kind coherent after partial updates.
    kind = str(out.get("avatar_kind") or AVATAR_KIND_INITIALS)
    if kind == AVATAR_KIND_IMAGE and not out.get("avatar_image_url"):
        out["avatar_kind"] = (
            AVATAR_KIND_ICON if out.get("avatar_icon") else AVATAR_KIND_INITIALS
        )
    if kind == AVATAR_KIND_ICON and not out.get("avatar_icon"):
        out["avatar_kind"] = AVATAR_KIND_INITIALS
    return out


def absolutize_avatar_url(url: str | None) -> str:
    """Turn a relative upload path into a public API absolute URL for email/widget."""
    if not url:
        return ""
    raw = str(url).strip()
    if not raw:
        return ""
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    if raw.startswith("/"):
        from app.config import get_settings

        return f"{get_settings().public_api_url.rstrip('/')}{raw}"
    return raw


def signature_avatar_html(agent: Agent | None) -> str:
    """Small round image for default agent signatures when an upload is set."""
    payload = avatar_payload(agent)
    url = absolutize_avatar_url(str(payload.get("avatar_image_url") or "") or None)
    if not url:
        return ""
    name = html_escape((agent.name if agent else "Agent") or "Agent")
    return (
        f'<p style="margin:0 0 8px 0">'
        f'<img src="{html_escape(url)}" alt="{name}" width="48" height="48" '
        f'style="border-radius:50%;display:block" />'
        f"</p>"
    )


def html_escape(value: str) -> str:
    import html as html_mod

    return html_mod.escape(value, quote=True)
