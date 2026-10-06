"""Who may use and manage a connection (shared ``access_list`` shape).

Stored on ``IntegrationConnection.metadata_json`` under ``access`` with levels
``use`` < ``manage``. No list means: All people and All agents may use it;
only owners and admins manage it. Owners and admins always manage.

``use`` lets an agent reach the connection's tools (writes still pass the
module roster, apply mode and posture) and lets a person see it and have
their assistant runs use it. ``manage`` adds verify, rename, defaults,
project links, access and disconnect.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationConnection
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


def _meta(conn: IntegrationConnection) -> dict[str, Any]:
    try:
        data = json.loads(conn.metadata_json or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def connection_access(conn: IntegrationConnection) -> list[dict[str, str]]:
    entries = normalize_entries(_meta(conn).get("access"), LEVELS)
    return entries if entries is not None else [dict(e) for e in DEFAULT_ACCESS]


def is_default_access(conn: IntegrationConnection) -> bool:
    return not isinstance(_meta(conn).get("access"), list)


async def set_connection_access(
    session: AsyncSession, conn: IntegrationConnection, entries: list[dict[str, Any]] | None
) -> list[dict[str, str]]:
    """Replace the list (caller commits). ``None`` restores the default."""
    meta = _meta(conn)
    if entries is None:
        meta.pop("access", None)
    else:
        meta["access"] = await validate_entries(session, conn.tenant_id, entries, LEVELS)
    conn.metadata_json = json.dumps(meta)
    session.add(conn)
    return connection_access(conn)


def level_for(conn: IntegrationConnection, principal: Principal) -> str | None:
    return best_level(connection_access(conn), principal, LEVELS)


async def user_level(
    session: AsyncSession, conn: IntegrationConnection, *, user_id: UUID, role: str
) -> str | None:
    if role in UNRESTRICTED_ROLES:
        return "manage"
    principal = await user_principal(session, conn.tenant_id, user_id, role)
    return level_for(conn, principal)


async def agent_level(
    session: AsyncSession, conn: IntegrationConnection, agent_id: UUID
) -> str | None:
    principal = await agent_principal(session, conn.tenant_id, agent_id)
    return level_for(conn, principal)


async def require_manage(
    session: AsyncSession, conn: IntegrationConnection, *, user_id: UUID, role: str
) -> None:
    from fastapi import HTTPException

    if await user_level(session, conn, user_id=user_id, role=role) != "manage":
        raise HTTPException(
            status_code=403,
            detail="You cannot manage this connection. Ask an owner or admin.",
        )
