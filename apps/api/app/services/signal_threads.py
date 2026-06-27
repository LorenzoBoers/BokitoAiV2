"""Signal thread service with inbox-parity for the unified Messages hub."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
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
    return value.isoformat() if value else None


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
        "priority": signal.priority,
        "assigned_to_user_id": assignee_num,
        "tags": json.loads(signal.tags_json or "[]"),
        "ai_paused": signal.ai_paused,
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
    return {
        "id": str(message.id),
        "thread_id": str(message.signal_id),
        "signal_id": str(message.signal_id),
        "connection_id": None,
        "kind": message.kind,
        "direction": message.direction,
        "from_address": message.from_address,
        "to_addresses": message.to_addresses,
        "subject": message.subject,
        "body_preview": message.body_preview or message.body_text[:200],
        "body_text": message.body_text,
        "body_html": message.body_html or None,
        "graph_message_id": message.external_id,
        "in_reply_to": None,
        "author_user_id": author_num,
        "is_read": message.direction != "inbound",
        "send_status": message.send_status,
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
        # No status filter: every thread in the active folder/channel scope.
        pass
    elif view == "all_open":
        query = query.where(Signal.status == "open")
    elif view == "mine":
        query = query.where(Signal.status == "open", Signal.assigned_user_id == user_id)
    elif view == "unassigned":
        query = query.where(Signal.status == "open", Signal.assigned_user_id.is_(None))
    elif view == "pending":
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
        query = query.where(Signal.tags_json.like(f'%"{tag}"%'))

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
            pass

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
        query = query.where(Signal.subject.ilike(like) | Signal.contact_email.ilike(like))

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
        select(SignalMessage).where(SignalMessage.signal_id == signal_id).order_by(SignalMessage.created_at)
    )
    messages = list(messages_result.scalars().all())
    decision_ids = [m.decision_id for m in messages if m.decision_id]
    decisions_by_id: dict[UUID, DecisionRequest] = {}
    if decision_ids:
        dr = await session.execute(
            select(DecisionRequest).where(DecisionRequest.id.in_(decision_ids))
        )
        decisions_by_id = {d.id: d for d in dr.scalars().all()}
    events_result = await session.execute(
        select(SignalEvent).where(SignalEvent.signal_id == signal_id).order_by(SignalEvent.created_at)
    )
    rev_map = {v: k for k, v in (await _user_map(session, tenant_id)).items()}
    agent = await _resolve_thread_agent(session, tenant_id, signal, messages)
    return {
        "thread": serialize_thread(signal, is_pinned=signal_id in pinned, agent=agent),
        "messages": [
            serialize_message(m, decision=decisions_by_id.get(m.decision_id) if m.decision_id else None)
            for m in messages
        ],
        "events": [serialize_event(e, user_num_map=rev_map) for e in events_result.scalars().all()],
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
) -> dict[str, Any] | None:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    if status is not None:
        signal.status = status
    if assigned_to_user_id is not None:
        user_map = await _user_map(session, tenant_id)
        signal.assigned_user_id = user_map.get(assigned_to_user_id) if assigned_to_user_id else None
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
                }
            ),
        )
    )
    await session.commit()
    await session.refresh(signal)
    await publish_thread_update(signal)
    pinned = await _pinned_ids(session, tenant_id, user_id)
    return serialize_thread(signal, is_pinned=signal_id in pinned, user_num=user_num)


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


async def delete_thread(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> bool:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return False
    for model in (SignalMessage, SignalEvent, SignalThreadPin):
        rows = await session.execute(select(model).where(model.signal_id == signal_id))
        for row in rows.scalars().all():
            await session.delete(row)
    await session.delete(signal)
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
) -> dict[str, Any] | None:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    now = datetime.utcnow()
    send_status = None
    if direction == "outbound":
        from app.channels import deliver_outbound

        send_status = await deliver_outbound(
            session, signal, body_text=body_text, body_html=body_html
        )
        if send_status == "skipped":
            send_status = "sent"
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
        send_status=send_status,
        received_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.updated_at = now
    if action == "send_and_close":
        signal.status = "closed"
    elif action == "send_and_pending":
        signal.status = "pending"
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
    # Internal agent threads are two-way chats: when an operator posts a reply
    # (not an internal note), run the thread's agent and append its response.
    # External channels (email/whatsapp/widget) and assistant-channel threads
    # (handled by /api/chat) are intentionally excluded.
    if direction == "outbound" and signal.channel == "internal" and not signal.ai_paused:
        await _generate_agent_reply(session, tenant_id, user_id, signal, attachments=attachments)
    return serialize_message(message)


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
        )
        reply_text = ""
        tokens: dict = {"input_tokens": 0, "output_tokens": 0}
        async for event in loop.stream_chat(history, attachments=attachments):
            if event["type"] == "done":
                reply_text = event.get("text", "") or "Done."
                tokens = event.get("usage", tokens)
        await append_signal_chat_message(
            session,
            signal,
            role="assistant",
            content=reply_text,
            author_agent_id=agent.id,
            metadata={"usage": tokens},
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
                "avatar_url": None,
            }
        )
    return members


async def sync_status(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    return []


async def resolve_message_decision(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    message_id: UUID,
    *,
    action: str,
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
    await resolve_decision_message(session, tenant_id, message.decision_id, action=action, user_id=user_id)
    session.add(
        SignalMessage(
            signal_id=signal_id,
            tenant_id=tenant_id,
            kind="system_event",
            direction="system",
            role="system",
            body_text=f"Decision {action}",
            body_preview=f"Decision {action}",
            author_user_id=user_id,
        )
    )
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type=f"decision_{action}",
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps({"decision_id": str(message.decision_id), "action": action}),
        )
    )
    await session.commit()
    return {"ok": True, "action": action}
