"""Wire agent decisions and workforce messages into Signal threads."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalEvent, SignalMessage


async def get_or_create_internal_thread(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    project_id: UUID | None = None,
    subject: str,
    contact_name: str = "Agent",
    assigned_user_id: UUID | None = None,
    existing_signal_id: UUID | None = None,
) -> Signal:
    if existing_signal_id:
        result = await session.execute(
            select(Signal).where(Signal.id == existing_signal_id, Signal.tenant_id == tenant_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            return existing

    signal = Signal(
        tenant_id=tenant_id,
        channel="internal",
        source="workforce",
        subject=subject or "(No subject)",
        contact_name=contact_name,
        status="open",
        priority="normal",
        has_unread=True,
        project_id=project_id,
        assigned_user_id=assigned_user_id,
        last_message_at=datetime.utcnow(),
    )
    session.add(signal)
    await session.flush()
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="signal_created",
            actor_type="system",
            payload_json=json.dumps({"source": "internal"}),
        )
    )
    return signal


async def append_decision_to_signal(
    session: AsyncSession,
    tenant_id: UUID,
    decision: DecisionRequest,
    *,
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
    project_id: UUID | None = None,
) -> SignalMessage:
    signal = await get_or_create_internal_thread(
        session,
        tenant_id,
        project_id=project_id or decision.project_id,
        subject=decision.title,
        assigned_user_id=user_id,
    )
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant_id,
        kind="decision_request",
        direction="inbound",
        role="assistant",
        author_agent_id=agent_id,
        subject=decision.title,
        body_text=decision.summary or decision.title,
        body_preview=(decision.summary or decision.title)[:200],
        decision_id=decision.id,
        received_at=datetime.utcnow(),
    )
    session.add(message)
    decision.message_id = message.id
    decision.signal_id = signal.id
    signal.last_message_at = datetime.utcnow()
    signal.has_unread = True
    signal.updated_at = datetime.utcnow()
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="decision_created",
            actor_type="agent" if agent_id else "system",
            actor_id=str(agent_id or ""),
            payload_json=json.dumps({"decision_id": str(decision.id)}),
        )
    )
    await session.flush()
    return message


async def append_workforce_message(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    kind: str,
    subject: str,
    body: str,
    project_id: UUID | None = None,
    agent_id: UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> SignalMessage:
    signal = await get_or_create_internal_thread(
        session,
        tenant_id,
        project_id=project_id,
        subject=subject,
        contact_name="Agent",
    )
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant_id,
        kind=kind,
        direction="inbound",
        role="assistant",
        author_agent_id=agent_id,
        subject=subject,
        body_text=body,
        body_preview=body[:200],
        received_at=datetime.utcnow(),
    )
    session.add(message)
    signal.last_message_at = datetime.utcnow()
    signal.has_unread = True
    session.add(signal)
    await session.flush()
    return message


async def ingest_decision_request(
    session: AsyncSession,
    tenant_id: UUID,
    notification: Notification,
    decision: DecisionRequest,
    *,
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
) -> SignalMessage:
    return await append_decision_to_signal(
        session,
        tenant_id,
        decision,
        user_id=user_id or notification.user_id,
        agent_id=agent_id,
        project_id=decision.project_id,
    )
