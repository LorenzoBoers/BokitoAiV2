"""Signal thread service with inbox-parity for the unified Messages hub."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_signal_message, publish_thread_update
from app.models.agent import Agent
from app.models.auth import Membership, User, user_numeric_id
from app.models.channel import ChannelAccount
from app.models.notification import DecisionRequest
from app.models.signal import (
    EXTERNAL_CHANNELS,
    Signal,
    SignalEvent,
    SignalMessage,
    SignalThreadPin,
    is_internal_channel,
)


logger = logging.getLogger(__name__)


def _iso(value: datetime | None) -> str | None:
    """Naive datetimes are stored as UTC; mark them as such so browsers do not
    parse them as local time (which shifted every timestamp by the UTC offset)."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.isoformat() + "Z"
    return value.isoformat()


def _user_uuid_from_num(session_users: dict[int, UUID], user_num: int | None) -> UUID | None:
    if user_num is None:
        return None
    return session_users.get(user_num)


async def _user_map(session: AsyncSession, tenant_id: UUID) -> dict[int, UUID]:
    result = await session.execute(
        select(User).join(Membership, Membership.user_id == User.id).where(Membership.tenant_id == tenant_id)
    )
    return {user_numeric_id(u.id): u.id for u in result.scalars().all()}


async def resolve_email_account_by_numeric_id(
    session: AsyncSession,
    tenant_id: UUID,
    numeric_id: int,
) -> UUID | None:
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.tenant_id == tenant_id, ChannelAccount.channel == "email"
        )
    )
    for account in result.scalars().all():
        if user_numeric_id(account.id) == numeric_id:
            return account.id
    return None


def serialize_thread(
    signal: Signal,
    *,
    is_pinned: bool = False,
    user_num: int | None = None,
    agent: Agent | None = None,
) -> dict[str, Any]:
    assignee_num = user_numeric_id(signal.assigned_user_id) if signal.assigned_user_id else None
    email_conn_id = user_numeric_id(signal.channel_account_id) if signal.channel_account_id else None
    folder = "internal" if is_internal_channel(signal.channel) else "external"
    return {
        "id": str(signal.id),
        "organisation_id": str(signal.tenant_id),
        "email_connection_id": email_conn_id,
        "connection_id": str(signal.connection_id) if signal.connection_id else None,
        "graph_conversation_id": signal.external_id or "",
        "email_subject": signal.subject,
        "contact_id": str(signal.contact_id) if signal.contact_id else None,
        "contact_email": signal.contact_email,
        "contact_name": signal.contact_name,
        "contact_phone": signal.contact_phone,
        "status": signal.status,
        "snoozed_until": _iso(signal.snoozed_until),
        "priority": signal.priority,
        "assigned_to_user_id": assignee_num,
        "tags": json.loads(signal.tags_json or "[]"),
        "ai_paused": signal.ai_paused,
        "suggested_actions": json.loads(signal.suggested_actions_json or "[]"),
        "last_message_at": _iso(signal.last_message_at),
        "has_unread": signal.has_unread,
        "is_pinned": is_pinned,
        "channel": signal.channel,
        "folder": folder,
        "agent_id": str(signal.agent_id) if signal.agent_id else None,
        "agent_name": agent.name if agent else None,
        "agent_kind": agent.kind if agent else None,
        "project_id": str(signal.project_id) if signal.project_id else None,
        "created_at": _iso(signal.created_at),
    }


def serialize_message(message: SignalMessage, *, decision: DecisionRequest | None = None) -> dict[str, Any]:
    author_num = user_numeric_id(message.author_user_id) if message.author_user_id else None
    payload: dict[str, Any] = {}
    if message.decision_id:
        payload["decision_id"] = str(message.decision_id)
    if message.author_agent_id:
        payload["agent_id"] = str(message.author_agent_id)
    if decision:
        try:
            options = json.loads(decision.options_json or "[]")
        except json.JSONDecodeError:
            options = []
        payload["decision"] = {
            "id": str(decision.id),
            "title": decision.title,
            "summary": decision.summary,
            "status": decision.status,
            "options": options,
        }
    try:
        meta = json.loads(message.metadata_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    usage = meta.get("usage") if isinstance(meta, dict) else None
    steps = meta.get("steps") if isinstance(meta, dict) else None
    thinking = meta.get("thinking") if isinstance(meta, dict) else None
    if (
        (isinstance(usage, dict) and usage)
        or (isinstance(steps, list) and steps)
        or (isinstance(thinking, dict) and thinking)
    ):
        payload["agent_trace"] = {
            "usage": usage if isinstance(usage, dict) else {},
            "steps": steps if isinstance(steps, list) else [],
            "thinking": thinking if isinstance(thinking, dict) else {},
        }
    return {
        "id": str(message.id),
        "thread_id": str(message.signal_id),
        "signal_id": str(message.signal_id),
        "connection_id": None,
        "kind": message.kind,
        "direction": message.direction,
        "from_address": message.from_address,
        "to_addresses": message.to_addresses,
        "cc": str(meta.get("cc") or "") or None if isinstance(meta, dict) else None,
        "bcc": str(meta.get("bcc") or "") or None if isinstance(meta, dict) else None,
        "subject": message.subject,
        "body_preview": message.body_preview or message.body_text[:200],
        "body_text": message.body_text,
        "body_html": message.body_html or None,
        "graph_message_id": message.external_id,
        "in_reply_to": None,
        "author_user_id": author_num,
        "is_read": message.direction != "inbound",
        "send_status": message.send_status,
        "send_after": _iso(message.send_after),
        "attachments": json.loads(message.attachments_json or "[]"),
        "decision_id": str(message.decision_id) if message.decision_id else None,
        "payload": payload,
        "received_at": _iso(message.received_at),
        "created_at": _iso(message.created_at),
    }


def serialize_event(event: SignalEvent, *, user_num_map: dict[UUID, int] | None = None) -> dict[str, Any]:
    actor_num = None
    if user_num_map and event.actor_id:
        try:
            actor_num = user_num_map.get(UUID(event.actor_id))
        except ValueError:
            actor_num = None
    return {
        "id": str(event.id),
        "thread_id": str(event.signal_id),
        "signal_id": str(event.signal_id),
        "event_type": event.event_type,
        "actor_user_id": actor_num,
        "payload": json.loads(event.payload_json or "{}"),
        "created_at": _iso(event.created_at),
    }


async def _resolve_thread_agent(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    messages: list[SignalMessage] | None = None,
) -> Agent | None:
    if signal.agent_id:
        result = await session.execute(
            select(Agent).where(Agent.id == signal.agent_id, Agent.tenant_id == tenant_id)
        )
        agent = result.scalar_one_or_none()
        if agent:
            return agent
    if messages:
        for message in reversed(messages):
            if not message.author_agent_id:
                continue
            result = await session.execute(
                select(Agent).where(
                    Agent.id == message.author_agent_id,
                    Agent.tenant_id == tenant_id,
                )
            )
            agent = result.scalar_one_or_none()
            if agent:
                return agent
    if signal.project_id:
        from app.models.project import Project

        project_result = await session.execute(
            select(Project).where(Project.id == signal.project_id, Project.tenant_id == tenant_id)
        )
        project = project_result.scalar_one_or_none()
        if project and project.po_agent_id:
            result = await session.execute(
                select(Agent).where(Agent.id == project.po_agent_id, Agent.tenant_id == tenant_id)
            )
            agent = result.scalar_one_or_none()
            if agent:
                return agent
    return None


async def _pinned_ids(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> set[UUID]:
    result = await session.execute(
        select(SignalThreadPin.signal_id).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
        )
    )
    return {row for row in result.scalars().all()}


async def _signals_with_open_decisions(session: AsyncSession, tenant_id: UUID) -> set[UUID]:
    result = await session.execute(
        select(SignalMessage.signal_id)
        .join(DecisionRequest, DecisionRequest.id == SignalMessage.decision_id)
        .where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "decision_request",
            DecisionRequest.status == "awaiting_human",
        )
    )
    return {row for row in result.scalars().all()}


