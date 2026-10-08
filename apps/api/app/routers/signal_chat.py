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

AI handling (take over / hand back) uses PUT /ai-handling/conversation/{id}.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
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
from app.services.ai_handling import is_held
from app.services.assistant_context import page_context_block
from app.services.assistant_threads import (
    append_signal_chat_message,
    serialize_chat_message,
    signal_chat_history,
)
from app.services.conversation_title import maybe_apply_intent_title
from app.services.personal_agents import (
    allowed_company_agents,
    get_user_preference,
    resolve_chat_target,
)
from app.services.personal_assistant import PERSONAL_THREAD_SOURCE

router = APIRouter(tags=["signals"])
logger = logging.getLogger(__name__)

ASSISTANT_CHANNELS = ("assistant", "widget")
# Chat streams that die without finalize leave AgentRun=running and block Send.
CHAT_BUSY_STALE = timedelta(seconds=90)


def _apply_intent_title_once(signal: Signal, content: str) -> None:
    """Replace the placeholder list title once, with a short intent label."""
    maybe_apply_intent_title(signal, content)


async def _set_chat_agent_live(
    session: AsyncSession,
    agent: Agent | None,
    *,
    status: str,
    signal: Signal | None = None,
    run: AgentRun | None = None,
    summary: str | None = None,
) -> None:
    """Corner status for Ask/chat turns: working while the loop runs, then standby.

    Broadcasts ``agent.status`` so avatars (sidebar, panel, list) pulse live.
    Failures are logged and swallowed — presence must never break the reply.
    """
    if agent is None:
        return
    from app.services.workforce_runtime import mark_agent_activity

    try:
        working = status == "working"
        await mark_agent_activity(
            session,
            agent,
            status=status,
            summary=(summary or (signal.subject if signal else None) or "Replying")[:200]
            if working
            else None,
            signal_id=signal.id if working and signal is not None else None,
            activity_id=run.id if working and run is not None else None,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to set chat agent live status=%s", status)


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
    # In-app assistant: what the operator is looking at (route + entity), sent
    # with every turn so the agent can help in context.
    page_context: str = ""


def _serialize_conversation(signal: Signal, agents: dict[UUID, Agent] | None = None) -> dict:
    agent = agents.get(signal.agent_id) if agents and signal.agent_id else None
    return {
        "id": str(signal.id),
        "title": signal.subject,
        "channel": signal.channel,
        "source": signal.source,
        "audience": "internal" if signal.channel == "assistant" else "external",
        "ai_handling": signal.ai_handling,
        "agent_id": str(signal.agent_id) if signal.agent_id else None,
        "agent_name": agent.name if agent else None,
        "agent_kind": agent.kind if agent else None,
        "updated_at": signal.updated_at.isoformat(),
    }


def _serialize_target(agent: Agent, *, is_default: bool = False) -> dict:
    from app.services.workforce_runtime import serialize_agent

    return {**serialize_agent(agent, view="picker"), "is_default": is_default}


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
    source: str | None = None,
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
    # Private Bokito helper threads live in their own rail section, so they stay
    # out of the operator's agent chats unless asked for explicitly.
    if source:
        query = query.where(Signal.source == source)
    else:
        query = query.where(Signal.source != PERSONAL_THREAD_SOURCE)
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

    ok = await threads_svc.delete_thread(
        session, auth.tenant.id, conversation_id, user_id=auth.user.id if auth.user else None
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}


@router.get("/conversations/{conversation_id}/messages")
async def list_messages(
    conversation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=200)] = 80,
    before: Annotated[UUID | None, Query()] = None,
):
    """Newest ``limit`` messages (chronological). Pass ``before`` to page older."""
    await _get_thread(session, conversation_id, auth.tenant.id)
    page_size = max(1, min(int(limit or 80), 200))
    msg_filters: list = [
        SignalMessage.signal_id == conversation_id,
        SignalMessage.tenant_id == auth.tenant.id,
    ]
    if before is not None:
        before_row = (
            await session.execute(
                select(SignalMessage).where(
                    SignalMessage.id == before,
                    SignalMessage.signal_id == conversation_id,
                    SignalMessage.tenant_id == auth.tenant.id,
                )
            )
        ).scalar_one_or_none()
        if before_row is not None and before_row.created_at is not None:
            from sqlalchemy import and_, or_

            msg_filters.append(
                or_(
                    SignalMessage.created_at < before_row.created_at,
                    and_(
                        SignalMessage.created_at == before_row.created_at,
                        SignalMessage.id < before_row.id,
                    ),
                )
            )

    result = await session.execute(
        select(SignalMessage)
        .where(*msg_filters)
        .order_by(SignalMessage.created_at.desc(), SignalMessage.id.desc())
        .limit(page_size + 1)
    )
    newest_first = list(result.scalars().all())
    has_older = len(newest_first) > page_size
    messages = list(reversed(newest_first[:page_size]))

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

    return {
        "items": [
            serialize_chat_message(m, decision=decisions_by_id.get(m.decision_id))
            for m in messages
        ],
        "has_older": has_older,
        "oldest_message_id": str(messages[0].id) if messages else None,
    }


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
    _apply_intent_title_once(signal, body.content)
    await session.commit()

    if is_held(signal):
        return {
            "message": {"role": "assistant", "content": ""},
            "ai_paused": True,
            "llm_configured": True,
        }

    agent, run = await _agent_run(session, auth, signal, body.content)
    await _set_chat_agent_live(
        session, agent, status="working", signal=signal, run=run, summary=body.content
    )
    history = await signal_chat_history(session, conversation_id)
    loop = AgentLoop(
        session, auth.tenant.id, auth.user.id, agent=agent, run=run, signal_id=signal.id,
        enable_chat_thinking=True,
        tool_signal_id=signal.context_signal_id,
        user_role=auth.role,
    )
    llm_meta = await _llm_meta_for_agent(session, auth.tenant.id, agent)
    from app.services.agent.run_cancel import clear_cancel, is_run_cancelled

    try:
        try:
            reply_text, tokens = await loop.run_chat(
                history,
                extra_context=page_context_block(body.page_context),
                attachments=body.attachments,
            )
        except Exception as exc:
            logger.exception("assistant chat failed for signal %s", signal.id)
            reply_text = _agent_error_message(exc, llm_meta)
            tokens = {}
            await _finalize_run(session, run, status="failed", error=exc)
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
            saved = []
            if reply_text.strip():
                saved = await loop.persist_turn(
                    signal, metadata=llm_meta, final_metadata={"cancelled": True, "usage": tokens}
                )
            await session.commit()
            for msg in saved:
                await session.refresh(msg)
            if run:
                clear_cancel(run.id)
            payloads = [serialize_chat_message(m) for m in saved]
            return {
                "message": payloads[-1] if payloads else {"role": "assistant", "content": ""},
                "messages": payloads,
                "usage": tokens,
                "cancelled": True,
                **llm_meta,
            }

        thinking_meta = loop.thinking_payload()
        saved = await loop.persist_turn(
            signal,
            metadata=llm_meta,
            final_metadata={"usage": tokens, **({"thinking": thinking_meta} if thinking_meta else {})},
        )
        _apply_intent_title_once(signal, body.content)
        await _finalize_run(session, run, status="completed", tokens=tokens)
        await session.commit()
        for msg in saved:
            await session.refresh(msg)
        if run:
            clear_cancel(run.id)
        payloads = [serialize_chat_message(m) for m in saved]
        return {
            "message": payloads[-1],
            "messages": payloads,
            "usage": tokens,
            **llm_meta,
        }
    finally:
        await _set_chat_agent_live(session, agent, status="standby")


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
    _apply_intent_title_once(signal, body.content)
    await session.commit()

    if is_held(signal):

        async def paused_generator():
            yield {"event": "done", "data": json.dumps({"text": "", "ai_paused": True})}

        return EventSourceResponse(paused_generator())

    from app.services.agent.run_cancel import clear_cancel

    agent = None
    run = None
    try:
        agent, run = await _agent_run(session, auth, signal, body.content)
        await _set_chat_agent_live(
            session, agent, status="working", signal=signal, run=run, summary=body.content
        )
        history = await signal_chat_history(session, conversation_id)
        loop = AgentLoop(
            session, auth.tenant.id, auth.user.id, agent=agent, run=run, signal_id=signal.id,
            enable_chat_thinking=True,
            tool_signal_id=signal.context_signal_id,
            user_role=auth.role,
        )
        llm_meta = await _llm_meta_for_agent(session, auth.tenant.id, agent)
    except Exception as exc:
        # Setup failures (e.g. history compaction LLM billing) must not leave a
        # bare 500 + stuck AgentRun; surface a done event the client can show.
        logger.exception("assistant stream setup failed for signal %s", signal.id)
        llm_meta = await _llm_meta_for_agent(session, auth.tenant.id, agent)
        error_text = _agent_error_message(exc, llm_meta)
        await _finalize_run(session, run, status="failed", error=exc)
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
        await _set_chat_agent_live(session, agent, status="standby")

        async def setup_failed_generator():
            yield {
                "event": "done",
                "data": json.dumps({"text": error_text, "error": True, **llm_meta}),
            }

        return EventSourceResponse(setup_failed_generator())

    async def event_generator():
        full_text = ""
        run_closed = False
        if run:
            yield {
                "event": "start",
                "data": json.dumps({"run_id": str(run.id)}),
            }
        try:
            async for event in loop.stream_chat(
                history,
                extra_context=page_context_block(body.page_context),
                attachments=body.attachments,
            ):
                if event["type"] == "thinking":
                    yield {
                        "event": "thinking",
                        "data": json.dumps({"text": event.get("text", "")}),
                    }
                elif event["type"] == "delta":
                    full_text += event["text"]
                    yield {
                        "event": "delta",
                        "data": json.dumps(
                            {"text": event["text"], "segment_id": event.get("segment_id")}
                        ),
                    }
                elif event["type"] == "done":
                    final = event.get("text", full_text)
                    cancelled = bool(event.get("cancelled"))
                    thinking_meta = loop.thinking_payload()
                    # Tool-only / dropped replies still need a visible bubble.
                    if not (final or "").strip() and not cancelled:
                        final = (
                            "I could not finish a reply for that. "
                            "Try again, or press Stop if the AI stays busy."
                        )
                    final_meta = {
                        "usage": event.get("usage", {}),
                        **({"thinking": thinking_meta} if thinking_meta else {}),
                        **({"cancelled": True} if cancelled else {}),
                    }
                    saved = []
                    # Skip empty cancelled replies; keep partial text if any streamed.
                    if final.strip() or not cancelled:
                        saved = await loop.persist_turn(
                            signal, metadata=llm_meta, final_metadata=final_meta
                        )
                    if not cancelled:
                        _apply_intent_title_once(signal, body.content)
                    await _finalize_run(
                        session,
                        run,
                        status="cancelled" if cancelled else "completed",
                        tokens=event.get("usage") or {},
                    )
                    await session.commit()
                    run_closed = True
                    if run:
                        clear_cancel(run.id)
                    done_payload: dict = {
                        "text": final,
                        "messages": [serialize_chat_message(m) for m in saved],
                        "usage": event.get("usage", {}),
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
            await _finalize_run(session, run, status="failed", error=exc)
            await append_signal_chat_message(
                session,
                signal,
                role="assistant",
                content=error_text,
                author_agent_id=agent.id if agent else None,
                metadata={"error": True, **llm_meta},
            )
            await session.commit()
            run_closed = True
            if run:
                clear_cancel(run.id)
            yield {
                "event": "done",
                "data": json.dumps({"text": error_text, "error": True, **llm_meta}),
            }
        finally:
            # Client disconnect / proxy timeout / cancelled generator: never leave
            # AgentRun=running or the next Send hits agent_busy with an empty UI.
            try:
                open_run = run
                if not run_closed and open_run is not None:
                    refresh_ok = True
                    try:
                        await session.refresh(open_run)
                    except Exception:
                        refresh_ok = False
                    if refresh_ok and open_run.status == "running":
                        logger.warning(
                            "assistant stream abandoned for signal %s run %s — closing busy lock",
                            signal.id,
                            open_run.id,
                        )
                        try:
                            await _finalize_run(session, open_run, status="failed")
                            if not full_text.strip():
                                await append_signal_chat_message(
                                    session,
                                    signal,
                                    role="assistant",
                                    content=(
                                        "The reply stopped unexpectedly. "
                                        "Send your message again."
                                    ),
                                    author_agent_id=agent.id if agent else None,
                                    metadata={"error": True, "abandoned_stream": True, **llm_meta},
                                )
                            await session.commit()
                        except Exception:
                            logger.exception("failed to close abandoned chat run %s", open_run.id)
                        clear_cancel(open_run.id)
            finally:
                await _set_chat_agent_live(session, agent, status="standby")

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
    if run.agent_id:
        agent = await session.get(Agent, run.agent_id)
        await _set_chat_agent_live(session, agent, status="standby")
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
    from app.services.agent.run_cancel import clear_cancel

    busy = await _running_chat_run(session, tenant_id, conversation_id)
    if busy is None:
        return
    started = busy.started_at or datetime.utcnow()
    if datetime.utcnow() - started >= CHAT_BUSY_STALE:
        # Orphaned lock after a dropped SSE / crashed worker.
        logger.warning(
            "reclaiming stale chat run %s on conversation %s (age %s)",
            busy.id,
            conversation_id,
            datetime.utcnow() - started,
        )
        await _finalize_run(session, busy, status="failed")
        await session.commit()
        clear_cancel(busy.id)
        return
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


async def _finalize_run(
    session,
    run: AgentRun | None,
    *,
    status: str,
    tokens: dict | None = None,
    error: BaseException | None = None,
) -> None:
    """Close the run record; callers commit. Runs must never stay 'running'."""
    if run is None:
        return
    run.status = status
    run.completed_at = datetime.utcnow()
    if error is not None:
        from app.services.run_errors import record_run_error

        record_run_error(run, error)
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
    from app.services.agent.llm import is_rate_limit_error

    if is_rate_limit_error(exc):
        return (
            "The AI provider is busy right now (rate limit). "
            "Wait a few seconds and send your message again."
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
