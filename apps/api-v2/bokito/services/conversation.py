"""Conversation service: the one thread model.

Everything that happens to a conversation is a message. Status, assignment
and tags are the only mutable header fields; the thread is the log.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.base import utcnow
from bokito.domain.conversation import (
    Channel,
    Conversation,
    ConversationStatus,
    Direction,
    Message,
    MessageKind,
    SendStatus,
)
from bokito.domain.orient import Contact
from bokito.errors import NotFound
from bokito.realtime.broker import publish


@dataclass
class ConversationFilters:
    status: list[ConversationStatus] = field(default_factory=list)
    channel: Channel | None = None
    assignee_user_id: uuid.UUID | None = None
    unassigned: bool = False
    contact_id: uuid.UUID | None = None
    signal_type_id: uuid.UUID | None = None
    tag: str | None = None
    q: str | None = None
    queue: str | None = None  # attention | mine | agents | waiting | all
    follow_up_due: bool = False


async def get_or_create(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    channel: Channel,
    external_id: str | None,
    subject: str = "",
    connection_id: uuid.UUID | None = None,
    contact_id: uuid.UUID | None = None,
    participants: list[Any] | None = None,
) -> tuple[Conversation, bool]:
    if external_id:
        existing = await session.scalar(
            select(Conversation).where(
                Conversation.tenant_id == tenant_id,
                Conversation.channel == channel,
                Conversation.external_id == external_id,
            )
        )
        if existing:
            return existing, False
    now = utcnow()
    conv = Conversation(
        tenant_id=tenant_id,
        channel=channel,
        external_id=external_id,
        subject=subject[:500],
        connection_id=connection_id,
        contact_id=contact_id,
        participants=participants or [],
        last_activity_at=now,
    )
    session.add(conv)
    await session.flush()
    await publish(tenant_id, "conversations", {"event": "created", "id": str(conv.id)})
    return conv, True


async def get(
    session: AsyncSession, tenant_id: uuid.UUID, conversation_id: uuid.UUID
) -> Conversation:
    conv = await session.get(Conversation, conversation_id)
    if not conv or conv.tenant_id != tenant_id:
        raise NotFound("conversation not found", code="conversation_not_found")
    return conv


def _apply_filters(
    stmt: Select, tenant_id: uuid.UUID, f: ConversationFilters, user_id: uuid.UUID | None
):
    stmt = stmt.where(Conversation.tenant_id == tenant_id)
    if f.queue == "attention":
        stmt = stmt.where(
            Conversation.status == ConversationStatus.open,
            or_(Conversation.handoff.is_(True), Conversation.unread.is_(True)),
        )
    elif f.queue == "mine" and user_id:
        stmt = stmt.where(Conversation.assignee_user_id == user_id)
    elif f.queue == "agents":
        stmt = stmt.where(Conversation.agent_id.is_not(None), Conversation.handoff.is_(False))
    elif f.queue == "waiting":
        stmt = stmt.where(Conversation.status == ConversationStatus.waiting)
    if f.status:
        stmt = stmt.where(Conversation.status.in_(f.status))
    elif f.queue in (None, "all") and not f.follow_up_due:
        stmt = stmt.where(Conversation.status != ConversationStatus.closed)
    if f.channel:
        stmt = stmt.where(Conversation.channel == f.channel)
    if f.assignee_user_id:
        stmt = stmt.where(Conversation.assignee_user_id == f.assignee_user_id)
    if f.unassigned:
        stmt = stmt.where(Conversation.assignee_user_id.is_(None))
    if f.contact_id:
        stmt = stmt.where(Conversation.contact_id == f.contact_id)
    if f.signal_type_id:
        stmt = stmt.where(Conversation.signal_type_id == f.signal_type_id)
    if f.tag:
        stmt = stmt.where(Conversation.tags.contains([f.tag]))
    if f.follow_up_due:
        stmt = stmt.where(
            Conversation.follow_up_at.is_not(None), Conversation.follow_up_at <= utcnow()
        )
    if f.q:
        like = f"%{f.q.strip()}%"
        stmt = stmt.outerjoin(Contact, Contact.id == Conversation.contact_id).where(
            or_(
                Conversation.subject.ilike(like),
                Conversation.compact_summary.ilike(like),
                Contact.name.ilike(like),
                Contact.email.ilike(like),
            )
        )
    return stmt


async def list_conversations(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    f: ConversationFilters,
    *,
    user_id: uuid.UUID | None = None,
    limit: int = 50,
    cursor: datetime | None = None,
) -> list[Conversation]:
    stmt = _apply_filters(select(Conversation), tenant_id, f, user_id)
    if cursor:
        stmt = stmt.where(Conversation.last_activity_at < cursor)
    stmt = stmt.order_by(Conversation.last_activity_at.desc()).limit(limit)
    return list((await session.scalars(stmt)).all())


async def queue_counts(
    session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID | None
) -> dict[str, int]:
    out: dict[str, int] = {}
    for queue in ("attention", "mine", "agents", "waiting", "all"):
        stmt = _apply_filters(
            select(func.count(Conversation.id)),
            tenant_id,
            ConversationFilters(queue=queue),
            user_id,
        )
        out[queue] = int(await session.scalar(stmt) or 0)
    return out


async def append_message(
    session: AsyncSession,
    conv: Conversation,
    *,
    kind: MessageKind = MessageKind.message,
    direction: Direction = Direction.internal,
    body: str = "",
    html: str | None = None,
    author_user_id: uuid.UUID | None = None,
    author_agent_id: uuid.UUID | None = None,
    author_contact_id: uuid.UUID | None = None,
    author_label: str = "",
    external_id: str | None = None,
    attachments: list[Any] | None = None,
    send_status: SendStatus = SendStatus.none,
    ai_generated: bool = False,
    run_id: uuid.UUID | None = None,
    meta: dict[str, Any] | None = None,
    created_at: datetime | None = None,
) -> Message:
    now = created_at or utcnow()
    msg = Message(
        tenant_id=conv.tenant_id,
        conversation_id=conv.id,
        kind=kind,
        direction=direction,
        body=body,
        html=html,
        author_user_id=author_user_id,
        author_agent_id=author_agent_id,
        author_contact_id=author_contact_id,
        author_label=author_label,
        external_id=external_id,
        attachments=attachments or [],
        send_status=send_status,
        ai_generated=ai_generated,
        run_id=run_id,
        meta=meta or {},
        created_at=now,
    )
    session.add(msg)
    conv.last_activity_at = now
    if direction == Direction.inbound and kind == MessageKind.message:
        conv.last_inbound_at = now
        conv.unread = True
        if conv.status in (ConversationStatus.waiting, ConversationStatus.snoozed):
            conv.status = ConversationStatus.open
        if conv.status == ConversationStatus.closed:
            conv.status = ConversationStatus.open
            conv.closed_at = None
            conv.meta = {**(conv.meta or {}), "reopened": True}
    if direction == Direction.outbound and kind == MessageKind.message:
        conv.unread = False
    await session.flush()
    await publish(
        conv.tenant_id,
        f"conversation:{conv.id}",
        {"event": "message", "id": str(msg.id), "kind": kind.value},
    )
    await publish(conv.tenant_id, "conversations", {"event": "updated", "id": str(conv.id)})
    return msg


async def list_messages(
    session: AsyncSession,
    conv: Conversation,
    *,
    limit: int = 100,
    before: datetime | None = None,
    kinds: list[MessageKind] | None = None,
) -> list[Message]:
    stmt = select(Message).where(Message.conversation_id == conv.id)
    if before:
        stmt = stmt.where(Message.created_at < before)
    if kinds:
        stmt = stmt.where(Message.kind.in_(kinds))
    stmt = stmt.order_by(Message.created_at.desc()).limit(limit)
    rows = list((await session.scalars(stmt)).all())
    rows.reverse()
    return rows


async def set_status(
    session: AsyncSession, conv: Conversation, status: ConversationStatus, *, by: str = ""
) -> Conversation:
    if conv.status == status:
        return conv
    conv.status = status
    conv.closed_at = utcnow() if status == ConversationStatus.closed else None
    if status == ConversationStatus.closed:
        conv.unread = False
        conv.follow_up_at = None
    await append_message(
        session,
        conv,
        kind=MessageKind.system,
        body=f"Status set to {status.value}",
        meta={"status": status.value, "by": by},
    )
    return conv


async def assign(
    session: AsyncSession,
    conv: Conversation,
    *,
    user_id: uuid.UUID | None = None,
    agent_id: uuid.UUID | None = None,
    by: str = "",
) -> Conversation:
    conv.assignee_user_id = user_id
    if agent_id is not None or user_id is None:
        conv.agent_id = agent_id
    if user_id:
        conv.handoff = False
    await append_message(
        session,
        conv,
        kind=MessageKind.system,
        body="Assigned",
        meta={
            "user_id": str(user_id) if user_id else None,
            "agent_id": str(agent_id) if agent_id else None,
            "by": by,
        },
    )
    return conv


async def set_tags(session: AsyncSession, conv: Conversation, tags: list[str]) -> Conversation:
    conv.tags = sorted({t.strip().lower() for t in tags if t.strip()})
    await session.flush()
    await publish(conv.tenant_id, "conversations", {"event": "updated", "id": str(conv.id)})
    return conv


async def mark_handoff(
    session: AsyncSession, conv: Conversation, reason: str, *, by: str
) -> Conversation:
    conv.handoff = True
    conv.unread = True
    await append_message(
        session,
        conv,
        kind=MessageKind.system,
        body=f"Handed off to a colleague: {reason}" if reason else "Handed off to a colleague",
        meta={"handoff": True, "reason": reason, "by": by},
    )
    return conv


async def set_follow_up(
    session: AsyncSession, conv: Conversation, at: datetime | None
) -> Conversation:
    conv.follow_up_at = at
    if at:
        conv.status = ConversationStatus.snoozed if at > utcnow() else conv.status
    await session.flush()
    return conv