async def nav_badge_counts(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    include_agents_attention: bool,
) -> dict[str, Any]:
    """Lightweight unread/attention counts for sidebar badges (no thread payloads)."""
    tenant = Signal.tenant_id == tenant_id
    open_status = Signal.status == "open"
    unread = Signal.has_unread.is_(True)

    async def _count(*filters) -> int:
        stmt = select(func.count()).select_from(Signal).where(tenant, *filters)
        return int((await session.execute(stmt)).scalar_one() or 0)

    my_unread = await _count(open_status, unread, Signal.assigned_user_id == user_id)
    unassigned_unread = await _count(open_status, unread, Signal.assigned_user_id.is_(None))
    all_unread = await _count(open_status, unread)

    agents_attention = 0
    if include_agents_attention:
        open_dec = await _signals_with_open_decisions(session, tenant_id)
        agents_attention = len(open_dec)

    return {
        "inbox_unread": my_unread + unassigned_unread,
        "inbox_by_queue": {
            "my": my_unread,
            "unassigned": unassigned_unread,
            "all": all_unread,
        },
        "agents_attention": agents_attention,
    }


async def _signals_with_message_kind(session: AsyncSession, tenant_id: UUID, kind: str) -> set[UUID]:
    result = await session.execute(
        select(SignalMessage.signal_id.distinct()).where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == kind,
        )
    )
    return {row for row in result.scalars().all()}


