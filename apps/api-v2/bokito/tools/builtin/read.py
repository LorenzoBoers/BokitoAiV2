"""Read tools: what agents and MCP clients look at before they act.

They return the same shapes as the REST API (`api.schemas`), so a client that
knows one surface knows the other.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field

from bokito.api.schemas import ContactOut, ConversationOut, DecisionOut, MessageOut
from bokito.domain.conversation import Channel, ConversationStatus
from bokito.services import contacts as contacts_svc
from bokito.services import conversation as conv_svc
from bokito.services import decision as decision_svc
from bokito.tools.registry import ToolContext, tool


class ListConversationsArgs(BaseModel):
    queue: Literal["attention", "mine", "agents", "waiting", "all"] | None = None
    status: list[ConversationStatus] = Field(default_factory=list)
    channel: Channel | None = None
    q: str = Field(default="", max_length=200, description="Search subject and contact.")
    limit: int = Field(default=20, ge=1, le=100)


@tool(
    "list_conversations",
    description="List conversations in the workspace, newest activity first.",
    category="read",
)
async def list_conversations(ctx: ToolContext, args: ListConversationsArgs) -> dict:
    f = conv_svc.ConversationFilters(
        status=args.status, channel=args.channel, q=args.q or None, queue=args.queue
    )
    rows = await conv_svc.list_conversations(
        ctx.session, ctx.tenant_id, f, user_id=ctx.principal.user_id, limit=args.limit
    )
    return {
        "conversations": [ConversationOut.model_validate(c).model_dump(mode="json") for c in rows]
    }


class GetConversationArgs(BaseModel):
    conversation_id: uuid.UUID
    message_limit: int = Field(default=50, ge=1, le=200)


@tool(
    "get_conversation",
    description="One conversation with its messages, decisions and run notes.",
    category="read",
)
async def get_conversation(ctx: ToolContext, args: GetConversationArgs) -> dict:
    conv = await conv_svc.get(ctx.session, ctx.tenant_id, args.conversation_id)
    messages = await conv_svc.list_messages(ctx.session, conv, limit=args.message_limit)
    return {
        "conversation": ConversationOut.model_validate(conv).model_dump(mode="json"),
        "messages": [MessageOut.model_validate(m).model_dump(mode="json") for m in messages],
    }


class ListContactsArgs(BaseModel):
    q: str = Field(default="", max_length=200)
    limit: int = Field(default=20, ge=1, le=100)


@tool("list_contacts", description="Search contacts by name, email or phone.", category="read")
async def list_contacts(ctx: ToolContext, args: ListContactsArgs) -> dict:
    rows = await contacts_svc.search(ctx.session, ctx.tenant_id, args.q or None, limit=args.limit)
    return {"contacts": [ContactOut.model_validate(c).model_dump(mode="json") for c in rows]}


class ListDecisionsArgs(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)


@tool(
    "list_decisions",
    description="Decisions that are waiting for an operator.",
    category="read",
)
async def list_decisions(ctx: ToolContext, args: ListDecisionsArgs) -> dict:
    rows = await decision_svc.list_open(ctx.session, ctx.tenant_id, limit=args.limit)
    return {"decisions": [DecisionOut.model_validate(d).model_dump(mode="json") for d in rows]}
