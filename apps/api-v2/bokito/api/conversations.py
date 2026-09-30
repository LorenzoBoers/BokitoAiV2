"""Conversations: one list, one thread, mutations through tools."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from bokito.api.schemas import ConversationOut, DecisionOut, MessageOut, SignalOut, ToolOutcomeOut
from bokito.deps import DbSession, Operator
from bokito.domain.conversation import Channel, ConversationStatus, Decision, MessageKind
from bokito.domain.orient import Signal
from bokito.services import conversation as conv_svc
from bokito.services import usage as usage_svc
from bokito.tools import execute_tool
from bokito.workers.queue import enqueue

router = APIRouter(prefix="/conversations", tags=["conversations"])


class ConversationListOut(BaseModel):
    items: list[ConversationOut]
    next_cursor: datetime | None
    counts: dict[str, int]


@router.get("", response_model=ConversationListOut, summary="List conversations")
async def list_conversations(
    session: DbSession,
    principal: Operator,
    queue: str | None = Query(default=None, pattern="^(attention|mine|agents|waiting|all)$"),
    status: list[ConversationStatus] | None = Query(default=None),
    channel: Channel | None = None,
    assignee_user_id: uuid.UUID | None = None,
    unassigned: bool = False,
    contact_id: uuid.UUID | None = None,
    signal_type_id: uuid.UUID | None = None,
    tag: str | None = None,
    q: str | None = None,
    follow_up_due: bool = False,
    cursor: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> ConversationListOut:
    f = conv_svc.ConversationFilters(
        status=status or [],
        channel=channel,
        assignee_user_id=assignee_user_id,
        unassigned=unassigned,
        contact_id=contact_id,
        signal_type_id=signal_type_id,
        tag=tag,
        q=q,
        queue=queue,
        follow_up_due=follow_up_due,
    )
    rows = await conv_svc.list_conversations(
        session, principal.tenant_id, f, user_id=principal.user_id, limit=limit, cursor=cursor
    )
    counts = await conv_svc.queue_counts(session, principal.tenant_id, principal.user_id)
    return ConversationListOut(
        items=[ConversationOut.model_validate(r) for r in rows],
        next_cursor=rows[-1].last_activity_at if len(rows) == limit else None,
        counts=counts,
    )


class ConversationCreate(BaseModel):
    subject: str = Field(default="", max_length=500)
    body: str = Field(default="", max_length=20000)
    contact_id: uuid.UUID | None = None
    channel: Channel = Channel.internal
    tags: list[str] = Field(default_factory=list)
    ask_agent: bool = Field(default=False, description="Let the default agent respond")


@router.post(
    "", response_model=ConversationOut, status_code=201, summary="Start an internal conversation"
)
async def create_conversation(
    body: ConversationCreate, session: DbSession, principal: Operator
) -> ConversationOut:
    conv, _ = await conv_svc.get_or_create(
        session,
        principal.tenant_id,
        channel=body.channel
        if body.channel in (Channel.internal, Channel.api)
        else Channel.internal,
        external_id=None,
        subject=body.subject,
        contact_id=body.contact_id,
    )
    if body.tags:
        await conv_svc.set_tags(session, conv, body.tags)
    if body.body:
        await conv_svc.append_message(
            session,
            conv,
            kind=MessageKind.message,
            direction=conv_svc.Direction.inbound if body.ask_agent else conv_svc.Direction.internal,
            body=body.body,
            author_user_id=principal.user_id,
        )
    await session.commit()
    if body.ask_agent:
        await enqueue("run_agent_job", str(conv.id))
    return ConversationOut.model_validate(conv)


@router.get("/{conversation_id}", response_model=ConversationOut, summary="Conversation header")
async def get_conversation(
    conversation_id: uuid.UUID, session: DbSession, principal: Operator
) -> ConversationOut:
    conv = await conv_svc.get(session, principal.tenant_id, conversation_id)
    if conv.unread:
        conv.unread = False
        await session.commit()
    return ConversationOut.model_validate(conv)


class MessagesOut(BaseModel):
    items: list[MessageOut]
    decisions: list[DecisionOut]
    signals: list[SignalOut]
    next_before: datetime | None


@router.get("/{conversation_id}/messages", response_model=MessagesOut, summary="Thread")
async def list_messages(
    conversation_id: uuid.UUID,
    session: DbSession,
    principal: Operator,
    before: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> MessagesOut:
    conv = await conv_svc.get(session, principal.tenant_id, conversation_id)
    rows = await conv_svc.list_messages(session, conv, limit=limit, before=before)
    decisions = list(
        (await session.scalars(select(Decision).where(Decision.conversation_id == conv.id))).all()
    )
    signals = list(
        (await session.scalars(select(Signal).where(Signal.conversation_id == conv.id))).all()
    )
    return MessagesOut(
        items=[MessageOut.model_validate(m) for m in rows],
        decisions=[DecisionOut.model_validate(d) for d in decisions],
        signals=[SignalOut.model_validate(s) for s in signals],
        next_before=rows[0].created_at if len(rows) == limit else None,
    )


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=20000)
    html: str | None = None
    draft: bool = False


@router.post(
    "/{conversation_id}/reply", response_model=ToolOutcomeOut, summary="Reply (tool: reply)"
)
async def reply(
    conversation_id: uuid.UUID, body: ReplyIn, session: DbSession, principal: Operator
) -> ToolOutcomeOut:
    outcome = await execute_tool(
        session,
        principal,
        "reply",
        {"conversation_id": str(conversation_id), **body.model_dump()},
        conversation_id=conversation_id,
    )
    await session.commit()
    return ToolOutcomeOut(**outcome.to_dict())


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=20000)


@router.post(
    "/{conversation_id}/notes",
    response_model=ToolOutcomeOut,
    summary="Internal note (tool: add_note)",
)
async def add_note(
    conversation_id: uuid.UUID, body: NoteIn, session: DbSession, principal: Operator
) -> ToolOutcomeOut:
    outcome = await execute_tool(
        session,
        principal,
        "add_note",
        {"conversation_id": str(conversation_id), "body": body.body},
        conversation_id=conversation_id,
    )
    await session.commit()
    return ToolOutcomeOut(**outcome.to_dict())


class StatusIn(BaseModel):
    status: ConversationStatus
    follow_up_at: datetime | None = None


@router.post(
    "/{conversation_id}/status",
    response_model=ConversationOut,
    summary="Set status (tool: set_status)",
)
async def set_status(
    conversation_id: uuid.UUID, body: StatusIn, session: DbSession, principal: Operator
) -> ConversationOut:
    await execute_tool(
        session,
        principal,
        "set_status",
        {
            "conversation_id": str(conversation_id),
            "status": body.status.value,
            "follow_up_at": body.follow_up_at.isoformat() if body.follow_up_at else None,
        },
        conversation_id=conversation_id,
    )
    await session.commit()
    return ConversationOut.model_validate(
        await conv_svc.get(session, principal.tenant_id, conversation_id)
    )


class AssignIn(BaseModel):
    user_id: uuid.UUID | None = None
    agent_id: uuid.UUID | None = None


@router.post(
    "/{conversation_id}/assign", response_model=ConversationOut, summary="Assign (tool: assign)"
)
async def assign(
    conversation_id: uuid.UUID, body: AssignIn, session: DbSession, principal: Operator
) -> ConversationOut:
    await execute_tool(
        session,
        principal,
        "assign",
        {
            "conversation_id": str(conversation_id),
            "user_id": str(body.user_id) if body.user_id else None,
            "agent_id": str(body.agent_id) if body.agent_id else None,
        },
        conversation_id=conversation_id,
    )
    await session.commit()
    return ConversationOut.model_validate(
        await conv_svc.get(session, principal.tenant_id, conversation_id)
    )


class TagsIn(BaseModel):
    tags: list[str]


@router.put(
    "/{conversation_id}/tags",
    response_model=ConversationOut,
    summary="Replace tags (tool: set_tags)",
)
async def set_tags(
    conversation_id: uuid.UUID, body: TagsIn, session: DbSession, principal: Operator
) -> ConversationOut:
    await execute_tool(
        session,
        principal,
        "set_tags",
        {"conversation_id": str(conversation_id), "tags": body.tags},
        conversation_id=conversation_id,
    )
    await session.commit()
    return ConversationOut.model_validate(
        await conv_svc.get(session, principal.tenant_id, conversation_id)
    )


@router.post("/{conversation_id}/agent", response_model=dict, summary="Ask the agent to act now")
async def ask_agent(
    conversation_id: uuid.UUID,
    session: DbSession,
    principal: Operator,
    agent_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    conv = await conv_svc.get(session, principal.tenant_id, conversation_id)
    await session.commit()
    job = await enqueue("run_agent_job", str(conv.id), str(agent_id) if agent_id else None)
    return {"queued": job is not None, "job_id": job}


@router.get(
    "/{conversation_id}/usage", response_model=dict, summary="Usage and cost for this conversation"
)
async def conversation_usage(
    conversation_id: uuid.UUID, session: DbSession, principal: Operator
) -> dict[str, Any]:
    conv = await conv_svc.get(session, principal.tenant_id, conversation_id)
    return await usage_svc.conversation_report(session, principal.tenant_id, conv.id)
