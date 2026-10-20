"""Owner and turn of a conversation.

Owner: who is responsible. ``assignee_kind`` + ``assignee_id`` (polymorphic
user | agent | team). ``agent_id`` is the handling pin and may differ when a
team/person owns while an agent drafts. Every conversation has an owner:
without a person or agent it belongs to the channel's owner team, else to
All people. It only changes when someone assigns or picks up.

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
from app.models.team import ALL_DEPARTMENT_NAME, TEAM_KIND_CUSTOM, Team

OWNER_KINDS = ("user", "agent", "department")
TURN_FIELDS = ("turn_kind", "turn_ref_id", "turn_reason")
DRAFT_TITLES = ("Suggested reply", "Reply to customer message")
INTERNAL_CHANNELS = ("internal", "assistant")
NO_REPLY_TITLE = "No reply needed"


# ── owner normalization (mapper events, sync connection) ─────────────


def _all_department_id(connection: Any, tenant_id: UUID) -> UUID:
    """Sync fallback for the All root (mapper events have no AsyncSession)."""
    row = connection.execute(
        select(Team.id).where(
            Team.tenant_id == tenant_id,
            Team.parent_id.is_(None),
            Team.name == ALL_DEPARTMENT_NAME,
        ).limit(1)
    ).first()
    if row:
        return row[0]
    team_id = uuid4()
    now = datetime.utcnow()
    connection.execute(
        insert(Team.__table__).values(
            id=team_id,
            tenant_id=tenant_id,
            name=ALL_DEPARTMENT_NAME,
            description="",
            kind=TEAM_KIND_CUSTOM,
            pickup="people",
            pinned=True,
            last_pick="",
            settings_json="{}",
            parent_id=None,
            created_at=now,
            updated_at=now,
        )
    )
    return team_id


def routing_human_owner(settings: dict[str, Any] | None) -> tuple[str, UUID] | None:
    """Person or team set as the channel's human owner in ``settings.routing``.

    ``user_id`` wins when both are present. Empty / invalid values mean All.
    """
    routing = settings.get("routing") if isinstance(settings, dict) else None
    if not isinstance(routing, dict):
        return None
    for kind, key in (("user", "user_id"), ("department", "department_id"), ("department", "team_id")):
        raw = routing.get(key)
        if not raw:
            continue
        try:
            return kind, UUID(str(raw))
        except (ValueError, AttributeError, TypeError):
            continue
    return None


def _channel_human_owner(connection: Any, signal: Signal) -> tuple[str, UUID] | None:
    if not signal.channel_account_id:
        return None
    from app.models.channel import ChannelAccount

    row = connection.execute(
        select(ChannelAccount.settings_json).where(ChannelAccount.id == signal.channel_account_id)
    ).first()
    if not row:
        return None
    try:
        return routing_human_owner(json.loads(row[0] or "{}"))
    except (ValueError, AttributeError, TypeError, json.JSONDecodeError):
        return None


def _channel_team_id(connection: Any, signal: Signal) -> UUID | None:
    owner = _channel_human_owner(connection, signal)
    return owner[1] if owner and owner[0] == "department" else None


def default_team_id(connection: Any, signal: Signal) -> UUID:
    return _channel_team_id(connection, signal) or _all_department_id(connection, signal.tenant_id)


def _changed(target: Signal, name: str) -> bool:
    return attributes.get_history(target, name).has_changes()


def _normalize_owner(connection: Any, target: Signal, *, is_insert: bool) -> None:
    kind = target.assignee_kind or ""
    # A direct write to assignee_id is an assignment to that party when kind is set.
    if is_insert or _changed(target, "assignee_id"):
        if kind == "user" and target.assignee_id is None:
            kind = ""
    if kind == "user" and target.assignee_id is None:
        kind = ""
    if kind == "agent" and target.agent_id is None and target.assignee_id is None:
        kind = ""
    if kind == "agent" and target.assignee_id is None and target.agent_id is not None:
        target.assignee_id = target.agent_id
    if kind == "department" and target.assignee_id is None:
        target.assignee_id = default_team_id(connection, target)
    if not kind:
        if (
            is_insert
            and target.agent_id is not None
            and target.channel in INTERNAL_CHANNELS
        ):
            # A person opening a chat with an agent owns that conversation;
            # agent_id is the chat partner, not the assignee. Shared agent
            # channels (owner_user_id null) stay with the agent.
            if target.owner_user_id is not None:
                kind = "user"
                target.assignee_id = target.owner_user_id
            else:
                kind = "agent"
                target.assignee_id = target.agent_id
        else:
            channel_owner = _channel_human_owner(connection, target)
            if channel_owner and channel_owner[0] == "user":
                kind = "user"
                target.assignee_id = channel_owner[1]
            else:
                kind = "department"
                target.assignee_id = (
                    channel_owner[1]
                    if channel_owner and channel_owner[0] == "department"
                    else _all_department_id(connection, target.tenant_id)
                )
    target.assignee_kind = kind
    if kind == "agent" and target.assignee_id and not target.agent_id:
        target.agent_id = target.assignee_id


@event.listens_for(Signal, "before_insert")
def _signal_before_insert(_mapper, connection, target: Signal) -> None:
    _normalize_owner(connection, target, is_insert=True)


@event.listens_for(Signal, "before_update")
def _signal_before_update(_mapper, connection, target: Signal) -> None:
    if any(
        _changed(target, name)
        for name in ("assignee_kind", "assignee_id", "agent_id")
    ):
        _normalize_owner(connection, target, is_insert=False)


# ── turn (session events) ─────────────────────────────────────────────


def _owner_target(signal: Signal) -> tuple[str, UUID | None, UUID | None]:
    if signal.assignee_kind == "user" and signal.assignee_id:
        return "user", signal.assignee_id, None
    if signal.assignee_kind == "agent" and (signal.assignee_id or signal.agent_id):
        return "agent", None, None
    return "department", None, signal.assignee_id


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
        if decision.addressee_kind == "department" and decision.addressee_department_id:
            return "department", None, decision.addressee_department_id, reason
        kind, user_id, team_id = _owner_target(signal)
        if kind == "agent":
            # An agent asking itself makes no sense: the question goes to people.
            return "department", None, signal.assignee_team_id or None, reason
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
    if kind == "department" and team_id is None:
        team_id = signal.assignee_team_id
    ref_id = user_id or team_id
    current = (signal.turn_kind, signal.turn_ref_id, signal.turn_reason)
    if current != (kind, ref_id, reason):
        signal.turn_kind = kind
        signal.turn_ref_id = ref_id
        signal.turn_reason = reason


def _touches_turn(obj: Any) -> UUID | None:
    if isinstance(obj, Signal):
        state = attributes.instance_state(obj)
        if state.key is None:
            return obj.id
        relevant = (
            "status", "assignee_kind", "assignee_id", "agent_id",
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


def _unread_mention_exists(user_id: UUID):
    from app.models.notification import Notification

    return (
        select(Notification.id)
        .where(
            Notification.signal_id == Signal.id,
            Notification.user_id == user_id,
            Notification.kind == "mention",
            Notification.status == "unread",
        )
        .exists()
    )


def for_you_predicate(
    user_id: UUID,
    team_ids: set[UUID] | None = None,
    all_department_id: UUID | None = None,
):
    """Assigned to you, plus a question or draft addressed to you, plus an unread mention.

    Team ownership and a team's turn stay in Unassigned. A customer who asked
    for a person stays there until someone picks the conversation up.
    ``team_ids`` and ``all_department_id`` are accepted so older callers keep
    working; membership no longer widens this queue.
    """
    del team_ids, all_department_id
    return or_(
        and_(Signal.assignee_kind == "user", Signal.assignee_id == user_id),
        and_(
            Signal.turn_kind == "user",
            Signal.turn_ref_id == user_id,
            Signal.turn_reason.in_(("question", "draft_ready")),
        ),
        _unread_mention_exists(user_id),
    )


def turn_is_mine_predicate(
    user_id: UUID,
    team_ids: set[UUID] | None = None,
    all_department_id: UUID | None = None,
):
    """The subset of Assigned to me where you must act now (sorted first, counted on the badge).

    Your turn (a reply, a question or a draft) or an unread mention. A reply
    you already sent stays in the list and does not count.
    """
    del team_ids, all_department_id
    return or_(
        and_(Signal.turn_kind == "user", Signal.turn_ref_id == user_id),
        _unread_mention_exists(user_id),
    )


def unassigned_predicate():
    """Team-owned and not picked up, and not waiting on one person.

    A question or draft addressed to a person leaves this queue and sits in
    Assigned to me for that person.
    """
    return and_(
        Signal.assignee_kind == "department",
        or_(
            Signal.turn_kind != "user",
            Signal.turn_reason.notin_(("question", "draft_ready")),
        ),
    )


async def my_teams(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> tuple[set[UUID], UUID]:
    """(custom department ids the user is in, the All root id)."""
    from app.services.teams import all_department, user_team_ids

    custom = set(await user_team_ids(session, tenant_id, user_id, include_system=False))
    return custom, (await all_department(session, tenant_id)).id


async def for_you_clause(session: AsyncSession, tenant_id: UUID, user_id: UUID):
    teams, all_id = await my_teams(session, tenant_id, user_id)
    return for_you_predicate(user_id, teams, all_id)


async def turn_is_mine_clause(session: AsyncSession, tenant_id: UUID, user_id: UUID):
    teams, all_id = await my_teams(session, tenant_id, user_id)
    return turn_is_mine_predicate(user_id, teams, all_id)


# ── writes ───────────────────────────────────────────────────────────


def set_owner(
    signal: Signal,
    kind: str,
    owner_id: UUID | None,
    *,
    by_user_id: UUID | None = None,
) -> None:
    """Point the conversation at a new owner (caller commits).

    A person or team owner is also remembered as ``last_human_owner_*`` so the
    conversation can return there when an agent hands it back.

    Prefer :func:`apply_owner` when an async session is available so the
    participant roster stays in sync.
    """
    if kind not in OWNER_KINDS:
        raise ValueError("Invalid owner kind")
    signal.assignee_kind = kind
    signal.assignee_id = owner_id
    if kind == "agent":
        signal.agent_id = owner_id
    else:
        remember_human_owner(signal, kind, owner_id)
    signal.assigned_by_user_id = by_user_id


async def apply_owner(
    session: AsyncSession,
    signal: Signal,
    kind: str,
    owner_id: UUID | None,
    *,
    by_user_id: UUID | None = None,
) -> None:
    """``set_owner`` plus participant roster sync."""
    set_owner(signal, kind, owner_id, by_user_id=by_user_id)
    from app.services.participants import sync_owner_participant

    await sync_owner_participant(session, signal)


def remember_human_owner(signal: Signal, kind: str, owner_id: UUID | None) -> None:
    """Record the last person or team that handled this conversation."""
    if kind == "user" and owner_id is not None:
        signal.last_human_owner_json = json.dumps({"kind": "user", "id": str(owner_id)})
    elif kind == "department" and owner_id is not None:
        signal.last_human_owner_json = json.dumps({"kind": "department", "id": str(owner_id)})


def human_owner_payload(signal: Signal) -> dict[str, Any] | None:
    try:
        data = json.loads(signal.last_human_owner_json or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        data = {}
    if not isinstance(data, dict):
        return None
    kind = str(data.get("kind") or "")
    raw_id = data.get("id")
    if kind in ("user", "department") and raw_id:
        return {"kind": kind, "id": str(raw_id)}
    return None


async def _active_member(session: AsyncSession, tenant_id: UUID, user_id: UUID | None) -> bool:
    if user_id is None:
        return False
    from app.models.auth import Membership

    membership = (
        await session.execute(
            select(Membership).where(
                Membership.tenant_id == tenant_id, Membership.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    return membership is not None


async def _team_exists(session: AsyncSession, tenant_id: UUID, team_id: UUID | None) -> bool:
    if team_id is None:
        return False
    team = await session.get(Team, team_id)
    return team is not None and team.tenant_id == tenant_id


async def contact_owner(
    session: AsyncSession, tenant_id: UUID, contact: Any
) -> tuple[str, UUID] | None:
    """Validated ``(kind, id)`` owner of a contact, following merges."""
    if contact is None:
        return None
    if getattr(contact, "merged_into_id", None):
        from app.models.channel import Contact

        merged = await session.get(Contact, contact.merged_into_id)
        if merged is not None and merged.tenant_id == tenant_id:
            contact = merged
    kind = getattr(contact, "owner_kind", "") or ""
    if kind == "user" and await _active_member(session, tenant_id, contact.owner_user_id):
        return "user", contact.owner_user_id
    if kind == "department" and await _team_exists(session, tenant_id, contact.owner_department_id):
        return "department", contact.owner_department_id
    return None


async def channel_human_owner(
    session: AsyncSession, signal: Signal
) -> tuple[str, UUID] | None:
    """Person or team set as the channel's human owner, when still valid."""
    if not signal.channel_account_id:
        return None
    from app.models.channel import ChannelAccount

    account = await session.get(ChannelAccount, signal.channel_account_id)
    if account is None:
        return None
    try:
        owner = routing_human_owner(json.loads(account.settings_json or "{}"))
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    if owner is None:
        return None
    kind, owner_id = owner
    if kind == "user" and await _active_member(session, signal.tenant_id, owner_id):
        return "user", owner_id
    if kind == "department" and await _team_exists(session, signal.tenant_id, owner_id):
        return "department", owner_id
    return None