async def _signals_with_outbound_messages(session: AsyncSession, tenant_id: UUID) -> set[UUID]:
    result = await session.execute(
        select(SignalMessage.signal_id.distinct()).where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.direction == "outbound",
        )
    )
    return {row for row in result.scalars().all()}


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
    tag: str | None = None,
    connection_id: str | None = None,
    email_connection_id: int | None = None,
    project_id: str | None = None,
    agent_id: str | None = None,
    page: int = 1,
    per_page: int = 30,
) -> dict[str, Any]:
    pinned = await _pinned_ids(session, tenant_id, user_id)
    query = select(Signal).where(Signal.tenant_id == tenant_id)

    if folder == "external":
        query = query.where(Signal.channel.in_(EXTERNAL_CHANNELS))
    elif folder == "internal":
        query = query.where(Signal.channel == "internal")
    elif folder == "inbox":
        # Assignable conversations across channels; assistant chats live
        # under the Assistant section, not the shared inbox.
        query = query.where(Signal.channel != "assistant")
    elif folder == "assistant":
        query = query.where(Signal.channel == "assistant")
        query = query.where(
            (Signal.owner_user_id == user_id) | (Signal.owner_user_id.is_(None))
        )

    if channel:
        query = query.where(Signal.channel == channel)

    if project_id:
        try:
            query = query.where(Signal.project_id == UUID(project_id))
        except ValueError:
            return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}

    if view == "all":
        # Active workload across statuses; closed and spam threads live in
        # their own views so closing a thread removes it from "All".
        query = query.where(Signal.status.notin_(("closed", "spam")))
    elif view == "all_open":
        query = query.where(Signal.status == "open")
    elif view == "mine":
        query = query.where(Signal.status == "open", Signal.assigned_user_id == user_id)
    elif view == "unassigned":
        query = query.where(Signal.status == "open", Signal.assigned_user_id.is_(None))
    elif view == "pending":
        query = query.where(Signal.status == "pending")
    elif view == "snoozed":
        query = query.where(Signal.status == "pending", Signal.snoozed_until.is_not(None))
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
        open_dec = await _signals_with_open_decisions(session, tenant_id)
        if open_dec:
            query = query.where(Signal.id.in_(open_dec))
        else:
            query = query.where(Signal.id.is_(None))
    elif view == "updates":
        ids = await _signals_with_message_kind(session, tenant_id, "status_update")
        query = query.where(Signal.id.in_(ids) if ids else Signal.id.is_(None))
    elif view == "results":
        ids = await _signals_with_message_kind(session, tenant_id, "task_result")
        query = query.where(Signal.id.in_(ids) if ids else Signal.id.is_(None))
    elif view == "outbound":
        ids = await _signals_with_outbound_messages(session, tenant_id)
        query = query.where(
            Signal.channel.in_(EXTERNAL_CHANNELS),
            Signal.id.in_(ids) if ids else Signal.id.is_(None),
        )
    elif view == "external":
        query = query.where(Signal.channel.in_(EXTERNAL_CHANNELS), Signal.status == "open")
    elif view == "internal":
        query = query.where(Signal.channel == "internal")

    if tag:
        # tags_json holds a JSON array of strings; match the quoted literal.
        # ilike keeps SQLite and Postgres behavior identical (LIKE is
        # case-insensitive on SQLite but case-sensitive on Postgres).
        query = query.where(Signal.tags_json.ilike(f'%"{tag}"%'))

    if assignee_id is not None:
        user_map = await _user_map(session, tenant_id)
        assignee_uuid = user_map.get(assignee_id)
        if assignee_uuid:
            query = query.where(Signal.assigned_user_id == assignee_uuid)
        else:
            query = query.where(Signal.id.is_(None))

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
            query = query.where(Signal.agent_id == UUID(agent_id))
        except ValueError:
            return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}

    if search:
        like = f"%{search}%"
        # Message-body predicate: on Postgres use full-text search backed by
        # the expression GIN index from schema_patch (`ix_signal_messages_fts`,
        # expression must match verbatim); SQLite (tests) falls back to ILIKE.
        bind = getattr(session, "bind", None)
        if bind is not None and bind.dialect.name == "postgresql":
            body_pred = sa_text(
                "to_tsvector('simple', coalesce(signal_messages.subject, '') || ' ' "
                "|| coalesce(signal_messages.body_text, '')) "
                "@@ plainto_tsquery('simple', :fts_query)"
            ).bindparams(fts_query=search)
        else:
            body_pred = SignalMessage.body_text.ilike(like)
        # EXISTS keeps the row set deduplicated and the planner free to use
        # the signal indexes.
        body_match = (
            select(SignalMessage.id)
            .where(
                SignalMessage.signal_id == Signal.id,
                SignalMessage.tenant_id == tenant_id,
                body_pred,
            )
            .exists()
        )
        query = query.where(
            Signal.subject.ilike(like)
            | Signal.contact_email.ilike(like)
            | Signal.contact_name.ilike(like)
            | body_match
        )

    count_result = await session.execute(select(func.count()).select_from(query.subquery()))
    items_total = count_result.scalar_one()

    query = query.order_by(Signal.last_message_at.desc())
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await session.execute(query)
    threads = list(result.scalars().all())
    threads.sort(
        key=lambda t: (
            t.id not in pinned,
            -(t.last_message_at.timestamp() if t.last_message_at else 0),
        )
    )

    agent_ids = {t.agent_id for t in threads if t.agent_id}
    agents_by_id: dict[UUID, Agent] = {}
    if agent_ids:
        agent_rows = await session.execute(
            select(Agent).where(Agent.tenant_id == tenant_id, Agent.id.in_(agent_ids))
        )
        agents_by_id = {a.id: a for a in agent_rows.scalars().all()}

    project_po_agents: dict[UUID, Agent] = {}
    unresolved_project_ids = {
        t.project_id for t in threads if t.project_id and not t.agent_id
    }
    if unresolved_project_ids:
        from app.models.project import Project

        project_result = await session.execute(
            select(Project).where(
                Project.tenant_id == tenant_id,
                Project.id.in_(unresolved_project_ids),
                Project.po_agent_id.is_not(None),
            )
        )
        projects = list(project_result.scalars().all())
        po_ids = {p.po_agent_id for p in projects if p.po_agent_id}
        if po_ids:
            po_rows = await session.execute(
                select(Agent).where(Agent.tenant_id == tenant_id, Agent.id.in_(po_ids))
            )
            po_by_id = {a.id: a for a in po_rows.scalars().all()}
            for project in projects:
                if project.po_agent_id and project.po_agent_id in po_by_id:
                    project_po_agents[project.id] = po_by_id[project.po_agent_id]

    items = []
    for t in threads:
        agent = agents_by_id.get(t.agent_id) if t.agent_id else None
        if not agent and t.project_id:
            agent = project_po_agents.get(t.project_id)
        items.append(
            serialize_thread(
                t,
                is_pinned=t.id in pinned,
                user_num=user_num,
                agent=agent,
            )
        )
    next_page = page + 1 if page * per_page < items_total else None
    return {"items": items, "curPage": page, "itemsTotal": items_total, "nextPage": next_page}


async def get_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
) -> dict[str, Any] | None:
    result = await session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return None
    pinned = await _pinned_ids(session, tenant_id, user_id)
    messages_result = await session.execute(
        select(SignalMessage)
        .where(SignalMessage.signal_id == signal_id, SignalMessage.tenant_id == tenant_id)
        .order_by(SignalMessage.created_at)
    )
    messages = list(messages_result.scalars().all())
    decision_ids = [m.decision_id for m in messages if m.decision_id]
    decisions_by_id: dict[UUID, DecisionRequest] = {}
    if decision_ids:
        dr = await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.id.in_(decision_ids),
                DecisionRequest.tenant_id == tenant_id,
            )
        )
        decisions_by_id = {d.id: d for d in dr.scalars().all()}
    events_result = await session.execute(
        select(SignalEvent)
        .where(SignalEvent.signal_id == signal_id, SignalEvent.tenant_id == tenant_id)
        .order_by(SignalEvent.created_at)
    )
    rev_map = {v: k for k, v in (await _user_map(session, tenant_id)).items()}
    agent = await _resolve_thread_agent(session, tenant_id, signal, messages)

    # Caller's own feedback per message so thumbs state survives reloads.
    from app.models.learning import Feedback

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

    serialized_messages = []
    for m in messages:
        row = serialize_message(
            m, decision=decisions_by_id.get(m.decision_id) if m.decision_id else None
        )
        fb = feedback_by_subject.get(str(m.id))
        if fb:
            row["my_feedback"] = {"score": fb.score, "sentiment": fb.sentiment}
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

    return {
        "thread": serialize_thread(signal, is_pinned=signal_id in pinned, agent=agent),
        "messages": serialized_messages,
        "events": [serialize_event(e, user_num_map=rev_map) for e in events_result.scalars().all()],
        "sessions": sessions,
        "csat": csat,
    }


