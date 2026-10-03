"""Who an agent asks: the addressee of a decision.

Resolution, first match wins:

1. An explicit target from the tool call (``to``), routed ``fixed``.
2. The agent's "Ask questions to" setting (``settings_json.ask_target``), routed ``fixed``.
3. Automatic (routed ``auto``):
   a. the conversation owner when that is a person;
   b. whoever handed the agent the work (assigned the conversation or gave the task);
   c. the conversation's owner team, else the channel's owner team;
   d. All people.

A person who is away is skipped; the question goes to the next step.
Notifications for the decision go to the addressee only: the person, or the
people in the team.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Membership, User
from app.models.notification import DecisionRequest
from app.models.signal import Signal

ASK_TARGET_KINDS = ("auto", "user", "team")


@dataclass(frozen=True)
class Addressee:
    kind: str  # user | team
    user_id: UUID | None = None
    team_id: UUID | None = None
    routed_by: str = "auto"  # auto | fixed | rule

    def apply(self, decision: DecisionRequest) -> None:
        decision.addressee_kind = self.kind
        decision.addressee_user_id = self.user_id if self.kind == "user" else None
        decision.addressee_team_id = self.team_id if self.kind == "team" else None
        decision.routed_by = self.routed_by


def _uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value)) if value else None
    except (ValueError, TypeError):
        return None


def agent_ask_target(agent: Agent | None) -> dict[str, Any]:
    """``{"kind": "auto" | "user" | "team", "id": str | None}`` for an agent."""
    if agent is None:
        return {"kind": "auto", "id": None}
    try:
        settings = json.loads(agent.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    raw = settings.get("ask_target") if isinstance(settings, dict) else None
    if not isinstance(raw, dict):
        return {"kind": "auto", "id": None}
    kind = str(raw.get("kind") or "auto")
    target = _uuid(raw.get("id"))
    if kind not in ASK_TARGET_KINDS or (kind != "auto" and target is None):
        return {"kind": "auto", "id": None}
    return {"kind": kind, "id": str(target) if target else None}


def set_agent_ask_target(agent: Agent, kind: str, target_id: UUID | None) -> None:
    if kind not in ASK_TARGET_KINDS:
        raise ValueError("Invalid ask target")
    if kind != "auto" and target_id is None:
        raise ValueError("Missing ask target id")
    try:
        settings = json.loads(agent.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    if not isinstance(settings, dict):
        settings = {}
    if kind == "auto":
        settings.pop("ask_target", None)
    else:
        settings["ask_target"] = {"kind": kind, "id": str(target_id)}
    agent.settings_json = json.dumps(settings)


async def _available_member(session: AsyncSession, tenant_id: UUID, user_id: UUID | None) -> bool:
    """A workspace member who is not away."""
    if user_id is None:
        return False
    from sqlalchemy import select

    from app.services.presence import AWAY, user_status

    row = (
        await session.execute(
            select(User)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.tenant_id == tenant_id, User.id == user_id, User.is_active.is_(True))
        )
    ).scalar_one_or_none()
    return row is not None and user_status(row) != AWAY


async def _valid_team(session: AsyncSession, tenant_id: UUID, team_id: UUID | None) -> bool:
    if team_id is None:
        return False
    from app.services.teams import get_team

    return await get_team(session, tenant_id, team_id) is not None


async def _channel_team(session: AsyncSession, signal: Signal) -> UUID | None:
    if not signal.channel_account_id:
        return None
    from app.models.channel import ChannelAccount

    account = await session.get(ChannelAccount, signal.channel_account_id)
    if account is None:
        return None
    try:
        raw = (json.loads(account.settings_json or "{}").get("routing") or {}).get("team_id")
    except (json.JSONDecodeError, AttributeError):
        return None
    return _uuid(raw)


async def parse_target(
    session: AsyncSession, tenant_id: UUID, raw: Any
) -> dict[str, Any] | None:
    """Read a tool's ``to``: ``{"kind", "id"}`` or ``"user:<id|email>"`` / ``"team:<id|name>"``."""
    if isinstance(raw, dict):
        kind, ref = str(raw.get("kind") or ""), str(raw.get("id") or "")
    elif isinstance(raw, str) and ":" in raw:
        kind, ref = (part.strip() for part in raw.split(":", 1))
    else:
        return None
    if kind not in ("user", "team") or not ref:
        return None
    if _uuid(ref):
        return {"kind": kind, "id": ref}
    from sqlalchemy import func, select

    if kind == "user":
        row = (
            await session.execute(
                select(User.id)
                .join(Membership, Membership.user_id == User.id)
                .where(Membership.tenant_id == tenant_id, func.lower(User.email) == ref.lower())
            )
        ).first()
    else:
        from app.models.team import Team

        row = (
            await session.execute(
                select(Team.id).where(Team.tenant_id == tenant_id, func.lower(Team.name) == ref.lower())
            )
        ).first()
    return {"kind": kind, "id": str(row[0])} if row else None