async def human_fallback_owner(
    session: AsyncSession, signal: Signal, *, contact: Any = None
) -> tuple[str, UUID]:
    """Where a conversation lands when it leaves the agent.

    Chain: last human owner (still a member / existing team) -> contact owner
    -> channel owner (person or team) -> All people. Never returns an agent.
    """
    tenant_id = signal.tenant_id
    kind = signal.last_human_owner_kind or ""
    if kind == "user" and await _active_member(session, tenant_id, signal.last_human_owner_user_id):
        return "user", signal.last_human_owner_user_id  # type: ignore[return-value]
    if kind == "department" and await _team_exists(session, tenant_id, signal.last_human_owner_department_id):
        return "department", signal.last_human_owner_department_id  # type: ignore[return-value]
    if contact is None and signal.contact_id:
        from app.models.channel import Contact

        contact = await session.get(Contact, signal.contact_id)
    owner = await contact_owner(session, tenant_id, contact)
    if owner is not None:
        return owner
    channel_owner = await channel_human_owner(session, signal)
    if channel_owner is not None:
        return channel_owner
    team_id = await resolve_assignee(session, tenant_id, signal, "department", None)
    return "department", team_id


async def route_new_conversation(
    session: AsyncSession,
    signal: Signal,
    *,
    tenant: Any = None,
    account: Any = None,
    contact: Any = None,
) -> dict[str, Any] | None:
    """Pick the first owner of a new external conversation (caller commits).

    1. An inbox rule already assigned a person: keep it.
    2. The contact has an owner and the agent may not take the conversation
       (manual, held, no channel agent): that person or team owns it.
    3. The channel agent may own it (autonomous or assisted): the agent owns
       it first; a contact owner is remembered as the person it hands to.
    4. Otherwise the channel owner team owns it and ``distribute`` may hand
       it to a person straight away.

    Returns the ``auto_assigned`` event payload when the owner changed.
    """
    from app.models.signal import SignalEvent
    from app.services.distribution import distribute

    if signal.channel in INTERNAL_CHANNELS:
        return None
    if signal.assignee_kind == "user" and signal.assigned_user_id is not None:
        return None

    tenant_id = signal.tenant_id
    if tenant is None:
        from app.models.auth import Tenant

        tenant = await session.get(Tenant, tenant_id)
    from app.services import ai_handling
    from app.services.routing import resolve_inbound_agent_for_signal

    if account is None or contact is None:
        loaded_account, loaded_contact = await ai_handling.load_layers(session, tenant_id, signal)
        account = account or loaded_account
        contact = contact or loaded_contact
    agent = await resolve_inbound_agent_for_signal(session, signal)
    handling = await ai_handling.resolve_for_signal(session, tenant, signal, agent=agent)
    agent_can_own = await agent_may_own(session, signal, agent=agent, account=account, tenant=tenant, handling=handling)

    owner = await contact_owner(session, tenant_id, contact)
    payload: dict[str, Any] | None = None
    if owner is not None and not agent_can_own:
        kind, owner_id = owner
        set_owner(signal, kind, owner_id)
        payload = {"kind": kind, "id": str(owner_id), "reason": "contact_owner"}
    elif agent_can_own and agent is not None:
        set_owner(signal, "agent", agent.id)
        if owner is not None:
            # The agent answers first; the contact owner is where it escalates.
            remember_human_owner(signal, owner[0], owner[1])
        payload = {
            "kind": "agent",
            "id": str(agent.id),
            "agent_name": getattr(agent, "name", ""),
            "reason": "assisted" if handling.effective == "assisted" else "autonomous",
        }
    if payload is not None:
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant_id,
                event_type="auto_assigned",
                actor_type="system",
                actor_id="",
                payload_json=json.dumps(payload),
            )
        )
        return payload
    return await distribute(session, signal)


