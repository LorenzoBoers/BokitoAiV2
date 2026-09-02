"""Assistant conversation endpoints of the unified Signals API.

An assistant conversation is a `Signal` with channel="assistant" owned by the
requesting user. These routes live under the `/signals` prefix (included by
`app.routers.signals`) so Messages, email, the widget, and assistant chats all
share one API family. Paths:

- GET  /signals/chat/targets
- GET/POST  /signals/conversations
- PATCH/DELETE  /signals/conversations/{id}
- GET/POST  /signals/conversations/{id}/messages
- POST /signals/conversations/{id}/stream

Takeover/release use the shared /signals/{signal_id}/takeover and /release.
"""

import json
import logging
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
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.services.agent.loop import AgentLoop
from app.services.assistant_threads import (
    append_signal_chat_message,
    serialize_chat_message,
    signal_chat_history,
)
from app.services.personal_agents import (
    allowed_company_agents,
    get_user_preference,
    resolve_chat_target,
)

router = APIRouter(tags=["signals"])
logger = logging.getLogger(__name__)

ASSISTANT_CHANNELS = ("assistant", "widget")


class ConversationCreate(BaseModel):
    title: str = "New conversation"
    audience: str = "internal"
    channel: str = "assistant"
    agent_id: UUID | None = None
    # Ask-assistant: ground the conversation in this customer thread.
    context_signal_id: UUID | None = None


class ConversationUpdate(BaseModel):
    title: str


class MessageCreate(BaseModel):
    content: str
    attachments: list[dict] = []


def _serialize_conversation(signal: Signal, agents: dict[UUID, Agent] | None = None) -> dict:
    agent = agents.get(signal.agent_id) if agents and signal.agent_id else None
    return {
        "id": str(signal.id),
        "title": signal.subject,
        "channel": signal.channel,
        "audience": "internal" if signal.channel == "assistant" else "external",
        "ai_paused": signal.ai_paused,
        "agent_id": str(signal.agent_id) if signal.agent_id else None,
        "agent_name": agent.name if agent else None,
        "agent_kind": agent.kind if agent else None,
        "updated_at": signal.updated_at.isoformat(),
    }


def _serialize_target(agent: Agent, *, is_default: bool = False) -> dict:
    from app.services.agent_avatar import avatar_payload

    payload = {
        "id": str(agent.id),
        "name": agent.name,
        "kind": agent.kind,
        "role": agent.role,
        "runtime_status": agent.runtime_status,
        "is_default": is_default,
    }
    payload.update(avatar_payload(agent))
    return payload


