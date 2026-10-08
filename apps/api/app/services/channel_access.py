"""Who may see and handle a channel: one access list for people, agents and teams.

Stored on ``ChannelAccount.settings_json`` under ``access`` in the shared
``access_list`` shape with levels ``view`` < ``handle``. No list means
everyone: All people and All agents may handle the channel. Owners and
admins always handle every channel.

``view`` lets someone read the channel's conversations; ``handle`` also lets
them reply, take ownership and receive its conversations. For agents, a
missing entry means the agent may not act on the channel at all.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import ChannelAccount
from app.models.team import SYSTEM_TEAM_KINDS, TEAM_KIND_AGENTS, TEAM_KIND_PEOPLE
from app.services.access_list import (
    ACCESS_KINDS,
    UNRESTRICTED_ROLES,
    Principal,
    agent_principal,
    best_level,
    normalize_entries,
    user_principal,
    validate_entries,
)

__all__ = [
    "ACCESS_KINDS",
    "ACCESS_LEVELS",
    "UNRESTRICTED_ROLES",
    "Principal",
    "agent_principal",
    "user_principal",
]

ACCESS_LEVELS = ("view", "handle")

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
    entries = normalize_entries(settings.get("access"), ACCESS_LEVELS)
    if entries is None:
        legacy = _legacy_access(settings)
        return legacy if legacy is not None else [dict(e) for e in DEFAULT_ACCESS]
    return entries


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
    else:
        settings["access"] = await validate_entries(
            session, account.tenant_id, entries, ACCESS_LEVELS
        )
    account.settings_json = json.dumps(settings)


def access_level(account: ChannelAccount, principal: Principal) -> str | None:
    """``handle``, ``view`` or None for this principal on this channel."""
    return best_level(account_access(account), principal, ACCESS_LEVELS)


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
    if account is None or is_default_access(account):
        return True
    principal = await agent_principal(session, account.tenant_id, agent_id)
    return access_level(account, principal) == "handle"


async def agents_that_can_handle(
    session: AsyncSession,
    account: ChannelAccount | None,
    agent_ids: list[UUID],
) -> set[UUID]:
    """Which of ``agent_ids`` may handle the channel (one membership query)."""
    if not agent_ids:
        return set()
    if account is None or is_default_access(account):
        return set(agent_ids)
    from app.services.access_list import agent_principals

    principals = await agent_principals(session, account.tenant_id, agent_ids)
    return {
        aid
        for aid, principal in principals.items()
        if access_level(account, principal) == "handle"
    }


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
