"""Wire agent decisions and workforce messages into Signal threads."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_decision, publish_signal_message
from app.services.automated_mail import clip_with_ellipsis
from app.models.agent import Agent
from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalEvent, SignalMessage


def decision_provenance(decision: DecisionRequest) -> dict[str, Any] | None:
    """Where this decision came from, for the card and the notification.

    One shape per source so the UI can label it ("Queue item", "Agent run") and
    link to the right surface. Returns None for a plain agent question.
    """
    if decision.platform_change_id:
        return {"type": "platform_change", "id": str(decision.platform_change_id)}
    if decision.agent_task_id:
        return {
            "type": "agent_task",
            "id": str(decision.agent_task_id),
            "project_id": str(decision.project_id) if decision.project_id else None,
        }
    if decision.project_id:
        return {"type": "project", "id": str(decision.project_id)}
    if decision.run_id:
        return {"type": "agent_run", "id": str(decision.run_id)}
    return None


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
            # Only relabel internal threads; an external thread's contact_name
            # belongs to the customer, never the agent posting a decision.
            if (
                existing.channel == "internal"
                and contact_name
                and contact_name != "Agent"
                and existing.contact_name in ("", "Agent")
            ):
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
        if agent_name != "Agent" and signal.channel == "internal":
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
        body_preview=clip_with_ellipsis(decision.summary or decision.title, 200)
        or (decision.title or "")[:200],
        decision_id=decision.id,
        received_at=datetime.utcnow(),
    )
    session.add(message)
    await session.flush()
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
    # Pass the decision so the gateway event carries the full options payload
    # and open threads can render the decision card without a refetch.
    await publish_signal_message(signal, message, decision=decision)
    await publish_decision(
        tenant_id,
        decision_id=decision.id,
        status=decision.status,
        title=decision.title,
        signal_id=signal.id,
    )
    from app.services.webhooks import decision_event_data, emit_webhook_event

    await emit_webhook_event(session, tenant_id, "decision.created", decision_event_data(decision))
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


async def create_decision(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    title: str,
    summary: str = "",
    options: list[dict[str, Any]] | None = None,
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
    signal_id: UUID | None = None,
    project_id: UUID | None = None,
    platform_change_id: UUID | None = None,
    agent_task_id: UUID | None = None,
    run_id: UUID | None = None,
    source_type: str = "agent",
    source_id: str | None = None,
    notification_payload: dict[str, Any] | None = None,
    notification_title: str | None = None,
) -> tuple[DecisionRequest, SignalMessage]:
    """The single write path for human decisions.

    Creates the DecisionRequest, projects it into the notification bell
    (respecting mute preferences), lands the card as a message in a Signal
    thread, and publishes the gateway events. Callers never write Notification
    rows for decisions themselves.

    The notification payload always ends up carrying `decision_id`,
    `signal_id` and `message_id`, so the bell and a push both deep-link to the
    exact card instead of the inbox root.
    """
    from app.gateway.publish import publish_notification
    from app.services.notification_mail import decision_bell_status

    bell_status = await decision_bell_status(session, tenant_id, user_id)
    notification = Notification(
        tenant_id=tenant_id,
        user_id=user_id,
        kind="decision_request",
        title=notification_title or title,
        body=(summary or title)[:500],
        status=bell_status,
        payload_json=json.dumps(notification_payload or {}, default=str),
    )
    session.add(notification)
    await session.flush()
    if bell_status == "unread":
        await publish_notification(
            tenant_id,
            notification_id=notification.id,
            kind=notification.kind,
            title=notification.title,
        )
    decision = DecisionRequest(
        tenant_id=tenant_id,
        notification_id=notification.id,
        title=title,
        summary=summary,
        options_json=json.dumps(options or []),
        status="awaiting_human",
        project_id=project_id,
        platform_change_id=platform_change_id,
        agent_task_id=agent_task_id,
        run_id=run_id,
        signal_id=signal_id,
        source_type=source_type,
        source_id=source_id,
    )
    session.add(decision)
    await session.flush()
    message = await append_decision_to_signal(
        session,
        tenant_id,
        decision,
        user_id=user_id,
        agent_id=agent_id,
        project_id=project_id,
        signal_id=signal_id,
    )
    # The thread and the card only exist after the append, so the bell payload
    # is completed here rather than trusting each caller to guess the ids.
    notification.payload_json = json.dumps(
        {
            **(notification_payload or {}),
            "decision_id": str(decision.id),
            "signal_id": str(decision.signal_id) if decision.signal_id else None,
            "message_id": str(message.id),
        },
        default=str,
    )
    session.add(notification)
    await session.flush()
    return decision, message