async def _explicit(
    session: AsyncSession, tenant_id: UUID, target: dict[str, Any] | None
) -> Addressee | None:
    if not isinstance(target, dict):
        return None
    kind = str(target.get("kind") or "")
    target_id = _uuid(target.get("id"))
    if kind == "user" and await _available_member(session, tenant_id, target_id):
        return Addressee("user", user_id=target_id, routed_by="fixed")
    if kind == "team" and await _valid_team(session, tenant_id, target_id):
        return Addressee("team", team_id=target_id, routed_by="fixed")
    return None


async def resolve_addressee(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    agent_id: UUID | None = None,
    signal: Signal | None = None,
    requested_by: UUID | None = None,
    to: dict[str, Any] | None = None,
) -> Addressee:
    """Pick who a decision is addressed to; never returns nothing."""
    found = await _explicit(session, tenant_id, to)
    if found:
        return found
    agent = await session.get(Agent, agent_id) if agent_id else None
    if agent is not None and agent.tenant_id == tenant_id:
        target = agent_ask_target(agent)
        if target["kind"] != "auto":
            found = await _explicit(session, tenant_id, target)
            if found:
                return found
    if signal is not None:
        from app.models.auth import Tenant
        from app.services.routing_learning import rule_for_topic, topic_of

        rule = rule_for_topic(await session.get(Tenant, tenant_id), topic_of(signal))
        rule_user = _uuid(rule.get("user_id")) if rule else None
        if rule_user is not None and await _available_member(session, tenant_id, rule_user):
            return Addressee("user", user_id=rule_user, routed_by="rule")
    if signal is not None and signal.assignee_kind == "user":
        if await _available_member(session, tenant_id, signal.assigned_user_id):
            return Addressee("user", user_id=signal.assigned_user_id)
    giver = requested_by or (signal.assigned_by_user_id if signal is not None else None)
    if await _available_member(session, tenant_id, giver):
        return Addressee("user", user_id=giver)
    if signal is not None:
        if signal.assignee_kind == "team" and await _valid_team(session, tenant_id, signal.assignee_team_id):
            return Addressee("team", team_id=signal.assignee_team_id)
        channel_team = await _channel_team(session, signal)
        if await _valid_team(session, tenant_id, channel_team):
            return Addressee("team", team_id=channel_team)
    from app.services.teams import people_team

    return Addressee("team", team_id=(await people_team(session, tenant_id)).id)


async def addressee_user_ids(session: AsyncSession, decision: DecisionRequest) -> list[UUID]:
    """The people a decision notifies: the addressee, or the people in the team."""
    if decision.addressee_kind == "user" and decision.addressee_user_id:
        return [decision.addressee_user_id]
    if decision.addressee_kind == "team" and decision.addressee_team_id:
        from app.services.teams import get_team, team_user_ids

        team = await get_team(session, decision.tenant_id, decision.addressee_team_id)
        if team is not None:
            return await team_user_ids(session, team)
    return []


def addressee_payload(decision: DecisionRequest) -> dict[str, Any]:
    return {
        "kind": decision.addressee_kind or "",
        "user_id": str(decision.addressee_user_id) if decision.addressee_user_id else None,
        "team_id": str(decision.addressee_team_id) if decision.addressee_team_id else None,
        "routed_by": decision.routed_by or "",
    }
