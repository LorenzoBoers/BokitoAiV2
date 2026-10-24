"""Who may see and handle a channel: one access list for people, agents and teams.

Stored on ``ChannelAccount.settings_json`` under ``access`` in the shared
``access_list`` shape with levels ``view`` < ``handle``. No list means
everyone (the All department). Owners and admins always handle every channel.

``view`` lets someone read the channel's conversations; ``handle`` also lets
them reply, take ownership and receive its conversations. For agents, a
missing entry means the agent may not act on the channel at all — except when
the list is the default (everyone).
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import ChannelAccount
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
from app.services.teams import ensure_org_root

__all__ = [
    "ACCESS_KINDS",
    "ACCESS_LEVELS",
    "UNRESTRICTED_ROLES",
    "Principal",
    "agent_principal",
    "user_principal",
]

ACCESS_LEVELS = ("view", "handle")


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
    return [{"kind": "user", "id": str(u), "level": "handle"} for u in users if u]


async def default_access(session: AsyncSession, tenant_id: UUID) -> list[dict[str, str]]:
    root = await ensure_org_root(session, tenant_id)
    return [{"kind": "department", "id": str(root.id), "level": "handle"}]


def account_access(account: ChannelAccount) -> list[dict[str, str]]:
    """Normalized access list for a channel (never raises).

    When nothing is stored, returns an empty list — callers treat that as
    default/everyone via ``is_default_access``.
    """
    settings = _settings(account)
    entries = normalize_entries(settings.get("access"), ACCESS_LEVELS)
    if entries is None:
        legacy = _legacy_access(settings)
        return legacy if legacy is not None else []
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
    from app.services.setup_links import replace_resource_grants

    await replace_resource_grants(
        session,
        account.tenant_id,
        "channel",
        settings.get("access") if isinstance(settings.get("access"), list) else [],
        channel_account_id=account.id,
    )


def access_level(account: ChannelAccount, principal: Principal) -> str | None:
    """``handle``, ``view`` or None for this principal on this channel."""
    if principal.unrestricted or is_default_access(account):
        return "handle"
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
    """Channels the user may see. None means unrestricted (owner/admin).

    A member scoped to departments gets a ``ConversationAccess`` set that also
    carries the department rule (services/department_access.py).
    """
    if role in UNRESTRICTED_ROLES:
        return None
    from app.services.department_access import scoped_access

    principal = await user_principal(
        session, tenant_id, user_id, role, include_system=False
    )
    ids = {a.id for a in await _accounts(session, tenant_id) if access_level(a, principal)}
    return await scoped_access(session, tenant_id, user_id, ids)


async def handled_channel_account_ids(
    session: AsyncSession, tenant_id: UUID, *, user_id: UUID, role: str
) -> set[UUID] | None:
    """Channels the user may handle. None means unrestricted (owner/admin)."""
    if role in UNRESTRICTED_ROLES:
        return None
    principal = await user_principal(
        session, tenant_id, user_id, role, include_system=False
    )
    return {
        a.id for a in await _accounts(session, tenant_id) if access_level(a, principal) == "handle"
    }


async def can_view_account(
    session: AsyncSession, account: ChannelAccount, *, user_id: UUID, role: str
) -> bool:
    if role in UNRESTRICTED_ROLES:
        return True
    principal = await user_principal(
        session, account.tenant_id, user_id, role, include_system=False
    )
    return access_level(account, principal) is not None


async def can_handle_account(
    session: AsyncSession, account: ChannelAccount, *, user_id: UUID, role: str
) -> bool:
    if role in UNRESTRICTED_ROLES:
        return True
    principal = await user_principal(
        session, account.tenant_id, user_id, role, include_system=False
    )
    return access_level(account, principal) == "handle"


async def agent_can_handle(
    session: AsyncSession, account: ChannelAccount | None, agent_id: UUID, *, signal: Any | None = None
) -> bool:
    """Whether an agent may act on a channel's conversations. No channel: allowed.

    With ``signal``, the crew of the department responsible for that conversation
    may always reply on it, also without access to the channel.
    """
    if account is None or is_default_access(account):
        return True
    principal = await agent_principal(session, account.tenant_id, agent_id)
    if access_level(account, principal) == "handle":
        return True
    if signal is None:
        return False
    return await crew_of_responsible(session, signal, agent_id)


async def crew_of_responsible(session: AsyncSession, signal: Any, agent_id: UUID) -> bool:
    """Whether the agent sits in the crew of the department responsible for ``signal``."""
    from app.models.team import is_root_department
    from app.services.department_domain import department_of_signal
    from app.services.teams import direct_department_ids, get_team

    department_id = await department_of_signal(session, signal)
    if department_id is None:
        return False
    department = await get_team(session, signal.tenant_id, department_id)
    if department is None or is_root_department(department):
        return False
    return department_id in await direct_department_ids(session, signal.tenant_id, "agent", agent_id)


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
    from app.services.teams import org_root, get_team, team_user_ids

    if is_default_access(account):
        return None
    entries = account_access(account)
    root = await org_root(session, account.tenant_id)
    if any(
        e["kind"] == "department" and e["id"] == str(root.id) and e["level"] == "handle"
        for e in entries
    ):
        return None
    out: set[UUID] = set()
    for entry in entries:
        if entry["level"] != "handle":
            continue
        if entry["kind"] == "user":
            out.add(UUID(entry["id"]))
        elif entry["kind"] == "department":
            try:
                team = await get_team(session, account.tenant_id, UUID(entry["id"]))
            except ValueError:
                continue
            if team is not None:
                out.update(await team_user_ids(session, team))
    return out
