"""Owner and turn of a conversation.

Owner: who is responsible. One person (``assigned_user_id``), one agent
(``agent_id``) or one team (``assignee_team_id``); ``assignee_kind`` says
which. Every conversation has an owner: without a person or agent it belongs
to the channel's owner team, else to All people. It only changes when someone
assigns or picks up.

Turn: who must act now. Derived after every flush that touches a
conversation, its messages or its decisions (``recompute``), stored for fast
"For you" queries. Rules, first match wins:

1. An open question or draft goes to its addressee (or the owner).
2. The customer spoke last: the owner (person, agent or team).
3. Internal threads: the agent when a person spoke last.
4. Otherwise the customer.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import and_, event, insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, attributes

from app.models.notification import DecisionRequest
from app.models.signal import EXTERNAL_CHANNELS, Signal, SignalMessage
from app.models.team import TEAM_KIND_PEOPLE, Team

OWNER_KINDS = ("user", "agent", "team")
TURN_FIELDS = ("turn_kind", "turn_user_id", "turn_team_id", "turn_reason")
DRAFT_TITLES = ("Suggested reply", "Reply to customer message")
INTERNAL_CHANNELS = ("internal", "assistant")
NO_REPLY_TITLE = "No reply needed"


# ── owner normalization (mapper events, sync connection) ─────────────


def _people_team_id(connection: Any, tenant_id: UUID) -> UUID:
    row = connection.execute(
        select(Team.id).where(Team.tenant_id == tenant_id, Team.kind == TEAM_KIND_PEOPLE).limit(1)
    ).first()
    if row:
        return row[0]
    team_id = uuid4()
    now = datetime.utcnow()
    connection.execute(
        insert(Team.__table__).values(
            id=team_id,
            tenant_id=tenant_id,
            name="All people",
            description="",
            kind=TEAM_KIND_PEOPLE,
            pickup="people",
            pinned=False,
            last_pick="",
            created_at=now,
            updated_at=now,
        )
    )
    return team_id


def _channel_team_id(connection: Any, signal: Signal) -> UUID | None:
    if not signal.channel_account_id:
        return None
    from app.models.channel import ChannelAccount

    row = connection.execute(
        select(ChannelAccount.settings_json).where(ChannelAccount.id == signal.channel_account_id)
    ).first()
    if not row:
        return None
    try:
        settings = json.loads(row[0] or "{}")
        raw = (settings.get("routing") or {}).get("team_id")
        return UUID(str(raw)) if raw else None
    except (ValueError, AttributeError, TypeError):
        return None


def default_team_id(connection: Any, signal: Signal) -> UUID:
    return _channel_team_id(connection, signal) or _people_team_id(connection, signal.tenant_id)


def _changed(target: Signal, name: str) -> bool:
    return attributes.get_history(target, name).has_changes()


def _normalize_owner(connection: Any, target: Signal, *, is_insert: bool) -> None:
    kind = target.assignee_kind or ""
    # A direct write to assigned_user_id (older paths) is an assignment to that person.
    if is_insert or _changed(target, "assigned_user_id"):
        if target.assigned_user_id is not None:
            kind = "user"
        elif kind == "user":
            kind = ""
    if kind == "user" and target.assigned_user_id is None:
        kind = ""
    if kind == "agent" and target.agent_id is None:
        kind = ""
    if kind == "team" and target.assignee_team_id is None:
        target.assignee_team_id = default_team_id(connection, target)
    if not kind:
        if (
            is_insert
            and target.agent_id is not None
            and target.channel in INTERNAL_CHANNELS
        ):
            kind = "agent"
        else:
            kind = "team"
            if target.assignee_team_id is None:
                target.assignee_team_id = default_team_id(connection, target)
    if kind != "user" and target.assigned_user_id is not None:
        target.assigned_user_id = None
    if kind != "team" and target.assignee_team_id is not None:
        target.assignee_team_id = None
    target.assignee_kind = kind


@event.listens_for(Signal, "before_insert")
def _signal_before_insert(_mapper, connection, target: Signal) -> None:
    _normalize_owner(connection, target, is_insert=True)


@event.listens_for(Signal, "before_update")
def _signal_before_update(_mapper, connection, target: Signal) -> None:
    if any(
        _changed(target, name)
        for name in ("assignee_kind", "assigned_user_id", "agent_id", "assignee_team_id")
    ):
        _normalize_owner(connection, target, is_insert=False)


# ── turn (session events) ─────────────────────────────────────────────


def _owner_target(signal: Signal) -> tuple[str, UUID | None, UUID | None]:
    if signal.assignee_kind == "user" and signal.assigned_user_id:
        return "user", signal.assigned_user_id, None
    if signal.assignee_kind == "agent" and signal.agent_id:
        return "agent", None, None
    return "team", None, signal.assignee_team_id


def compute_turn(session: Session, signal: Signal) -> tuple[str, UUID | None, UUID | None, str]:
    """(turn_kind, turn_user_id, turn_team_id, turn_reason) for a conversation."""
    if signal.status != "open":
        return "", None, None, ""
    decision = session.execute(
        select(DecisionRequest)
        .where(
            DecisionRequest.signal_id == signal.id,
            DecisionRequest.status == "awaiting_human",
        )
        .order_by(DecisionRequest.created_at.desc())
        .limit(1)
    ).scalars().first()
    if decision is not None and decision.title == NO_REPLY_TITLE:
        # The agent judged that nothing needs a reply; the card is a courtesy.
        return "", None, None, ""
    if decision is not None:
        reason = "draft_ready" if decision.title in DRAFT_TITLES else "question"
        if decision.addressee_kind == "user" and decision.addressee_user_id:
            return "user", decision.addressee_user_id, None, reason
        if decision.addressee_kind == "team" and decision.addressee_team_id:
            return "team", None, decision.addressee_team_id, reason
        kind, user_id, team_id = _owner_target(signal)
        if kind == "agent":
            # An agent asking itself makes no sense: the question goes to people.
            return "team", None, signal.assignee_team_id or None, reason
        return kind, user_id, team_id, reason

    last = session.execute(
        select(SignalMessage.direction, SignalMessage.kind)
        .where(
            SignalMessage.signal_id == signal.id,
            SignalMessage.kind.in_(("user_message", "agent_message")),
            or_(SignalMessage.send_status.is_(None), SignalMessage.send_status != "cancelled"),
        )
        .order_by(SignalMessage.created_at.desc())
        .limit(1)
    ).first()
    if signal.channel in EXTERNAL_CHANNELS:
        if last is None or last.direction == "inbound":
            kind, user_id, team_id = _owner_target(signal)
            return kind, user_id, team_id, "reply_needed"
        return "customer", None, None, ""
    if last is not None and last.kind == "user_message" and signal.agent_id:
        return "agent", None, None, ""
    return "", None, None, ""


def _apply_turn(session: Session, signal: Signal) -> None:
    kind, user_id, team_id, reason = compute_turn(session, signal)
    if kind == "team" and team_id is None:
        team_id = signal.assignee_team_id
    current = (signal.turn_kind, signal.turn_user_id, signal.turn_team_id, signal.turn_reason)
    if current != (kind, user_id, team_id, reason):
        signal.turn_kind = kind
        signal.turn_user_id = user_id
        signal.turn_team_id = team_id
        signal.turn_reason = reason


def _touches_turn(obj: Any) -> UUID | None:
    if isinstance(obj, Signal):
        state = attributes.instance_state(obj)
        if state.key is None:
            return obj.id
        relevant = (
            "status", "assignee_kind", "assigned_user_id", "agent_id", "assignee_team_id",
        )
        if any(_changed(obj, name) for name in relevant):
            return obj.id
        return None
    if isinstance(obj, SignalMessage):
        return obj.signal_id
    if isinstance(obj, DecisionRequest):
        return obj.signal_id
    return None


@event.listens_for(Session, "after_flush")
def _collect_turn_targets(session: Session, _ctx) -> None:
    pending: set[UUID] = session.info.setdefault("turn_pending", set())
    for obj in list(session.new) + list(session.dirty):
        sid = _touches_turn(obj)
        if sid:
            pending.add(sid)


@event.listens_for(Session, "after_flush_postexec")
def _recompute_turns(session: Session, _ctx) -> None:
    pending: set[UUID] = session.info.pop("turn_pending", set())
    if not pending or session.info.get("turn_running"):
        return
    session.info["turn_running"] = True
    try:
        with session.no_autoflush:
            for sid in pending:
                signal = session.get(Signal, sid)
                if signal is not None:
                    _apply_turn(session, signal)
    finally:
        session.info.pop("turn_running", None)


# ── queries ──────────────────────────────────────────────────────────


def for_you_predicate(
    user_id: UUID,
    team_ids: set[UUID],
    people_team_id: UUID | None = None,
):
    """Work in conversations that is yours.

    - you own it;
    - the turn is yours, or a custom team's you are in;
    - a question is addressed to All people;
    - you were mentioned and have not opened it since.

    Customer replies waiting on All people stay in Unassigned, not here.
    """
    from app.models.notification import Notification

    clauses = [
        and_(Signal.assignee_kind == "user", Signal.assigned_user_id == user_id),
        and_(Signal.turn_kind == "user", Signal.turn_user_id == user_id),
    ]
    custom = {t for t in team_ids if t != people_team_id}
    if custom:
        clauses.append(and_(Signal.turn_kind == "team", Signal.turn_team_id.in_(custom)))
        # Team-owned customer work belongs here. Standing group rooms do not —
        # they only appear when it is actually the team's turn.
        clauses.append(
            and_(
                Signal.assignee_kind == "team",
                Signal.assignee_team_id.in_(custom),
                Signal.source != "team",
            )
        )
    if people_team_id is not None:
        clauses.append(
            and_(
                Signal.turn_kind == "team",
                Signal.turn_team_id == people_team_id,
                Signal.turn_reason == "question",
            )
        )
    clauses.append(
        select(Notification.id)
        .where(
            Notification.signal_id == Signal.id,
            Notification.user_id == user_id,
            Notification.kind == "mention",
            Notification.status == "unread",
        )
        .exists()
    )
    return or_(*clauses)


def turn_is_mine_predicate(
    user_id: UUID,
    team_ids: set[UUID],
    people_team_id: UUID | None = None,
):
    """The subset of For you where you must act now (sorted first, counted on the badge)."""
    clauses = [and_(Signal.turn_kind == "user", Signal.turn_user_id == user_id)]
    custom = {t for t in team_ids if t != people_team_id}
    if custom:
        clauses.append(and_(Signal.turn_kind == "team", Signal.turn_team_id.in_(custom)))
    if people_team_id is not None:
        clauses.append(
            and_(
                Signal.turn_kind == "team",
                Signal.turn_team_id == people_team_id,
                Signal.turn_reason == "question",
            )
        )
    return or_(*clauses)


def unassigned_predicate():
    """Team-owned and not picked up by anyone yet."""
    return Signal.assignee_kind == "team"


async def my_teams(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> tuple[set[UUID], UUID]:
    """(custom team ids the user is in, the All people team id)."""
    from app.services.teams import people_team, user_team_ids

    custom = set(await user_team_ids(session, tenant_id, user_id, include_system=False))
    return custom, (await people_team(session, tenant_id)).id


async def for_you_clause(session: AsyncSession, tenant_id: UUID, user_id: UUID):
    teams, people_id = await my_teams(session, tenant_id, user_id)
    return for_you_predicate(user_id, teams, people_id)


async def turn_is_mine_clause(session: AsyncSession, tenant_id: UUID, user_id: UUID):
    teams, people_id = await my_teams(session, tenant_id, user_id)
    return turn_is_mine_predicate(user_id, teams, people_id)


# ── writes ───────────────────────────────────────────────────────────


def set_owner(
    signal: Signal,
    kind: str,
    owner_id: UUID | None,
    *,
    by_user_id: UUID | None = None,
) -> None:
    """Point the conversation at a new owner (caller commits)."""
    if kind not in OWNER_KINDS:
        raise ValueError("Invalid owner kind")
    signal.assignee_kind = kind
    signal.assigned_user_id = owner_id if kind == "user" else None
    signal.assignee_team_id = owner_id if kind == "team" else None
    if kind == "agent":
        signal.agent_id = owner_id
    signal.assigned_by_user_id = by_user_id


async def picked_up_event(
    session: AsyncSession, signal: Signal, user_id: UUID, team_id: UUID | None, *, via: str
):
    """Timeline event "Picked up by Lisa (via Support)"."""
    from app.models.signal import SignalEvent

    team = await session.get(Team, team_id) if team_id else None
    return SignalEvent(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        event_type="picked_up",
        actor_type="user",
        actor_id=str(user_id),
        payload_json=json.dumps(
            {
                "team_id": str(team_id) if team_id else None,
                "team_name": team.name if team is not None else "",
                "team_kind": team.kind if team is not None else "",
                "via": via,
            }
        ),
    )


async def pick_up(session: AsyncSession, signal: Signal, user_id: UUID, *, via: str) -> bool:
    """A team-owned conversation becomes the first responder's (caller commits).

    Returns False when someone (person or agent) already owns it.
    """
    if signal.assignee_kind != "team":
        return False
    from app.services.ai_handling import on_assignment_change

    team_id = signal.assignee_team_id
    set_owner(signal, "user", user_id, by_user_id=user_id)
    on_assignment_change(session, signal, before_assignee=None, before_kind="team", actor_id=str(user_id))
    session.add(signal)
    session.add(await picked_up_event(session, signal, user_id, team_id, via=via))
    return True


async def resolve_assignee(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    kind: str,
    raw_id: str | int | None,
) -> UUID:
    """Validate an assignment target; raises ValueError with an operator-facing reason.

    People and agents need Handle access on the conversation's channel.
    ``raw_id`` for a person may be the numeric inbox id or the UUID.
    """
    from app.models.agent import Agent
    from app.models.auth import Membership
    from app.models.channel import ChannelAccount
    from app.services.channel_access import agent_can_handle, can_handle_account
    from app.services.teams import get_team

    if kind not in OWNER_KINDS:
        raise ValueError("Invalid owner kind")
    if raw_id in (None, ""):
        if kind == "team":
            account = (
                await session.get(ChannelAccount, signal.channel_account_id)
                if signal.channel_account_id
                else None
            )
            team_id = None
            if account is not None:
                try:
                    raw = (json.loads(account.settings_json or "{}").get("routing") or {}).get("team_id")
                    team_id = UUID(str(raw)) if raw else None
                except (ValueError, AttributeError, TypeError):
                    team_id = None
            if team_id is None:
                from app.services.teams import people_team

                team_id = (await people_team(session, tenant_id)).id
            return team_id
        raise ValueError("Missing owner id")
    account = (
        await session.get(ChannelAccount, signal.channel_account_id)
        if signal.channel_account_id
        else None
    )
    if kind == "user":
        user_id: UUID | None = None
        if isinstance(raw_id, int) or str(raw_id).isdigit():
            user_map = await _user_num_map(session, tenant_id)
            user_id = user_map.get(int(raw_id))
        else:
            user_id = _as_uuid(raw_id)
        membership = (
            await session.execute(
                select(Membership).where(
                    Membership.tenant_id == tenant_id, Membership.user_id == user_id
                )
            )
        ).scalar_one_or_none() if user_id else None
        if membership is None:
            raise ValueError("Person not found")
        if account is not None and not await can_handle_account(
            session, account, user_id=user_id, role=membership.role
        ):
            raise ValueError("This person cannot handle this channel")
        return user_id
    target = _as_uuid(raw_id)
    if kind == "agent":
        agent = await session.get(Agent, target) if target else None
        if agent is None or agent.tenant_id != tenant_id:
            raise ValueError("Agent not found")
        if not await agent_can_handle(session, account, agent.id):
            raise ValueError("This agent cannot handle this channel")
        return agent.id
    team = await get_team(session, tenant_id, target) if target else None
    if team is None:
        raise ValueError("Team not found")
    return team.id


async def assignee_candidates(session: AsyncSession, tenant_id: UUID, signal: Signal) -> dict[str, Any]:
    """People, agents and teams for the assign picker and @mentions on this conversation.

    Everyone is listed; those without Handle access on the channel carry
    ``can_handle: False`` and ``reason: "no_channel_access"`` so the UI can grey them out.
    """
    from app.models.agent import Agent
    from app.models.auth import Membership, User, user_numeric_id
    from app.models.channel import ChannelAccount
    from app.services.channel_access import agent_can_handle, can_handle_account
    from app.services.presence import user_status
    from app.services.teams import list_teams

    account = (
        await session.get(ChannelAccount, signal.channel_account_id) if signal.channel_account_id else None
    )
    now = datetime.utcnow()
    people = []
    rows = await session.execute(
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.tenant_id == tenant_id,
            User.is_active.is_(True),
            Membership.is_active.is_(True),
        )
    )
    for user, membership in rows.all():
        ok = account is None or await can_handle_account(
            session, account, user_id=user.id, role=membership.role
        )
        people.append(
            {
                "id": user_numeric_id(user.id),
                "uuid": str(user.id),
                "name": user.display_name or user.email,
                "email": user.email,
                "avatar_url": user.avatar_url,
                "presence": user_status(user, now=now),
                "can_handle": ok,
                "reason": "" if ok else "no_channel_access",
            }
        )
    agents = []
    agent_rows = await session.execute(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.is_active.is_(True),
            Agent.kind == "company",
            Agent.acts_for_user.is_(False),
        )
    )
    from app.models.agent import AgentRun
    from app.services.teams import serialize_team
    from app.services.workforce_runtime import serialize_agent

    agent_list = list(agent_rows.scalars().all())
    running_ids: set[UUID] = set()
    if agent_list:
        running_ids = set(
            (
                await session.execute(
                    select(AgentRun.agent_id).where(
                        AgentRun.tenant_id == tenant_id,
                        AgentRun.agent_id.in_([a.id for a in agent_list]),
                        AgentRun.status == "running",
                    )
                )
            )
            .scalars()
            .all()
        )
    for agent in agent_list:
        ok = await agent_can_handle(session, account, agent.id)
        agents.append(
            {
                **serialize_agent(agent, view="picker", running=agent.id in running_ids),
                "can_handle": ok,
                "reason": "" if ok else "no_channel_access",
            }
        )
    teams = []
    for team in await list_teams(session, tenant_id):
        payload = await serialize_team(session, team)
        teams.append(
            {
                "id": payload["id"],
                "name": payload["name"],
                "kind": payload["kind"],
                "can_handle": True,
                "reason": "",
                "presence": payload["presence"],
                "avatar_kind": payload["avatar_kind"],
                "avatar_icon": payload["avatar_icon"],
                "avatar_color": payload["avatar_color"],
                "avatar_image_url": payload["avatar_image_url"],
            }
        )
    people.sort(key=lambda p: (not p["can_handle"], p["name"].lower()))
    agents.sort(key=lambda a: (not a["can_handle"], a["name"].lower()))
    return {"people": people, "agents": agents, "teams": teams}


def _as_uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        return None


async def _user_num_map(session: AsyncSession, tenant_id: UUID) -> dict[int, UUID]:
    from app.models.auth import Membership, user_numeric_id

    ids = (
        await session.execute(select(Membership.user_id).where(Membership.tenant_id == tenant_id))
    ).scalars().all()
    return {user_numeric_id(uid): uid for uid in ids}


def owner_payload(signal: Signal) -> dict[str, Any]:
    return {
        "kind": signal.assignee_kind or "team",
        "user_id": str(signal.assigned_user_id) if signal.assigned_user_id else None,
        "agent_id": str(signal.agent_id) if signal.assignee_kind == "agent" and signal.agent_id else None,
        "team_id": str(signal.assignee_team_id) if signal.assignee_team_id else None,
    }


def turn_payload(signal: Signal) -> dict[str, Any]:
    return {
        "kind": signal.turn_kind or "",
        "user_id": str(signal.turn_user_id) if signal.turn_user_id else None,
        "team_id": str(signal.turn_team_id) if signal.turn_team_id else None,
        "reason": signal.turn_reason or "",
    }
