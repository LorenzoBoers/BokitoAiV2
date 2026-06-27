"""Complete inbound signal processing: agent reply persistence + external delivery."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.outbound import deliver_outbound
from app.models.agent import Agent
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.assistant_threads import append_signal_chat_message


_SKIP_REPLIES = frozenset({"", "Done.", "HEARTBEAT_OK"})


async def persist_inbound_agent_reply(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    agent: Agent,
    *,
    reply_text: str,
    run_id: UUID | None = None,
    tokens: dict | None = None,
) -> dict:
    """Persist agent output on an inbound thread and deliver externally when applicable."""
    text = (reply_text or "").strip()
    if text in _SKIP_REPLIES or signal.ai_paused:
        return {"skipped": True, "reason": "empty_or_paused"}

    metadata: dict = {"inbound_auto_reply": True}
    if run_id:
        metadata["run_id"] = str(run_id)
    if tokens:
        metadata["usage"] = tokens

    message = await append_signal_chat_message(
        session,
        signal,
        role="assistant",
        content=text,
        author_agent_id=agent.id,
        metadata=metadata,
    )

    delivery_status = "skipped"
    if signal.channel in ("email", "slack"):
        delivery_status = await deliver_outbound(
            session,
            signal,
            body_text=text,
            subject=f"Re: {signal.subject}" if signal.subject else "Reply",
        )
        if delivery_status.startswith("sent"):
            message.auto_sent = True
            session.add(message)

    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="agent_replied",
            actor_type="agent",
            actor_id=str(agent.id),
            payload_json=json.dumps(
                {"run_id": str(run_id) if run_id else None, "delivery": delivery_status}
            ),
        )
    )
    await session.commit()
    return {
        "message_id": str(message.id),
        "delivery": delivery_status,
        "channel": signal.channel,
    }
