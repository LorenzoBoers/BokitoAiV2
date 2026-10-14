"""Who may use and manage a tenant calendar (shared ``access_list`` shape).

Stored on ``TenantCalendar.access_json`` with levels ``use`` < ``manage``.
Empty list means: All people and All agents may use it; only owners and
admins manage it. Owners and admins always manage.

``use`` sees the calendar's events in Agenda and agent tools.
``manage`` toggles sync, tags and the calendar access list.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar import TenantCalendar
from app.models.team import TEAM_KIND_AGENTS, TEAM_KIND_PEOPLE
from app.services.access_list import (
    UNRESTRICTED_ROLES,
    Principal,
    agent_principal,
    best_level,
    normalize_entries,
    user_principal,
    validate_entries,
)

LEVELS = ("use", "manage")

DEFAULT_ACCESS: list[dict[str, str]] = [
    {"kind": "team", "id": TEAM_KIND_PEOPLE, "level": "use"},
    {"kind": "team", "id": TEAM_KIND_AGENTS, "level": "use"},
]


def calendar_access(cal: TenantCalendar) -> list[dict[str, str]]:
    try:
        raw = json.loads(cal.access_json or "[]")
    except json.JSONDecodeError:
        raw = []
    entries = normalize_entries(raw if isinstance(raw, list) and raw else None, LEVELS)
    return entries if entries is not None else [dict(e) for e in DEFAULT_ACCESS]


def is_default_access(cal: TenantCalendar) -> bool:
    try:
        raw = json.loads(cal.access_json or "[]")
    except json.JSONDecodeError:
        return True
    return not isinstance(raw, list) or len(raw) == 0


async def set_calendar_access(
    session: AsyncSession, cal: TenantCalendar, entries: list[dict[str, Any]] | None
) -> list[dict[str, str]]:
    """Replace the list (caller commits). ``None`` restores the default."""
    if entries is None:
        cal.access_json = "[]"
    else:
        cal.access_json = json.dumps(
            await validate_entries(session, cal.tenant_id, entries, LEVELS)
        )
    session.add(cal)
    return calendar_access(cal)


def level_for(cal: TenantCalendar, principal: Principal) -> str | None:
    return best_level(calendar_access(cal), principal, LEVELS)


async def user_level(
    session: AsyncSession, cal: TenantCalendar, *, user_id: UUID, role: str
) -> str | None:
    if role in UNRESTRICTED_ROLES:
        return "manage"
    principal = await user_principal(session, cal.tenant_id, user_id, role)
    return level_for(cal, principal)


async def agent_level(
    session: AsyncSession, cal: TenantCalendar, agent_id: UUID
) -> str | None:
    principal = await agent_principal(session, cal.tenant_id, agent_id)
    return level_for(cal, principal)


async def require_manage(
    session: AsyncSession, cal: TenantCalendar, *, user_id: UUID, role: str
) -> None:
    from fastapi import HTTPException

    if await user_level(session, cal, user_id=user_id, role=role) != "manage":
        raise HTTPException(
            status_code=403,
            detail="You cannot manage this calendar. Ask an owner or admin.",
        )