async def update_note(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    message_id: UUID,
    *,
    body_text: str,
) -> dict[str, Any] | None:
    result = await session.execute(
        select(SignalMessage).where(
            SignalMessage.id == message_id,
            SignalMessage.signal_id == signal_id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "internal_note",
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        return None
    message.body_text = body_text
    message.body_preview = body_text[:200]
    # Notes are created with a body_html mirror (see reply_to_thread); keep it
    # in sync or the timeline keeps rendering the stale HTML after an edit.
    message.body_html = f"<p>{body_text}</p>"
    session.add(message)
    await session.commit()
    return serialize_message(message)


async def delete_note(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    message_id: UUID,
) -> bool:
    result = await session.execute(
        select(SignalMessage).where(
            SignalMessage.id == message_id,
            SignalMessage.signal_id == signal_id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "internal_note",
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        return False
    await session.delete(message)
    await session.commit()
    return True


async def list_notes(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
) -> list[dict[str, Any]]:
    result = await session.execute(
        select(SignalMessage)
        .where(
            SignalMessage.signal_id == signal_id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "internal_note",
        )
        .order_by(SignalMessage.created_at)
    )
    return [serialize_message(m) for m in result.scalars().all()]


async def _get_signal_row(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> Signal | None:
    result = await session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
    )
    return result.scalar_one_or_none()


async def patch_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    signal_id: UUID,
    *,
    status: str | None = None,
    assigned_to_user_id: int | None = None,
    tags: list[str] | None = None,
    priority: str | None = None,
    project_id: UUID | None = None,
    project_id_set: bool = False,
    snoozed_until: datetime | None = None,
    snoozed_until_set: bool = False,
) -> dict[str, Any] | None:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    before_status = signal.status
    before_assignee = signal.assigned_user_id
    if snoozed_until_set:
        # Snoozing implies pending; clearing the wake time alone keeps status.
        signal.snoozed_until = snoozed_until
        if snoozed_until is not None and status is None:
            status = "pending"
    if status is not None:
        signal.status = status
        if status != "pending":
            # Reopen/close/spam always clears any pending wake time.
            signal.snoozed_until = None
    newly_assigned: UUID | None = None
    if assigned_to_user_id is not None:
        user_map = await _user_map(session, tenant_id)
        next_assignee = user_map.get(assigned_to_user_id) if assigned_to_user_id else None
        if next_assignee and next_assignee != signal.assigned_user_id and next_assignee != user_id:
            newly_assigned = next_assignee
        signal.assigned_user_id = next_assignee
    if tags is not None:
        signal.tags_json = json.dumps(tags)
    if priority is not None:
        signal.priority = priority
    if project_id_set:
        if project_id is not None:
            from app.models.project import Project

            project_result = await session.execute(
                select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
            )
            if not project_result.scalar_one_or_none():
                raise HTTPException(status_code=404, detail="Project not found")
        signal.project_id = project_id
    signal.updated_at = datetime.utcnow()
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type="thread_updated",
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps(
                {
                    "status": status,
                    "priority": priority,
                    "project_id": str(project_id) if project_id else None,
                    "assigned_to": assigned_to_user_id,
                    "tags": tags,
                }
            ),
        )
    )
    # Govern audit only for the mutations that matter (status / assignee) —
    # tag/priority tweaks stay thread-timeline-only to avoid audit noise.
    if signal.status != before_status or signal.assigned_user_id != before_assignee:
        from app.services.audit import record_audit

        await record_audit(
            session,
            tenant_id,
            action="signal:updated",
            actor_type="user",
            actor_id=user_id,
            resource_type="signal",
            resource_id=signal_id,
            summary=(signal.subject or "")[:120],
            before={"status": before_status, "assigned_user_id": str(before_assignee or "")},
            after={"status": signal.status, "assigned_user_id": str(signal.assigned_user_id or "")},
            commit=False,
        )
    await session.commit()
    await session.refresh(signal)
    await publish_thread_update(signal)
    if signal.status == "closed" and before_status != "closed":
        from app.services.webhooks import emit_webhook_event, signal_event_data

        await emit_webhook_event(session, tenant_id, "signal.closed", signal_event_data(signal))
    if newly_assigned:
        await _notify_assignment(session, tenant_id, signal, assignee_id=newly_assigned, actor_id=user_id)
    pinned = await _pinned_ids(session, tenant_id, user_id)
    return serialize_thread(signal, is_pinned=signal_id in pinned, user_num=user_num)


async def _notify_assignment(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    assignee_id: UUID,
    actor_id: UUID,
) -> None:
    """Notify a teammate that a conversation was assigned to them."""
    from app.gateway.publish import publish_notification
    from app.models.notification import Notification
    from app.services.notification_mail import (
        notification_channels,
        send_notification_mail,
        thread_link,
    )

    channels = await notification_channels(session, tenant_id, assignee_id, "assigned-to-me")
    if not channels["desktop"] and not channels["email"]:
        return
    actor_result = await session.execute(select(User).where(User.id == actor_id))
    actor = actor_result.scalar_one_or_none()
    actor_name = (actor.display_name or actor.email) if actor else "A teammate"
    title = f"{actor_name} assigned {signal.subject or 'a conversation'} to you"
    if channels["desktop"]:
        notification = Notification(
            tenant_id=tenant_id,
            user_id=assignee_id,
            kind="assignment",
            title=title,
            body=(signal.summary or "")[:300],
            payload_json=json.dumps({"signal_id": str(signal.id)}),
        )
        session.add(notification)
        await session.commit()
        await publish_notification(
            tenant_id, notification_id=notification.id, kind="assignment", title=notification.title
        )
    if channels["email"]:
        await send_notification_mail(
            session,
            assignee_id,
            subject=title,
            text=(
                f"{title}.\n\n"
                f"{(signal.summary or '').strip()[:500]}\n\n"
                f"Open the conversation:\n{thread_link(signal.id)}"
            ),
        )


async def set_read(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    signal_id: UUID,
    *,
    read: bool,
) -> dict[str, Any] | None:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    signal.has_unread = not read
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    pinned = await _pinned_ids(session, tenant_id, user_id)
    return serialize_thread(signal, is_pinned=signal_id in pinned, user_num=user_num)


async def wake_snoozed_threads(session: AsyncSession) -> int:
    """Reopen snoozed threads whose wake time passed (all tenants; scheduler tick)."""
    now = datetime.utcnow()
    result = await session.execute(
        select(Signal).where(
            Signal.status == "pending",
            Signal.snoozed_until.is_not(None),
            Signal.snoozed_until <= now,
        )
    )
    woken = list(result.scalars().all())
    for signal in woken:
        signal.status = "open"
        signal.snoozed_until = None
        signal.has_unread = True
        signal.updated_at = now
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="snooze_expired",
                actor_type="system",
                actor_id="",
                payload_json="{}",
            )
        )
    if woken:
        await session.commit()
        for signal in woken:
            await publish_thread_update(signal)
    return len(woken)


