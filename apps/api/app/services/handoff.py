"""Human takeover for external conversations.

One shared path for every way a conversation can escalate to the team:
the agent's ``handoff_to_human`` tool and the widget visitor's own
"talk to a human" action both land here. Pauses AI replies on the thread
(``Signal.ai_paused``), records an ``ai_paused`` SignalEvent, publishes the
thread update, and alerts owners/admins (notification category ``handoff``).
"""

from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal, SignalEvent


async def request_human_handoff(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    reason: str = "",
    via: str = "handoff_to_human",
    actor_type: str = "user",
    actor_id: str = "",
) -> bool:
    """Escalate ``signal`` to the team. Returns True when newly paused."""
    from app.gateway.publish import publish_thread_update
    from app.services.ops_alerts import notify_tenant_admins

    newly_paused = False
    if not signal.ai_paused:
        signal.ai_paused = True
        signal.has_unread = True
        signal.updated_at = datetime.utcnow()
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant_id,
                event_type="ai_paused",
                actor_type=actor_type,
                actor_id=actor_id,
                payload_json=json.dumps({"ai_paused": True, "via": via, "reason": reason}),
            )
        )
        await session.flush()
        await publish_thread_update(signal)
        newly_paused = True

    who = signal.contact_name or "A visitor"
    await notify_tenant_admins(
        session,
        tenant_id,
        category="handoff",
        title=f"Human takeover requested: {signal.subject or who}"[:200],
        body=reason
        or f"{who} asked for a human. AI replies are paused until someone takes over the thread.",
        payload={"signal_id": str(signal.id), "channel": signal.channel},
        cooldown_minutes=30,
    )
    return newly_paused


async def request_callback(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    reason: str = "",
    via: str = "request_callback",
    actor_type: str = "user",
    actor_id: str = "",
) -> None:
    """Ask the team to get back later. Does not pause AI replies."""
    from app.gateway.publish import publish_thread_update
    from app.services.ops_alerts import notify_tenant_admins

    signal.has_unread = True
    signal.updated_at = datetime.utcnow()
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="callback_requested",
            actor_type=actor_type,
            actor_id=actor_id,
            payload_json=json.dumps({"via": via, "reason": reason}),
        )
    )
    await session.flush()
    await publish_thread_update(signal)

    who = signal.contact_name or "A visitor"
    await notify_tenant_admins(
        session,
        tenant_id,
        category="handoff",
        title=f"Callback requested: {signal.subject or who}"[:200],
        body=reason
        or f"{who} asked the team to get back. Chat stays open; no live handoff right now.",
        payload={"signal_id": str(signal.id), "channel": signal.channel, "via": via},
        cooldown_minutes=30,
    )
