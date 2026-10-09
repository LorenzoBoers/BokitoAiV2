"""First / last name helpers for User.

``display_name`` stays the composed full name so existing list UIs, mentions,
and From lines keep working. Writers always go through ``apply_user_names`` so
the three fields stay in sync.
"""

from __future__ import annotations

from typing import Any


def compose_display_name(first_name: str = "", last_name: str = "") -> str:
    return " ".join(part for part in (first_name.strip(), last_name.strip()) if part)


def split_display_name(full: str) -> tuple[str, str]:
    """Split a legacy full name into first + remainder as last."""
    parts = (full or "").strip().split(None, 1)
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1]


def user_full_name(user: Any) -> str:
    """Preferred display string: composed parts, then legacy display_name, then email."""
    composed = compose_display_name(
        getattr(user, "first_name", "") or "",
        getattr(user, "last_name", "") or "",
    )
    if composed:
        return composed
    display = (getattr(user, "display_name", "") or "").strip()
    if display:
        return display
    return (getattr(user, "email", "") or "").strip()


def apply_user_names(
    user: Any,
    *,
    first_name: str | None = None,
    last_name: str | None = None,
    display_name: str | None = None,
) -> None:
    """Update name fields on a User-like object and keep ``display_name`` in sync.

    Prefer ``first_name`` / ``last_name``. A lone ``display_name`` (signup, invite,
    SSO) still splits into parts for existing clients.
    """
    if first_name is not None or last_name is not None:
        if first_name is not None:
            user.first_name = first_name.strip()
        if last_name is not None:
            user.last_name = last_name.strip()
        user.display_name = compose_display_name(user.first_name, user.last_name)
        return
    if display_name is not None:
        cleaned = display_name.strip()
        first, last = split_display_name(cleaned)
        user.first_name = first
        user.last_name = last
        user.display_name = cleaned or compose_display_name(first, last)
