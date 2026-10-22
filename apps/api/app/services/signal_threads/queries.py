"""Conversation list, thread detail, and attention counts."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.agent import Agent
from app.models.channel import ChannelAccount, Contact
from app.models.notification import DecisionRequest
from app.models.signal import (
    EXTERNAL_CHANNELS,
    Signal,
    SignalEvent,
    SignalMessage,
    is_internal_channel,
)
from app.services.ownership import (
    for_you_clause,
    turn_is_mine_clause,
    unassigned_predicate,
)

logger = logging.getLogger(__name__)



# Presets for the Communication list date filter (`activity=` / URL `date=`).
_ACTIVITY_PRESETS = frozenset({"today", "7d", "30d", "90d"})


def _activity_cutoff(preset: str) -> datetime | None:
    """Lower bound for ``Signal.last_message_at`` from a date-filter preset."""
    key = (preset or "").strip().lower()
    if key not in _ACTIVITY_PRESETS:
        return None
    now = utcnow()
    if key == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    days = {"7d": 7, "30d": 30, "90d": 90}[key]
    return now - timedelta(days=days)


def _open_decision_filters(
    tenant_id: UUID, *, signal_ids: list[UUID] | None = None, tip_cards: bool = False
) -> list[Any]:
    """Shared WHERE clauses for awaiting decisions.

    Personal assistant chats and "No reply needed" tip cards are not operator
    blockers, so every attention count and the Decisions queue skip them.
    ``tip_cards`` selects only the tip cards instead.
    """
    from app.services.automated_mail import NO_REPLY_DECISION_TITLE

    filters: list[Any] = [
        Signal.tenant_id == tenant_id,
        Signal.channel != "assistant",
        Signal.status.notin_(("closed", "spam")),
        SignalMessage.kind == "decision_request",
        DecisionRequest.status == "awaiting_human",
        (
            DecisionRequest.title == NO_REPLY_DECISION_TITLE
            if tip_cards
            else DecisionRequest.title != NO_REPLY_DECISION_TITLE
        ),
    ]
    if signal_ids is not None:
        if not signal_ids:
            filters.append(Signal.id.is_(None))
        else:
            filters.append(Signal.id.in_(signal_ids))
    return filters


async def _signals_with_open_decisions(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    signal_ids: list[UUID] | None = None,
) -> set[UUID]:
    """Signals with a real awaiting decision (reply draft, tool gate, escalate).

    Excludes "No reply needed" tip cards on automated mail — those must not
    inflate Agents / Cockpit attention counts or the Decisions queue.
    Pass ``signal_ids`` to scope to a list page instead of the whole tenant.
    """
    result = await session.execute(
        select(Signal.id)
        .join(SignalMessage, SignalMessage.signal_id == Signal.id)
        .join(DecisionRequest, DecisionRequest.id == SignalMessage.decision_id)
        .where(*_open_decision_filters(tenant_id, signal_ids=signal_ids))
    )
    return {row for row in result.scalars().all()}


async def _signal_has_open_decision(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID
) -> bool:
    """EXISTS check for one thread — used by get_thread."""
    result = await session.execute(
        select(Signal.id)
        .join(SignalMessage, SignalMessage.signal_id == Signal.id)
        .join(DecisionRequest, DecisionRequest.id == SignalMessage.decision_id)
        .where(*_open_decision_filters(tenant_id, signal_ids=[signal_id]))
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


# Peek size for search hits that miss the current queue or filters.
_OUTSIDE_SEARCH_LIMIT = 12


def _search_predicate(
    session: AsyncSession,
    tenant_id: UUID,
    search: str,
    *,
    fts_param: str = "fts_query",
):
    """Match subject, contact, company, attachment name, or message text."""
    like = f"%{search}%"
    bind = getattr(session, "bind", None)
    if bind is not None and bind.dialect.name == "postgresql":
        body_pred = sa_text(
            "to_tsvector('simple', coalesce(signal_messages.subject, '') || ' ' "
            "|| coalesce(signal_messages.body_text, '')) "
            f"@@ plainto_tsquery('simple', :{fts_param})"
        ).bindparams(**{fts_param: search})
    else:
        body_pred = SignalMessage.body_text.ilike(like)
    body_match = (
        select(SignalMessage.id)
        .where(
            SignalMessage.signal_id == Signal.id,
            SignalMessage.tenant_id == tenant_id,
            body_pred,
        )
        .exists()
    )
    company_match = (
        select(Contact.id)
        .where(
            Contact.id == Signal.contact_id,
            Contact.tenant_id == tenant_id,
            Contact.company.ilike(like),
        )
        .exists()
    )
    attachment_match = (
        select(SignalMessage.id)
        .where(
            SignalMessage.signal_id == Signal.id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.attachments_json.ilike(like),
        )
        .exists()
    )
    return (
        Signal.subject.ilike(like)
        | Signal.contact_email.ilike(like)
        | Signal.contact_name.ilike(like)
        | body_match
        | company_match
        | attachment_match
    )


def _visibility_predicate(visible_account_ids: set[UUID] | None):
    """Signal-level ACL clause; threads without an account stay visible.

    A department-scoped member also needs the department rule.
    """
    if visible_account_ids is None:
        return None
    from app.services.department_access import department_predicate

    channel = or_(
        Signal.channel_account_id.is_(None),
        Signal.channel_account_id.in_(visible_account_ids) if visible_account_ids else Signal.id.is_(None),
    )
    departments = department_predicate(visible_account_ids)
    return channel if departments is None else and_(channel, departments)


def _decision_join(*columns):
    return (
        select(*columns)
        .select_from(Signal)
        .join(SignalMessage, SignalMessage.signal_id == Signal.id)
        .join(DecisionRequest, DecisionRequest.id == SignalMessage.decision_id)
    )


async def attention_counts(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None = None,
    *,
    by_agent: bool = False,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, Any]:
    """What waits on people: the one source for nav badges, the bell, Cockpit and agents.

    ``for_you`` (only with ``user_id``) counts open conversations where you must
    act now (your turn, or an unread mention). ``decisions`` counts conversations
    with a real awaiting decision;
    ``no_reply_suggestions`` counts the tip cards kept out of ``decisions``.
    ``by_agent`` adds ``decisions_by_agent`` keyed by the owning agent id.
    """
    decisions = int(
        (
            await session.execute(
                _decision_join(func.count(func.distinct(Signal.id))).where(
                    *_open_decision_filters(tenant_id)
                )
            )
        ).scalar_one()
        or 0
    )
    no_reply = int(
        (
            await session.execute(
                _decision_join(func.count(func.distinct(Signal.id))).where(
                    *_open_decision_filters(tenant_id, tip_cards=True)
                )
            )
        ).scalar_one()
        or 0
    )
    out: dict[str, Any] = {"decisions": decisions, "no_reply_suggestions": no_reply}

    if user_id is not None:
        stmt = select(func.count()).select_from(Signal).where(
            Signal.tenant_id == tenant_id,
            Signal.status == "open",
            _hub_predicate(user_id),
            await turn_is_mine_clause(session, tenant_id, user_id),
        )
        acl = _visibility_predicate(visible_account_ids)
        if acl is not None:
            stmt = stmt.where(acl)
        out["for_you"] = int((await session.execute(stmt)).scalar_one() or 0)

    if by_agent:
        rows = (
            await session.execute(
                _decision_join(Signal.agent_id, func.count(func.distinct(Signal.id)))
                .where(*_open_decision_filters(tenant_id), Signal.agent_id.is_not(None))
                .group_by(Signal.agent_id)
            )
        ).all()
        out["decisions_by_agent"] = {agent_id: int(n) for agent_id, n in rows}
    return out


async def nav_badge_counts(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    include_agents_attention: bool,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, Any]:
    """Lightweight unread and list totals for sidebar badges (no thread payloads).

    ``for_you`` stays the turn count (bell and cockpit). Sidebar rows use
    ``*_unread`` and ``*_total``; totals match the Open side of the list switch.
    Counts are open hub threads only (never closed, spam, pending, or Bin).
    """
    from app.services.trash import alive

    tenant = Signal.tenant_id == tenant_id
    # Closed / spam / snoozed never inflate Unassigned or All unread badges.
    open_status = Signal.status == "open"
    unread = Signal.has_unread.is_(True)
    not_trashed = alive(Signal)
    acl = _visibility_predicate(visible_account_ids)

    async def _count(*filters) -> int:
        stmt = select(func.count()).select_from(Signal).where(tenant, not_trashed, *filters)
        if acl is not None:
            stmt = stmt.where(acl)
        return int((await session.execute(stmt)).scalar_one() or 0)

    hub_inbox = _hub_predicate(user_id)
    for_you = await for_you_clause(session, tenant_id, user_id)
    attention = await attention_counts(
        session, tenant_id, user_id, visible_account_ids=visible_account_ids
    )
    for_you_count = attention["for_you"]
    for_you_unread = await _count(open_status, unread, hub_inbox, for_you)
    for_you_total = await _count(open_status, hub_inbox, for_you)
    unassigned_clause = unassigned_predicate()
    unassigned_unread = await _count(open_status, unread, hub_inbox, unassigned_clause)
    unassigned_total = await _count(open_status, hub_inbox, unassigned_clause)
    all_unread = await _count(open_status, unread, hub_inbox)
    all_total = await _count(open_status, hub_inbox)

    agents_attention = attention["decisions"] if include_agents_attention else 0
    no_reply_suggestions = attention["no_reply_suggestions"] if include_agents_attention else 0

    from app.models.team import Team
    from app.services.time_items import due_for_user
    from app.services.trash import alive as team_alive

    # Custom departments (not the All root) are Communication folders.
    sidebar_teams = (
        await session.execute(
            select(Team.id).where(
                Team.tenant_id == tenant_id,
                Team.parent_id.is_not(None),
                team_alive(Team),
            )
        )
    ).scalars().all()
    by_team: dict[str, int] = {}
    for team_id in sidebar_teams:
        by_team[str(team_id)] = await _count(
            open_status,
            hub_inbox,
            or_(
                and_(Signal.turn_kind == "department", Signal.turn_ref_id == team_id),
                and_(
                    Signal.assignee_kind == "department",
                    Signal.assignee_id == team_id,
                    unread,
                ),
            ),
        )

    return {
        # Rail and the All communication row use unread, not whose turn it is.
        "inbox_unread": all_unread,
        "inbox_by_queue": {
            "for_you": for_you_count,
            "for_you_unread": for_you_unread,
            "for_you_total": for_you_total,
            "unassigned": unassigned_unread,
            "unassigned_total": unassigned_total,
            "all": all_unread,
            "all_total": all_total,
        },
        "by_team": by_team,
        "agents_attention": agents_attention,
        "no_reply_suggestions": no_reply_suggestions,
        "agenda_due": await due_for_user(session, tenant_id, user_id),
    }


def _exists_message_kind(tenant_id: UUID, kind: str):
    """EXISTS predicate: this Signal has at least one message of ``kind``."""
    return (
        select(SignalMessage.id)
        .where(
            SignalMessage.signal_id == Signal.id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == kind,
        )
        .exists()
    )


def _exists_open_decision(*, tip_cards: bool = False):
    """EXISTS predicate: this Signal has an awaiting decision (or tip card).

    Mirrors ``_open_decision_filters`` without materializing every matching
    signal id for the tenant into Python.
    """
    from app.services.automated_mail import NO_REPLY_DECISION_TITLE

    title_clause = (
        DecisionRequest.title == NO_REPLY_DECISION_TITLE
        if tip_cards
        else DecisionRequest.title != NO_REPLY_DECISION_TITLE
    )
    return (
        select(SignalMessage.id)
        .join(DecisionRequest, DecisionRequest.id == SignalMessage.decision_id)
        .where(
            SignalMessage.signal_id == Signal.id,
            Signal.channel != "assistant",
            Signal.status.notin_(("closed", "spam")),
            SignalMessage.kind == "decision_request",
            DecisionRequest.status == "awaiting_human",
            title_clause,
        )
        .exists()
    )


def _exists_outbound_message(tenant_id: UUID):
    """EXISTS predicate: this Signal has at least one outbound message."""
    return (
        select(SignalMessage.id)
        .where(
            SignalMessage.signal_id == Signal.id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.direction == "outbound",
        )
        .exists()
    )


def _needs_reply_predicate(tenant_id: UUID):
    """Open thread where the other side spoke last (or it is unread).

    "Spoke last" compares the newest inbound user message with the newest
    real outbound reply; mock/placeholder bodies do not count as a reply.
    """
    last_user = (
        select(SignalMessage.signal_id, func.max(SignalMessage.created_at).label("at"))
        .where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "user_message",
            SignalMessage.direction == "inbound",
        )
        .group_by(SignalMessage.signal_id)
        .subquery()
    )
    last_agent = (
        select(SignalMessage.signal_id, func.max(SignalMessage.created_at).label("at"))
        .where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.direction == "outbound",
            # Outbound system_event = "handled outside Bokito": counts as answered.
            SignalMessage.kind.in_(("user_message", "agent_message", "system_event")),
            # Same skip as list previews: mock/placeholder bodies are not a reply.
            ~func.lower(SignalMessage.body_text).like("[mock]%"),
            ~func.lower(SignalMessage.body_text).like("i received your message about:%"),
        )
        .group_by(SignalMessage.signal_id)
        .subquery()
    )
    inbound_last = (
        select(last_user.c.signal_id)
        .select_from(last_user.outerjoin(last_agent, last_user.c.signal_id == last_agent.c.signal_id))
        .where(or_(last_agent.c.at.is_(None), last_user.c.at > last_agent.c.at))
    )
    return and_(
        Signal.status == "open",
        or_(Signal.has_unread.is_(True), Signal.id.in_(inbound_last)),
    )


def _hub_predicate(user_id: UUID, *, include_runs: bool = False):
    """Conversations in All communication.

    Customer channels, assistant chats the operator may see (not inline
    agent sessions — those live on their host thread), and agent work
    threads once a person must act on them. Agenda threads (tasks,
    appointments, repeating wakes) always show. Filtering on one agent shows
    all of that agent's threads, including its runs. Private Bokito helper
    chats (source=personal) stay in the in-app widget, not this hub.
    """
    from app.services.personal_assistant import PERSONAL_THREAD_SOURCE
    from app.services.thread_schedule import SCHEDULE_SOURCE

    clauses = [
        Signal.channel.notin_(("internal", "assistant")),
        and_(
            Signal.channel == "assistant",
            Signal.source != PERSONAL_THREAD_SOURCE,
            Signal.context_signal_id.is_(None),
            or_(Signal.owner_user_id == user_id, Signal.owner_user_id.is_(None)),
        ),
    ]
    if include_runs:
        clauses.append(Signal.channel == "internal")
    else:
        clauses.append(
            and_(
                Signal.channel == "internal",
                or_(
                    Signal.turn_kind.in_(("user", "department")),
                    Signal.source.in_(("department", SCHEDULE_SOURCE, "trend")),
                    # Filed work (a recurring ticket, a queue item's ticket) is on a board.
                    and_(Signal.ticket_tag_id.is_not(None), Signal.ticket_status != "proposed"),
                ),
            )
        )
    return or_(*clauses)


async def list_threads(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    *,
    view: str = "all_open",
    folder: str | None = None,
    channel: str | None = None,
    search: str | None = None,
    assignee_id: int | None = None,
    priority: str | None = None,
    tag: str | None = None,
    connection_id: str | None = None,
    email_connection_id: int | None = None,
    project_id: str | None = None,
    path: str | None = None,
    category_id: str | None = None,
    stage: str | None = None,
    agent_id: str | None = None,
    unread: bool = False,
    needs_reply: bool = False,
    needs_decision: bool = False,
    pinned_only: bool = False,
    page: int = 1,
    per_page: int = 30,
    visible_account_ids: set[UUID] | None = None,
    team_id: str | None = None,
    scheduled_from: datetime | None = None,
    scheduled_to: datetime | None = None,
    activity: str | None = None,
    segment: str | None = None,
) -> dict[str, Any]:
    from app.services.signal_threads.pins import _pinned_ids
    from app.services.signal_threads.serialize import _user_map, resolve_email_account_by_numeric_id
    pinned = await _pinned_ids(session, tenant_id, user_id)
    from app.services.personal_assistant import PERSONAL_THREAD_SOURCE
    from app.services.trash import alive

    query = select(Signal).where(
        Signal.tenant_id == tenant_id,
        alive(Signal),
        Signal.source != PERSONAL_THREAD_SOURCE,
    )
    acl = _visibility_predicate(visible_account_ids)
    if acl is not None:
        query = query.where(acl)
    mine_first = None

    if team_id:
        try:
            team_uuid = UUID(team_id)
        except ValueError:
            return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}
        query = query.where(
            or_(
                and_(Signal.assignee_kind == "department", Signal.assignee_id == team_uuid),
                and_(Signal.turn_kind == "department", Signal.turn_ref_id == team_uuid),
            )
        )

    if folder == "external":
        query = query.where(Signal.channel.in_(EXTERNAL_CHANNELS))
    elif folder == "internal":
        query = query.where(Signal.channel == "internal")
    elif folder == "inbox":
        query = query.where(_hub_predicate(user_id, include_runs=bool(agent_id)))
    elif folder == "assistant":
        query = query.where(Signal.channel == "assistant")
        query = query.where(Signal.context_signal_id.is_(None))
        query = query.where(
            (Signal.owner_user_id == user_id) | (Signal.owner_user_id.is_(None))
        )

    if channel:
        channel_key = channel.strip().lower()
        widget_aliases = ("widget", "customer_widget", "webchat", "chat", "livechat")
        if channel_key in widget_aliases:
            query = query.where(Signal.channel.in_(widget_aliases))
        else:
            query = query.where(Signal.channel == channel)

    from app.services.communication_nav import list_predicates

    folder_filters = await list_predicates(
        session,
        tenant_id,
        {"project_id": project_id, "path": path, "category_id": category_id, "tag": tag, "stage": stage},
    )
    if folder_filters is None:
        return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}
    query = query.where(*folder_filters)

    if segment == "scheduled":
        # The Planned side of a queue: same owner scope, threads with a date.
        queue = view.removesuffix("_closed")
        if queue == "for_you":
            query = query.where(await for_you_clause(session, tenant_id, user_id))
        elif queue == "unassigned":
            query = query.where(unassigned_predicate())
        view = "scheduled"

    if view == "all":
        # Active workload across statuses; closed, spam and snoozed threads
        # live in their own views so closing a thread removes it from "All".
        query = query.where(Signal.status.notin_(("closed", "spam", "snoozed")))
    elif view == "all_open":
        query = query.where(Signal.status == "open")
    elif view == "for_you":
        query = query.where(
            Signal.status == "open", await for_you_clause(session, tenant_id, user_id)
        )
        mine_first = await turn_is_mine_clause(session, tenant_id, user_id)
    elif view == "for_you_closed":
        query = query.where(
            Signal.status == "closed", await for_you_clause(session, tenant_id, user_id)
        )
    elif view == "unassigned":
        query = query.where(Signal.status == "open", unassigned_predicate())
    elif view == "unassigned_closed":
        query = query.where(Signal.status == "closed", unassigned_predicate())
    elif view == "pending":
        query = query.where(Signal.status == "pending")
    elif view == "scheduled":
        # Threads with a date: agenda items, look-agains, repeating tasks
        # (paused repeats have no next moment but still belong here).
        from app.models.trigger import Trigger

        rule_threads = select(Trigger.signal_id).where(
            Trigger.tenant_id == tenant_id,
            Trigger.signal_id.is_not(None),
            Trigger.deleted_at.is_(None),
            Trigger.kind != "webhook",
        )
        query = query.where(
            or_(Signal.next_at.is_not(None), Signal.id.in_(rule_threads)),
            Signal.status.notin_(("spam",)),
        )
    elif view == "closed":
        query = query.where(Signal.status == "closed")
    elif view == "spam":
        query = query.where(Signal.status == "spam")
    elif view == "pinned":
        if pinned:
            query = query.where(Signal.id.in_(pinned))
        else:
            query = query.where(Signal.id.is_(None))
    elif view == "awaiting_decision":
        query = query.where(_exists_open_decision())
    elif view == "updates":
        query = query.where(_exists_message_kind(tenant_id, "status_update"))
    elif view == "results":
        query = query.where(_exists_message_kind(tenant_id, "task_result"))
    elif view == "outbound":
        query = query.where(
            Signal.channel.in_(EXTERNAL_CHANNELS),
            _exists_outbound_message(tenant_id),
        )
    elif view == "external":
        query = query.where(Signal.channel.in_(EXTERNAL_CHANNELS), Signal.status == "open")
    elif view == "internal":
        query = query.where(Signal.channel == "internal")

    if assignee_id is not None:
        user_map = await _user_map(session, tenant_id)
        assignee_uuid = user_map.get(assignee_id)
        if assignee_uuid:
            query = query.where(
                Signal.assignee_kind == "user", Signal.assignee_id == assignee_uuid
            )
        else:
            query = query.where(Signal.id.is_(None))

    if priority:
        if priority not in ("low", "normal", "high", "urgent"):
            return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}
        query = query.where(Signal.priority == priority)

    if activity:
        cutoff = _activity_cutoff(activity)
        if cutoff is None:
            return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}
        query = query.where(
            Signal.last_message_at.is_not(None),
            Signal.last_message_at >= cutoff,
        )

    if connection_id:
        try:
            query = query.where(Signal.connection_id == UUID(connection_id))
        except ValueError:
            # A malformed filter must narrow to nothing, not silently widen
            # the result set to the whole inbox.
            return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}

    if email_connection_id is not None:
        account_id = await resolve_email_account_by_numeric_id(session, tenant_id, email_connection_id)
        if account_id:
            query = query.where(Signal.channel_account_id == account_id)
        else:
            query = query.where(Signal.id.is_(None))

    if agent_id:
        try:
            agent_uuid = UUID(agent_id)
        except ValueError:
            return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}
        from app.models.signal_participant import SignalParticipant

        # Owner agent OR active participant (A2A / invited specialists).
        query = query.where(
            or_(
                Signal.agent_id == agent_uuid,
                Signal.id.in_(
                    select(SignalParticipant.signal_id).where(
                        SignalParticipant.tenant_id == tenant_id,
                        SignalParticipant.kind == "agent",
                        SignalParticipant.ref_id == agent_uuid,
                        SignalParticipant.left_at.is_(None),
                    )
                ),
            )
        )

    if scheduled_from is not None:
        query = query.where(Signal.next_at >= scheduled_from)
    if scheduled_to is not None:
        query = query.where(Signal.next_at <= scheduled_to)
    if unread:
        query = query.where(Signal.has_unread.is_(True))
    if pinned_only:
        query = query.where(Signal.id.in_(pinned) if pinned else Signal.id.is_(None))
    if needs_reply:
        query = query.where(_needs_reply_predicate(tenant_id))
    if needs_decision:
        query = query.where(_exists_open_decision())

    if search:
        # Message-body predicate: on Postgres use full-text search backed by
        # the expression GIN index from schema_patch (`ix_signal_messages_fts`,
        # expression must match verbatim); SQLite (tests) falls back to ILIKE.
        # EXISTS keeps the row set deduplicated and the planner free to use
        # the signal indexes.
        query = query.where(_search_predicate(session, tenant_id, search))

    # Snapshot before sort/page so a search can also peek past this scope.
    scoped_query = query

    count_result = await session.execute(select(func.count()).select_from(query.subquery()))
    items_total = count_result.scalar_one()

    human_first = case(
        (Signal.ai_handling_reason.in_(("handoff_requested", "escalated")), 0),
        else_=1,
    )
    if view == "scheduled":
        query = query.order_by(Signal.next_at.asc())
    elif mine_first is not None:
        # For you: a customer waiting on a person, then what waits on you now,
        # then what you merely own.
        query = query.order_by(
            human_first,
            case((mine_first, 0), else_=1),
            Signal.last_message_at.desc(),
        )
    else:
        query = query.order_by(human_first, Signal.last_message_at.desc())
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await session.execute(query)
    threads = list(result.scalars().all())
    threads.sort(key=lambda t: t.id not in pinned)
    items = await _present_thread_rows(session, tenant_id, user_id, user_num, threads, pinned)

    outside_items: list[dict[str, Any]] = []
    if search and search.strip() and page == 1:
        outside_rows = await _threads_outside_current_filters(
            session,
            tenant_id,
            search,
            scoped_query=scoped_query,
            view=view,
            visible_account_ids=visible_account_ids,
        )
        outside_items = await _present_thread_rows(
            session, tenant_id, user_id, user_num, outside_rows, pinned
        )

    next_page = page + 1 if page * per_page < items_total else None
    return {
        "items": items,
        "outside_items": outside_items,
        "curPage": page,
        "itemsTotal": items_total,
        "nextPage": next_page,
    }


async def _threads_outside_current_filters(
    session: AsyncSession,
    tenant_id: UUID,
    search: str,
    *,
    scoped_query,
    view: str,
    visible_account_ids: set[UUID] | None,
) -> list[Signal]:
    """Search hits that the current queue or filters leave out.

    Same tenant and mailbox visibility as the list. Spam stays out unless
    that queue is already open. The scoped query is everything the list
    itself would return, so these rows are the wider peek.
    """
    from app.services.personal_assistant import PERSONAL_THREAD_SOURCE
    from app.services.trash import alive

    wide = select(Signal).where(
        Signal.tenant_id == tenant_id,
        alive(Signal),
        Signal.source != PERSONAL_THREAD_SOURCE,
        _search_predicate(session, tenant_id, search, fts_param="fts_outside"),
        ~Signal.id.in_(scoped_query.with_only_columns(Signal.id)),
    )
    acl = _visibility_predicate(visible_account_ids)
    if acl is not None:
        wide = wide.where(acl)
    if view != "spam":
        wide = wide.where(Signal.status != "spam")
    wide = wide.order_by(Signal.last_message_at.desc()).limit(_OUTSIDE_SEARCH_LIMIT)
    result = await session.execute(wide)
    return list(result.scalars().all())


async def _present_thread_rows(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    threads: list[Signal],
    pinned: set,
) -> list[dict[str, Any]]:
    from app.services.signal_threads.serialize import (
        _latest_message_previews,
        floor_speaker_id,
        serialize_thread,
    )
    previews, speaker_ids = await _latest_message_previews(session, tenant_id, [t.id for t in threads])
    face_ids = set(speaker_ids.values())
    for thread in threads:
        on_floor = floor_speaker_id(thread)
        if on_floor:
            face_ids.add(on_floor)
    agent_ids = {t.agent_id for t in threads if t.agent_id} | face_ids
    agents_by_id: dict[UUID, Agent] = {}
    if agent_ids:
        agent_rows = await session.execute(
            select(Agent).where(Agent.tenant_id == tenant_id, Agent.id.in_(agent_ids))
        )
        agents_by_id = {a.id: a for a in agent_rows.scalars().all()}

    open_dec = (
        await _signals_with_open_decisions(
            session, tenant_id, signal_ids=[t.id for t in threads]
        )
        if threads
        else set()
    )

    from app.models.auth import Tenant
    from app.services.ai_handling import flow_dial_for, resolve_ai_handling, widget_account

    tenant = await session.get(Tenant, tenant_id)
    account_ids = {t.channel_account_id for t in threads if t.channel_account_id}
    accounts_by_id: dict[UUID, ChannelAccount] = {}
    if account_ids:
        account_rows = await session.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant_id,
                ChannelAccount.id.in_(account_ids),
            )
        )
        accounts_by_id = {a.id: a for a in account_rows.scalars().all()}
    widget_fallback = (
        await widget_account(session, tenant_id)
        if any(t.channel == "widget" and not t.channel_account_id for t in threads)
        else None
    )
    from app.services.tickets import tickets_by_signal

    tickets = await tickets_by_signal(session, tenant_id, threads)
    from app.services.signal_tags import inherited_tags_by_signal, tags_by_signal

    tags_map = await tags_by_signal(session, [t.id for t in threads])
    inherited_map = await inherited_tags_by_signal(session, tenant_id, threads)
    from app.services.folders import effective_tag_ids, load_catalog, serialize_folder_paths

    folder_catalog = await load_catalog(session, tenant_id)
    from app.services.thread_schedule import rules_by_signal, schedule_payload

    rules = await rules_by_signal(session, tenant_id, [t.id for t in threads])

    review_cache: dict[str, Any] = {}
    items = []
    for t in threads:
        agent = agents_by_id.get(t.agent_id) if t.agent_id else None
        face_id = floor_speaker_id(t) or speaker_ids.get(t.id) or t.agent_id
        speaker = agents_by_id.get(face_id) if face_id else None
        preview, direction, by_agent = previews.get(t.id, ("", "", False))
        account = accounts_by_id.get(t.channel_account_id) if t.channel_account_id else None
        if account is None and t.channel == "widget":
            account = widget_fallback
        flow_mode, flow_label = await flow_dial_for(session, t, cache=review_cache)
        handling = resolve_ai_handling(
            tenant, account, t, agent=agent, flow_mode=flow_mode, flow_label=flow_label
        ).to_payload()
        items.append(
            serialize_thread(
                t,
                is_pinned=t.id in pinned,
                user_num=user_num,
                agent=agent,
                last_preview=preview,
                last_direction=direction,
                last_by_agent=by_agent,
                has_open_decision=t.id in open_dec,
                ai_handling=handling,
                ticket=tickets.get(t.id),
                tags=tags_map.get(t.id, []),
                inherited_tags=inherited_map.get(t.id, []),
                folder_paths=serialize_folder_paths(
                    folder_catalog, await effective_tag_ids(session, t)
                ),
                schedule=schedule_payload(rules.get(t.id)),
                speaker=speaker,
            )
        )
    from app.services.pass_stick import viewer_unread_ids

    mine = await viewer_unread_ids(session, tenant_id, user_id, [t.id for t in threads])
    if mine:
        for item, thread in zip(items, threads):
            if thread.id in mine:
                item["has_unread"] = True
    return items


async def get_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    *,
    visible_account_ids: set[UUID] | None = None,
    limit: int = 80,
    before: UUID | None = None,
) -> dict[str, Any] | None:
    """Load a thread detail with a bounded message window.

    Default returns the newest ``limit`` messages (chronological). Pass
    ``before`` (a message id) to page older history. ``has_older`` tells the
    client whether another page exists above the returned window.
    """
    from app.services.signal_threads.pins import _pinned_ids
    from app.services.signal_threads.serialize import (
        _active_turn_payload,
        _resolve_thread_agent,
        _user_display_names,
        _user_map,
        conversation_speaker,
        mention_names,
        message_bundle_ids,
        message_proposal_ids,
        serialize_event,
        serialize_message,
        serialize_thread,
    )
    query = select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
    acl = _visibility_predicate(visible_account_ids)
    if acl is not None:
        # Hidden for this member: 404, existence must not leak.
        query = query.where(acl)
    signal = (await session.execute(query)).scalar_one_or_none()
    if not signal:
        return None

    from app.services.archived_agents import retarget_archived_handler

    if await retarget_archived_handler(session, signal):
        await session.commit()

    # A crashed Ask must not keep its live turn open on the thread log.
    try:
        from app.models.agent import AgentRun
        from app.services.agent.turn_persist import end_dead_turns

        busy = (
            await session.execute(
                select(AgentRun).where(
                    AgentRun.signal_id == signal_id,
                    AgentRun.trigger_type == "chat",
                    AgentRun.status == "running",
                ).limit(1)
            )
        ).scalar_one_or_none()
        # A run left "running" across a reload still holds its turn. After the
        # stale window the turn is abandoned; do not keep Nadenken up.
        if busy is not None and busy.started_at is not None:
            if busy.started_at < utcnow() - timedelta(minutes=15):
                busy.status = "failed"
                busy.completed_at = utcnow()
                busy.pause_reason = "cleared_stale"
                session.add(busy)
                await session.commit()
                busy = None
        if busy is None:
            await end_dead_turns(session, signal, older_than=timedelta(minutes=15))
    except Exception:  # noqa: BLE001
        logger.debug("closing dead turns on get_thread failed", exc_info=True)

    page_size = max(1, min(int(limit or 80), 200))
    pinned = await _pinned_ids(session, tenant_id, user_id)

    msg_filters: list[Any] = [
        SignalMessage.signal_id == signal_id,
        SignalMessage.tenant_id == tenant_id,
    ]
    if before is not None:
        before_row = (
            await session.execute(
                select(SignalMessage).where(
                    SignalMessage.id == before,
                    SignalMessage.signal_id == signal_id,
                    SignalMessage.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if before_row is not None and before_row.seq is not None:
            msg_filters.append(SignalMessage.seq < before_row.seq)

    # Newest-first +1 to detect has_older, then reverse for thread order.
    messages_result = await session.execute(
        select(SignalMessage)
        .where(*msg_filters)
        .order_by(SignalMessage.seq.desc(), SignalMessage.id.desc())
        .limit(page_size + 1)
    )
    newest_first = list(messages_result.scalars().all())
    has_older = len(newest_first) > page_size
    messages = list(reversed(newest_first[:page_size]))

    decision_ids = [m.decision_id for m in messages if m.decision_id]
    proposal_ids = message_proposal_ids(messages)
    decision_ids.extend(proposal_ids.values())
    bundle_ids = message_bundle_ids(messages)
    for ids in bundle_ids.values():
        decision_ids.extend(ids)
    decisions_by_id: dict[UUID, DecisionRequest] = {}
    if decision_ids:
        dr = await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.id.in_(decision_ids),
                DecisionRequest.tenant_id == tenant_id,
            )
        )
        decisions_by_id = {d.id: d for d in dr.scalars().all()}
    resolver_names = await _user_display_names(
        session,
        [
            d.resolved_by_user_id
            for d in decisions_by_id.values()
            if d.resolved_by_user_id
        ],
    )

    # Events in the same time window as the message page (plus any events
    # after the newest message when this is the live tail). Cap so a noisy
    # agent does not ship hundreds of pills with the first paint.
    EVENT_PAGE_CAP = 100
    event_filters: list[Any] = [
        SignalEvent.signal_id == signal_id,
        SignalEvent.tenant_id == tenant_id,
        # Side actions of an inbound read render inside its outcome card.
        SignalEvent.payload_json.notlike('%"folded_into"%'),
    ]
    if messages:
        stamps = [
            m.created_at.replace(tzinfo=None) if m.created_at.tzinfo else m.created_at
            for m in messages
            if m.created_at is not None
        ]
        oldest_at = min(stamps) if stamps else None
        newest_at = max(stamps) if stamps else None
        if before is not None and oldest_at is not None:
            # Older page: only events that fall inside this page's span.
            event_filters.append(SignalEvent.created_at >= oldest_at)
            if newest_at is not None:
                event_filters.append(SignalEvent.created_at <= newest_at)
        elif oldest_at is not None:
            # Live tail: drop ancient events before the window.
            event_filters.append(SignalEvent.created_at >= oldest_at)
    events_result = await session.execute(
        select(SignalEvent)
        .where(*event_filters)
        .order_by(SignalEvent.created_at.desc(), SignalEvent.id.desc())
        .limit(EVENT_PAGE_CAP + 1)
    )
    newest_events = list(events_result.scalars().all())
    events = list(reversed(newest_events[:EVENT_PAGE_CAP]))
    rev_map = {v: k for k, v in (await _user_map(session, tenant_id)).items()}
    agent = await _resolve_thread_agent(session, tenant_id, signal, messages)

    # Caller's own feedback per message so thumbs state survives reloads.
    from app.models.learning import Feedback
    from app.services import message_reactions as reaction_svc

    feedback_by_subject: dict[str, Feedback] = {}
    if messages:
        fb_result = await session.execute(
            select(Feedback).where(
                Feedback.tenant_id == tenant_id,
                Feedback.user_id == user_id,
                Feedback.subject_type == "message",
                Feedback.subject_id.in_([str(m.id) for m in messages]),
            )
        )
        feedback_by_subject = {f.subject_id: f for f in fb_result.scalars().all()}

    reaction_by_message = await reaction_svc.aggregate_for_messages(
        session,
        tenant_id,
        [m.id for m in messages],
        viewer_type="user",
        viewer_id=user_id,
    )

    # Email needs HTML in the window (LazyEmailHtmlFrame). Chat / assistant /
    # WhatsApp render plain text; agent traces load on expand via get_message.
    include_html = (signal.channel or "").lower() == "email"
    names_now = await mention_names(session, tenant_id, [m.body_text or "" for m in messages])
    serialized_messages = []
    for m in messages:
        proposal_decision = decisions_by_id.get(proposal_ids[m.id]) if m.id in proposal_ids else None
        row = serialize_message(
            m,
            decision=decisions_by_id.get(m.decision_id) if m.decision_id else None,
            include_html=include_html,
            include_trace=False,
            channel=signal.channel,
            proposal_decision=proposal_decision,
            proposal_resolved_by=(
                resolver_names.get(proposal_decision.resolved_by_user_id)
                if proposal_decision and proposal_decision.resolved_by_user_id
                else None
            ),
            proposal_resolver_names=resolver_names,
            bundle_decisions=[
                decisions_by_id[did] for did in bundle_ids.get(m.id, []) if did in decisions_by_id
            ],
            mention_names=names_now,
        )
        reactions = reaction_by_message.get(str(m.id)) or reaction_svc.empty_aggregate()
        row["reactions"] = reactions
        fb = feedback_by_subject.get(str(m.id))
        if fb:
            row["my_feedback"] = {"score": fb.score, "sentiment": fb.sentiment}
        elif reactions.get("mine") in reaction_svc.SCORED_KINDS:
            sentiment, score = reaction_svc.SCORED_KINDS[reactions["mine"]]
            row["my_feedback"] = {"score": score, "sentiment": sentiment}
        serialized_messages.append(row)

    # Inline agent sessions anchored on this thread (active + closed).
    from app.services.agent_sessions import list_sessions

    sessions = [] if signal.channel == "assistant" else await list_sessions(
        session, tenant_id, signal_id
    )

    # End-customer satisfaction rating on the conversation (widget CSAT).
    csat_result = await session.execute(
        select(Feedback)
        .where(
            Feedback.tenant_id == tenant_id,
            Feedback.subject_type == "signal",
            Feedback.subject_id == str(signal_id),
            Feedback.score.is_not(None),
        )
        .order_by(Feedback.created_at.desc())
        .limit(1)
    )
    csat_fb = csat_result.scalar_one_or_none()
    csat = (
        {
            "score": csat_fb.score,
            "comment": csat_fb.comment or "",
            "created_at": csat_fb.created_at.isoformat(),
        }
        if csat_fb
        else None
    )

    oldest_id = str(messages[0].id) if messages else None

    from app.models.auth import Tenant
    from app.services.ai_handling import resolve_for_signal

    tenant = await session.get(Tenant, tenant_id)
    handling = (await resolve_for_signal(session, tenant, signal)).to_payload()
    from app.services import ai_handling as handling_svc
    from app.services.signal_tags import inherited_tags_by_signal, signal_tag_names
    from app.services.tickets import ticket_payload

    thread_tags = await signal_tag_names(session, signal.id)
    inherited_tags = (await inherited_tags_by_signal(session, tenant_id, [signal])).get(signal.id, [])
    routing_policy = (await handling_svc.routing_for_signal(session, tenant, signal)).effective
    from app.services.folders import effective_tag_ids, load_catalog, serialize_folder_paths
    from app.services.ownership import human_owner_payload
    from app.services.thread_schedule import rules_by_signal, schedule_payload

    folder_catalog = await load_catalog(session, tenant_id)
    from app.services.participants import serialize_participants, sync_signal_baseline

    try:
        await sync_signal_baseline(session, signal)
        await session.flush()
    except Exception:  # noqa: BLE001 — roster sync must not break the thread
        logger.debug("sync_signal_baseline failed for %s", signal.id, exc_info=True)
        try:
            await session.rollback()
            # Re-load signal after rollback so later reads use a clean session.
            signal = await session.get(Signal, signal_id) or signal
        except Exception:  # noqa: BLE001
            logger.debug("rollback after baseline sync failed for %s", signal_id, exc_info=True)
    try:
        participants = await serialize_participants(session, tenant_id, signal_id)
    except Exception:  # noqa: BLE001 — participants are best-effort for the detail pane
        logger.exception("serialize_participants failed for %s", signal_id)
        participants = []
    active_turn = _active_turn_payload(signal)
    from app.services.handoff_sessions import serialize_handoff_session

    return {
        "thread": serialize_thread(
            signal,
            is_pinned=signal_id in pinned,
            agent=agent,
            has_open_decision=await _signal_has_open_decision(session, tenant_id, signal_id),
            ticket=await ticket_payload(session, signal),
            tags=thread_tags,
            inherited_tags=inherited_tags,
            folder_paths=serialize_folder_paths(folder_catalog, await effective_tag_ids(session, signal)),
            schedule=schedule_payload(
                (await rules_by_signal(session, tenant_id, [signal.id])).get(signal.id)
            ),
            ai_handling=handling,
            speaker=await conversation_speaker(session, signal),
        ),
        # Channel routing policy for the composer (send split at "ask",
        # "Send and close" default) and the last person/team that handled it.
        "routing_policy": routing_policy if not is_internal_channel(signal.channel) else None,
        "last_human_owner": human_owner_payload(signal),
        "participants": participants,
        "active_turn": active_turn,
        "handoff_session": serialize_handoff_session(signal),
        "messages": serialized_messages,
        "events": [serialize_event(e, user_num_map=rev_map) for e in events],
        "sessions": sessions,
        "csat": csat,
        "has_older": has_older,
        "oldest_message_id": oldest_id,
        # Where else this person is talking to us (WhatsApp after email, a
        # second mailbox): the thread banner and the contact panel use it.
        "related_conversations": await _related_conversations(session, signal),
    }


async def _related_conversations(session: AsyncSession, signal: Signal) -> list[dict[str, Any]]:
    if is_internal_channel(signal.channel) or signal.channel == "assistant":
        return []
    from app.services.related_conversations import related_conversations

    try:
        return await related_conversations(session, signal)
    except Exception:  # noqa: BLE001 — a sidebar hint must never break the thread
        logger.debug("related_conversations failed for %s", signal.id, exc_info=True)
        return []


async def get_message(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    message_id: UUID,
    *,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, Any] | None:
    """Full message payload (HTML + agent_trace) for lazy expand on the timeline."""
    from app.services.signal_threads.serialize import (
        _user_display_names,
        message_bundle_ids,
        message_proposal_ids,
        serialize_message,
    )
    signal = (
        await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not signal:
        return None
    if (
        visible_account_ids is not None
        and signal.channel_account_id
        and signal.channel_account_id not in visible_account_ids
    ):
        return None
    message = (
        await session.execute(
            select(SignalMessage).where(
                SignalMessage.id == message_id,
                SignalMessage.signal_id == signal_id,
                SignalMessage.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not message:
        return None
    decision = None
    if message.decision_id:
        decision = await session.get(DecisionRequest, message.decision_id)
        if decision and decision.tenant_id != tenant_id:
            decision = None
    proposal_decision = None
    proposal_id = message_proposal_ids([message]).get(message.id)
    if proposal_id:
        proposal_decision = await session.get(DecisionRequest, proposal_id)
        if proposal_decision and proposal_decision.tenant_id != tenant_id:
            proposal_decision = None
    resolver_names = await _user_display_names(
        session, [proposal_decision.resolved_by_user_id] if proposal_decision else []
    )
    bundle_decisions: list[DecisionRequest] = []
    bundle_ids = message_bundle_ids([message]).get(message.id, [])
    if bundle_ids:
        bundle_decisions = list(
            (
                await session.execute(
                    select(DecisionRequest).where(
                        DecisionRequest.id.in_(bundle_ids), DecisionRequest.tenant_id == tenant_id
                    )
                )
            ).scalars().all()
        )
    if bundle_decisions:
        resolver_names = await _user_display_names(
            session,
            [
                *(
                    [proposal_decision.resolved_by_user_id]
                    if proposal_decision and proposal_decision.resolved_by_user_id
                    else []
                ),
                *[d.resolved_by_user_id for d in bundle_decisions if d.resolved_by_user_id],
            ],
        )
    return serialize_message(
        message,
        decision=decision,
        include_html=True,
        include_trace=True,
        channel=signal.channel,
        proposal_decision=proposal_decision,
        proposal_resolved_by=(
            resolver_names.get(proposal_decision.resolved_by_user_id)
            if proposal_decision and proposal_decision.resolved_by_user_id
            else None
        ),
        proposal_resolver_names=resolver_names,
        bundle_decisions=bundle_decisions,
    )
