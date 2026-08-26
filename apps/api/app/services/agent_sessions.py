"""Inline agent sessions: an assistant conversation embedded in a thread.

A session is an assistant `Signal` (channel="assistant") whose
`context_signal_id` points at the host thread, plus a lifecycle
(`session_state` active -> closed). The existing chat endpoints handle the
actual conversation (streaming, tools, thread-transcript grounding); this
module owns start/close and the checkout outcome that stays visible in the
host thread's timeline as a collapsed, expandable block.
"""

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import User
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.signal_threads import _iso

# Tool calls that only read (research) are not "actions" worth surfacing in
# the checkout summary; everything else mutated state somewhere.
READ_ONLY_TOOLS = frozenset(
    {"search_index", "search_product_help", "list_docs", "read_doc", "get_tenant_overview"}
)

SUMMARY_MAX_CHARS = 400


def serialize_session(signal: Signal, agent: Agent | None) -> dict[str, Any]:
    try:
        outcome = json.loads(signal.session_outcome_json or "{}")
    except json.JSONDecodeError:
        outcome = {}
    return {
        "id": str(signal.id),
        "thread_id": str(signal.context_signal_id) if signal.context_signal_id else None,
        "state": signal.session_state,
        "agent_id": str(signal.agent_id) if signal.agent_id else None,
        "agent_name": agent.name if agent else None,
        "owner_user_id": str(signal.owner_user_id) if signal.owner_user_id else None,
        "started_at": _iso(signal.created_at),
        "closed_at": _iso(signal.session_closed_at) if signal.session_closed_at else None,
        "summary": outcome.get("summary") or "",
        "actions": outcome.get("actions") or [],
        "message_count": outcome.get("message_count") or 0,
    }


async def _load_host_thread(session: AsyncSession, tenant_id: UUID, thread_id: UUID) -> Signal:
    result = await session.execute(
        select(Signal).where(Signal.id == thread_id, Signal.tenant_id == tenant_id)
    )
    thread = result.scalar_one_or_none()
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    if thread.channel == "assistant":
        raise HTTPException(
            status_code=400, detail="Cannot start an agent session inside an assistant chat"
        )
    return thread


async def list_sessions(
    session: AsyncSession, tenant_id: UUID, thread_id: UUID
) -> list[dict[str, Any]]:
    """All sessions on a thread, oldest first (team-visible by design)."""
    result = await session.execute(
        select(Signal)
        .where(
            Signal.tenant_id == tenant_id,
            Signal.context_signal_id == thread_id,
            Signal.channel == "assistant",
            Signal.session_state.is_not(None),
        )
        .order_by(Signal.created_at)
    )
    signals = list(result.scalars().all())
    agent_ids = {s.agent_id for s in signals if s.agent_id}
    agents: dict[UUID, Agent] = {}
    if agent_ids:
        agents_result = await session.execute(
            select(Agent).where(Agent.id.in_(agent_ids), Agent.tenant_id == tenant_id)
        )
        agents = {a.id: a for a in agents_result.scalars().all()}
    return [serialize_session(s, agents.get(s.agent_id) if s.agent_id else None) for s in signals]


async def start_session(
    session: AsyncSession,
    tenant_id: UUID,
    user: User,
    thread_id: UUID,
    agent: Agent,
) -> dict[str, Any]:
    """Open a session; reuses the caller's existing active session on the thread."""
    thread = await _load_host_thread(session, tenant_id, thread_id)

    existing = (
        await session.execute(
            select(Signal).where(
                Signal.tenant_id == tenant_id,
                Signal.context_signal_id == thread_id,
                Signal.channel == "assistant",
                Signal.session_state == "active",
                Signal.owner_user_id == user.id,
            )
        )
    ).scalars().first()
    if existing is not None:
        return serialize_session(existing, agent if existing.agent_id == agent.id else None)

    conversation = Signal(
        tenant_id=tenant_id,
        channel="assistant",
        source="agent_session",
        subject=f"Agent session: {thread.subject[:80]}",
        owner_user_id=user.id,
        agent_id=agent.id,
        contact_name=user.display_name or user.email,
        has_unread=False,
        context_signal_id=thread_id,
        session_state="active",
    )
    session.add(conversation)
    await session.flush()
    session.add(
        SignalEvent(
            signal_id=thread_id,
            tenant_id=tenant_id,
            event_type="agent_session_started",
            actor_type="user",
            actor_id=str(user.id),
            payload_json=json.dumps(
                {"session_id": str(conversation.id), "agent_id": str(agent.id), "agent_name": agent.name}
            ),
        )
    )
    await session.commit()
    await session.refresh(conversation)
    return serialize_session(conversation, agent)


def _extract_actions(messages: list[SignalMessage]) -> list[dict[str, Any]]:
    """Consequential tool calls from the agent messages' trace steps."""
    actions: list[dict[str, Any]] = []
    for msg in messages:
        if msg.kind != "agent_message":
            continue
        try:
            meta = json.loads(msg.metadata_json or "{}")
        except json.JSONDecodeError:
            continue
        for step in meta.get("steps") or []:
            if step.get("step_type") != "tool_call":
                continue
            name = step.get("name") or ""
            if not name or name in READ_ONLY_TOOLS:
                continue
            payload = step.get("payload") or {}
            detail = ""
            raw_input = payload.get("input")
            if isinstance(raw_input, dict):
                # MCP calls carry the real tool name inside the input.
                detail = str(raw_input.get("tool") or raw_input.get("name") or "")
            actions.append({"tool": name, "detail": detail, "at": _iso(msg.created_at)})
    return actions


async def close_session(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    thread_id: UUID,
    session_id: UUID,
) -> dict[str, Any]:
    """Checkout: freeze the session and write its outcome to the host thread."""
    conversation = (
        await session.execute(
            select(Signal).where(
                Signal.id == session_id,
                Signal.tenant_id == tenant_id,
                Signal.channel == "assistant",
                Signal.context_signal_id == thread_id,
                Signal.session_state.is_not(None),
            )
        )
    ).scalar_one_or_none()
    if conversation is None:
        raise HTTPException(status_code=404, detail="Session not found")

    agent = None
    if conversation.agent_id:
        agent = (
            await session.execute(
                select(Agent).where(
                    Agent.id == conversation.agent_id, Agent.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()

    if conversation.session_state == "closed":
        return serialize_session(conversation, agent)

    messages = list(
        (
            await session.execute(
                select(SignalMessage)
                .where(
                    SignalMessage.signal_id == conversation.id,
                    SignalMessage.tenant_id == tenant_id,
                )
                .order_by(SignalMessage.created_at)
            )
        ).scalars().all()
    )
    chat_messages = [m for m in messages if m.kind in ("user_message", "agent_message")]
    last_agent_text = next(
        (m.body_text for m in reversed(chat_messages) if m.kind == "agent_message" and m.body_text),
        "",
    )
    summary = last_agent_text.strip()[:SUMMARY_MAX_CHARS]
    actions = _extract_actions(messages)

    outcome = {
        "summary": summary,
        "actions": actions,
        "message_count": len(chat_messages),
    }
    conversation.session_state = "closed"
    conversation.session_closed_at = datetime.utcnow()
    conversation.session_outcome_json = json.dumps(outcome)
    conversation.updated_at = datetime.utcnow()
    session.add(conversation)
    session.add(
        SignalEvent(
            signal_id=thread_id,
            tenant_id=tenant_id,
            event_type="agent_session_closed",
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps({"session_id": str(conversation.id), **outcome}),
        )
    )
    await session.commit()
    await session.refresh(conversation)
    return serialize_session(conversation, agent)
