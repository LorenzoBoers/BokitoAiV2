"""One access-list shape for people, agents and teams, shared by resources.

An entry is ``{"kind": "user" | "agent" | "team", "id": "<uuid or system
kind>", "level": "<level>"}``. System teams are referenced by their kind
(``people`` / ``agents``) so lists resolve without a lookup. Each resource
picks its own ordered levels, lowest first:

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

from app.models.team import SYSTEM_TEAM_KINDS, TEAM_KIND_AGENTS, TEAM_KIND_PEOPLE, Team

ACCESS_KINDS = ("user", "agent", "team")
UNRESTRICTED_ROLES = ("owner", "admin")


@dataclass
class Principal:
    kind: str  # user | agent
    id: str
    team_ids: set[str] = field(default_factory=set)
    unrestricted: bool = False


async def user_principal(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, role: str
) -> Principal:
    from app.services.teams import user_team_ids

    teams = {str(t) for t in await user_team_ids(session, tenant_id, user_id, include_system=False)}
    teams.add(TEAM_KIND_PEOPLE)
    return Principal("user", str(user_id), teams, unrestricted=role in UNRESTRICTED_ROLES)


async def agent_principal(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> Principal:
    from app.models.team import TeamMember

    teams = {
        str(t)
        for t in (
            await session.execute(
                select(TeamMember.team_id).where(
                    TeamMember.tenant_id == tenant_id,
                    TeamMember.member_kind == "agent",
                    TeamMember.agent_id == agent_id,
                )
            )
        ).scalars().all()
    }
    teams.add(TEAM_KIND_AGENTS)
    return Principal("agent", str(agent_id), teams)


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
    """Validate operator input; system team rows map to their kind; the highest level wins."""
    system_ids = {
        str(row.id): row.kind
        for row in (
            await session.execute(
                select(Team).where(Team.tenant_id == tenant_id, Team.kind.in_(SYSTEM_TEAM_KINDS))
            )
        ).scalars().all()
    }
    rank = {lvl: i for i, lvl in enumerate(levels)}
    seen: dict[tuple[str, str], str] = {}
    for entry in entries:
        kind = str(entry.get("kind") or "")
        ident = str(entry.get("id") or "")
        level = str(entry.get("level") or levels[-1])
        if kind not in ACCESS_KINDS or level not in rank or not ident:
            raise ValueError("Invalid access entry")
        if kind == "team":
            ident = system_ids.get(ident, ident)
            if ident not in SYSTEM_TEAM_KINDS:
                _require_uuid(ident)
        else:
            _require_uuid(ident)
        key = (kind, ident)
        if key not in seen or rank[level] > rank[seen[key]]:
            seen[key] = level
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
            kind == "team" and ident in principal.team_ids
        )
        if match and (best is None or rank[level] > rank[best]):
            best = level
    return best
