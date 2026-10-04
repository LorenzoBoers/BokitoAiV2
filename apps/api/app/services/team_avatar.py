"""Team visual identity: initials (default), icon, or uploaded image.

Stored in ``Team.settings_json``. Surfaces share the same fields via
``avatar_payload`` / ``serialize_team``.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.models.team import TEAM_KIND_AGENTS, TEAM_KIND_PEOPLE, Team
from app.services.agent_avatar import (
    AVATAR_KIND_ICON,
    AVATAR_KIND_IMAGE,
    AVATAR_KIND_INITIALS,
    AVATAR_KINDS,
    normalize_color,
    normalize_icon,
    normalize_image_url,
)

# Fixed marks for system teams (always icon, never initials).
SYSTEM_TEAM_AVATARS: dict[str, dict[str, str]] = {
    TEAM_KIND_PEOPLE: {
        "avatar_kind": AVATAR_KIND_ICON,
        "avatar_icon": "users",
        "avatar_color": "#4652f2",
    },
    TEAM_KIND_AGENTS: {
        "avatar_kind": AVATAR_KIND_ICON,
        "avatar_icon": "bot",
        "avatar_color": "#7c3aed",
    },
}

# Seeded palette matches dashboard ``lib/avatar.ts``.
_PALETTE = (
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
)


def _settings(raw: str | None) -> dict[str, Any]:
    import json

    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


def seeded_color(seed: str) -> str:
    """Deterministic hex from an id/name seed."""
    value = (seed or "").strip() or "team"
    hash_val = 0
    for ch in value:
        hash_val = (hash_val * 31 + ord(ch)) & 0xFFFFFFFF
    return _PALETTE[hash_val % len(_PALETTE)]


def avatar_payload(team: Team | None) -> dict[str, Any]:
    """Public avatar fields for API payloads. Default is initials + seeded color."""
    empty = {
        "avatar_kind": AVATAR_KIND_INITIALS,
        "avatar_icon": None,
        "avatar_color": seeded_color("team"),
        "avatar_image_url": None,
    }
    if team is None:
        return empty
    system = SYSTEM_TEAM_AVATARS.get(str(getattr(team, "kind", "") or ""))
    if system:
        return {
            "avatar_kind": system["avatar_kind"],
            "avatar_icon": system["avatar_icon"],
            "avatar_color": system["avatar_color"],
            "avatar_image_url": None,
        }
    stored = _settings(getattr(team, "settings_json", None))
    kind = str(stored.get("avatar_kind") or AVATAR_KIND_INITIALS).strip().lower()
    if kind not in AVATAR_KINDS:
        kind = AVATAR_KIND_INITIALS
    icon = normalize_icon(str(stored.get("avatar_icon") or "") or None)
    image = normalize_image_url(str(stored.get("avatar_image_url") or "") or None)
    color = normalize_color(str(stored.get("avatar_color") or "") or None) or seeded_color(
        str(team.id)
    )
    if kind == AVATAR_KIND_IMAGE and not image:
        kind = AVATAR_KIND_ICON if icon else AVATAR_KIND_INITIALS
    if kind == AVATAR_KIND_ICON and not icon:
        kind = AVATAR_KIND_INITIALS
    return {
        "avatar_kind": kind,
        "avatar_icon": icon if kind == AVATAR_KIND_ICON else None,
        "avatar_color": color,
        "avatar_image_url": image if kind == AVATAR_KIND_IMAGE else None,
    }


def apply_avatar_settings(
    stored: dict[str, Any],
    *,
    team_id: UUID | str | None = None,
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
    kind = str(out.get("avatar_kind") or AVATAR_KIND_INITIALS)
    if kind == AVATAR_KIND_IMAGE and not out.get("avatar_image_url"):
        out["avatar_kind"] = AVATAR_KIND_ICON if out.get("avatar_icon") else AVATAR_KIND_INITIALS
    if kind == AVATAR_KIND_ICON and not out.get("avatar_icon"):
        out["avatar_kind"] = AVATAR_KIND_INITIALS
    if not out.get("avatar_color"):
        out["avatar_color"] = seeded_color(str(team_id) if team_id else "team")
    return out


def dump_settings(data: dict[str, Any]) -> str:
    import json

    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))
