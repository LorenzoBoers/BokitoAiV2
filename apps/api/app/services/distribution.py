"""Hand new team conversations straight to one member.

Teams with pickup ``round_robin`` or ``least_open`` do not wait for the first
responder: a new conversation owned by the team goes to an eligible member.

Eligible: a person who is available (not away, recently seen) with Handle
access on the channel, or an active agent with Handle access. Nobody eligible
leaves the conversation with the team, as with pickup ``people``.

- ``round_robin``: the next eligible member after ``Team.last_pick``.
- ``least_open``: the eligible member with the fewest open conversations they own.
"""

from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal, SignalEvent
from app.models.team import Team

DISTRIBUTING_PICKUPS = ("round_robin", "least_open")


async def _eligible(session: AsyncSession, team: Team, signal: Signal):
    from app.models.agent import Agent
    from app.models.auth import Membership, User
    from app.models.channel import ChannelAccount
    from app.services.channel_access import agent_can_handle, can_handle_account
    from app.services.presence import AVAILABLE, user_status
    from app.services.teams import team_members

    account = await session.get(ChannelAccount, signal.channel_account_id) if signal.channel_account_id else None
    now = datetime.utcnow()
    eligible = []
    for ref in await team_members(session, team):
        if ref.kind == "user":
            user = await session.get(User, ref.id)
            membership = (
                await session.execute(
                    select(Membership).where(
                        Membership.tenant_id == team.tenant_id, Membership.user_id == ref.id
                    )
                )
            ).scalar_one_or_none()
            if user is None or membership is None or not user.is_active or not membership.is_active:
                continue
            if user_status(user, now=now) != AVAILABLE:
                continue
            if account is not None and not await can_handle_account(
                session, account, user_id=user.id, role=membership.role
            ):
                continue
        else:
            agent = await session.get(Agent, ref.id)
            if agent is None or agent.tenant_id != team.tenant_id or not agent.is_active:
                continue
            if not await agent_can_handle(session, account, agent.id):
                continue
        eligible.append(ref)
    return eligible


async def _open_counts(session: AsyncSession, tenant_id: UUID) -> dict[str, int]:
    counts: dict[str, int] = {}
    rows = await session.execute(
        select(Signal.assignee_kind, Signal.assigned_user_id, Signal.agent_id, func.count())
        .where(
            Signal.tenant_id == tenant_id,
            Signal.status == "open",
            Signal.assignee_kind.in_(("user", "agent")),
        )
        .group_by(Signal.assignee_kind, Signal.assigned_user_id, Signal.agent_id)
    )
    for kind, user_id, agent_id, count in rows.all():
        member_id = user_id if kind == "user" else agent_id
        if member_id:
            key = f"{kind}:{member_id}"
            counts[key] = counts.get(key, 0) + int(count)
    return counts


def _next_in_turn(eligible, last_pick: str):
    keys = [ref.key for ref in eligible]
    if last_pick in keys:
        return eligible[(keys.index(last_pick) + 1) % len(eligible)]
    return eligible[0]


async def distribute(session: AsyncSession, signal: Signal) -> dict | None:
    """Give a new team-owned conversation to one member (caller commits).

    Returns ``{"kind", "id"}`` of the new owner, or None when it stays with the team.
    """
    from app.services.ai_handling import on_assignment_change
    from app.services.audit import record_audit
    from app.services.ownership import set_owner

    if signal.assignee_kind != "team" or not signal.assignee_team_id:
        return None
    team = await session.get(Team, signal.assignee_team_id)
    if team is None or team.pickup not in DISTRIBUTING_PICKUPS:
        return None
    eligible = sorted(await _eligible(session, team, signal), key=lambda ref: ref.key)
    if not eligible:
        return None
    if team.pickup == "round_robin":
        pick = _next_in_turn(eligible, team.last_pick)
    else:
        counts = await _open_counts(session, team.tenant_id)
        pick = min(eligible, key=lambda ref: (counts.get(ref.key, 0), ref.key))

    team_id = team.id
    set_owner(signal, pick.kind, pick.id)
    on_assignment_change(session, signal, before_assignee=None, before_kind="team", actor_id="system")
    team.last_pick = pick.key
    session.add(team)
    session.add(signal)
    payload = {
        "team_id": str(team_id),
        "team_name": team.name,
        "pickup": team.pickup,
        "owner_kind": pick.kind,
        "owner_id": str(pick.id),
    }
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="auto_assigned",
            actor_type="system",
            payload_json=json.dumps(payload),
        )
    )
    await record_audit(
        session,
        signal.tenant_id,
        action="team:auto_assign",
        actor_type="system",
        resource_type="signal",
        resource_id=str(signal.id),
        summary=f"{team.name} gave a new conversation to a member ({team.pickup})",
        payload=payload,
        commit=False,
    )
    return {"kind": pick.kind, "id": str(pick.id)}
