"""Conversation tools: reply, note, status, assign, tags, handoff, signal."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field
from sqlalchemy import select

from bokito.channels.base import apply_disclosure, deliver
from bokito.domain.connection import Connection
from bokito.domain.conversation import ConversationStatus, Direction, MessageKind, SendStatus
from bokito.domain.orient import Contact, Signal, SignalStatus, SignalType
from bokito.domain.work import Agent
from bokito.errors import NotFound
from bokito.services import conversation as conv_svc
from bokito.services import policy as policy_svc
from bokito.tools.registry import ToolContext, tool


class ConversationArgs(BaseModel):
    conversation_id: uuid.UUID


class ReplyArgs(ConversationArgs):
    body: str = Field(min_length=1, max_length=20000)
    html: str | None = None
    draft: bool = Field(default=False, description="Save as draft instead of sending")


@tool(
    "reply",
    description="Send a reply to the customer on the conversation's channel.",
    category="communicate",
)
async def reply(ctx: ToolContext, args: ReplyArgs) -> dict:
    conv = await conv_svc.get(ctx.session, ctx.tenant_id, args.conversation_id)
    connection = (
        await ctx.session.get(Connection, conv.connection_id) if conv.connection_id else None
    )
    agent = await ctx.session.get(Agent, ctx.agent_id) if ctx.agent_id else None
    contact = await ctx.session.get(Contact, conv.contact_id) if conv.contact_id else None
    policy = await policy_svc.get_policy(ctx.session, ctx.tenant_id)
    ai = ctx.principal.trust == "agent"
    body = apply_disclosure(
        args.body,
        ai_generated=ai,
        connection=connection,
        policy=policy,
        language=(contact.language if contact and contact.language else "") or "en",
    )
    msg = await conv_svc.append_message(
        ctx.session,
        conv,
        kind=MessageKind.message,
        direction=Direction.outbound,
        body=body,
        html=args.html,
        author_user_id=ctx.principal.user_id if not ai else None,
        author_agent_id=ctx.agent_id,
        author_label=agent.name if agent else "",
        send_status=SendStatus.draft if args.draft else SendStatus.queued,
        ai_generated=ai,
        run_id=ctx.run_id,
    )
    if not args.draft:
        await deliver(ctx.session, connection, conv, msg)
        if conv.status == ConversationStatus.open and ai:
            conv.status = ConversationStatus.waiting
    return {"message_id": str(msg.id), "send_status": msg.send_status.value}


class NoteArgs(ConversationArgs):
    body: str = Field(min_length=1, max_length=20000)


@tool("add_note", description="Add an internal note to a conversation.", category="write")
async def add_note(ctx: ToolContext, args: NoteArgs) -> dict:
    conv = await conv_svc.get(ctx.session, ctx.tenant_id, args.conversation_id)
    msg = await conv_svc.append_message(
        ctx.session,
        conv,
        kind=MessageKind.note,
        direction=Direction.internal,
        body=args.body,
        author_user_id=ctx.principal.user_id,
        author_agent_id=ctx.agent_id,
        ai_generated=ctx.principal.trust == "agent",
        run_id=ctx.run_id,
    )
    return {"message_id": str(msg.id)}


class StatusArgs(ConversationArgs):
    status: ConversationStatus
    follow_up_at: datetime | None = None


@tool(
    "set_status",
    description="Open, close, snooze or mark a conversation as waiting.",
    category="write",
)
async def set_status(ctx: ToolContext, args: StatusArgs) -> dict:
    conv = await conv_svc.get(ctx.session, ctx.tenant_id, args.conversation_id)
    await conv_svc.set_status(ctx.session, conv, args.status, by=ctx.principal.actor)
    if args.follow_up_at is not None:
        await conv_svc.set_follow_up(ctx.session, conv, args.follow_up_at)
    return {"status": conv.status.value}


class AssignArgs(ConversationArgs):
    user_id: uuid.UUID | None = None
    agent_id: uuid.UUID | None = None


@tool("assign", description="Assign a conversation to a colleague or an agent.", category="write")
async def assign(ctx: ToolContext, args: AssignArgs) -> dict:
    conv = await conv_svc.get(ctx.session, ctx.tenant_id, args.conversation_id)
    if args.agent_id:
        agent = await ctx.session.get(Agent, args.agent_id)
        if not agent or agent.tenant_id != ctx.tenant_id:
            raise NotFound("agent not found", code="agent_not_found")
    await conv_svc.assign(
        ctx.session, conv, user_id=args.user_id, agent_id=args.agent_id, by=ctx.principal.actor
    )
    return {
        "assignee_user_id": str(args.user_id) if args.user_id else None,
        "agent_id": str(args.agent_id) if args.agent_id else None,
    }


class TagsArgs(ConversationArgs):
    tags: list[str]


@tool("set_tags", description="Replace the tags on a conversation.", category="write")
async def set_tags(ctx: ToolContext, args: TagsArgs) -> dict:
    conv = await conv_svc.get(ctx.session, ctx.tenant_id, args.conversation_id)
    await conv_svc.set_tags(ctx.session, conv, args.tags)
    return {"tags": conv.tags}


class HandoffArgs(ConversationArgs):
    reason: str = ""


@tool(
    "handoff",
    description="Hand the conversation to a human colleague and stop answering automatically.",
    category="write",
)
async def handoff(ctx: ToolContext, args: HandoffArgs) -> dict:
    conv = await conv_svc.get(ctx.session, ctx.tenant_id, args.conversation_id)
    await conv_svc.mark_handoff(ctx.session, conv, args.reason, by=ctx.principal.actor)
    return {"handoff": True}


class SignalArgs(ConversationArgs):
    type_slug: str
    title: str = ""
    fields: dict = Field(default_factory=dict)
    confidence: int = Field(default=80, ge=0, le=100)


@tool(
    "recognize_signal",
    description="Type a conversation as a Signal (for example quote_request or complaint).",
    category="write",
)
async def recognize_signal(ctx: ToolContext, args: SignalArgs) -> dict:
    conv = await conv_svc.get(ctx.session, ctx.tenant_id, args.conversation_id)
    st = await ctx.session.scalar(
        select(SignalType).where(
            SignalType.tenant_id == ctx.tenant_id, SignalType.slug == args.type_slug
        )
    )
    if not st:
        raise NotFound(f"signal type {args.type_slug} not found", code="signal_type_not_found")
    existing = await ctx.session.scalar(
        select(Signal).where(
            Signal.conversation_id == conv.id,
            Signal.type_id == st.id,
            Signal.status != SignalStatus.done,
        )
    )
    if existing:
        existing.fields = {**(existing.fields or {}), **args.fields}
        existing.confidence = args.confidence
        signal = existing
    else:
        signal = Signal(
            tenant_id=ctx.tenant_id,
            conversation_id=conv.id,
            type_id=st.id,
            title=(args.title or st.name)[:300],
            fields=args.fields,
            confidence=args.confidence,
            source="agent" if ctx.principal.trust == "agent" else "operator",
        )
        ctx.session.add(signal)
    conv.signal_type_id = st.id
    await ctx.session.flush()
    await conv_svc.append_message(
        ctx.session,
        conv,
        kind=MessageKind.system,
        body=f"Recognized as {st.name}",
        meta={"signal_id": str(signal.id), "type": st.slug},
    )
    return {"signal_id": str(signal.id), "type": st.slug}
