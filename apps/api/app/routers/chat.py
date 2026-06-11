"""Assistant chat API backed by the unified Signal thread model.

An assistant conversation is a `Signal` with channel="assistant" owned by the
requesting user. The URL contract is kept compatible with the dashboard chat
client; the storage layer is the same one used by Messages, email, and the
widget.
"""

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
from app.models.agent import AgentRun
from app.models.signal import Signal, SignalMessage
from app.services.agent.loop import AgentLoop
from app.services.assistant_threads import (
    append_signal_chat_message,
    serialize_chat_message,
    signal_chat_history,
)

router = APIRouter(prefix="/chat", tags=["chat"])

ASSISTANT_CHANNELS = ("assistant", "widget")


class ConversationCreate(BaseModel):
    title: str = "New conversation"
    audience: str = "internal"
    channel: str = "assistant"


class ConversationUpdate(BaseModel):
    title: str


class MessageCreate(BaseModel):
    content: str
    attachments: list[dict] = []


def _serialize_conversation(signal: Signal) -> dict:
    return {
        "id": str(signal.id),
        "title": signal.subject,
        "channel": signal.channel,
        "audience": "internal" if signal.channel == "assistant" else "external",
        "ai_paused": signal.ai_paused,
        "updated_at": signal.updated_at.isoformat(),
    }


@router.get("/conversations")
async def list_conversations(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    channel: str | None = None,
):
    query = select(Signal).where(Signal.tenant_id == auth.tenant.id)
    if channel:
        query = query.where(Signal.channel == channel)
        if channel == "assistant":
            query = query.where(
                (Signal.owner_user_id == auth.user.id) | (Signal.owner_user_id.is_(None))
            )
    else:
        query = query.where(
            Signal.channel == "assistant",
            (Signal.owner_user_id == auth.user.id) | (Signal.owner_user_id.is_(None)),
        )
    result = await session.execute(query.order_by(Signal.updated_at.desc()))
    return [_serialize_conversation(s) for s in result.scalars().all()]


@router.post("/conversations")
async def create_conversation(
    body: ConversationCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    signal = Signal(
        tenant_id=auth.tenant.id,
        channel="assistant",
        source="chat",
        subject=body.title,
        owner_user_id=auth.user.id,
        contact_name=auth.user.display_name or auth.user.email,
        has_unread=False,
    )
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return {"id": str(signal.id), "title": signal.subject, "channel": signal.channel}


@router.patch("/conversations/{conversation_id}")
async def update_conversation(
    conversation_id: UUID,
    body: ConversationUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    signal = await _get_thread(session, conversation_id, auth.tenant.id)
    signal.subject = body.title
    signal.updated_at = datetime.utcnow()
    await session.commit()
    return {"id": str(signal.id), "title": signal.subject}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import signal_threads as threads_svc

    ok = await threads_svc.delete_thread(session, auth.tenant.id, conversation_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}


@router.post("/conversations/{conversation_id}/takeover")
async def takeover(
    conversation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    signal = await _get_thread(session, conversation_id, auth.tenant.id)
    signal.ai_paused = True
    signal.assigned_user_id = auth.user.id
    await session.commit()
    return {"ai_paused": True}


@router.post("/conversations/{conversation_id}/release")
async def release(
    conversation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    signal = await _get_thread(session, conversation_id, auth.tenant.id)
    signal.ai_paused = False
    signal.assigned_user_id = None
    await session.commit()
    return {"ai_paused": False}


@router.get("/conversations/{conversation_id}/messages")
async def list_messages(
    conversation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await _get_thread(session, conversation_id, auth.tenant.id)
    result = await session.execute(
        select(SignalMessage)
        .where(
            SignalMessage.signal_id == conversation_id,
            SignalMessage.tenant_id == auth.tenant.id,
        )
        .order_by(SignalMessage.created_at)
    )
    return [serialize_chat_message(m) for m in result.scalars().all()]


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: UUID,
    body: MessageCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    signal = await _get_thread(session, conversation_id, auth.tenant.id)
    await append_signal_chat_message(
        session,
        signal,
        role="user",
        content=body.content,
        author_user_id=auth.user.id,
        attachments=body.attachments,
    )
    await session.commit()

    if signal.ai_paused:
        return {"message": {"role": "assistant", "content": ""}, "ai_paused": True}

    agent, run = await _agent_run(session, auth, body.content)
    history = await signal_chat_history(session, conversation_id)
    loop = AgentLoop(
        session, auth.tenant.id, auth.user.id, agent=agent, run=run, signal_id=signal.id
    )
    reply_text, tokens = await loop.run_chat(history, attachments=body.attachments)

    assistant_msg = await append_signal_chat_message(
        session,
        signal,
        role="assistant",
        content=reply_text,
        author_agent_id=agent.id if agent else None,
        metadata={"usage": tokens},
    )
    if signal.subject == "New conversation":
        signal.subject = body.content[:60]
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
    signal = await _get_thread(session, conversation_id, auth.tenant.id)
    await append_signal_chat_message(
        session,
        signal,
        role="user",
        content=body.content,
        author_user_id=auth.user.id,
        attachments=body.attachments,
    )
    await session.commit()

    agent, _run = await _agent_run(session, auth, body.content)
    history = await signal_chat_history(session, conversation_id)
    loop = AgentLoop(session, auth.tenant.id, auth.user.id, agent=agent, signal_id=signal.id)

    async def event_generator():
        full_text = ""
        async for event in loop.stream_chat(history, attachments=body.attachments):
            if event["type"] == "delta":
                full_text += event["text"]
                yield {"event": "delta", "data": json.dumps({"text": event["text"]})}
            elif event["type"] == "done":
                final = event.get("text", full_text)
                await append_signal_chat_message(
                    session,
                    signal,
                    role="assistant",
                    content=final,
                    author_agent_id=agent.id if agent else None,
                )
                await session.commit()
                yield {"event": "done", "data": json.dumps({"text": final})}

    return EventSourceResponse(event_generator())


async def _get_thread(session: AsyncSession, conversation_id: UUID, tenant_id: UUID) -> Signal:
    result = await session.execute(
        select(Signal).where(
            Signal.id == conversation_id,
            Signal.tenant_id == tenant_id,
            Signal.channel.in_(ASSISTANT_CHANNELS),
        )
    )
    signal = result.scalar_one_or_none()
    if not signal:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return signal


async def _agent_run(session, auth, content: str):
    from app.services.routing import resolve_agent_for_channel

    agent = await resolve_agent_for_channel(session, auth.tenant.id, "assistant")
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
