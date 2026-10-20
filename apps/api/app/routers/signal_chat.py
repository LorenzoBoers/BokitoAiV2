"""Operator chat endpoints of the unified Signals API.

Ask/stream works on assistant chats (`channel=assistant`) and on wake /
agent-run threads (`channel=internal`) the same way. Widget visitor chats can
share these routes too. List/create defaults stay assistant-scoped. Routes
live under `/signals` (included by `app.routers.signals`). Paths:

- GET  /signals/chat/targets
- GET/POST  /signals/conversations
- PATCH/DELETE  /signals/conversations/{id}
- GET/POST  /signals/conversations/{id}/messages
- POST /signals/conversations/{id}/stream

AI handling (take over / hand back) uses PUT /ai-handling/conversation/{id}.
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.db.session import async_session_factory, get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.agent import Agent, AgentRun
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.services.agent.loop import AgentLoop
from app.services.ai_handling import is_held, release_conversation
from app.services.assistant_context import page_context_block
from app.services.assistant_threads import (
    append_signal_chat_message,
    serialize_chat_message,
    signal_chat_history,
)
from app.services.conversation_title import apply_title_once
from app.services.personal_agents import (
    allowed_company_agents,
    get_user_preference,
    resolve_chat_target,
)
from app.services.personal_assistant import PERSONAL_THREAD_SOURCE

router = APIRouter(tags=["signals"])
logger = logging.getLogger(__name__)

# Operator Ask/stream uses the same path for assistant chats and wake /
# agent-run threads (channel=internal). Widget stays for visitor chats that
# share these conversation routes. Keep in sync with is_internal_channel /
# ownership.INTERNAL_CHANNELS for team-facing turns.
OPERATOR_CHAT_CHANNELS = ("assistant", "internal", "widget")
# Back-compat alias for imports/tests that still say ASSISTANT_CHANNELS.
ASSISTANT_CHANNELS = OPERATOR_CHAT_CHANNELS
# Last-resort age cap. The turn usually lives on the worker, so a missing
# in-process task is not a ghost. Only age (or Stop) reclaims the row.
CHAT_BUSY_STALE = timedelta(minutes=15)
# A live turn that sent nothing for this long has no writer left.
DEAD_TURN_AFTER = timedelta(minutes=2)
_LIVE_CHAT_TURNS: dict[str, asyncio.Task] = {}
_CHAT_START_LOCKS: dict[str, asyncio.Lock] = {}


def _chat_turn_key(conversation_id: UUID) -> str:
    return str(conversation_id)


def _chat_turn_is_live(conversation_id: UUID) -> bool:
    task = _LIVE_CHAT_TURNS.get(_chat_turn_key(conversation_id))
    return task is not None and not task.done()


def _chat_start_lock(conversation_id: UUID) -> asyncio.Lock:
    return _CHAT_START_LOCKS.setdefault(_chat_turn_key(conversation_id), asyncio.Lock())


def _track_chat_turn(conversation_id: UUID, task: asyncio.Task) -> None:
    key = _chat_turn_key(conversation_id)
    _LIVE_CHAT_TURNS[key] = task

    def _drop(done: asyncio.Task) -> None:
        if _LIVE_CHAT_TURNS.get(key) is done:
            _LIVE_CHAT_TURNS.pop(key, None)

    task.add_done_callback(_drop)


def _cancel_live_chat_turn(conversation_id: UUID) -> None:
    task = _LIVE_CHAT_TURNS.pop(_chat_turn_key(conversation_id), None)
    if task is not None and not task.done():
        task.cancel()


async def _put_sse(queue: asyncio.Queue, event: str, data: dict[str, Any]) -> None:
    await queue.put({"event": event, "data": json.dumps(data)})


def _apply_intent_title_once(signal: Signal, content: str) -> None:
    """Provisional list title now; one AI refine follows when still blank."""
    apply_title_once(signal, content)


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
        # Never put the thread subject (often the operator's last message) into
        # live.summary — the Communication agent nav would echo it as a row.
        await mark_agent_activity(
            session,
            agent,
            status=status,
            summary=(summary or "Replying")[:200] if working else None,
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
    # Opener from "New conversation": persisted with the thread so a lost
    # client-side auto-send cannot leave an empty "Untitled chat".
    message: str = ""
    # Files / pasted images on that opener (same shape as MessageCreate).
    attachments: list[dict] = []


class ConversationUpdate(BaseModel):
    title: str


class MessageCreate(BaseModel):
    content: str = ""
    attachments: list[dict] = []
    # In-app assistant: what the operator is looking at (route + entity), sent
    # with every turn so the agent can help in context.
    page_context: str = ""
    # After create-with-message: run the agent on the last user bubble without
    # appending a duplicate. content may be empty; the last user message is used.
    continue_pending: bool = False


async def _resolve_turn_content(
    session: AsyncSession,
    signal: Signal,
    body: MessageCreate,
    *,
    author_user_id: UUID,
) -> tuple[str, list[dict]]:
    """Persist a new user bubble, or reuse the opener after create-with-message.

    ``continue_pending`` skips appending so New conversation / Correction can
    create the thread with the opener already stored, then kick the agent
    without duplicating the user message when client-side auto-send is flaky.
    """
    if body.continue_pending:
        last = (
            await session.execute(
                select(SignalMessage)
                .where(
                    SignalMessage.signal_id == signal.id,
                    SignalMessage.role == "user",
                )
                .order_by(SignalMessage.seq.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        content = (body.content or "").strip() or ((last.body_text if last else "") or "").strip()
        if not content:
            raise HTTPException(status_code=400, detail="No pending message to continue")
        attachments = body.attachments or []
        if last and not attachments:
            try:
                raw = json.loads(last.attachments_json or "[]")
                if isinstance(raw, list):
                    attachments = [a for a in raw if isinstance(a, dict)]
            except (TypeError, ValueError, json.JSONDecodeError):
                attachments = []
        _apply_intent_title_once(signal, content)
        return content, attachments

    content = (body.content or "").strip()
    if not content and not body.attachments:
        raise HTTPException(status_code=400, detail="A message is required")
    await append_signal_chat_message(
        session,
        signal,
        role="user",
        content=content or " ",
        author_user_id=author_user_id,
        attachments=body.attachments,
    )
    _apply_intent_title_once(signal, content)
    return content or " ", list(body.attachments or [])


def _serialize_conversation(signal: Signal, agents: dict[UUID, Agent] | None = None) -> dict:
    agent = agents.get(signal.agent_id) if agents and signal.agent_id else None
    return {
        "id": str(signal.id),
        "title": signal.subject,
        "channel": signal.channel,
        "source": signal.source,
        "audience": (
            "internal"
            if signal.channel in ("assistant", "internal")
            else "external"
        ),
        "ai_handling": signal.ai_handling,
        "agent_id": str(signal.agent_id) if signal.agent_id else None,
        "agent_name": agent.name if agent else None,
        "agent_kind": agent.kind if agent else None,
        "updated_at": signal.updated_at.isoformat(),
    }


def _serialize_target(agent: Agent, *, is_default: bool = False) -> dict:
    from app.services.workforce_runtime import serialize_agent

    return {**serialize_agent(agent, view="picker"), "is_default": is_default, "is_lead": bool(agent.is_lead)}


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
    opener = (body.message or "").strip()
    attachments = [a for a in (body.attachments or []) if isinstance(a, dict)]
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
    # Opener owns the conversation; agent_id is the chat partner.
    from app.services.ownership import set_owner

    set_owner(signal, "user", auth.user.id, by_user_id=auth.user.id)
    session.add(signal)
    await session.flush()
    has_opener = bool(opener or attachments)
    if has_opener:
        await append_signal_chat_message(
            session,
            signal,
            role="user",
            content=opener or " ",
            author_user_id=auth.user.id,
            attachments=attachments or None,
        )
        if opener:
            _apply_intent_title_once(signal, opener)
    await session.commit()
    await session.refresh(signal)
    return {
        "id": str(signal.id),
        "title": signal.subject,
        "channel": signal.channel,
        "agent_id": str(agent.id),
        "agent_name": agent.name,
        "agent_kind": agent.kind,
        "has_opener": has_opener,
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
    async with _chat_start_lock(conversation_id):
        await _ensure_session_idle(session, auth.tenant.id, conversation_id)
        turn_content, turn_attachments = await _resolve_turn_content(
            session, signal, body, author_user_id=auth.user.id
        )
        await _withdraw_session_checkout(session, auth.tenant.id, signal)
        await session.commit()

        # Operator Ask is an explicit hand-back: clear conversation hold and continue.
        if is_held(signal):
            await _hand_back_on_operator_ask(session, signal, auth)

        agent, run = await _agent_run(session, auth, signal, turn_content)
        req_task = asyncio.current_task()
        if req_task:
            _track_chat_turn(conversation_id, req_task)
    await _set_chat_agent_live(
        session, agent, status="working", signal=signal, run=run, summary=turn_content
    )
    history = await signal_chat_history(
        session, conversation_id, for_agent_id=agent.id if agent else None
    )
    from app.services.chat_runtime import build_agent_loop

    loop = build_agent_loop(
        session,
        tenant_id=auth.tenant.id,
        user_id=auth.user.id,
        agent=agent,
        signal_id=signal.id,
        trust="operator",
        tool_signal_id=signal.context_signal_id,
        run=run,
        surface="operator_chat",
        enable_chat_thinking=True,
        user_role=auth.role,
    )
    llm_meta = await _llm_meta_for_agent(session, auth.tenant.id, agent)
    from app.services.agent.run_cancel import clear_cancel, is_run_cancelled

    try:
        try:
            reply_text, tokens = await loop.run_chat(
                history,
                extra_context=_with_addressing(page_context_block(body.page_context), turn_content, agent),
                attachments=turn_attachments,
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
            saved = await loop.persist_turn(
                signal,
                metadata=llm_meta,
                final_metadata={"cancelled": True, "usage": tokens},
                fallback_text="Stopped before a reply was ready.",
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
        _apply_intent_title_once(signal, turn_content)
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


_EMPTY_FALLBACK = (
    "I could not finish a reply for that. "
    "Try again, or press Stop if the AI stays busy."
)
_CANCELLED_FALLBACK = "Stopped before a reply was ready."
_ABANDONED_FALLBACK = "The reply stopped unexpectedly. Send your message again."
# Orchestrator Ask with several tools can exceed three minutes; cutting the drive
# at 180s left tool trails on the thread but no synthesis bubble.
_OPERATOR_CHAT_DRIVE_TIMEOUT_S = 420
_TOOL_ONLY_STREAM_FALLBACK = (
    "I finished the lookups but could not write a summary. "
    "Ask again with a narrower question."
)


def _operator_stream_persist_text(
    *,
    stream_text: str,
    cancelled: bool,
    loop: AgentLoop | None,
) -> str:
    """Text persisted for a finished SSE turn (must match ``stream_chat`` done)."""
    if cancelled:
        return _CANCELLED_FALLBACK
    stripped = (stream_text or "").strip()
    if stripped:
        return stripped
    if loop is not None and loop.turn is not None and loop.turn.all_activity():
        return _TOOL_ONLY_STREAM_FALLBACK
    return _EMPTY_FALLBACK


async def _persist_failed_chat_turn(
    session: AsyncSession,
    loop: AgentLoop | None,
    signal: Signal,
    agent: Agent | None,
    run: AgentRun | None,
    llm_meta: dict[str, Any],
    error_text: str,
    *,
    error: BaseException | None = None,
    abandoned: bool = False,
) -> None:
    """Finalize a crashed/cancelled Ask: close the live turn, one error bubble, wake.

    The error bubble carries the work the turn did, so the trail and the
    failure read as one row.
    """
    from app.services.agent.run_cancel import clear_cancel

    await _finalize_run(session, run, status="failed", error=error if isinstance(error, Exception) else None)
    try:
        from app.services.participant_turns import clear_ask_floor_chip

        await clear_ask_floor_chip(
            session,
            signal,
            agent_id=agent.id if agent else None,
        )
    except Exception:  # noqa: BLE001
        logger.debug("clear floor after failed chat turn failed", exc_info=True)

    sealed = False
    had_partial_work = (
        loop is not None
        and loop.turn is not None
        and bool(getattr(loop.turn, "all_activity", lambda: [])())
    )
    if loop is not None and loop.turn is not None:
        try:
            await loop.turn.finish("error")
        except Exception:  # noqa: BLE001
            logger.debug("closing the live turn after a chat failure failed", exc_info=True)
        try:
            await loop.persist_turn(
                signal,
                metadata={
                    "error": True,
                    **({"abandoned_stream": True} if abandoned else {}),
                    **llm_meta,
                },
                final_metadata={"error": True},
                fallback_text=error_text,
            )
            sealed = True
        except Exception:  # noqa: BLE001
            logger.exception("persist_turn after chat failure failed for %s", signal.id)
    if not sealed:
        await append_signal_chat_message(
            session,
            signal,
            role="assistant",
            content=error_text,
            author_agent_id=agent.id if agent else None,
            metadata={
                "error": True,
                **({"abandoned_stream": True} if abandoned else {}),
                **llm_meta,
            },
        )

    if loop is not None:
        await loop.end_inline_turn("error")
    await session.commit()
    if run:
        clear_cancel(run.id)

    # Partial tool work crashed: wake the same agent so they can tell the human
    # and continue (canvas/folder builds must not die silently after a hard refresh).
    if (
        not abandoned
        and agent is not None
        and had_partial_work
        and error_text
    ):
        try:
            from app.services.agent_turns import enqueue_turn

            await enqueue_turn(
                session,
                signal,
                agent_id=agent.id,
                cause_kind="system",
                prompt=(
                    "Your previous turn failed before you finished "
                    f"(error for the human: {error_text[:280]}). "
                    "Tell the human in one short sentence that something went wrong, "
                    "then continue the unfinished work if you can "
                    "(for example finish update_folder_canvas). "
                    "Do not pass. Do not say you are still waiting."
                ),
                requested_by_kind="system",
                idempotency_key=f"recover:{run.id}" if run else None,
            )
            await session.commit()
        except Exception:  # noqa: BLE001
            logger.debug("wake agent after failed chat turn failed", exc_info=True)


async def _drive_operator_chat_turn(
    *,
    queue: asyncio.Queue,
    tenant_id: UUID,
    user_id: UUID,
    user_role: str | None,
    signal_id: UUID,
    agent_id: UUID | None,
    run_id: UUID | None,
    context_signal_id: UUID | None,
    history: list[dict[str, Any]],
    extra_context: str,
    attachments: list | None,
    turn_content: str,
    llm_meta: dict[str, Any],
) -> None:
    """Run the agent on its own session so leaving the tab does not kill it."""
    from app.services.agent.run_cancel import clear_cancel

    logger.warning("operator chat drive start signal=%s run=%s", signal_id, run_id)
    try:
        async with async_session_factory() as session:
            signal = await session.get(Signal, signal_id)
            agent = await session.get(Agent, agent_id) if agent_id else None
            run = await session.get(AgentRun, run_id) if run_id else None
            if signal is None:
                return
            from app.services.chat_runtime import build_agent_loop

            loop = build_agent_loop(
                session,
                tenant_id=tenant_id,
                user_id=user_id,
                agent=agent,
                signal_id=signal.id,
                trust="operator",
                tool_signal_id=context_signal_id,
                run=run,
                surface="operator_chat",
                enable_chat_thinking=True,
                user_role=user_role,
            )
            loaded_history = history
            if not loaded_history:
                try:
                    loaded_history = await asyncio.wait_for(
                        signal_chat_history(
                            session, signal_id, compact=False, for_agent_id=agent_id
                        ),
                        timeout=12,
                    )
                except Exception:
                    logger.exception("chat history load failed for %s", signal_id)
                    loaded_history = [{"role": "user", "content": turn_content}]
            try:
                async with asyncio.timeout(_OPERATOR_CHAT_DRIVE_TIMEOUT_S):
                    async for event in loop.stream_chat(
                        loaded_history,
                        extra_context=extra_context,
                        attachments=attachments,
                        skip_rag=True,
                    ):
                        # The gateway carries the live turn; this SSE only says when it is saved.
                        if event["type"] == "done":
                            cancelled = bool(event.get("cancelled"))
                            persist_text = _operator_stream_persist_text(
                                stream_text=str(event.get("text") or ""),
                                cancelled=cancelled,
                                loop=loop,
                            )
                            thinking_meta = loop.thinking_payload()
                            final_meta = {
                                "usage": event.get("usage", {}),
                                **({"thinking": thinking_meta} if thinking_meta else {}),
                                **({"cancelled": True} if cancelled else {}),
                            }
                            saved = await loop.persist_turn(
                                signal,
                                metadata=llm_meta,
                                final_metadata=final_meta,
                                fallback_text=persist_text,
                            )
                            if not cancelled:
                                _apply_intent_title_once(signal, turn_content)
                            await _finalize_run(
                                session,
                                run,
                                status="cancelled" if cancelled else "completed",
                                tokens=event.get("usage") or {},
                            )
                            if not cancelled and agent is not None and persist_text.strip():
                                from app.services.pass_stick import pass_stick

                                await pass_stick(
                                    session,
                                    signal,
                                    body_text=persist_text,
                                    author_kind="agent",
                                    author_id=agent.id,
                                    author_name=agent.name or "",
                                    enqueue=False,
                                )
                            await session.commit()
                            if run:
                                clear_cancel(run.id)
                            done_payload: dict[str, Any] = {
                                "text": persist_text,
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
                            await _put_sse(queue, "done", done_payload)
            except asyncio.CancelledError:
                logger.warning("operator chat turn cancelled for signal %s", signal_id)
                try:
                    await _persist_failed_chat_turn(
                        session,
                        loop,
                        signal,
                        agent,
                        run,
                        llm_meta,
                        _ABANDONED_FALLBACK,
                        abandoned=True,
                    )
                except Exception:
                    logger.exception("failed to persist cancelled chat turn %s", run_id)
                raise
            except Exception as exc:
                logger.exception("assistant stream failed for signal %s", signal.id)
                error_text = _agent_error_message(exc, llm_meta)
                try:
                    await session.rollback()
                except Exception:
                    pass
                # Keep ``loop`` so the open checkpoint is replaced (not left as a
                # stuck “Update folder canvas” under a second error bubble).
                try:
                    await _persist_failed_chat_turn(
                        session,
                        loop,
                        signal,
                        agent,
                        run,
                        llm_meta,
                        error_text,
                        error=exc,
                    )
                except Exception:
                    logger.exception("failed to persist error chat turn %s", run_id)
                    try:
                        async with async_session_factory() as fresh:
                            signal2 = await fresh.get(Signal, signal_id)
                            agent2 = await fresh.get(Agent, agent_id) if agent_id else None
                            run2 = await fresh.get(AgentRun, run_id) if run_id else None
                            if signal2 is not None:
                                await _persist_failed_chat_turn(
                                    fresh,
                                    None,
                                    signal2,
                                    agent2,
                                    run2,
                                    llm_meta,
                                    error_text,
                                    error=exc,
                                )
                    except Exception:
                        logger.exception("failed to persist error chat turn on fresh session %s", run_id)
                await _put_sse(queue, "done", {"text": error_text, "error": True, **llm_meta})
            finally:
                try:
                    await _set_chat_agent_live(session, agent, status="standby")
                    await session.commit()
                except Exception:
                    logger.exception("failed to stand by after chat turn %s", run_id)
    finally:
        await queue.put(None)


@router.post("/conversations/{conversation_id}/stream")
async def stream_message(
    conversation_id: UUID,
    body: MessageCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    signal = await _get_thread(session, conversation_id, auth.tenant.id)
    async with _chat_start_lock(conversation_id):
        await _ensure_session_idle(session, auth.tenant.id, conversation_id)
        req_task = asyncio.current_task()
        if req_task:
            _track_chat_turn(conversation_id, req_task)
        turn_content, turn_attachments = await _resolve_turn_content(
            session, signal, body, author_user_id=auth.user.id
        )
        await _withdraw_session_checkout(session, auth.tenant.id, signal)
        await session.commit()

        # Operator Ask is an explicit hand-back: clear conversation hold and continue.
        if is_held(signal):
            await _hand_back_on_operator_ask(session, signal, auth)

        # Several people tagged, or only colleagues: the stick decides and the
        # worker streams over the gateway. This SSE only confirms the handoff.
        from app.services.agent_turns import cancel_turns, latest_human_message_id
        from app.services.handoff_sessions import expand_invitees
        from app.services.pass_stick import _user_mentions, pass_stick

        message_id = await latest_human_message_id(session, signal.id)
        invitees = await expand_invitees(session, auth.tenant.id, signal, turn_content)
        colleagues_only = not invitees["agents"] and bool(_user_mentions(turn_content))
        if (invitees["agents"] and invitees["total"] >= 2) or colleagues_only:
            author_name = (
                (auth.user.display_name or auth.user.email) if auth.user else ""
            )
            moved = await pass_stick(
                session,
                signal,
                body_text=turn_content,
                author_kind="user",
                author_id=auth.user.id,
                author_name=author_name or "",
                wake_default=False,
                channel_agent_id=signal.agent_id,
                message_id=message_id,
            )
            await session.commit()
            opener_id = moved.get("holder_id")
            payload = {
                "text": "",
                "handoff": True,
                "opener_id": opener_id,
                "llm_configured": True,
                "llm_mode": "stick",
                "llm_key_source": "n/a",
            }

            async def handoff_started_generator():
                yield {"event": "done", "data": json.dumps(payload)}

            return EventSourceResponse(handoff_started_generator())

        if await cancel_turns(session, signal, keep_episode=message_id, outcome="superseded"):
            await session.commit()
        # Solo Ask (one focused agent): close any open handoff so the co-awake
        # strip and opener floor do not steal the live seat from the target.
        from app.services.handoff_sessions import get_handoff_session, interrupt_handoff_session

        if get_handoff_session(signal):
            await interrupt_handoff_session(
                session, signal, reason="operator_ask"
            )
            await session.commit()

        from app.services.agent.run_cancel import clear_cancel

        agent = None
        run = None
        try:
            agent, run = await _agent_run(session, auth, signal, turn_content)
            await _set_chat_agent_live(
                session, agent, status="working", signal=signal, run=run, summary=turn_content
            )
            # Do not resolve the model or compact history here. Both can hang
            # after presence is already "working" and before the drive starts.
            llm_meta = {
                "llm_configured": True,
                "llm_mode": "live",
                "llm_key_source": "deferred",
            }
            await session.commit()
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

        drive_kwargs = dict(
            tenant_id=auth.tenant.id,
            user_id=auth.user.id,
            user_role=auth.role,
            signal_id=signal.id,
            agent_id=agent.id if agent else None,
            run_id=run.id if run else None,
            context_signal_id=signal.context_signal_id,
            history=[],
            extra_context=_with_addressing(page_context_block(body.page_context), turn_content, agent),
            attachments=turn_attachments,
            turn_content=turn_content,
            llm_meta=llm_meta,
        )
        # The worker job is registered, but a wedged worker startup (init_db
        # after a simultaneous API boot) leaves Redis jobs unconsumed and the
        # thread silent. Drive in-process; reload reclaim covers orphans.
        queued = False
        queue: asyncio.Queue | None = None
        if not queued:
            queue = asyncio.Queue()
            task = asyncio.create_task(
                _drive_operator_chat_turn(queue=queue, **drive_kwargs)
            )
            _track_chat_turn(conversation_id, task)
            logger.warning(
                "operator chat starting drive signal=%s run=%s",
                conversation_id,
                run.id if run else None,
            )

    # Release the request connection before the SSE wait. Holding it for the
    # whole stream deadlocks the drive task when the pool is exhausted.
    try:
        await session.close()
    except Exception:
        logger.exception("failed to close request session before chat SSE")

    async def event_generator():
        if run:
            yield {
                "event": "start",
                "data": json.dumps({"run_id": str(run.id)}),
            }
        try:
            if queue is not None:
                while True:
                    item = await queue.get()
                    if item is None:
                        break
                    yield item
                return
            # Worker owns the turn. Gateway already streams thinking/deltas;
            # SSE only waits so the composer unlocks on done.
            import time as _time

            deadline = _time.monotonic() + 200
            status = "running"
            while _time.monotonic() < deadline:
                if run is None:
                    break
                async with async_session_factory() as poll:
                    row = await poll.get(AgentRun, run.id)
                    if row is None or row.status != "running":
                        status = row.status if row else "missing"
                        break
                await asyncio.sleep(0.4)
            payload: dict[str, Any] = {"text": "", **llm_meta}
            if run:
                payload["run_id"] = str(run.id)
            if status == "failed":
                payload["error"] = True
            if status == "cancelled":
                payload["cancelled"] = True
            yield {"event": "done", "data": json.dumps(payload)}
        except asyncio.CancelledError:
            # Viewer left or the proxy dropped SSE. The turn keeps writing
            # to the thread on its own session (API task or worker).
            raise

    return EventSourceResponse(event_generator())


@router.post("/conversations/{conversation_id}/cancel")
async def cancel_conversation_run(
    conversation_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Stop: cancel queued and running agent turns and the in-flight Ask run."""
    from app.services.agent.run_cancel import request_cancel
    from app.services.agent_turns import stop_conversation

    signal = await _get_thread(session, conversation_id, auth.tenant.id)
    turn_runs = await stop_conversation(session, signal)
    for run_id in turn_runs:
        request_cancel(run_id)
        turn_run = await session.get(AgentRun, run_id)
        if turn_run is not None and turn_run.status == "running":
            turn_run.status = "cancelled"
            turn_run.completed_at = datetime.utcnow()
            session.add(turn_run)
    await session.commit()
    run = await _running_chat_run(session, auth.tenant.id, conversation_id)
    if run is None:
        return {"ok": True, "cancelled": bool(turn_runs)}

    request_cancel(run.id)
    run.status = "cancelled"
    run.completed_at = datetime.utcnow()
    session.add(run)
    await session.commit()
    _cancel_live_chat_turn(conversation_id)
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


