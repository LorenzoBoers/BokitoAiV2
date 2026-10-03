"""Who may see and handle a channel: one access list for people, agents and teams.

Stored on ``ChannelAccount.settings_json`` under ``access``::

    {"access": [{"kind": "user" | "agent" | "team", "id": "<uuid or system kind>",
                 "level": "view" | "handle"}, ...]}

System teams are referenced by their kind (``people`` / ``agents``) so the
list resolves without a lookup. No list means everyone: All people and All
agents may handle the channel. Owners and admins always handle every channel.

``view`` lets someone read the channel's conversations; ``handle`` also lets
them reply, take ownership and receive its conversations. For agents, a
missing entry means the agent may not act on the channel at all.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import ChannelAccount
from app.models.team import SYSTEM_TEAM_KINDS, TEAM_KIND_AGENTS, TEAM_KIND_PEOPLE, Team

ACCESS_KINDS = ("user", "agent", "team")
ACCESS_LEVELS = ("view", "handle")
UNRESTRICTED_ROLES = ("owner", "admin")

DEFAULT_ACCESS: list[dict[str, str]] = [
    {"kind": "team", "id": TEAM_KIND_PEOPLE, "level": "handle"},
    {"kind": "team", "id": TEAM_KIND_AGENTS, "level": "handle"},
]


def _settings(account: ChannelAccount) -> dict[str, Any]:
    try:
        data = json.loads(account.settings_json or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _legacy_access(settings: dict[str, Any]) -> list[dict[str, str]] | None:
    """Convert the retired ``visibility`` key (everyone | selected users)."""
    raw = settings.get("visibility")
    if not isinstance(raw, dict) or raw.get("mode") != "selected":
        return None
    users = raw.get("user_ids") if isinstance(raw.get("user_ids"), list) else []
    entries = [{"kind": "user", "id": str(u), "level": "handle"} for u in users if u]
    entries.append({"kind": "team", "id": TEAM_KIND_AGENTS, "level": "handle"})
    return entries


def account_access(account: ChannelAccount) -> list[dict[str, str]]:
    """Normalized access list for a channel (never raises)."""
    settings = _settings(account)
    raw = settings.get("access")
    if not isinstance(raw, list):
        legacy = _legacy_access(settings)
        return legacy if legacy is not None else [dict(e) for e in DEFAULT_ACCESS]
    out: list[dict[str, str]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get("kind") or "")
        ident = str(entry.get("id") or "")
        level = str(entry.get("level") or "handle")
        if kind in ACCESS_KINDS and ident and level in ACCESS_LEVELS:
            out.append({"kind": kind, "id": ident, "level": level})
    return out


def is_default_access(account: ChannelAccount) -> bool:
    settings = _settings(account)
    return not isinstance(settings.get("access"), list) and _legacy_access(settings) is None


async def set_account_access(
    session: AsyncSession, account: ChannelAccount, entries: list[dict[str, Any]] | None
) -> None:
    """Replace the access list (caller commits). ``None`` restores the default."""
    settings = _settings(account)
    settings.pop("visibility", None)
    if entries is None:
        settings.pop("access", None)
        account.settings_json = json.dumps(settings)
        return
    system_ids = {
        str(row.id): row.kind
        for row in (
            await session.execute(
                select(Team).where(
                    Team.tenant_id == account.tenant_id, Team.kind.in_(SYSTEM_TEAM_KINDS)
                )
            )
        ).scalars().all()
    }
    seen: dict[tuple[str, str], str] = {}
    for entry in entries:
        kind = str(entry.get("kind") or "")
        ident = str(entry.get("id") or "")
        level = str(entry.get("level") or "handle")
        if kind not in ACCESS_KINDS or level not in ACCESS_LEVELS or not ident:
            raise ValueError("Invalid access entry")
        if kind == "team":
            ident = system_ids.get(ident, ident)
            if ident not in SYSTEM_TEAM_KINDS:
                _require_uuid(ident)
        else:
            _require_uuid(ident)
        key = (kind, ident)
        if seen.get(key) != "handle":
            seen[key] = level
    settings["access"] = [{"kind": k, "id": i, "level": lvl} for (k, i), lvl in seen.items()]
    account.settings_json = json.dumps(settings)


def _require_uuid(value: str) -> None:
    try:
        UUID(value)
    except ValueError as exc:
        raise ValueError("Invalid access entry") from exc


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


_RANK = {None: 0, "view": 1, "handle": 2}


def access_level(account: ChannelAccount, principal: Principal) -> str | None:
    """``handle``, ``view`` or None for this principal on this channel."""
    if principal.unrestricted:
        return "handle"
    best: str | None = None
    for entry in account_access(account):
        kind, ident, level = entry["kind"], entry["id"], entry["level"]
        match = (kind == principal.kind and ident == principal.id) or (
            kind == "team" and ident in principal.team_ids
        )
        if match and _RANK[level] > _RANK[best]:
            best = level
    return best


async def _accounts(session: AsyncSession, tenant_id: UUID) -> list[ChannelAccount]:
    return list(
        (
            await session.execute(select(ChannelAccount).where(ChannelAccount.tenant_id == tenant_id))
        ).scalars().all()
    )


async def visible_channel_account_ids(
    session: AsyncSession, tenant_id: UUID, *, user_id: UUID, role: str
) -> set[UUID] | None:
    """Channels the user may see. None means unrestricted (owner/admin)."""
    if role in UNRESTRICTED_ROLES:
        return None
    principal = await user_principal(session, tenant_id, user_id, role)
    return {a.id for a in await _accounts(session, tenant_id) if access_level(a, principal)}


async def handled_channel_account_ids(
    session: AsyncSession, tenant_id: UUID, *, user_id: UUID, role: str
) -> set[UUID] | None:
    """Channels the user may handle. None means unrestricted (owner/admin)."""
    if role in UNRESTRICTED_ROLES:
        return None
    principal = await user_principal(session, tenant_id, user_id, role)
    return {
        a.id for a in await _accounts(session, tenant_id) if access_level(a, principal) == "handle"
    }


async def can_view_account(
    session: AsyncSession, account: ChannelAccount, *, user_id: UUID, role: str
) -> bool:
    if role in UNRESTRICTED_ROLES:
        return True
    principal = await user_principal(session, account.tenant_id, user_id, role)
    return access_level(account, principal) is not None


async def can_handle_account(
    session: AsyncSession, account: ChannelAccount, *, user_id: UUID, role: str
) -> bool:
    if role in UNRESTRICTED_ROLES:
        return True
    principal = await user_principal(session, account.tenant_id, user_id, role)
    return access_level(account, principal) == "handle"


async def agent_can_handle(session: AsyncSession, account: ChannelAccount | None, agent_id: UUID) -> bool:
    """Whether an agent may act on a channel's conversations. No channel: allowed."""
    if account is None:
        return True
    principal = await agent_principal(session, account.tenant_id, agent_id)
    return access_level(account, principal) == "handle"


async def handler_user_ids(session: AsyncSession, account: ChannelAccount) -> set[UUID] | None:
    """People who may handle the channel besides owners/admins. None = everyone."""
    from app.services.teams import get_team, team_user_ids

    entries = account_access(account)
    if any(e["kind"] == "team" and e["id"] == TEAM_KIND_PEOPLE and e["level"] == "handle" for e in entries):
        return None
    out: set[UUID] = set()
    for entry in entries:
        if entry["level"] != "handle":
            continue
        if entry["kind"] == "user":
            out.add(UUID(entry["id"]))
        elif entry["kind"] == "team" and entry["id"] not in SYSTEM_TEAM_KINDS:
            team = await get_team(session, account.tenant_id, UUID(entry["id"]))
            if team is not None:
                out.update(await team_user_ids(session, team))
    return out
