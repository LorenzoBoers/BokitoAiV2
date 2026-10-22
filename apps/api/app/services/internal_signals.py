"""Internal signals: something the platform or an agent noticed, as its own thread.

A connection that goes bad, a learning proposal, a trend for a client: each is
a first-class signal (``channel=internal``, ``source=awareness``) owned by the
department domain that should act on it (All when none fits). It runs through
the same chain as a customer message: read, approach, outcome, learning.

``key`` deduplicates: while a signal with the same key is open, a new raise
adds a message to it instead of opening a second thread.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from app.core.time import utcnow

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal, SignalEvent, SignalMessage

logger = logging.getLogger(__name__)

SOURCE = "awareness"


async def _open_with_key(session: AsyncSession, tenant_id: UUID, key: str) -> Signal | None:
    return (
        await session.execute(
            select(Signal)
            .where(
                Signal.tenant_id == tenant_id,
                Signal.channel == "internal",
                Signal.source == SOURCE,
                Signal.external_id == key,
                Signal.status.in_(("open", "pending", "snoozed")),
            )
            .order_by(Signal.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def raise_internal_signal(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    subject: str,
    body: str,
    key: str,
    department_id: UUID | None = None,
    agent_id: UUID | None = None,
    project_id: UUID | None = None,
    labels: list[str] | None = None,
    about: dict[str, Any] | None = None,
) -> tuple[Signal, bool]:
    """Open (or add to) the internal signal for ``key``. Returns (signal, created). Flushes."""
    from app.models.agent import Agent
    from app.services.signal_tags import add_signal_tags
    from app.services.teams import ensure_all_department

    now = utcnow()
    signal = await _open_with_key(session, tenant_id, key)
    created = signal is None
    if signal is None:
        if department_id is None:
            department_id = (await ensure_all_department(session, tenant_id)).id
        agent = await session.get(Agent, agent_id) if agent_id else None
        signal = Signal(
            tenant_id=tenant_id,
            channel="internal",
            source=SOURCE,
            external_id=key[:255],
            subject=subject[:200] or "Signal",
            contact_name=agent.name if agent else "Bokito",
            agent_id=agent_id,
            project_id=project_id,
            assignee_kind="department",
            assignee_id=department_id,
            status="open",
            priority="normal",
            summary=subject[:500],
            last_message_at=now,
            has_unread=True,
        )
        session.add(signal)
        await session.flush()
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant_id,
                event_type="signal_created",
                actor_type="agent" if agent_id else "system",
                actor_id=str(agent_id or ""),
                payload_json=json.dumps({"source": SOURCE, "key": key, "about": about or {}}),
            )
        )
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant_id,
        kind="agent_message",
        direction="inbound",
        role="assistant",
        author_agent_id=agent_id,
        subject=subject[:200],
        body_text=body,
        body_preview=body[:200],
        received_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.has_unread = True
    session.add(signal)
    await session.flush()
    if labels:
        await add_signal_tags(session, tenant_id, signal.id, labels, actor_type="system")
    try:
        from app.gateway.publish import publish_signal_message

        await publish_signal_message(signal, message)
    except Exception:  # noqa: BLE001 — live push is best effort
        logger.warning("live push for internal signal %s failed", signal.id, exc_info=True)
    return signal, created