async def _hand_back_on_operator_ask(
    session: AsyncSession, signal: Signal, auth: AuthContext
) -> None:
    """Clear a conversation AI hold when the operator Asks again (S51 hand-back).

    Inbound auto-reply stays paused via ``is_held``; operator Ask is the
    explicit hand-back path (same intent as PUT /ai-handling). Publishes a
    thread update so chrome drops the manual signal.
    """
    from app.gateway.publish import publish_thread_update

    released = release_conversation(
        session,
        signal,
        reason="operator_ask",
        actor_type="user",
        actor_id=str(auth.user.id),
        via="operator_ask",
    )
    if not released:
        return
    await session.commit()
    try:
        await publish_thread_update(signal)
    except Exception:
        logger.debug("hand-back publish failed for %s", signal.id, exc_info=True)


async def _withdraw_session_checkout(
    session: AsyncSession, tenant_id: UUID, signal: Signal
) -> None:
    """Inline session: a new operator message retracts a pending wrap-up card."""
    if not signal.context_signal_id or signal.session_state != "active":
        return
    from app.services.agent_sessions import resume_session_after_message

    try:
        await resume_session_after_message(session, tenant_id, signal)
    except Exception:
        logger.debug("checkout withdraw failed for %s", signal.id, exc_info=True)