async def agent_may_own(
    session: AsyncSession,
    signal: Signal,
    *,
    agent: Any,
    account: Any = None,
    tenant: Any = None,
    handling: Any = None,
) -> bool:
    """Whether this agent may own the conversation.

    The agent owns the next step when the effective AI handling is autonomous
    (it sends) or assisted (it prepares a draft, context and actions, then hands
    the conversation to a person). Manual, a hold, an internal channel or an
    autonomous channel that cannot deliver rule it out.
    """
    if agent is None or signal.channel in INTERNAL_CHANNELS:
        return False
    from app.services import ai_handling

    if handling is None:
        if tenant is None:
            from app.models.auth import Tenant

            tenant = await session.get(Tenant, signal.tenant_id)
        if account is None:
            account, _contact = await ai_handling.load_layers(session, signal.tenant_id, signal)
        handling = await ai_handling.resolve_for_signal(session, tenant, signal, agent=agent)
    if handling.effective not in ("autonomous", "assisted"):
        return False
    if handling.effective == "autonomous" and signal.channel_account_id:
        from app.models.channel import ChannelAccount
        from app.services.channel_registry import account_can_send

        if account is None:
            account = await session.get(ChannelAccount, signal.channel_account_id)
        if account is not None and not account_can_send(account):
            return False
    return True


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
    if signal.assignee_kind != "department":
        return False
    from app.services.ai_handling import on_assignment_change

    team_id = signal.assignee_team_id
    set_owner(signal, "user", user_id, by_user_id=user_id)
    on_assignment_change(session, signal, before_assignee=None, before_kind="department", actor_id=str(user_id))
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
        if kind == "department":
            channel_owner = await channel_human_owner(session, signal)
            if channel_owner and channel_owner[0] == "department":
                return channel_owner[1]
            from app.services.teams import all_department

            return (await all_department(session, tenant_id)).id
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
    from app.services.presence import connected_user_ids_for, visible_user_status
    from app.services.teams import list_teams

    account = (
        await session.get(ChannelAccount, signal.channel_account_id) if signal.channel_account_id else None
    )
    now = datetime.utcnow()
    connected = connected_user_ids_for(tenant_id)
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
                "presence": visible_user_status(
                    user, connected=str(user.id) in connected, now=now
                ),
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
                "system": bool(payload.get("system")),
                "can_handle": True,
                "reason": "",
                "presence": payload["presence"],
                "members": payload["members"],
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
    kind = signal.assignee_kind or "department"
    owner_id = str(signal.assignee_id) if signal.assignee_id else None
    return {
        "kind": kind,
        "id": owner_id,
        "user_id": owner_id if kind == "user" else None,
        "agent_id": owner_id if kind == "agent" else (
            str(signal.agent_id) if signal.agent_id else None
        ),
        "team_id": owner_id if kind == "department" else None,
    }


def turn_payload(signal: Signal) -> dict[str, Any]:
    kind = signal.turn_kind or ""
    ref = str(signal.turn_ref_id) if signal.turn_ref_id else None
    return {
        "kind": kind,
        "id": ref,
        "user_id": ref if kind == "user" else None,
        "team_id": ref if kind == "department" else None,
        "reason": signal.turn_reason or "",
    }