BULK_ACTIONS = ("close", "reopen", "spam", "read", "unread", "assign")


async def bulk_update_threads(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    signal_ids: list[UUID],
    action: str,
    assignee_id: int | None = None,
) -> dict[str, Any]:
    """Apply one operator action to many threads at once (inbox bulk bar)."""
    if action not in BULK_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown bulk action: {action}")
    assignee_uuid: UUID | None = None
    if action == "assign":
        user_map = await _user_map(session, tenant_id)
        assignee_uuid = user_map.get(assignee_id) if assignee_id else None
        if not assignee_uuid:
            raise HTTPException(status_code=404, detail="Assignee not found")

    result = await session.execute(
        select(Signal).where(Signal.tenant_id == tenant_id, Signal.id.in_(signal_ids))
    )
    signals = list(result.scalars().all())
    now = datetime.utcnow()
    before_states = {
        str(s.id): {"status": s.status, "assigned_user_id": str(s.assigned_user_id or "")}
        for s in signals
    }
    for signal in signals:
        if action == "close":
            signal.status = "closed"
            signal.snoozed_until = None
        elif action == "reopen":
            signal.status = "open"
            signal.snoozed_until = None
        elif action == "spam":
            signal.status = "spam"
            signal.snoozed_until = None
        elif action == "read":
            signal.has_unread = False
        elif action == "unread":
            signal.has_unread = True
        elif action == "assign":
            signal.assigned_user_id = assignee_uuid
        signal.updated_at = now
        session.add(signal)
        if action in ("close", "reopen", "spam", "assign"):
            session.add(
                SignalEvent(
                    signal_id=signal.id,
                    tenant_id=tenant_id,
                    event_type="thread_updated",
                    actor_type="user",
                    actor_id=str(user_id),
                    payload_json=json.dumps({"bulk": action}),
                )
            )
    # One audit event per bulk action with the before-states; mark-read noise
    # (read/unread) is intentionally excluded from the govern audit.
    if signals and action in ("close", "reopen", "spam", "assign"):
        from app.services.audit import record_audit

        await record_audit(
            session,
            tenant_id,
            action=f"signal:bulk_{action}",
            actor_type="user",
            actor_id=user_id,
            resource_type="signal",
            resource_id=";".join(str(s.id) for s in signals[:50]),
            summary=f"Bulk {action} on {len(signals)} thread(s)",
            before=before_states,
            after={"assignee_id": assignee_id} if action == "assign" else None,
            commit=False,
        )
    await session.commit()
    for signal in signals:
        await publish_thread_update(signal)
    if action == "close":
        from app.services.webhooks import emit_webhook_event, signal_event_data

        for signal in signals:
            if before_states[str(signal.id)]["status"] != "closed":
                await emit_webhook_event(
                    session, tenant_id, "signal.closed", signal_event_data(signal)
                )
    return {"updated": len(signals), "action": action}


async def delete_thread(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID, *, user_id: UUID | None = None
) -> bool:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return False
    subject = signal.subject
    for model in (SignalMessage, SignalEvent, SignalThreadPin):
        rows = await session.execute(select(model).where(model.signal_id == signal_id))
        for row in rows.scalars().all():
            await session.delete(row)

    # Clean up remaining FK references so Postgres does not reject the delete.
    from sqlalchemy import delete as sa_delete
    from sqlalchemy import update as sa_update

    from app.models.orchestration import AgentTask
    from app.models.outcome import OperationalOutcome
    from app.models.platform_change import PlatformChange
    from app.models.trigger import Trigger

    # Decisions live inside the thread and are deleted with it; platform
    # changes keep their own record but lose the decision link.
    decision_ids = (
        (await session.execute(select(DecisionRequest.id).where(DecisionRequest.signal_id == signal_id)))
        .scalars()
        .all()
    )
    if decision_ids:
        await session.execute(
            sa_update(PlatformChange)
            .where(PlatformChange.decision_id.in_(decision_ids))  # type: ignore[attr-defined]
            .values(decision_id=None)
        )
        await session.execute(sa_delete(DecisionRequest).where(DecisionRequest.id.in_(decision_ids)))  # type: ignore[attr-defined]

    # Tasks, triggers, and outcomes outlive the thread; detach the reference.
    for ref_model in (AgentTask, Trigger, OperationalOutcome):
        await session.execute(
            sa_update(ref_model).where(ref_model.signal_id == signal_id).values(signal_id=None)
        )

    await session.delete(signal)
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action="signal:deleted",
        actor_type="user" if user_id else "system",
        actor_id=user_id or "",
        resource_type="signal",
        resource_id=signal_id,
        summary=(subject or "")[:120],
        commit=False,
    )
    await session.commit()
    return True


async def set_ai_paused(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    *,
    paused: bool,
) -> dict[str, Any] | None:
    """Human takeover / hand-back for a thread.

    When paused, the assigned operator owns replies and the AI stops generating
    automatic responses (widget stream, /api/chat, and internal agent threads all
    respect `ai_paused`). Releasing hands control back to the agent.
    """
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    signal.ai_paused = paused
    signal.assigned_user_id = user_id if paused else None
    signal.updated_at = datetime.utcnow()
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type="ai_paused" if paused else "ai_resumed",
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps({"ai_paused": paused}),
        )
    )
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action="signal:takeover" if paused else "signal:handback",
        actor_type="user",
        actor_id=user_id,
        resource_type="signal",
        resource_id=signal_id,
        summary=(signal.subject or "")[:120],
        commit=False,
    )
    await session.commit()
    await publish_thread_update(signal)
    return {"signal_id": str(signal_id), "ai_paused": paused}


