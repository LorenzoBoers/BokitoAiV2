"""Website chat widget: the public livechat API.

Visitors get a signed session token bound to one conversation. Everything the
visitor sends is an inbound message; agent and colleague replies show up in
the same thread. Disclosure and agent name come from the connection.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from bokito.channels import base
from bokito.channels.inbound import InboundMessage, ingest, new_external_id
from bokito.config import get_settings
from bokito.deps import DbSession
from bokito.domain.connection import Connection, ConnectionKind, ConnectionStatus
from bokito.domain.conversation import Channel, Conversation, Direction, Message, MessageKind
from bokito.domain.orient import Contact
from bokito.domain.work import Agent
from bokito.errors import NotFound, Unauthorized
from bokito.services import connections as conn_svc
from bokito.services import conversation as conv_svc
from bokito.services import policy as policy_svc

router = APIRouter(prefix="/livechat", tags=["livechat"])


def _sign(conversation_id: uuid.UUID) -> str:
    key = get_settings().jwt_secret.encode()
    return hmac.new(key, str(conversation_id).encode(), hashlib.sha256).hexdigest()[:32]


def session_token(conversation_id: uuid.UUID) -> str:
    return f"{conversation_id}.{_sign(conversation_id)}"


def parse_token(token: str | None) -> uuid.UUID:
    if not token or "." not in token:
        raise Unauthorized("missing visitor token", code="visitor_token")
    cid, sig = token.split(".", 1)
    try:
        conversation_id = uuid.UUID(cid)
    except ValueError as exc:
        raise Unauthorized("bad visitor token", code="visitor_token") from exc
    if not hmac.compare_digest(sig, _sign(conversation_id)):
        raise Unauthorized("bad visitor token", code="visitor_token")
    return conversation_id


async def _connection(session, public_key: str) -> Connection:
    conn = await conn_svc.get_by_public_key(session, public_key)
    if not conn or conn.kind != ConnectionKind.widget or conn.status == ConnectionStatus.disabled:
        raise NotFound("widget not found", code="widget_not_found")
    return conn


class WidgetConfig(BaseModel):
    name: str
    agent_name: str
    greeting: str
    disclosure: str
    language: str
    theme: dict[str, Any]


@router.get("/{public_key}/config", response_model=WidgetConfig, summary="Widget configuration")
async def widget_config(public_key: str, session: DbSession) -> WidgetConfig:
    conn = await _connection(session, public_key)
    agent = await session.get(Agent, conn.agent_id) if conn.agent_id else None
    policy = await policy_svc.get_policy(session, conn.tenant_id)
    language = str(conn.settings.get("language") or "en")
    return WidgetConfig(
        name=conn.name,
        agent_name=agent.name if agent else str(conn.settings.get("agent_name") or "Assistant"),
        greeting=str(conn.settings.get("greeting") or "How can we help?"),
        disclosure=base.disclosure_line(policy, language) if conn.disclosure_enabled else "",
        language=language,
        theme=dict(conn.settings.get("theme") or {}),
    )


class SessionIn(BaseModel):
    name: str = ""
    email: str | None = None
    page_url: str = ""
    visitor_id: str | None = Field(default=None, description="Stable browser id to resume threads")
    message: str | None = Field(default=None, max_length=8000)


class SessionOut(BaseModel):
    token: str
    conversation_id: uuid.UUID


@router.post(
    "/{public_key}/sessions",
    response_model=SessionOut,
    status_code=201,
    summary="Start or resume a chat",
)
async def start_session(public_key: str, body: SessionIn, session: DbSession) -> SessionOut:
    conn = await _connection(session, public_key)
    visitor = body.visitor_id or uuid.uuid4().hex
    thread_id = f"widget:{conn.id}:{visitor}"
    existing = await session.scalar(
        select(Conversation).where(
            Conversation.tenant_id == conn.tenant_id,
            Conversation.channel == Channel.widget,
            Conversation.external_id == thread_id,
        )
    )
    if existing and existing.status.value == "closed":
        thread_id = new_external_id(f"widget:{conn.id}:{visitor}")
        existing = None
    if body.message:
        conv, _, _ = await ingest(
            session,
            conn,
            InboundMessage(
                channel=Channel.widget,
                external_thread_id=thread_id,
                external_message_id=None,
                body=body.message,
                subject=body.message[:80],
                sender_name=body.name,
                sender_email=body.email,
                sender_handle=("widget", visitor),
                meta={"page_url": body.page_url},
            ),
        )
    elif existing:
        conv = existing
    else:
        from bokito.services import contacts as contact_svc

        contact = await contact_svc.resolve_or_create(
            session,
            conn.tenant_id,
            email=body.email,
            name=body.name,
            handle=("widget", visitor),
            kind="visitor",
        )
        conv, _ = await conv_svc.get_or_create(
            session,
            conn.tenant_id,
            channel=Channel.widget,
            external_id=thread_id,
            subject="Website chat",
            connection_id=conn.id,
            contact_id=contact.id,
        )
        if conn.agent_id:
            conv.agent_id = conn.agent_id
        await session.commit()
    return SessionOut(token=session_token(conv.id), conversation_id=conv.id)


class VisitorMessage(BaseModel):
    id: uuid.UUID
    role: str
    author: str
    body: str
    created_at: datetime


class VisitorThread(BaseModel):
    conversation_id: uuid.UUID
    status: str
    messages: list[VisitorMessage]


def _visible(msg: Message) -> bool:
    return (
        msg.kind == MessageKind.message
        and msg.direction in (Direction.inbound, Direction.outbound)
        and msg.send_status.value not in ("draft", "failed")
    )


@router.get("/{public_key}/messages", response_model=VisitorThread, summary="Visitor thread")
async def visitor_messages(
    public_key: str,
    session: DbSession,
    x_visitor_token: str | None = Header(default=None),
    since: datetime | None = Query(default=None),
) -> VisitorThread:
    conn = await _connection(session, public_key)
    conversation_id = parse_token(x_visitor_token)
    conv = await session.get(Conversation, conversation_id)
    if not conv or conv.tenant_id != conn.tenant_id:
        raise NotFound("conversation not found", code="conversation_not_found")
    stmt = select(Message).where(Message.conversation_id == conv.id)
    if since:
        stmt = stmt.where(Message.created_at > since)
    rows = (await session.scalars(stmt.order_by(Message.created_at))).all()
    return VisitorThread(
        conversation_id=conv.id,
        status=conv.status.value,
        messages=[
            VisitorMessage(
                id=m.id,
                role="visitor" if m.direction == Direction.inbound else "agent",
                author=m.author_label
                or ("You" if m.direction == Direction.inbound else "Assistant"),
                body=m.body,
                created_at=m.created_at,
            )
            for m in rows
            if _visible(m)
        ],
    )


class VisitorSend(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


@router.post(
    "/{public_key}/messages",
    response_model=VisitorMessage,
    status_code=201,
    summary="Visitor sends a message",
)
async def visitor_send(
    public_key: str,
    body: VisitorSend,
    session: DbSession,
    x_visitor_token: str | None = Header(default=None),
) -> VisitorMessage:
    conn = await _connection(session, public_key)
    conversation_id = parse_token(x_visitor_token)
    conv = await session.get(Conversation, conversation_id)
    if not conv or conv.tenant_id != conn.tenant_id:
        raise NotFound("conversation not found", code="conversation_not_found")
    contact = await session.get(Contact, conv.contact_id) if conv.contact_id else None
    msg = await conv_svc.append_message(
        session,
        conv,
        kind=MessageKind.message,
        direction=Direction.inbound,
        body=body.body,
        author_contact_id=contact.id if contact else None,
        author_label=contact.name if contact and contact.name else "Visitor",
    )
    await session.commit()
    from bokito.workers.queue import enqueue

    await enqueue("handle_inbound_job", str(conv.id))
    return VisitorMessage(
        id=msg.id, role="visitor", author=msg.author_label, body=msg.body, created_at=msg.created_at
    )


async def deliver_widget(session, connection, conv, msg) -> dict[str, Any]:
    """The thread is the transport; the widget polls or streams it."""
    return {"transport": "widget"}


base.register(Channel.widget, deliver_widget)
