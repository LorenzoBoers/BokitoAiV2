"""Signal thread service with inbox-parity for the unified Messages hub."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_signal_message, publish_thread_update
from app.models.agent import Agent
from app.models.auth import Membership, User, user_numeric_id
from app.models.channel import ChannelAccount, Contact
from app.models.notification import DecisionRequest, Notification
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


def _is_placeholder_preview(text: str) -> bool:
    low = text.lower()
    return (
        low.startswith("[mock]")
        or low.startswith("i received your message about:")
        or "placeholder reply while the workspace" in low
    )


def _clean_thread_preview(text: str) -> str:
    snippet = (text or "").strip().replace("\n", " ")
    if snippet.startswith("[mock]"):
        snippet = snippet[len("[mock]") :].strip()
    return snippet[:140]


async def _latest_message_previews(
    session: AsyncSession, tenant_id: UUID, signal_ids: list[UUID]
) -> dict[UUID, tuple[str, str]]:
    if not signal_ids:
        return {}
    result = await session.execute(
        select(
            SignalMessage.signal_id,
            SignalMessage.body_preview,
            SignalMessage.body_text,
            SignalMessage.kind,
            SignalMessage.direction,
        )
        .where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.signal_id.in_(signal_ids),
            SignalMessage.kind.in_(("user_message", "agent_message")),
        )
        .order_by(SignalMessage.created_at.desc())
    )
    user_previews: dict[UUID, tuple[str, str]] = {}
    other_previews: dict[UUID, tuple[str, str]] = {}
    for signal_id, preview, text, kind, direction in result.all():
        raw = (preview or text or "").strip()
        is_placeholder = _is_placeholder_preview(raw)
        snippet = _clean_thread_preview(raw)
        if not snippet:
            continue
        resolved_dir = direction or ("inbound" if kind == "user_message" else "outbound")
        if kind == "user_message" and signal_id not in user_previews:
            user_previews[signal_id] = (snippet, resolved_dir)
        if not is_placeholder and signal_id not in other_previews:
            other_previews[signal_id] = (snippet, resolved_dir)
    out: dict[UUID, tuple[str, str]] = {}
    for signal_id in signal_ids:
        out[signal_id] = other_previews.get(signal_id) or user_previews.get(signal_id, ("", ""))
    return out


def serialize_thread(
    signal: Signal,
    *,
    is_pinned: bool = False,
    user_num: int | None = None,
    agent: Agent | None = None,
    last_preview: str | None = None,
    last_direction: str | None = None,
    has_open_decision: bool = False,
) -> dict[str, Any]:
    assignee_num = user_numeric_id(signal.assigned_user_id) if signal.assigned_user_id else None
    email_conn_id = user_numeric_id(signal.channel_account_id) if signal.channel_account_id else None
    folder = "internal" if is_internal_channel(signal.channel) else "external"
    payload: dict[str, Any] = {
        "id": str(signal.id),
        "organisation_id": str(signal.tenant_id),
        "email_connection_id": email_conn_id,
        "connection_id": str(signal.connection_id) if signal.connection_id else None,
        "graph_conversation_id": signal.external_id or "",
        "email_subject": signal.subject,
        "last_message_preview": last_preview or "",
        "last_message_direction": last_direction or "",
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
        # AI triage (INTERPRETATION layer) shown on the thread header.
        "category": signal.category,
        "urgency": signal.urgency,
        "certainty": signal.certainty,
        "ai_summary": signal.summary,
        "triaged_at": _iso(signal.triaged_at),
        "last_message_at": _iso(signal.last_message_at),
        "has_unread": signal.has_unread,
        "has_open_decision": has_open_decision,
        "is_pinned": is_pinned,
        "channel": signal.channel,
        "folder": folder,
        "agent_id": str(signal.agent_id) if signal.agent_id else None,
        "agent_name": agent.name if agent else None,
        "agent_kind": agent.kind if agent else None,
        "project_id": str(signal.project_id) if signal.project_id else None,
        "created_at": _iso(signal.created_at),
    }
    if agent:
        from app.services.agent_avatar import avatar_payload

        av = avatar_payload(agent)
        payload["agent_avatar_kind"] = av["avatar_kind"]
        payload["agent_avatar_icon"] = av["avatar_icon"]
        payload["agent_avatar_color"] = av["avatar_color"]
        payload["agent_avatar_image_url"] = av["avatar_image_url"]
    return payload


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
    *,
    fallback_to_lead: bool = True,
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
        from app.services.projects import project_default_agent

        default_agent = await project_default_agent(session, tenant_id, signal.project_id)
        if default_agent:
            return default_agent
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
    if not fallback_to_lead:
        return None
    from app.services.lead_agent import get_lead_agent

    return await get_lead_agent(session, tenant_id)


async def _pinned_ids(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> set[UUID]:
    result = await session.execute(
        select(SignalThreadPin.signal_id).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
        )
    )
    return {row for row in result.scalars().all()}


async def _signals_with_open_decisions(session: AsyncSession, tenant_id: UUID) -> set[UUID]:
    """Signals with a real awaiting decision (reply draft, tool gate, escalate).

    Excludes "No reply needed" tip cards on automated mail — those must not
    inflate Agents / Cockpit attention counts or the Decisions queue.
    """
    from app.services.automated_mail import NO_REPLY_DECISION_TITLE

    result = await session.execute(
        select(Signal.id)
        .join(SignalMessage, SignalMessage.signal_id == Signal.id)
        .join(DecisionRequest, DecisionRequest.id == SignalMessage.decision_id)
        .where(
            Signal.tenant_id == tenant_id,
            Signal.channel != "assistant",
            Signal.status.notin_(("closed", "spam")),
            SignalMessage.kind == "decision_request",
            DecisionRequest.status == "awaiting_human",
            DecisionRequest.title != NO_REPLY_DECISION_TITLE,
        )
    )
    return {row for row in result.scalars().all()}


async def count_no_reply_suggestions(session: AsyncSession, tenant_id: UUID) -> int:
    """Awaiting 'No reply needed' tip cards (excluded from agents_attention)."""
    from app.services.automated_mail import NO_REPLY_DECISION_TITLE

    result = await session.execute(
        select(func.count(func.distinct(Signal.id)))
        .select_from(Signal)
        .join(SignalMessage, SignalMessage.signal_id == Signal.id)
        .join(DecisionRequest, DecisionRequest.id == SignalMessage.decision_id)
        .where(
            Signal.tenant_id == tenant_id,
            Signal.channel != "assistant",
            Signal.status.notin_(("closed", "spam")),
            SignalMessage.kind == "decision_request",
            DecisionRequest.status == "awaiting_human",
            DecisionRequest.title == NO_REPLY_DECISION_TITLE,
        )
    )
    return int(result.scalar_one() or 0)


def _visibility_predicate(visible_account_ids: set[UUID] | None):
    """Signal-level ACL clause; threads without an account stay visible."""
    if visible_account_ids is None:
        return None
    return or_(
        Signal.channel_account_id.is_(None),
        Signal.channel_account_id.in_(visible_account_ids) if visible_account_ids else Signal.id.is_(None),
    )


async def nav_badge_counts(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    include_agents_attention: bool,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, Any]:
    """Lightweight unread/attention counts for sidebar badges (no thread payloads)."""
    tenant = Signal.tenant_id == tenant_id
    open_status = Signal.status == "open"
    unread = Signal.has_unread.is_(True)
    acl = _visibility_predicate(visible_account_ids)

    async def _count(*filters) -> int:
        stmt = select(func.count()).select_from(Signal).where(tenant, *filters)
        if acl is not None:
            stmt = stmt.where(acl)
        return int((await session.execute(stmt)).scalar_one() or 0)

    customer_inbox = Signal.channel.notin_(("internal", "assistant"))
    my_unread = await _count(
        open_status, unread, customer_inbox, Signal.assigned_user_id == user_id
    )
    unassigned_unread = await _count(
        open_status, unread, customer_inbox, Signal.assigned_user_id.is_(None)
    )
    all_unread = await _count(open_status, unread, customer_inbox)

    agents_attention = 0
    no_reply_suggestions = 0
    if include_agents_attention:
        open_dec = await _signals_with_open_decisions(session, tenant_id)
        agents_attention = len(open_dec)
        no_reply_suggestions = await count_no_reply_suggestions(session, tenant_id)

    return {
        "inbox_unread": my_unread + unassigned_unread,
        "inbox_by_queue": {
            "my": my_unread,
            "unassigned": unassigned_unread,
            "all": all_unread,
        },
        "agents_attention": agents_attention,
        "no_reply_suggestions": no_reply_suggestions,
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
    unread: bool = False,
    needs_reply: bool = False,
    needs_decision: bool = False,
    pinned_only: bool = False,
    page: int = 1,
    per_page: int = 30,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, Any]:
    pinned = await _pinned_ids(session, tenant_id, user_id)
    query = select(Signal).where(Signal.tenant_id == tenant_id)
    acl = _visibility_predicate(visible_account_ids)
    if acl is not None:
        query = query.where(acl)

    if folder == "external":
        query = query.where(Signal.channel.in_(EXTERNAL_CHANNELS))
    elif folder == "internal":
        query = query.where(Signal.channel == "internal")
    elif folder == "inbox":
        # Customer work only. Internal agent runs live under Agent-runs;
        # assistant chats live under Assistant.
        query = query.where(Signal.channel.notin_(("internal", "assistant")))
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
        # Parked conversations: timed wake or wait-until-reply (no wake time).
        query = query.where(Signal.status == "pending")
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

    if unread:
        query = query.where(Signal.has_unread.is_(True))
    if pinned_only:
        query = query.where(Signal.id.in_(pinned) if pinned else Signal.id.is_(None))
    if needs_reply:
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
                SignalMessage.kind.in_(("user_message", "agent_message")),
                # Same skip as list previews: mock/placeholder bodies are not a reply.
                ~func.lower(SignalMessage.body_text).like("[mock]%"),
                ~func.lower(SignalMessage.body_text).like("i received your message about:%"),
            )
            .group_by(SignalMessage.signal_id)
            .subquery()
        )
        inbound_last = (
            select(last_user.c.signal_id)
            .select_from(
                last_user.outerjoin(last_agent, last_user.c.signal_id == last_agent.c.signal_id)
            )
            .where(or_(last_agent.c.at.is_(None), last_user.c.at > last_agent.c.at))
        )
        query = query.where(
            Signal.status == "open",
            or_(Signal.has_unread.is_(True), Signal.id.in_(inbound_last)),
        )
    if needs_decision:
        open_dec = await _signals_with_open_decisions(session, tenant_id)
        query = query.where(Signal.id.in_(open_dec) if open_dec else Signal.id.is_(None))

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
        query = query.where(
            Signal.subject.ilike(like)
            | Signal.contact_email.ilike(like)
            | Signal.contact_name.ilike(like)
            | body_match
            | company_match
            | attachment_match
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

    previews = await _latest_message_previews(session, tenant_id, [t.id for t in threads])
    open_dec = await _signals_with_open_decisions(session, tenant_id) if threads else set()
    items = []
    for t in threads:
        agent = agents_by_id.get(t.agent_id) if t.agent_id else None
        if not agent and t.project_id:
            agent = project_po_agents.get(t.project_id)
        preview, direction = previews.get(t.id, ("", ""))
        items.append(
            serialize_thread(
                t,
                is_pinned=t.id in pinned,
                user_num=user_num,
                agent=agent,
                last_preview=preview,
                last_direction=direction,
                has_open_decision=t.id in open_dec,
            )
        )
    next_page = page + 1 if page * per_page < items_total else None
    return {"items": items, "curPage": page, "itemsTotal": items_total, "nextPage": next_page}


async def get_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    *,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, Any] | None:
    result = await session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return None
    if (
        visible_account_ids is not None
        and signal.channel_account_id
        and signal.channel_account_id not in visible_account_ids
    ):
        # Hidden accounts 404 for members: existence must not leak.
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
        "thread": serialize_thread(
            signal,
            is_pinned=signal_id in pinned,
            agent=agent,
            has_open_decision=signal_id in await _signals_with_open_decisions(session, tenant_id),
        ),
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
    author_user_id: UUID | None = None,
    author_name: str = "",
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
    prev_mentions = {int(num) for _, num in MENTION_PATTERN.findall(message.body_text or "")}
    message.body_text = body_text
    message.body_preview = body_text[:200]
    # Notes are created with a body_html mirror (see reply_to_thread); keep it
    # in sync or the timeline keeps rendering the stale HTML after an edit.
    message.body_html = f"<p>{body_text}</p>"
    session.add(message)
    await session.commit()
    # A mention added during the edit must still ping the teammate; mentions
    # that were already in the note stay silent (no duplicate notifications).
    new_mentions = {int(num) for _, num in MENTION_PATTERN.findall(body_text or "")}
    added = new_mentions - prev_mentions
    if added:
        signal = await _get_signal_row(session, tenant_id, signal_id)
        if signal:
            added_only = MENTION_PATTERN.sub(
                lambda m: m.group(0) if int(m.group(2)) in added else f"@{m.group(1)}",
                body_text or "",
            )
            await notify_mentions(
                session,
                tenant_id,
                signal,
                body_text=added_only,
                author_user_id=author_user_id,
                author_name=author_name,
            )
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
        from app.services import signal_tags as tag_svc

        normalized = tag_svc.normalize_tags(tags)
        signal.tags_json = json.dumps(normalized)
        # Operator-typed tags join the tenant vocabulary, so the sidebar,
        # settings, and AI tagging all see the same list.
        await tag_svc.ensure_tags(session, tenant_id, normalized, user_id=user_id)
        tags = normalized
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
    if signal.status != before_status and signal.status in {"pending", "closed", "spam"}:
        parked = {
            "pending": "human_snoozed",
            "closed": "human_closed",
            "spam": "human_spam",
        }[signal.status]
        await _defer_open_reply_suggestions(session, tenant_id, signal_id, reason=parked)
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
            tenant_id=tenant_id,
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


BULK_ACTIONS = ("close", "reopen", "spam", "read", "unread", "assign", "snooze")


async def bulk_update_threads(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    signal_ids: list[UUID],
    action: str,
    assignee_id: int | None = None,
    snoozed_until: datetime | None = None,
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
        elif action == "snooze":
            signal.status = "pending"
            signal.snoozed_until = snoozed_until
        signal.updated_at = now
        session.add(signal)
        if action in ("close", "spam"):
            # A closed/spam thread must not keep a pending reply card in the
            # decision queue: nobody is going to send that draft anymore.
            await _defer_open_reply_suggestions(
                session, tenant_id, signal.id, reason="thread_closed"
            )
        if action in ("close", "reopen", "spam", "assign", "snooze"):
            event_payload: dict[str, Any] = {"bulk": action}
            if action == "assign" and assignee_id is not None:
                # The timeline chip names the assignee from this field.
                event_payload["assigned_to"] = assignee_id
            session.add(
                SignalEvent(
                    signal_id=signal.id,
                    tenant_id=tenant_id,
                    event_type="thread_updated",
                    actor_type="user",
                    actor_id=str(user_id),
                    payload_json=json.dumps(event_payload),
                )
            )
    # One audit event per bulk action with the before-states; mark-read noise
    # (read/unread) is intentionally excluded from the govern audit.
    if signals and action in ("close", "reopen", "spam", "assign", "snooze"):
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


async def _defer_open_reply_suggestions(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    reason: str = "human_replied",
) -> None:
    """Clear leftover 'Suggested reply' cards once a human already answered.

    Only reply-suggestion cards are deferred. Platform-change reviews and
    other awaiting_human decisions stay open.
    """
    result = await session.execute(
        select(DecisionRequest).where(
            DecisionRequest.tenant_id == tenant_id,
            DecisionRequest.signal_id == signal_id,
            DecisionRequest.status == "awaiting_human",
            DecisionRequest.platform_change_id.is_(None),
            DecisionRequest.title.in_(("Suggested reply", "Reply to customer message")),
        )
    )
    now = datetime.utcnow()
    for decision in result.scalars().all():
        decision.status = "deferred"
        decision.resolved_at = now
        decision.chosen_option_id = reason
        session.add(decision)
        if decision.notification_id:
            # Clear the paired bell item too: the card no longer needs anyone.
            notif = (
                await session.execute(
                    select(Notification).where(Notification.id == decision.notification_id)
                )
            ).scalar_one_or_none()
            if notif and notif.status == "unread":
                notif.status = "read"
                session.add(notif)


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
        from app.services.signatures import resolve_from_display_name, resolve_signature_html

        # Manual replies are sent as the operator: their signature (mailbox
        # signature as fallback) is appended server-side.
        signature_html = await resolve_signature_html(
            session, tenant_id, send_as="user", user_id=user_id
        )
        from_display_name = await resolve_from_display_name(
            session, tenant_id, send_as="user", user_id=user_id
        )
        delivery = await deliver_outbound(
            session,
            signal,
            body_text=body_text,
            body_html=body_html,
            cc=cc,
            bcc=bcc,
            attachments=attachments,
            signature_html=signature_html,
            from_display_name=from_display_name,
        )
        send_status = delivery.status
        if send_status == "skipped":
            send_status = "sent"
        if delivery.body_html:
            body_html = delivery.body_html
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
    if direction == "outbound":
        signal.has_unread = False
    if direction == "outbound":
        await _defer_open_reply_suggestions(session, tenant_id, signal_id)
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
        from app.services.signatures import resolve_from_display_name, resolve_signature_html

        send_as = "user" if message.author_user_id else "agent"
        signature_html = await resolve_signature_html(
            session,
            message.tenant_id,
            send_as=send_as,
            user_id=message.author_user_id,
            agent_id=message.author_agent_id or signal.agent_id,
        )
        from_display_name = await resolve_from_display_name(
            session,
            message.tenant_id,
            send_as=send_as,
            user_id=message.author_user_id,
            agent_id=message.author_agent_id or signal.agent_id,
        )
        try:
            delivery = await deliver_outbound(
                session,
                signal,
                body_text=message.body_text,
                body_html=message.body_html or None,
                cc=meta.get("cc"),
                bcc=meta.get("bcc"),
                attachments=attachments or None,
                signature_html=signature_html,
                from_display_name=from_display_name,
            )
            status = delivery.status
            if delivery.body_html:
                message.body_html = delivery.body_html
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
            tenant_id=tenant_id,
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
        # Auto-reply only when the thread explicitly involves an agent (pinned,
        # in the message history, or via its project) — the lead-agent fallback
        # would otherwise answer every bare internal thread.
        agent = await _resolve_thread_agent(
            session, tenant_id, signal, fallback_to_lead=False
        )
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
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.tenant_id == tenant_id, User.is_active.is_(True))
    )
    members = []
    for user, membership in result.all():
        members.append(
            {
                "id": user_numeric_id(user.id),
                "uuid": str(user.id),
                "name": user.display_name or user.email,
                "email": user.email,
                "avatar_url": user.avatar_url,
                "role": membership.role,
            }
        )
    return members


def _parse_tags(tags_json: str | None) -> list[str]:
    try:
        tags = json.loads(tags_json or "[]")
    except json.JSONDecodeError:
        return []
    return [t for t in tags if isinstance(t, str) and t.strip()]


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
    # Sender identity for approved reply suggestions ("user" | "agent").
    send_as: str | None = None,
    # External resolution channel (e.g. "slack:U123"); lands in the event payload.
    source: str | None = None,
) -> dict[str, Any]:
    from app.services.decisions import resolve_decision_message

    if send_as is not None and send_as not in ("user", "agent"):
        raise HTTPException(status_code=400, detail="send_as must be 'user' or 'agent'")

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
    if send_as is not None:
        payload_override["send_as"] = send_as

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

    # Approving one draft dismisses leftover sibling suggestion cards.
    if action in ("approve", "approved"):
        await _defer_open_reply_suggestions(
            session, tenant_id, signal_id, reason="human_approved_sibling"
        )

    await session.commit()

    # Approving "create a task" must actually open a follow-up on Agenda,
    # not only dismiss the card. create_agent_task commits on its own.
    created_task_id: str | None = None
    if user_id and action in ("approved", "approve") and option_id == "create_task":
        from app.services.orchestration.dispatcher import create_agent_task

        sig_result = await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
        signal = sig_result.scalar_one_or_none()
        if signal:
            who = signal.contact_email or signal.contact_name or "conversation"
            task = await create_agent_task(
                session,
                tenant_id,
                title=f"Follow up: {signal.subject or who}"[:120],
                description=f"Created from a decision on this conversation ({who}).",
                signal_id=signal.id,
                created_by=user_id,
                trigger_type="decision",
                auto_start=False,
            )
            created_task_id = str(task.id)

    return {
        "ok": True,
        "action": action,
        "option_id": option_id,
        "rule_suggestion": rule_suggestion,
        "task_id": created_task_id,
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


async def dismiss_no_reply_suggestions(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    also_close_threads: bool = False,
) -> dict[str, Any]:
    """Clear backlog of awaiting 'No reply needed' tip cards in one action.

    Resolves each as keep_open (card gone, thread stays open) unless
    ``also_close_threads`` is set. Does not teach inbox rules — bulk dismiss
    is cleanup, not a preference signal.
    """
    from app.services.automated_mail import NO_REPLY_DECISION_TITLE
    from app.services.decisions import resolve_decision_message

    rows = (
        await session.execute(
            select(DecisionRequest, SignalMessage.signal_id)
            .join(SignalMessage, SignalMessage.decision_id == DecisionRequest.id)
            .join(Signal, Signal.id == SignalMessage.signal_id)
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.title == NO_REPLY_DECISION_TITLE,
                Signal.status.notin_(("closed", "spam")),
            )
        )
    ).all()

    seen_decisions: set[UUID] = set()
    dismissed = 0
    closed = 0
    for decision, signal_id in rows:
        if decision.id in seen_decisions:
            continue
        seen_decisions.add(decision.id)
        await resolve_decision_message(
            session,
            tenant_id,
            decision.id,
            action="approve",
            user_id=user_id,
            option_id="keep_open",
        )
        session.add(
            SignalEvent(
                signal_id=signal_id,
                tenant_id=tenant_id,
                event_type="decision_dismissed",
                actor_type="user",
                actor_id=str(user_id),
                payload_json=json.dumps(
                    {
                        "decision_id": str(decision.id),
                        "action": "dismiss",
                        "option_id": "keep_open",
                        "via": "bulk_no_reply",
                    }
                ),
            )
        )
        dismissed += 1
        if also_close_threads:
            signal = (
                await session.execute(
                    select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
                )
            ).scalar_one_or_none()
            if signal and signal.status == "open":
                signal.status = "closed"
                signal.updated_at = datetime.utcnow()
                session.add(signal)
                session.add(
                    SignalEvent(
                        signal_id=signal_id,
                        tenant_id=tenant_id,
                        event_type="thread_updated",
                        actor_type="user",
                        actor_id=str(user_id),
                        payload_json=json.dumps({"status": "closed", "bulk": "close", "via": "bulk_no_reply"}),
                    )
                )
                closed += 1

    await session.commit()
    return {"ok": True, "dismissed": dismissed, "closed": closed}
