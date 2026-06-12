"""Wire agent decisions and workforce messages into Signal threads."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_decision, publish_signal_message
from app.models.agent import Agent
from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalEvent, SignalMessage


async def get_or_create_internal_thread(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    project_id: UUID | None = None,
    subject: str,
    contact_name: str = "Agent",
    agent_id: UUID | None = None,
    assigned_user_id: UUID | None = None,
    existing_signal_id: UUID | None = None,
) -> Signal:
    if existing_signal_id:
        result = await session.execute(
            select(Signal).where(Signal.id == existing_signal_id, Signal.tenant_id == tenant_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            if agent_id and not existing.agent_id:
                existing.agent_id = agent_id
            if contact_name and contact_name != "Agent" and existing.contact_name in ("", "Agent"):
                existing.contact_name = contact_name
            return existing

    signal = Signal(
        tenant_id=tenant_id,
        channel="internal",
        source="workforce",
        subject=subject or "(No subject)",
        contact_name=contact_name,
        agent_id=agent_id,
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
    signal_id: UUID | None = None,
) -> SignalMessage:
    agent_name = "Agent"
    if agent_id:
        agent_row = (
            await session.execute(select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if agent_row:
            agent_name = agent_row.name

    signal = await get_or_create_internal_thread(
        session,
        tenant_id,
        project_id=project_id or decision.project_id,
        subject=decision.title,
        contact_name=agent_name,
        agent_id=agent_id,
        assigned_user_id=user_id,
        existing_signal_id=signal_id,
    )
    if agent_id and not signal.agent_id:
        signal.agent_id = agent_id
        if agent_name != "Agent":
            signal.contact_name = agent_name
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
    await publish_signal_message(signal, message)
    await publish_decision(
        tenant_id,
        decision_id=decision.id,
        status=decision.status,
        title=decision.title,
        signal_id=signal.id,
    )
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
    agent_name = "Agent"
    if agent_id:
        agent_row = (
            await session.execute(select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id))
        ).scalar_one_or_none()
        if agent_row:
            agent_name = agent_row.name

    signal = await get_or_create_internal_thread(
        session,
        tenant_id,
        project_id=project_id,
        subject=subject,
        contact_name=agent_name,
        agent_id=agent_id,
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
    await publish_signal_message(signal, message)
    return message


async def ingest_decision_request(
    session: AsyncSession,
    tenant_id: UUID,
    notification: Notification,
    decision: DecisionRequest,
    *,
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
    signal_id: UUID | None = None,
) -> SignalMessage:
    return await append_decision_to_signal(
        session,
        tenant_id,
        decision,
        user_id=user_id or notification.user_id,
        agent_id=agent_id,
        project_id=decision.project_id,
        signal_id=signal_id,
    )