async def reply_to_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    signal_id: UUID,
    *,
    body_text: str,
    body_html: str | None = None,
    action: str = "send",
    direction: str = "outbound",
    kind: str = "user_message",
    attachments: list[dict] | None = None,
    snooze_minutes: int | None = None,
    cc: str | None = None,
    bcc: str | None = None,
    send_after_seconds: int | None = None,
) -> dict[str, Any] | None:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    now = datetime.utcnow()
    # Soft undo / scheduled send: persist the message without delivering it;
    # the scheduler tick delivers once `send_after` passes, and the cancel
    # endpoint can remove it before that.
    scheduled = bool(send_after_seconds and send_after_seconds > 0) and direction == "outbound"
    send_status = None
    if scheduled:
        send_status = "scheduled"
    elif direction == "outbound":
        from app.channels import deliver_outbound

        send_status = await deliver_outbound(
            session,
            signal,
            body_text=body_text,
            body_html=body_html,
            cc=cc,
            bcc=bcc,
            attachments=attachments,
        )
        if send_status == "skipped":
            send_status = "sent"
    message_meta: dict[str, Any] = {}
    if cc:
        message_meta["cc"] = cc
    if bcc:
        message_meta["bcc"] = bcc
    message = SignalMessage(
        signal_id=signal_id,
        tenant_id=tenant_id,
        kind=kind if direction == "internal" else "user_message",
        direction=direction,
        role="user" if direction != "internal" else "system",
        author_user_id=user_id,
        from_address="",
        to_addresses=signal.contact_email,
        subject=signal.subject,
        body_text=body_text,
        body_preview=body_text[:200],
        body_html=body_html or f"<p>{body_text}</p>",
        attachments_json=json.dumps(attachments or []),
        metadata_json=json.dumps(message_meta) if message_meta else "{}",
        send_status=send_status,
        send_after=(now + timedelta(seconds=send_after_seconds)) if scheduled else None,
        received_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.updated_at = now
    if action == "send_and_close":
        signal.status = "closed"
        signal.snoozed_until = None
    elif action == "send_and_pending":
        signal.status = "pending"
        # Optional wake time; without one the thread waits for the next
        # inbound message (snooze-until-reply).
        if snooze_minutes and snooze_minutes > 0:
            signal.snoozed_until = now + timedelta(minutes=snooze_minutes)
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type="reply_sent" if direction == "outbound" else "note_added",
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps({"action": action}),
        )
    )
    await session.commit()
    await session.refresh(message)
    await publish_signal_message(signal, message)
    if action in ("send_and_close", "send_and_pending"):
        # Status changed alongside the reply; widget conversations also need
        # the visitor-safe status event (e.g. to show the CSAT prompt).
        await publish_thread_update(signal)
    if action == "send_and_close":
        from app.services.webhooks import emit_webhook_event, signal_event_data

        await emit_webhook_event(session, tenant_id, "signal.closed", signal_event_data(signal))
    # @mentions in replies and internal notes notify the mentioned teammates.
    author_result = await session.execute(select(User).where(User.id == user_id))
    author = author_result.scalar_one_or_none()
    await notify_mentions(
        session,
        tenant_id,
        signal,
        body_text=body_text,
        author_user_id=user_id,
        author_name=(author.display_name or author.email) if author else "",
    )
    # Internal agent threads are two-way chats: when an operator posts a reply
    # (not an internal note), run the thread's agent and append its response.
    # External channels (email/whatsapp/widget) and assistant-channel threads
    # (handled by /api/chat) are intentionally excluded.
    if direction == "outbound" and signal.channel == "internal" and not signal.ai_paused and not scheduled:
        await _generate_agent_reply(session, tenant_id, user_id, signal, attachments=attachments)
    return serialize_message(message)


async def deliver_due_outbound_messages(session: AsyncSession) -> int:
    """Deliver scheduled outbound messages whose send time passed (scheduler tick).

    Runs across all tenants. Failures mark the message `failed:*` so the
    operator sees it in the thread instead of a silent drop.
    """
    from app.channels import deliver_outbound

    now = datetime.utcnow()
    result = await session.execute(
        select(SignalMessage)
        .where(
            SignalMessage.send_status == "scheduled",
            SignalMessage.send_after.is_not(None),
            SignalMessage.send_after <= now,
        )
        .order_by(SignalMessage.send_after)
        .limit(25)
    )
    due = list(result.scalars().all())
    delivered = 0
    for message in due:
        signal = await session.get(Signal, message.signal_id)
        if not signal:
            message.send_status = "failed:thread_missing"
            session.add(message)
            continue
        meta: dict[str, Any] = {}
        try:
            meta = json.loads(message.metadata_json or "{}")
        except (TypeError, ValueError):
            meta = {}
        try:
            attachments = json.loads(message.attachments_json or "[]")
        except (TypeError, ValueError):
            attachments = []
        try:
            status = await deliver_outbound(
                session,
                signal,
                body_text=message.body_text,
                body_html=message.body_html or None,
                cc=meta.get("cc"),
                bcc=meta.get("bcc"),
                attachments=attachments or None,
            )
        except Exception as exc:  # noqa: BLE001 — one bad message must not stall the queue
            logger.exception("Scheduled send failed for message %s", message.id)
            status = f"failed:{type(exc).__name__}"[:80]
        message.send_status = "sent" if status == "skipped" else status
        message.send_after = None
        session.add(message)
        delivered += 1
        await session.commit()
        await session.refresh(message)
        await publish_signal_message(signal, message)
    if due:
        await session.commit()
    return delivered


async def cancel_scheduled_message(
    session: AsyncSession,
    tenant_id: UUID,
    message_id: UUID,
) -> dict[str, Any] | None:
    """Soft undo: remove a still-scheduled outbound message before delivery.

    Returns the removed message's body so the composer can restore the draft,
    or None when the message is unknown or already (being) sent.
    """
    result = await session.execute(
        select(SignalMessage).where(
            SignalMessage.id == message_id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.send_status == "scheduled",
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        return None
    signal = await session.get(Signal, message.signal_id)
    body_text = message.body_text
    signal_id = message.signal_id
    await session.delete(message)
    if signal:
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant_id,
                event_type="scheduled_send_cancelled",
                actor_type="user",
                actor_id="",
                payload_json="{}",
            )
        )
    await session.commit()
    if signal:
        await publish_thread_update(signal)
    return {"signal_id": str(signal_id), "body_text": body_text}