def _should_reclaim_chat_run(conversation_id: UUID, started: datetime) -> bool:
    """Reclaim when this process has no live turn, or the run is older than 15 min."""
    if not _chat_turn_is_live(conversation_id):
        return True
    return datetime.utcnow() - started >= CHAT_BUSY_STALE


async def reclaim_orphaned_chat_runs() -> int:
    """Finalize leftover chat runs after API boot (in-process turns die with uvicorn)."""
    from sqlalchemy import inspect

    from app.services.agent.run_cancel import clear_cancel
    from app.services.agent.turn_persist import end_dead_turns

    async with async_session_factory() as session:
        has_runs = await session.run_sync(
            lambda sync_conn: inspect(sync_conn).has_table("agent_runs")
        )
        if not has_runs:
            return 0
        result = await session.execute(
            select(AgentRun).where(
                AgentRun.trigger_type == "chat",
                AgentRun.status == "running",
            )
        )
        runs = list(result.scalars().all())
        agent_ids = {run.agent_id for run in runs if run.agent_id}
        signal_ids = {run.signal_id for run in runs if run.signal_id}
        for run in runs:
            await _finalize_run(session, run, status="failed")
            clear_cancel(run.id)
        for signal_id in signal_ids:
            signal = await session.get(Signal, signal_id)
            if signal is None:
                continue
            await end_dead_turns(
                session,
                signal,
                error_text=(
                    "The assistant stopped unexpectedly while working. "
                    "Send your message again, or ask me to continue."
                ),
                older_than=DEAD_TURN_AFTER,
            )
        for agent_id in agent_ids:
            agent = await session.get(Agent, agent_id)
            await _set_chat_agent_live(session, agent, status="standby")
        if runs:
            await session.commit()
        return len(runs)


