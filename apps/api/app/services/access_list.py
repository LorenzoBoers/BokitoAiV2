"""One access-list shape for people, agents and departments, shared by resources.

An entry is ``{"kind": "user" | "agent" | "department", "id": "<uuid>",
"level": "<level>"}``. The pinned **All** department is the Everyone option.
Each resource picks its own ordered levels, lowest first:

- channels: ``view`` < ``handle`` (``channel_access``)
- connections: ``use`` < ``manage`` (``connection_access``)

Owners and admins are unrestricted on every resource.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import Team

ACCESS_KINDS = ("user", "agent", "department")
UNRESTRICTED_ROLES = ("owner", "admin")
# Legacy string ids and the Everyone UI sentinel — map to All on validate.
EVERYONE_SENTINELS = frozenset({"people", "agents", "everyone", "all"})


@dataclass
class Principal:
    kind: str  # user | agent
    id: str
    team_ids: set[str] = field(default_factory=set)
    unrestricted: bool = False


async def user_principal(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    role: str,
    *,
    include_system: bool = True,
) -> Principal:
    from app.services.teams import user_team_ids

    teams = {
        str(t)
        for t in await user_team_ids(
            session, tenant_id, user_id, include_system=include_system
        )
    }
    return Principal("user", str(user_id), teams, unrestricted=role in UNRESTRICTED_ROLES)


async def agent_principals(
    session: AsyncSession, tenant_id: UUID, agent_ids: Sequence[UUID]
) -> dict[UUID, Principal]:
    """Team memberships for many agents (direct + ancestors).

    The organization root is always included: a grant to it means Everyone,
    also for an agent that is not placed in any department.
    """
    from app.services.teams import agent_team_ids, ensure_org_root

    root = str((await ensure_org_root(session, tenant_id)).id)
    unique = list(dict.fromkeys(agent_ids))
    out: dict[UUID, Principal] = {}
    for aid in unique:
        teams = {str(t) for t in await agent_team_ids(session, tenant_id, aid)} | {root}
        out[aid] = Principal("agent", str(aid), teams)
    return out


async def agent_principal(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> Principal:
    return (await agent_principals(session, tenant_id, [agent_id]))[agent_id]


def normalize_entries(raw: Any, levels: Sequence[str]) -> list[dict[str, str]] | None:
    """Clean stored entries; None when nothing is stored (caller's default applies)."""
    if not isinstance(raw, list):
        return None
    out: list[dict[str, str]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get("kind") or "")
        ident = str(entry.get("id") or "")
        level = str(entry.get("level") or levels[-1])
        if kind in ACCESS_KINDS and ident and level in levels:
            out.append({"kind": kind, "id": ident, "level": level})
    return out


def _require_uuid(value: str) -> None:
    try:
        UUID(value)
    except ValueError as exc:
        raise ValueError("Invalid access entry") from exc


async def validate_entries(
    session: AsyncSession,
    tenant_id: UUID,
    entries: list[dict[str, Any]],
    levels: Sequence[str],
) -> list[dict[str, str]]:
    """Validate operator input; Everyone / legacy people|agents map to All."""
    from app.models.agent import Agent
    from app.models.auth import Membership
    from app.services.teams import ensure_org_root

    all_dept = await ensure_org_root(session, tenant_id)
    all_id = str(all_dept.id)
    rank = {lvl: i for i, lvl in enumerate(levels)}
    seen: dict[tuple[str, str], str] = {}
    agent_ids: list[UUID] = []
    user_ids: list[UUID] = []
    for entry in entries:
        kind = str(entry.get("kind") or "")
        ident = str(entry.get("id") or "")
        level = str(entry.get("level") or levels[-1])
        if kind not in ACCESS_KINDS or level not in rank or not ident:
            raise ValueError("Invalid access entry")
        if kind == "department":
            if ident in EVERYONE_SENTINELS:
                ident = all_id
            else:
                _require_uuid(ident)
                row = (
                    await session.execute(
                        select(Team.id).where(Team.id == UUID(ident), Team.tenant_id == tenant_id)
                    )
                ).scalar_one_or_none()
                if row is None:
                    raise ValueError("Unknown department")
        else:
            _require_uuid(ident)
            if kind == "agent":
                agent_ids.append(UUID(ident))
            elif kind == "user":
                user_ids.append(UUID(ident))
        key = (kind, ident)
        if key not in seen or rank[level] > rank[seen[key]]:
            seen[key] = level

    if agent_ids:
        active_agents = {
            str(aid)
            for aid in (
                await session.execute(
                    select(Agent.id).where(
                        Agent.tenant_id == tenant_id,
                        Agent.id.in_(agent_ids),
                        Agent.kind == "company",
                        Agent.is_active.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        }
        for aid in agent_ids:
            if str(aid) not in active_agents:
                raise ValueError("Agent is deactivated or unknown")
    if user_ids:
        active_users = {
            str(uid)
            for uid in (
                await session.execute(
                    select(Membership.user_id).where(
                        Membership.tenant_id == tenant_id,
                        Membership.user_id.in_(user_ids),
                        Membership.is_active.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        }
        for uid in user_ids:
            if str(uid) not in active_users:
                raise ValueError("Person is deactivated or unknown")

    return [{"kind": k, "id": i, "level": lvl} for (k, i), lvl in seen.items()]


def best_level(
    entries: list[dict[str, str]], principal: Principal, levels: Sequence[str]
) -> str | None:
    """Highest level this principal holds on the list (top level when unrestricted)."""
    if principal.unrestricted:
        return levels[-1]
    rank = {lvl: i for i, lvl in enumerate(levels)}
    best: str | None = None
    for entry in entries:
        kind, ident, level = entry["kind"], entry["id"], entry["level"]
        if level not in rank:
            continue
        match = (kind == principal.kind and ident == principal.id) or (
            kind == "department" and ident in principal.team_ids
        )
        if match and (best is None or rank[level] > rank[best]):
            best = level
    return best