@router.get("/chat/targets")
async def chat_targets(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Company agents the current user may chat with. Empty when none are permitted."""
    is_admin = auth.role in ("owner", "admin")
    company = await allowed_company_agents(session, auth.tenant.id, auth.user.id, is_admin=is_admin)
    pref = await get_user_preference(session, auth.tenant.id, auth.user.id)
    default_id: UUID | None = None
    if pref and pref.default_chat_agent_id:
        valid_ids = {a.id for a in company}
        if pref.default_chat_agent_id in valid_ids:
            default_id = pref.default_chat_agent_id
    items = [_serialize_target(a, is_default=a.id == default_id) for a in company]
    return {
        "items": items,
        "default_agent_id": str(default_id) if default_id else None,
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
    signals = list(result.scalars().all())
    agents = await _agents_by_id(session, auth.tenant.id, [s.agent_id for s in signals])
    return [_serialize_conversation(s, agents) for s in signals]


@router.post("/conversations")
async def create_conversation(
    body: ConversationCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    agent = await resolve_chat_target(
        session, auth.tenant.id, auth.user, body.agent_id, is_admin=auth.role in ("owner", "admin")
    )
    context_signal_id: UUID | None = None
    if body.context_signal_id:
        ctx_result = await session.execute(
            select(Signal).where(
                Signal.id == body.context_signal_id, Signal.tenant_id == auth.tenant.id
            )
        )
        if ctx_result.scalar_one_or_none():
            context_signal_id = body.context_signal_id
    signal = Signal(
        tenant_id=auth.tenant.id,
        channel="assistant",
        source="chat",
        subject=body.title,
        owner_user_id=auth.user.id,
        agent_id=agent.id,
        contact_name=auth.user.display_name or auth.user.email,
        has_unread=False,
        context_signal_id=context_signal_id,
    )
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return {
        "id": str(signal.id),
        "title": signal.subject,
        "channel": signal.channel,
        "agent_id": str(agent.id),
        "agent_name": agent.name,
        "agent_kind": agent.kind,
    }


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
    messages = result.scalars().all()

    # Batch-load attached decisions so cards render server-driven state
    # (options, resolved status) that survives reloads.
    decision_ids = [m.decision_id for m in messages if m.decision_id]
    decisions_by_id: dict[UUID, DecisionRequest] = {}
    if decision_ids:
        dec_result = await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.id.in_(decision_ids),
                DecisionRequest.tenant_id == auth.tenant.id,
            )
        )
        decisions_by_id = {d.id: d for d in dec_result.scalars().all()}

    return [
        serialize_chat_message(m, decision=decisions_by_id.get(m.decision_id))
        for m in messages
    ]


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: UUID,
    body: MessageCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    signal = await _get_thread(session, conversation_id, auth.tenant.id)
    await _ensure_session_idle(session, auth.tenant.id, conversation_id)
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
        return {
            "message": {"role": "assistant", "content": ""},
            "ai_paused": True,
            "llm_configured": True,
        }

    agent, run = await _agent_run(session, auth, signal, body.content)
    history = await signal_chat_history(session, conversation_id)
    loop = AgentLoop(
        session, auth.tenant.id, auth.user.id, agent=agent, run=run, signal_id=signal.id,
        enable_chat_thinking=True,
        tool_signal_id=signal.context_signal_id,
    )
    llm_meta = await _llm_meta_for_agent(session, auth.tenant.id, agent)
    from app.services.agent.run_cancel import clear_cancel, is_run_cancelled

    try:
        reply_text, tokens = await loop.run_chat(history, attachments=body.attachments)
    except Exception as exc:
        logger.exception("assistant chat failed for signal %s", signal.id)
        reply_text = _agent_error_message(exc, llm_meta)
        tokens = {}
        await _finalize_run(session, run, status="failed")
        assistant_msg = await append_signal_chat_message(
            session,
            signal,
            role="assistant",
            content=reply_text,
            author_agent_id=agent.id if agent else None,
            metadata={"error": True, "llm_meta": llm_meta},
        )
        await session.commit()
        await session.refresh(assistant_msg)
        if run:
            clear_cancel(run.id)
        return {
            "message": {
                "id": str(assistant_msg.id),
                "role": "assistant",
                "content": reply_text,
            },
            "usage": tokens,
            "error": True,
            **llm_meta,
        }

    cancelled = await is_run_cancelled(session, run.id if run else None)
    if cancelled:
        await _finalize_run(session, run, status="cancelled", tokens=tokens)
        if reply_text.strip():
            assistant_msg = await append_signal_chat_message(
                session,
                signal,
                role="assistant",
                content=reply_text,
                author_agent_id=agent.id if agent else None,
                metadata={
                    "cancelled": True,
                    "usage": tokens,
                    "steps": list(loop.trace_steps),
                    **llm_meta,
                },
            )
            await session.commit()
            await session.refresh(assistant_msg)
            payload = serialize_chat_message(assistant_msg)
        else:
            await session.commit()
            payload = {"role": "assistant", "content": ""}
        if run:
            clear_cancel(run.id)
        return {"message": payload, "usage": tokens, "cancelled": True, **llm_meta}

    assistant_msg = await append_signal_chat_message(
        session,
        signal,
        role="assistant",
        content=reply_text,
        author_agent_id=agent.id if agent else None,
        metadata={
            "usage": tokens,
            "steps": list(loop.trace_steps),
            **({"thinking": loop.thinking_payload()} if loop.thinking_payload() else {}),
            **llm_meta,
        },
    )
    if signal.subject == "New conversation":
        signal.subject = body.content[:60]
    await _finalize_run(session, run, status="completed", tokens=tokens)
    await session.commit()
    await session.refresh(assistant_msg)
    if run:
        clear_cancel(run.id)
    return {
        "message": serialize_chat_message(assistant_msg),
        "usage": tokens,
        **llm_meta,
    }


@router.post("/conversations/{conversation_id}/stream")
async def stream_message(
    conversation_id: UUID,
    body: MessageCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    signal = await _get_thread(session, conversation_id, auth.tenant.id)
    await _ensure_session_idle(session, auth.tenant.id, conversation_id)
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

        async def paused_generator():
            yield {"event": "done", "data": json.dumps({"text": "", "ai_paused": True})}

        return EventSourceResponse(paused_generator())

    agent, run = await _agent_run(session, auth, signal, body.content)
    history = await signal_chat_history(session, conversation_id)
    loop = AgentLoop(
        session, auth.tenant.id, auth.user.id, agent=agent, run=run, signal_id=signal.id,
        enable_chat_thinking=True,
        tool_signal_id=signal.context_signal_id,
    )
    llm_meta = await _llm_meta_for_agent(session, auth.tenant.id, agent)
    from app.services.agent.run_cancel import clear_cancel

    async def event_generator():
        full_text = ""
        if run:
            yield {
                "event": "start",
                "data": json.dumps({"run_id": str(run.id)}),
            }
        try:
            async for event in loop.stream_chat(history, attachments=body.attachments):
                if event["type"] == "thinking":
                    yield {
                        "event": "thinking",
                        "data": json.dumps({"text": event.get("text", "")}),
                    }
                elif event["type"] == "delta":
                    full_text += event["text"]
                    yield {"event": "delta", "data": json.dumps({"text": event["text"]})}
                elif event["type"] == "done":
                    final = event.get("text", full_text)
                    cancelled = bool(event.get("cancelled"))
                    thinking_meta = loop.thinking_payload()
                    # Skip empty cancelled replies; keep partial text if any streamed.
                    if final.strip():
                        await append_signal_chat_message(
                            session,
                            signal,
                            role="assistant",
                            content=final,
                            author_agent_id=agent.id if agent else None,
                            metadata={
                                "usage": event.get("usage", {}),
                                "steps": event.get("steps") or list(loop.trace_steps),
                                **({"thinking": thinking_meta} if thinking_meta else {}),
                                **({"cancelled": True} if cancelled else {}),
                                **llm_meta,
                            },
                        )
                    elif not cancelled:
                        await append_signal_chat_message(
                            session,
                            signal,
                            role="assistant",
                            content=final or "Done.",
                            author_agent_id=agent.id if agent else None,
                            metadata={
                                "usage": event.get("usage", {}),
                                "steps": event.get("steps") or list(loop.trace_steps),
                                **({"thinking": thinking_meta} if thinking_meta else {}),
                                **llm_meta,
                            },
                        )
                    if signal.subject == "New conversation" and not cancelled:
                        signal.subject = body.content[:60]
                    await _finalize_run(
                        session,
                        run,
                        status="cancelled" if cancelled else "completed",
                        tokens=event.get("usage") or {},
                    )
                    await session.commit()
                    if run:
                        clear_cancel(run.id)
                    done_payload: dict = {
                        "text": final,
                        "usage": event.get("usage", {}),
                        "steps": event.get("steps") or list(loop.trace_steps),
                        **llm_meta,
                    }
                    if cancelled:
                        done_payload["cancelled"] = True
                    if thinking_meta:
                        done_payload["thinking"] = thinking_meta
                    if run:
                        done_payload["run_id"] = str(run.id)
                    yield {
                        "event": "done",
                        "data": json.dumps(done_payload),
                    }
        except Exception as exc:
            logger.exception("assistant stream failed for signal %s", signal.id)
            error_text = _agent_error_message(exc, llm_meta)
            await _finalize_run(session, run, status="failed")
            await append_signal_chat_message(
                session,
                signal,
                role="assistant",
                content=error_text,
                author_agent_id=agent.id if agent else None,
                metadata={"error": True, **llm_meta},
            )
            await session.commit()
            if run:
                clear_cancel(run.id)
            yield {
                "event": "done",
                "data": json.dumps({"text": error_text, "error": True, **llm_meta}),
            }

    return EventSourceResponse(event_generator())


@router.post("/conversations/{conversation_id}/cancel")
async def cancel_conversation_run(
    conversation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Stop the in-flight chat AgentRun for this conversation (cooperative cancel)."""
    await _get_thread(session, conversation_id, auth.tenant.id)
    run = await _running_chat_run(session, auth.tenant.id, conversation_id)
    if run is None:
        return {"ok": True, "cancelled": False}
    from app.services.agent.run_cancel import request_cancel

    request_cancel(run.id)
    run.status = "cancelled"
    run.completed_at = datetime.utcnow()
    session.add(run)
    await session.commit()
    return {"ok": True, "cancelled": True, "run_id": str(run.id)}


async def _running_chat_run(
    session: AsyncSession, tenant_id: UUID, conversation_id: UUID
) -> AgentRun | None:
    result = await session.execute(
        select(AgentRun)
        .where(
            AgentRun.tenant_id == tenant_id,
            AgentRun.trigger_type == "chat",
            AgentRun.trigger_id == str(conversation_id),
            AgentRun.status == "running",
        )
        .order_by(AgentRun.started_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _ensure_session_idle(
    session: AsyncSession, tenant_id: UUID, conversation_id: UUID
) -> None:
    busy = await _running_chat_run(session, tenant_id, conversation_id)
    if busy is not None:
        raise HTTPException(
            status_code=409,
            detail="agent_busy",
        )


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


async def _agents_by_id(
    session: AsyncSession, tenant_id: UUID, ids: list[UUID | None]
) -> dict[UUID, Agent]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    result = await session.execute(
        select(Agent).where(Agent.tenant_id == tenant_id, Agent.id.in_(wanted))
    )
    return {a.id: a for a in result.scalars().all()}


async def _resolve_thread_agent(session: AsyncSession, auth, signal: Signal) -> Agent | None:
    """Agent pinned on the thread, else legacy channel routing."""
    if signal.agent_id:
        result = await session.execute(
            select(Agent).where(Agent.id == signal.agent_id, Agent.tenant_id == auth.tenant.id)
        )
        agent = result.scalar_one_or_none()
        if agent and agent.is_active:
            return agent
    from app.services.routing import resolve_agent_for_channel

    return await resolve_agent_for_channel(session, auth.tenant.id, signal.channel)


async def _agent_run(session, auth, signal: Signal, content: str):
    agent = await _resolve_thread_agent(session, auth, signal)
    run = None
    if agent:
        run = AgentRun(
            tenant_id=auth.tenant.id,
            agent_id=agent.id,
            trigger_type="chat",
            trigger_id=str(signal.id),
            subject=f"Chat: {content[:80]}",
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)
    return agent, run


async def _finalize_run(session, run: AgentRun | None, *, status: str, tokens: dict | None = None) -> None:
    """Close the run record; callers commit. Runs must never stay 'running'."""
    if run is None:
        return
    run.status = status
    run.completed_at = datetime.utcnow()
    if isinstance(tokens, dict):
        run.tokens_input = int(tokens.get("input_tokens") or 0)
        run.tokens_output = int(tokens.get("output_tokens") or 0)
    session.add(run)
    # Mirror the outcome onto the ledger Task when this run was promoted.
    from app.services.task_ledger import settle_run_task

    await settle_run_task(session, run)


def _agent_error_message(exc: Exception, llm_meta: dict) -> str:
    if not llm_meta.get("llm_configured"):
        return (
            "The assistant cannot reply because no LLM API key is configured for this workspace. "
            "Add a provider key in Settings or contact your administrator."
        )
    return (
        "The assistant encountered an error while generating a reply. "
        "Please try again in a moment."
    )


async def _llm_meta_for_agent(session: AsyncSession, tenant_id: UUID, agent: Agent | None) -> dict:
    from app.services.model_resolution import resolve_model_call

    model_slug = agent.model if agent else None
    call = await resolve_model_call(session, tenant_id, kind="chat", model_slug=model_slug)
    return {
        "llm_configured": call.live,
        "llm_mode": "live" if call.live else "mock",
        "llm_key_source": call.key_source,
    }