async def _ensure_session_idle(
    session: AsyncSession, tenant_id: UUID, conversation_id: UUID
) -> None:
    from app.services.agent.run_cancel import clear_cancel

    busy = await _running_chat_run(session, tenant_id, conversation_id)
    if busy is None:
        return
    started = busy.started_at or datetime.utcnow()
    if _should_reclaim_chat_run(conversation_id, started):
        logger.warning(
            "reclaiming orphaned chat run %s on conversation %s (age %s, live=%s)",
            busy.id,
            conversation_id,
            datetime.utcnow() - started,
            _chat_turn_is_live(conversation_id),
        )
        from app.services.agent.turn_persist import end_dead_turns

        await _finalize_run(session, busy, status="failed")
        signal = await session.get(Signal, conversation_id)
        if signal is not None:
            await end_dead_turns(
                session,
                signal,
                error_text=(
                    "The assistant stopped unexpectedly while working. "
                    "Send your message again, or ask me to continue."
                ),
                author_agent_id=busy.agent_id,
                older_than=DEAD_TURN_AFTER,
            )
        await session.commit()
        clear_cancel(busy.id)
        _cancel_live_chat_turn(conversation_id)
        return
    raise HTTPException(
        status_code=409,
        detail="agent_busy",
    )


async def _get_thread(session: AsyncSession, conversation_id: UUID, tenant_id: UUID) -> Signal:
    """Load a thread the operator may Ask on (assistant chat or wake/run)."""
    result = await session.execute(
        select(Signal).where(
            Signal.id == conversation_id,
            Signal.tenant_id == tenant_id,
            Signal.channel.in_(OPERATOR_CHAT_CHANNELS),
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


async def _resolve_ask_agent(
    session: AsyncSession,
    auth,
    signal: Signal,
    content: str,
) -> tuple[Agent | None, str]:
    """Who answers this message: the one addressed agent, else the team router."""
    from app.services.addressing import resolve
    from app.services.team_router import pick_responder

    async def live(agent_id: UUID | None) -> Agent | None:
        if agent_id is None:
            return None
        agent = await session.get(Agent, agent_id)
        if agent is None or agent.tenant_id != auth.tenant.id or not agent.is_active:
            return None
        return agent

    agent_ids = [tid for _kind, tid in resolve(content).addressed("agent")]
    if len(agent_ids) == 1:
        picked = await live(agent_ids[0])
        if picked:
            return picked, "mention"
    pick = await pick_responder(session, signal, content)
    picked = await live(pick.agent_id)
    if picked:
        return picked, pick.reason
    return await _resolve_thread_agent(session, auth, signal), "owner"


def _with_addressing(block: str | None, content: str, agent: Agent | None) -> str | None:
    """Page context plus whether this agent was addressed or only named."""
    if agent is None:
        return block
    from app.services.addressing import turn_line

    line = turn_line(content or "", agent.id)
    if not line:
        return block
    return f"{block}\n\n{line}" if block else line


async def _agent_run(
    session,
    auth,
    signal: Signal,
    content: str,
):
    agent, reason = await _resolve_ask_agent(session, auth, signal, content)
    run = None
    if agent:
        run = AgentRun(
            tenant_id=auth.tenant.id,
            agent_id=agent.id,
            trigger_type="chat",
            trigger_id=str(signal.id),
            subject=f"Chat: {content[:80]}",
            signal_id=signal.id,
            result_json=json.dumps({"routing": {"reason": reason}}),
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

    if isinstance(exc, TimeoutError):
        return (
            "The assistant took too long to start a reply. "
            "Send your message again."
        )
    if is_rate_limit_error(exc):
        return (
            "The AI provider is busy right now (rate limit). "
            "Wait a few seconds and send your message again."
        )
    from app.exceptions import AppError
    from app.services.run_errors import workspace_block

    if workspace_block(exc) == "spend_cap" or (
        isinstance(exc, AppError) and exc.code == "budget_exceeded"
    ):
        return str(exc) or (
            "Daily LLM token budget exhausted. Raise the cap in Usage settings "
            "or wait until tomorrow."
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