# Mentions use a stable inline markup so plain text stays readable:
# "@[Jane Doe](user:123456)" where the id is the dashboard numeric user id.
MENTION_PATTERN = re.compile(r"@\[([^\]]+)\]\(user:(\d+)\)")


async def notify_mentions(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    body_text: str,
    author_user_id: UUID | None,
    author_name: str = "",
) -> list[UUID]:
    """Create in-app notifications for @[Name](user:id) mentions in a message.

    Returns the user ids that were notified. Commits once when anything was
    created and publishes a gateway event so open dashboards refresh live.
    """
    from app.gateway.publish import publish_notification
    from app.models.notification import Notification
    from app.services.notification_mail import (
        notification_channels,
        send_notification_mail,
        thread_link,
    )

    mention_nums = {int(num) for _, num in MENTION_PATTERN.findall(body_text or "")}
    if not mention_nums:
        return []
    user_map = await _user_map(session, tenant_id)
    plain = MENTION_PATTERN.sub(lambda m: f"@{m.group(1)}", body_text or "")
    title = f"{author_name or 'A teammate'} mentioned you in {signal.subject or 'a conversation'}"
    notified: list[UUID] = []
    created: list[Notification] = []
    email_targets: list[UUID] = []
    for num in sorted(mention_nums):
        target = user_map.get(num)
        if not target or target == author_user_id:
            continue
        channels = await notification_channels(session, tenant_id, target, "mentions")
        if not channels["desktop"] and not channels["email"]:
            continue
        if channels["email"]:
            email_targets.append(target)
        if not channels["desktop"]:
            notified.append(target)
            continue
        notification = Notification(
            tenant_id=tenant_id,
            user_id=target,
            kind="mention",
            title=title,
            body=plain[:300],
            payload_json=json.dumps({"signal_id": str(signal.id)}),
        )
        session.add(notification)
        created.append(notification)
        notified.append(target)
    if created:
        await session.commit()
        for notification in created:
            await publish_notification(
                tenant_id,
                notification_id=notification.id,
                kind="mention",
                title=notification.title,
            )
    for target in email_targets:
        await send_notification_mail(
            session,
            target,
            subject=title,
            text=(
                f"{title}.\n\n"
                f"{plain[:500]}\n\n"
                f"Open the conversation:\n{thread_link(signal.id)}"
            ),
        )
    return notified


async def _generate_agent_reply(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal: Signal,
    *,
    attachments: list[dict] | None = None,
) -> None:
    """Run the thread's agent and append its reply.

    Best-effort: the user's message is already committed, so any failure here
    is logged and swallowed rather than surfaced to the caller.
    """
    from app.services.agent.loop import AgentLoop
    from app.services.assistant_threads import (
        append_signal_chat_message,
        signal_chat_history,
    )

    signal_id = signal.id
    try:
        agent = await _resolve_thread_agent(session, tenant_id, signal)
        if not agent or not agent.is_active:
            return
        history = await signal_chat_history(session, signal_id)
        loop = AgentLoop(
            session,
            tenant_id,
            user_id,
            agent=agent,
            signal_id=signal_id,
            enable_chat_thinking=True,
        )
        reply_text = ""
        tokens: dict = {"input_tokens": 0, "output_tokens": 0}
        steps: list = []
        thinking_meta = None
        async for event in loop.stream_chat(history, attachments=attachments):
            if event["type"] == "done":
                reply_text = event.get("text", "") or "Done."
                tokens = event.get("usage", tokens)
                steps = event.get("steps") or list(loop.trace_steps)
                thinking_meta = loop.thinking_payload()
        meta: dict = {"usage": tokens, "steps": steps}
        if thinking_meta:
            meta["thinking"] = thinking_meta
        await append_signal_chat_message(
            session,
            signal,
            role="assistant",
            content=reply_text,
            author_agent_id=agent.id,
            metadata=meta,
        )
        await session.commit()
    except Exception:  # noqa: BLE001 - never break the user's reply
        await session.rollback()
        logger.exception("Failed to generate agent reply for signal %s", signal_id)


async def list_pins(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> dict[str, list[str]]:
    pinned = await _pinned_ids(session, tenant_id, user_id)
    return {"thread_ids": [str(tid) for tid in sorted(pinned, key=str)]}


async def pin_thread(session: AsyncSession, tenant_id: UUID, user_id: UUID, signal_id: UUID) -> None:
    existing = await session.execute(
        select(SignalThreadPin).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
            SignalThreadPin.signal_id == signal_id,
        )
    )
    if existing.scalar_one_or_none():
        return
    session.add(SignalThreadPin(tenant_id=tenant_id, user_id=user_id, signal_id=signal_id))
    await session.commit()


