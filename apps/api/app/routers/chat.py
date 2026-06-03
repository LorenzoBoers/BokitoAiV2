import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.agent import Agent, AgentRun
from app.models.chat import Conversation, ConversationMessage
from app.services.agent.loop import AgentLoop

router = APIRouter(prefix="/chat", tags=["chat"])


class ConversationCreate(BaseModel):
    title: str = "New conversation"
    audience: str = "internal"


class MessageCreate(BaseModel):
    content: str
    attachments: list[dict] = []


@router.get("/conversations")
async def list_conversations(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(Conversation)
        .where(Conversation.tenant_id == auth.tenant.id, Conversation.user_id == auth.user.id)
        .order_by(Conversation.updated_at.desc())
    )
    return [
        {
            "id": str(c.id),
            "title": c.title,
            "audience": c.audience,
            "updated_at": c.updated_at.isoformat(),
        }
        for c in result.scalars().all()
    ]


@router.post("/conversations")
async def create_conversation(
    body: ConversationCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    conv = Conversation(
        tenant_id=auth.tenant.id,
        user_id=auth.user.id,
        title=body.title,
        audience=body.audience,
    )
    session.add(conv)
    await session.commit()
    await session.refresh(conv)
    return {"id": str(conv.id), "title": conv.title}


@router.get("/conversations/{conversation_id}/messages")
async def list_messages(
    conversation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == conversation_id,
            ConversationMessage.tenant_id == auth.tenant.id,
        )
        .order_by(ConversationMessage.created_at)
    )
    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "attachments": json.loads(m.attachments_json or "[]"),
            "created_at": m.created_at.isoformat(),
        }
        for m in result.scalars().all()
    ]


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: UUID,
    body: MessageCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    conv_result = await session.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.tenant_id == auth.tenant.id,
        )
    )
    conv = conv_result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    user_msg = ConversationMessage(
        conversation_id=conversation_id,
        tenant_id=auth.tenant.id,
        role="user",
        content=body.content,
        attachments_json=json.dumps(body.attachments),
    )
    session.add(user_msg)
    await session.commit()

    agent_result = await session.execute(
        select(Agent).where(Agent.tenant_id == auth.tenant.id, Agent.role == "assistant").limit(1)
    )
    agent = agent_result.scalar_one_or_none()
    run = None
    if agent:
        run = AgentRun(
            tenant_id=auth.tenant.id,
            agent_id=agent.id,
            trigger_type="chat",
            subject=f"Chat: {body.content[:80]}",
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)

    history_result = await session.execute(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.created_at)
    )
    history = [
        {"role": m.role if m.role != "tool" else "user", "content": m.content}
        for m in history_result.scalars().all()
    ]

    loop = AgentLoop(session, auth.tenant.id, auth.user.id, agent=agent, run=run)
    reply_text, tokens = await loop.run_chat(history)

    assistant_msg = ConversationMessage(
        conversation_id=conversation_id,
        tenant_id=auth.tenant.id,
        role="assistant",
        content=reply_text,
        metadata_json=json.dumps({"usage": tokens}),
    )
    session.add(assistant_msg)
    conv.title = conv.title if conv.title != "New conversation" else body.content[:60]
    await session.commit()
    await session.refresh(assistant_msg)

    return {
        "message": {
            "id": str(assistant_msg.id),
            "role": "assistant",
            "content": reply_text,
        },
        "usage": tokens,
    }


@router.post("/conversations/{conversation_id}/stream")
async def stream_message(
    conversation_id: UUID,
    body: MessageCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    conv_result = await session.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.tenant_id == auth.tenant.id,
        )
    )
    conv = conv_result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    user_msg = ConversationMessage(
        conversation_id=conversation_id,
        tenant_id=auth.tenant.id,
        role="user",
        content=body.content,
    )
    session.add(user_msg)
    await session.commit()

    agent_result = await session.execute(
        select(Agent).where(Agent.tenant_id == auth.tenant.id, Agent.role == "assistant").limit(1)
    )
    agent = agent_result.scalar_one_or_none()

    history_result = await session.execute(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.created_at)
    )
    history = [{"role": m.role, "content": m.content} for m in history_result.scalars().all()]
    loop = AgentLoop(session, auth.tenant.id, auth.user.id, agent=agent)

    async def event_generator():
        full_text = ""
        async for event in loop.stream_chat(history):
            if event["type"] == "delta":
                full_text += event["text"]
                yield {"event": "delta", "data": json.dumps({"text": event["text"]})}
            elif event["type"] == "done":
                assistant_msg = ConversationMessage(
                    conversation_id=conversation_id,
                    tenant_id=auth.tenant.id,
                    role="assistant",
                    content=event.get("text", full_text),
                )
                session.add(assistant_msg)
                await session.commit()
                yield {"event": "done", "data": json.dumps({"text": event.get("text", full_text)})}

    return EventSourceResponse(event_generator())
