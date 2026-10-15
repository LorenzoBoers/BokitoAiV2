"""Unified chat runtime for operator, widget, agent, and system surfaces.

Surfaces differ only in auth/trust. Durable messages and agent turns share
this entry point so hub, widget, and A2A paths stay aligned.
"""

from __future__ import annotations

import logging
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun
from app.models.signal import Signal, SignalMessage
from app.services.assistant_threads import append_signal_chat_message
from app.services.agent.loop import AgentLoop

logger = logging.getLogger(__name__)

Trust = Literal["operator", "widget", "agent", "system", "external"]


async def post_message(
    session: AsyncSession,
    signal: Signal,
    *,
    content: str,
    role: str = "user",
    trust: Trust = "operator",
    author_user_id: UUID | None = None,
    author_agent_id: UUID | None = None,
    kind: str | None = None,
    attachments: list[dict] | None = None,
    metadata: dict[str, Any] | None = None,
    decision_id: UUID | None = None,
) -> SignalMessage:
    """Append a chat-style message and publish on the gateway."""
    meta = dict(metadata or {})
    meta.setdefault("trust", trust)
    if kind == "internal_note" or (kind is None and role == "system"):
        # Team-only note path used by post_thread_message / post_internal_note.
        from datetime import datetime
        import json

        from app.gateway.publish import publish_signal_message
        from app.models.signal import SignalMessage as SM

        now = datetime.utcnow()
        message = SM(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            kind="internal_note",
            direction="internal",
            role="assistant" if author_agent_id else "user",
            author_user_id=author_user_id,
            author_agent_id=author_agent_id,
            body_text=content,
            body_preview=content[:200],
            attachments_json=json.dumps(attachments or []),
            metadata_json=json.dumps(meta),
            decision_id=decision_id,
            received_at=now,
        )
        session.add(message)
        signal.last_message_at = now
        signal.updated_at = now
        session.add(signal)
        await session.flush()
        await publish_signal_message(signal, message)
        return message
    return await append_signal_chat_message(
        session,
        signal,
        role=role,
        content=content,
        author_user_id=author_user_id,
        author_agent_id=author_agent_id,
        attachments=attachments,
        metadata=meta,
        decision_id=decision_id,
    )


def build_agent_loop(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    agent: Agent | None,
    signal_id: UUID | None,
    trust: Trust = "operator",
    tool_signal_id: UUID | None = None,
    run: AgentRun | None = None,
    surface: str = "",
    enable_chat_thinking: bool = False,
    reply_mode: str | None = None,
    user_role: str | None = None,
) -> AgentLoop:
    """Construct an AgentLoop with the shared trust/surface contract."""
    return AgentLoop(
        session,
        tenant_id,
        user_id,
        agent=agent,
        run=run,
        signal_id=signal_id,
        trust=trust,
        tool_signal_id=tool_signal_id or signal_id,
        surface=surface or trust,
        enable_chat_thinking=enable_chat_thinking,
        reply_mode=reply_mode,
        user_role=user_role,
    )


async def start_agent_turn(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    agent: Agent,
    signal: Signal,
    user_text: str,
    trust: Trust = "operator",
    tool_signal_id: UUID | None = None,
    surface: str = "",
    extra_system: str | None = None,
) -> dict[str, Any]:
    """Run one agent turn (blocking). Callers that stream keep their SSE path
    but should construct the loop via :func:`build_agent_loop`."""
    loop = build_agent_loop(
        session,
        tenant_id=tenant_id,
        user_id=user_id,
        agent=agent,
        signal_id=signal.id,
        trust=trust,
        tool_signal_id=tool_signal_id,
        surface=surface,
    )
    text, tokens = await loop.run_chat(
        [{"role": "user", "content": user_text}],
        extra_context=extra_system or "",
    )
    return {"ok": True, "text": text, "tokens": tokens}


async def cancel_turn(signal_id: UUID) -> bool:
    """Best-effort cancel of an in-process chat turn (operator Ask path)."""
    try:
        from app.routers.signal_chat import _cancel_live_chat_turn

        _cancel_live_chat_turn(signal_id)
        return True
    except Exception:  # noqa: BLE001
        logger.debug("cancel_turn failed for %s", signal_id, exc_info=True)
        return False