async def unpin_thread(session: AsyncSession, tenant_id: UUID, user_id: UUID, signal_id: UUID) -> None:
    existing = await session.execute(
        select(SignalThreadPin).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
            SignalThreadPin.signal_id == signal_id,
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        await session.delete(row)
        await session.commit()


async def list_members(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(User).join(Membership, Membership.user_id == User.id).where(Membership.tenant_id == tenant_id)
    )
    members = []
    for user in result.scalars().all():
        members.append(
            {
                "id": user_numeric_id(user.id),
                "name": user.display_name or user.email,
                "email": user.email,
                "avatar_url": user.avatar_url,
            }
        )
    return members


async def sync_status(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    """Per-mailbox sync state for the inbox Sync status panel."""
    from app.services.email_sync import account_sync_folders

    result = await session.execute(
        select(ChannelAccount)
        .where(ChannelAccount.tenant_id == tenant_id, ChannelAccount.channel == "email")
        .order_by(ChannelAccount.created_at)
    )
    accounts = [a for a in result.scalars().all() if a.provider in ("gmail", "outlook")]

    rows: list[dict[str, Any]] = []
    for account in accounts:
        try:
            settings = json.loads(account.settings_json or "{}")
            if not isinstance(settings, dict):
                settings = {}
        except json.JSONDecodeError:
            settings = {}
        try:
            creds = json.loads(account.credentials_json or "{}")
            has_token = bool(isinstance(creds, dict) and creds.get("access_token"))
        except json.JSONDecodeError:
            has_token = False

        if settings.get("last_error") and has_token and account.is_enabled:
            status = "error"
        elif not account.is_enabled:
            status = "paused"
        elif not has_token:
            status = "needs_auth"
        else:
            status = "connected"

        last_sync_at = settings.get("last_sync_at")
        messages_synced = int(settings.get("messages_synced") or 0)
        folders = []
        for index, folder in enumerate(account_sync_folders(settings)):
            selected = bool(folder.get("is_selected"))
            folders.append(
                {
                    "id": index + 1,
                    "folder_id": str(folder.get("id") or ""),
                    "folder_name": str(folder.get("display_name") or folder.get("id") or ""),
                    "is_selected": selected,
                    # Only the Inbox is polled today; other selections are stored intent.
                    "last_sync_at": last_sync_at if selected and folder.get("id") == "inbox" else None,
                    "messages_synced": messages_synced if folder.get("id") == "inbox" else 0,
                    "last_error": "",
                }
            )

        rows.append(
            {
                "id": user_numeric_id(account.id),
                "mailbox_email": account.address,
                "display_name": account.display_name or account.address,
                "provider": account.provider,
                "status": status,
                "is_enabled": account.is_enabled,
                "last_sync_at": last_sync_at,
                "last_error": str(settings.get("last_error") or ""),
                "folders": folders,
            }
        )
    return rows


async def resolve_message_decision(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
    signal_id: UUID,
    message_id: UUID,
    *,
    action: str,
    option_id: str | None = None,
    body: str | None = None,
    body_html: str | None = None,
    subject: str | None = None,
    response_text: str | None = None,
    # External resolution channel (e.g. "slack:U123"); lands in the event payload.
    source: str | None = None,
) -> dict[str, Any]:
    from app.services.decisions import resolve_decision_message

    msg_result = await session.execute(
        select(SignalMessage).where(
            SignalMessage.id == message_id,
            SignalMessage.signal_id == signal_id,
            SignalMessage.tenant_id == tenant_id,
        )
    )
    message = msg_result.scalar_one_or_none()
    if not message or not message.decision_id:
        raise HTTPException(status_code=404, detail="Decision message not found")

    payload_override: dict[str, Any] = {}
    if body is not None:
        payload_override["body"] = body
        payload_override["body_text"] = body
    if body_html is not None:
        payload_override["body_html"] = body_html
    if subject is not None:
        payload_override["subject"] = subject
    if response_text is not None and response_text.strip():
        payload_override["response_text"] = response_text.strip()

    await resolve_decision_message(
        session,
        tenant_id,
        message.decision_id,
        action=action,
        user_id=user_id,
        option_id=option_id,
        payload_override=payload_override or None,
    )
    # Single source of truth for resolution: the SignalEvent below (rendered as a
    # subtle divider) plus the decision's own status. No extra chat message —
    # except a free-text answer, which is real content the thread must keep.
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type=f"decision_{action}",
            actor_type="user",
            actor_id=str(user_id) if user_id else "",
            payload_json=json.dumps(
                {
                    "decision_id": str(message.decision_id),
                    "action": action,
                    "option_id": option_id,
                    "response_text": (response_text or "").strip() or None,
                    "via": source,
                }
            ),
        )
    )
    answer = (response_text or "").strip()
    if answer:
        sig_result = await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
        signal = sig_result.scalar_one_or_none()
        if signal:
            from app.services.assistant_threads import append_signal_chat_message

            await append_signal_chat_message(
                session,
                signal,
                role="user",
                content=answer,
                author_user_id=user_id,
                metadata={
                    "decision_id": str(message.decision_id),
                    "decision_response": True,
                    "option_id": option_id,
                },
            )

    # Learning hook: approved choices on "No reply needed" cards teach a
    # per-sender inbox rule (close / task). Consistent choices surface an
    # inline "always do this" suggestion; autonomous tenants auto-promote.
    rule_suggestion = None
    if user_id and action in ("approved", "approve") and option_id in ("close", "create_task"):
        rule_suggestion = await _record_no_reply_outcome(
            session, tenant_id, user_id, signal_id, message.decision_id, option_id
        )

    await session.commit()
    return {
        "ok": True,
        "action": action,
        "option_id": option_id,
        "rule_suggestion": rule_suggestion,
    }


async def _record_no_reply_outcome(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    decision_id: UUID,
    option_id: str,
) -> dict[str, Any] | None:
    """Feed an approved action-suggestion choice into the inbox-rule learner."""
    from app.models.auth import Tenant
    from app.models.learning import Feedback
    from app.models.notification import DecisionRequest, Notification
    from app.services import inbox_rules
    from app.tools.policy import resolve_posture

    decision = (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.id == decision_id, DecisionRequest.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if not decision or not decision.notification_id:
        return None
    notification = (
        await session.execute(
            select(Notification).where(Notification.id == decision.notification_id)
        )
    ).scalar_one_or_none()
    try:
        notif_payload = json.loads(notification.payload_json or "{}") if notification else {}
    except json.JSONDecodeError:
        notif_payload = {}
    if notif_payload.get("kind") != "action_suggestion":
        return None

    signal = (
        await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not signal or signal.source == "demo":
        # The onboarding demo thread never teaches rules.
        return None
    inbound = (
        await session.execute(
            select(SignalMessage)
            .where(SignalMessage.signal_id == signal_id, SignalMessage.direction == "inbound")
            .order_by(SignalMessage.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    from_address = (inbound.from_address if inbound else "") or signal.contact_email or ""
    try:
        inbound_meta = json.loads(inbound.metadata_json or "{}") if inbound else {}
    except json.JSONDecodeError:
        inbound_meta = {}
    auto_headers = (
        inbound_meta.get("auto_headers") if isinstance(inbound_meta, dict) else None
    )

    session.add(
        Feedback(
            tenant_id=tenant_id,
            subject_type="decision",
            subject_id=str(decision_id),
            user_id=user_id,
            comment=f"no_reply_action:{option_id}",
        )
    )

    tenant = await session.get(Tenant, tenant_id)
    auto_promote = bool(tenant) and resolve_posture(tenant) == "autonomous"
    return await inbox_rules.record_outcome(
        session,
        tenant_id,
        from_address=from_address,
        headers=auto_headers,
        option_id=option_id,
        sender_label=signal.contact_name or from_address,
        user_id=user_id,
        auto_promote=auto_promote,
    )
