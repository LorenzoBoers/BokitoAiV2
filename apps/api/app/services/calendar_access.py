"""Who may use and manage a tenant calendar (shared ``access_list`` shape).

Stored on ``TenantCalendar.access_json`` with levels ``use`` < ``manage``.
Empty list means: everyone (All) may use it; only owners and admins manage it.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import status_error
from app.models.calendar import TenantCalendar
from app.services.access_list import (
    UNRESTRICTED_ROLES,
    Principal,
    agent_principal,
    best_level,
    normalize_entries,
    user_principal,
    validate_entries,
)
from app.services.teams import ensure_org_root

LEVELS = ("use", "manage")


async def default_access(session: AsyncSession, tenant_id: UUID) -> list[dict[str, str]]:
    root = await ensure_org_root(session, tenant_id)
    return [{"kind": "department", "id": str(root.id), "level": "use"}]


def calendar_access(cal: TenantCalendar) -> list[dict[str, str]]:
    try:
        raw = json.loads(cal.access_json or "[]")
    except json.JSONDecodeError:
        raw = []
    entries = normalize_entries(raw if isinstance(raw, list) and raw else None, LEVELS)
    return entries if entries is not None else []


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
    from app.services.setup_links import replace_resource_grants

    raw = json.loads(cal.access_json or "[]")
    await replace_resource_grants(
        session,
        cal.tenant_id,
        "calendar",
        raw if isinstance(raw, list) else [],
        calendar_id=cal.id,
    )
    return await default_access(session, cal.tenant_id) if is_default_access(cal) else calendar_access(cal)


def level_for(cal: TenantCalendar, principal: Principal) -> str | None:
    if principal.unrestricted:
        return "manage"
    if is_default_access(cal):
        return "use"
    return best_level(calendar_access(cal), principal, LEVELS)


async def user_level(
    session: AsyncSession, cal: TenantCalendar, *, user_id: UUID, role: str
) -> str | None:
    if role in UNRESTRICTED_ROLES:
        return "manage"
    principal = await user_principal(
        session, cal.tenant_id, user_id, role, include_system=False
    )
    return level_for(cal, principal)


async def agent_level(
    session: AsyncSession, cal: TenantCalendar, agent_id: UUID
) -> str | None:
    principal = await agent_principal(session, cal.tenant_id, agent_id)
    return level_for(cal, principal)


async def require_manage(
    session: AsyncSession, cal: TenantCalendar, *, user_id: UUID, role: str
) -> None:
    if await user_level(session, cal, user_id=user_id, role=role) != "manage":
        raise status_error(
            status_code=403,
            detail="You cannot manage this calendar. Ask an owner or admin.",
        )
