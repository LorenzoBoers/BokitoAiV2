"""Unified SENSING API over Signal / SignalMessage / SignalEvent."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_signal_message, publish_thread_update
from app.models.channel import ChannelAccount, Contact
from app.models.signal import Signal, SignalEvent, SignalMessage


async def _primary_channel_account_id(
    session: AsyncSession, tenant_id: UUID, channel: str
) -> UUID | None:
    result = await session.execute(
        select(ChannelAccount)
        .where(
            ChannelAccount.tenant_id == tenant_id,
            ChannelAccount.channel == channel,
            ChannelAccount.is_enabled.is_(True),
        )
        .limit(1)
    )
    account = result.scalar_one_or_none()
    return account.id if account else None


async def get_or_create_contact(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    channel: str,
    address: str,
    display_name: str = "",
) -> Contact | None:
    if not address:
        return None
    result = await session.execute(
        select(Contact).where(
            Contact.tenant_id == tenant_id,
            Contact.channel == channel,
            Contact.address == address,
        )
    )
    contact = result.scalar_one_or_none()
    if contact:
        contact.last_seen_at = datetime.utcnow()
        if display_name and not contact.display_name:
            contact.display_name = display_name
        session.add(contact)
        return contact
    contact = Contact(
        tenant_id=tenant_id,
        channel=channel,
        address=address,
        display_name=display_name,
        status="approved",
        last_seen_at=datetime.utcnow(),
    )
    session.add(contact)
    await session.flush()
    return contact


def serialize_signal(row: Signal) -> dict[str, Any]:
    tags: list = []
    try:
        tags = json.loads(row.tags_json or "[]")
    except (json.JSONDecodeError, TypeError):
        pass
    return {
        "id": str(row.id),
        "channel": row.channel,
        "source": row.source,
        "subject": row.subject,
        "contact_name": row.contact_name,
        "contact_email": row.contact_email,
        "status": row.status,
        "priority": row.priority,
        "tags": tags,
        "has_unread": row.has_unread,
        "category": row.category,
        "urgency": row.urgency,
        "impact": row.impact,
        "summary": row.summary,
        "certainty": row.certainty,
        "triaged_at": row.triaged_at.isoformat() if row.triaged_at else None,
        "last_message_at": row.last_message_at.isoformat() if row.last_message_at else None,
        "created_at": row.created_at.isoformat(),
    }


def serialize_message(row: SignalMessage) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "signal_id": str(row.signal_id),
        "direction": row.direction,
        "role": row.role,
        "from_address": row.from_address,
        "subject": row.subject,
        "body_text": row.body_text,
        "body_preview": row.body_preview or row.body_text[:200],
        "kind": row.kind,
        "decision_id": str(row.decision_id) if row.decision_id else None,
        "send_status": row.send_status,
        "created_at": row.created_at.isoformat(),
    }


async def list_signals(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    status: Optional[str] = None,
    channel: Optional[str] = None,
    priority: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Signal]:
    stmt = select(Signal).where(Signal.tenant_id == tenant_id)
    if status:
        stmt = stmt.where(Signal.status == status)
    if channel:
        stmt = stmt.where(Signal.channel == channel)
    if priority:
        stmt = stmt.where(Signal.priority == priority)
    stmt = stmt.order_by(Signal.last_message_at.desc()).limit(min(limit, 200)).offset(offset)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_signal_detail(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID
) -> dict[str, Any]:
    result = await session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")
    msg_result = await session.execute(
        select(SignalMessage)
        .where(SignalMessage.signal_id == signal_id)
        .order_by(SignalMessage.created_at)
    )
    evt_result = await session.execute(
        select(SignalEvent).where(SignalEvent.signal_id == signal_id).order_by(SignalEvent.created_at)
    )
    return {
        **serialize_signal(signal),
        "messages": [serialize_message(m) for m in msg_result.scalars().all()],
        "events": [
            {
                "id": str(e.id),
                "event_type": e.event_type,
                "actor_type": e.actor_type,
                "payload": json.loads(e.payload_json or "{}"),
                "created_at": e.created_at.isoformat(),
            }
            for e in evt_result.scalars().all()
        ],
    }


async def create_inbound_signal(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    channel: str,
    source: str,
    subject: str,
    body_text: str,
    contact_email: str = "",
    contact_name: str = "",
    external_id: str = "",
) -> Signal:
    channel_account_id = None
    if channel in ("email", "slack", "widget"):
        channel_account_id = await _primary_channel_account_id(session, tenant_id, channel)
    contact = await get_or_create_contact(
        session,
        tenant_id,
        channel=channel,
        address=contact_email,
        display_name=contact_name,
    )
    signal = Signal(
        tenant_id=tenant_id,
        channel=channel,
        source=source,
        subject=subject or "(No subject)",
        contact_email=contact_email,
        contact_name=contact_name,
        external_id=external_id,
        channel_account_id=channel_account_id,
        contact_id=contact.id if contact else None,
        status="open",
        priority="normal",
        has_unread=True,
        last_message_at=datetime.utcnow(),
    )
    session.add(signal)
    await session.flush()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant_id,
        kind="user_message",
        direction="inbound",
        body_text=body_text,
        body_preview=body_text[:200],
        from_address=contact_email,
        subject=subject,
    )
    session.add(message)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="signal_created",
            actor_type="system",
        )
    )
    await session.commit()
    await session.refresh(signal)
    await session.refresh(message)
    await publish_signal_message(signal, message)
    return signal


async def apply_triage(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    category: str,
    urgency: int,
    impact: int,
    summary: str,
    certainty: int,
    priority: Optional[str] = None,
) -> Signal:
    result = await session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")
    signal.category = category
    signal.urgency = max(0, min(100, urgency))
    signal.impact = max(0, min(100, impact))
    signal.summary = summary
    signal.certainty = max(0, min(100, certainty))
    signal.triaged_at = datetime.utcnow()
    if priority:
        signal.priority = priority
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="triaged",
            actor_type="agent",
            payload_json=json.dumps(
                {"category": category, "urgency": urgency, "impact": impact, "certainty": certainty}
            ),
        )
    )
    await session.commit()
    await session.refresh(signal)
    await publish_thread_update(signal)
    return signal
