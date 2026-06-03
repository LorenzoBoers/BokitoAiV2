import json
from datetime import datetime
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
    channel: str = "assistant"


class ConversationUpdate(BaseModel):
    title: str


class MessageCreate(BaseModel):
    content: str
    attachments: list[dict] = []


@router.get("/conversations")
async def list_conversations(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    channel: str | None = None,
):
    query = select(Conversation).where(Conversation.tenant_id == auth.tenant.id)
    if channel:
        query = query.where(Conversation.channel == channel)
    else:
        query = query.where(
            (Conversation.user_id == auth.user.id) | (Conversation.user_id.is_(None))
        )
    result = await session.execute(query.order_by(Conversation.updated_at.desc()))
    return [
        {
            "id": str(c.id),
            "title": c.title,
            "channel": c.channel,
            "audience": c.audience,
            "ai_paused": c.ai_paused,
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
        channel=body.channel,
    )
    session.add(conv)
    await session.commit()
    await session.refresh(conv)
    return {"id": str(conv.id), "title": conv.title, "channel": conv.channel}


@router.patch("/conversations/{conversation_id}")
async def update_conversation(
    conversation_id: UUID,
    body: ConversationUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    conv = await _get_conv(session, conversation_id, auth.tenant.id)
    conv.title = body.title
    conv.updated_at = datetime.utcnow()
    await session.commit()
    return {"id": str(conv.id), "title": conv.title}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    conv = await _get_conv(session, conversation_id, auth.tenant.id)
    await session.delete(conv)
    await session.commit()
    return {"ok": True}


@router.post("/conversations/{conversation_id}/takeover")
async def takeover(
    conversation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    conv = await _get_conv(session, conversation_id, auth.tenant.id)
    conv.ai_paused = True
    conv.assigned_user_id = auth.user.id
    await session.commit()
    return {"ai_paused": True}


@router.post("/conversations/{conversation_id}/release")
async def release(
    conversation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    conv = await _get_conv(session, conversation_id, auth.tenant.id)
    conv.ai_paused = False
    conv.assigned_user_id = None
    await session.commit()
    return {"ai_paused": False}


@router.get("/conversations/{conversation_id}/messages")
async def list_messages(
    conversation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await _get_conv(session, conversation_id, auth.tenant.id)
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
            "certainty": m.certainty,
            "auto_sent": m.auto_sent,
            "decision_request_id": str(m.decision_request_id) if m.decision_request_id else None,
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
    conv = await _get_conv(session, conversation_id, auth.tenant.id)
    user_msg = ConversationMessage(
        conversation_id=conversation_id,
        tenant_id=auth.tenant.id,
        role="user",
        content=body.content,
        attachments_json=json.dumps(body.attachments),
    )
    session.add(user_msg)
    conv.last_message_at = datetime.utcnow()
    conv.updated_at = datetime.utcnow()
    await session.commit()

    if conv.ai_paused:
        return {"message": {"role": "assistant", "content": ""}, "ai_paused": True}

    agent, run = await _agent_run(session, auth, conv, body.content)
    history = await _history(session, conversation_id)
    loop = AgentLoop(session, auth.tenant.id, auth.user.id, agent=agent, run=run)
    reply_text, tokens = await loop.run_chat(history, attachments=body.attachments)

    assistant_msg = ConversationMessage(
        conversation_id=conversation_id,
        tenant_id=auth.tenant.id,
        role="assistant",
        content=reply_text,
        metadata_json=json.dumps({"usage": tokens}),
    )
    session.add(assistant_msg)
    if conv.title == "New conversation":
        conv.title = body.content[:60]
    conv.last_message_at = datetime.utcnow()
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
    conv = await _get_conv(session, conversation_id, auth.tenant.id)
    user_msg = ConversationMessage(
        conversation_id=conversation_id,
        tenant_id=auth.tenant.id,
        role="user",
        content=body.content,
        attachments_json=json.dumps(body.attachments),
    )
    session.add(user_msg)
    await session.commit()

    agent, _run = await _agent_run(session, auth, conv, body.content)
    history = await _history(session, conversation_id)
    loop = AgentLoop(session, auth.tenant.id, auth.user.id, agent=agent)

    async def event_generator():
        full_text = ""
        async for event in loop.stream_chat(history, attachments=body.attachments):
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
                conv.last_message_at = datetime.utcnow()
                await session.commit()
                yield {"event": "done", "data": json.dumps({"text": event.get("text", full_text)})}

    return EventSourceResponse(event_generator())


async def _get_conv(session: AsyncSession, conversation_id: UUID, tenant_id: UUID) -> Conversation:
    result = await session.execute(
        select(Conversation).where(Conversation.id == conversation_id, Conversation.tenant_id == tenant_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


async def _agent_run(session, auth, conv, content: str):
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
            subject=f"Chat: {content[:80]}",
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)
    return agent, run


async def _history(session, conversation_id):
    history_result = await session.execute(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.created_at)
    )
    return [
        {"role": m.role if m.role != "tool" else "user", "content": m.content}
        for m in history_result.scalars().all()
    ]
