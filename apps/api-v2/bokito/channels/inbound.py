"""Shared inbound path: any channel message becomes a message in a conversation.

`ingest` resolves the contact, finds or creates the conversation, appends the
inbound message and queues the agent. Channel adapters only parse.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.connection import Connection
from bokito.domain.conversation import Channel, Conversation, Direction, Message, MessageKind
from bokito.services import connections as conn_svc
from bokito.services import contacts as contact_svc
from bokito.services import conversation as conv_svc
from bokito.workers.queue import enqueue


@dataclass
class InboundMessage:
    channel: Channel
    external_thread_id: str | None
    external_message_id: str | None
    body: str
    subject: str = ""
    html: str | None = None
    sender_name: str = ""
    sender_email: str | None = None
    sender_phone: str | None = None
    sender_handle: tuple[str, str] | None = None
    attachments: list[dict[str, Any]] = field(default_factory=list)
    received_at: datetime | None = None
    meta: dict[str, Any] = field(default_factory=dict)


async def ingest(
    session: AsyncSession,
    connection: Connection,
    inbound: InboundMessage,
    *,
    queue_agent: bool = True,
) -> tuple[Conversation, Message, bool]:
    """Returns (conversation, message, is_duplicate)."""
    tenant_id = connection.tenant_id
    if inbound.external_message_id:
        from sqlalchemy import select

        dup = await session.scalar(
            select(Message).where(
                Message.tenant_id == tenant_id,
                Message.external_id == inbound.external_message_id,
            )
        )
        if dup:
            conv = await session.get(Conversation, dup.conversation_id)
            assert conv is not None
            return conv, dup, True

    contact = await contact_svc.resolve_or_create(
        session,
        tenant_id,
        email=inbound.sender_email,
        phone=inbound.sender_phone,
        name=inbound.sender_name,
        handle=inbound.sender_handle,
    )
    conv, created = await conv_svc.get_or_create(
        session,
        tenant_id,
        channel=inbound.channel,
        external_id=inbound.external_thread_id,
        subject=inbound.subject or inbound.body[:80],
        connection_id=connection.id,
        contact_id=contact.id,
        participants=[{"contact_id": str(contact.id), "name": contact.name}],
    )
    if conv.contact_id is None:
        conv.contact_id = contact.id
    if created and connection.agent_id:
        conv.agent_id = connection.agent_id
    msg = await conv_svc.append_message(
        session,
        conv,
        kind=MessageKind.message,
        direction=Direction.inbound,
        body=inbound.body,
        html=inbound.html,
        author_contact_id=contact.id,
        author_label=contact.name or inbound.sender_email or inbound.sender_phone or "",
        external_id=inbound.external_message_id,
        attachments=inbound.attachments,
        meta=inbound.meta,
        created_at=inbound.received_at,
    )
    await conn_svc.touch(session, connection)
    await session.commit()
    if queue_agent:
        await enqueue("handle_inbound_job", str(conv.id))
    return conv, msg, False


def new_external_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex}"
