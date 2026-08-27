"""Unified SENSING API over Signal / SignalMessage / SignalEvent."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_signal_message, publish_thread_update
from app.models.auth import Membership, User, user_numeric_id
from app.models.channel import ChannelAccount, Contact
from app.models.email_routing import EmailRoutingRule
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
    from app.services.companies import link_contact_company

    await link_contact_company(session, contact)
    return contact


def _rule_matches(rule: EmailRoutingRule, *, contact_email: str, subject: str) -> bool:
    value = (rule.condition_value or "").strip().lower()
    if rule.condition_type == "mailbox":
        return True
    if rule.condition_type == "sender_domain":
        if not value:
            return False
        domain = contact_email.split("@")[-1].lower() if "@" in contact_email else ""
        needle = value.lstrip("@")
        return bool(domain) and (domain == needle or contact_email.lower().endswith(needle))
    if rule.condition_type == "subject_contains":
        return bool(value) and value in (subject or "").lower()
    return False


async def apply_email_routing(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
) -> None:
    """Apply active routing rules for the signal's mailbox: merge labels and
    resolve an assignee. Highest-priority matching rule wins for assignment."""
    if signal.channel != "email" or not signal.channel_account_id:
        return
    result = await session.execute(
        select(EmailRoutingRule)
        .where(
            EmailRoutingRule.tenant_id == tenant_id,
            EmailRoutingRule.channel_account_id == signal.channel_account_id,
            EmailRoutingRule.is_active.is_(True),
        )
        .order_by(EmailRoutingRule.priority)
    )
    rules = list(result.scalars().all())
    if not rules:
        return
    labels: list[str] = []
    assign_numeric: int | None = None
    for rule in rules:
        if not _rule_matches(rule, contact_email=signal.contact_email, subject=signal.subject):
            continue
        try:
            rule_labels = json.loads(rule.labels_json or "[]")
        except (json.JSONDecodeError, TypeError):
            rule_labels = []
        for label in rule_labels:
            if isinstance(label, str) and label not in labels:
                labels.append(label)
        if assign_numeric is None and rule.assign_to_user_id is not None:
            assign_numeric = rule.assign_to_user_id
    if labels:
        try:
            existing = json.loads(signal.tags_json or "[]")
        except (json.JSONDecodeError, TypeError):
            existing = []
        merged = list(existing) if isinstance(existing, list) else []
        for label in labels:
            if label not in merged:
                merged.append(label)
        signal.tags_json = json.dumps(merged)
    if assign_numeric is not None and signal.assigned_user_id is None:
        member_result = await session.execute(
            select(User.id)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.tenant_id == tenant_id)
        )
        for (user_id,) in member_result.all():
            if user_numeric_id(user_id) == assign_numeric:
                signal.assigned_user_id = user_id
                break


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


def message_plain_text(row: SignalMessage) -> str:
    """Best-available plain text of a message for LLM/agent consumption.

    HTML-only email parsed before the HTML-to-text fallback existed (or via a
    provider snippet) can carry a ``body_text`` of ~200 chars while the real
    content lives in ``body_html`` — agents reading it conclude the email was
    cut off mid-sentence. Prefer the HTML-derived text when it is clearly
    fuller than the stored plain text.
    """
    text = (row.body_text or "").strip()
    html = (row.body_html or "").strip()
    if not html:
        return text
    from app.services.email_sync import html_to_text

    html_text = html_to_text(html)
    if len(html_text) > len(text) + 120:
        return html_text
    return text or html_text


def serialize_message(row: SignalMessage) -> dict[str, Any]:
    body_text = message_plain_text(row)
    return {
        "id": str(row.id),
        "signal_id": str(row.signal_id),
        "direction": row.direction,
        "role": row.role,
        "from_address": row.from_address,
        "subject": row.subject,
        "body_text": body_text,
        "body_preview": row.body_preview or body_text[:200],
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
    if channel in ("email", "slack", "widget", "whatsapp"):
        channel_account_id = await _primary_channel_account_id(session, tenant_id, channel)
    contact = await get_or_create_contact(
        session,
        tenant_id,
        channel=channel,
        address=contact_email,
        display_name=contact_name,
    )
    existing = await _open_thread_for_inbound(
        session,
        tenant_id,
        channel=channel,
        contact_id=contact.id if contact else None,
        contact_email=contact_email,
        subject=subject,
        external_id=external_id,
    )
    now = datetime.utcnow()
    if existing:
        existing.has_unread = True
        existing.status = "open"
        existing.snoozed_until = None
        existing.last_message_at = now
        existing.updated_at = now
        if contact_name and not existing.contact_name:
            existing.contact_name = contact_name
        session.add(existing)
        message = SignalMessage(
            signal_id=existing.id,
            tenant_id=tenant_id,
            kind="user_message",
            direction="inbound",
            body_text=body_text,
            body_preview=body_text[:200],
            from_address=contact_email,
            subject=subject,
            received_at=now,
        )
        session.add(message)
        session.add(
            SignalEvent(
                signal_id=existing.id,
                tenant_id=tenant_id,
                event_type="message_added",
                actor_type="system",
            )
        )
        await session.commit()
        await session.refresh(existing)
        await session.refresh(message)
        await publish_signal_message(existing, message)
        return existing

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
        last_message_at=now,
    )
    session.add(signal)
    await session.flush()
    await apply_email_routing(session, tenant_id, signal)
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
    from app.services.webhooks import emit_webhook_event, signal_event_data

    await emit_webhook_event(session, tenant_id, "signal.created", signal_event_data(signal))
    if source != "demo" and channel not in ("internal", "assistant"):
        from app.services.onboarding_demo import remove_demo_threads

        await remove_demo_threads(session, tenant_id)
    return signal


async def _open_thread_for_inbound(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    channel: str,
    contact_id: UUID | None,
    contact_email: str,
    subject: str,
    external_id: str,
) -> Signal | None:
    """Continue an open conversation instead of starting a duplicate thread."""
    query = select(Signal).where(
        Signal.tenant_id == tenant_id,
        Signal.channel == channel,
        Signal.status.in_(("open", "pending")),
    )
    if external_id:
        by_ext = await session.execute(query.where(Signal.external_id == external_id).limit(1))
        found = by_ext.scalar_one_or_none()
        if found:
            return found
    if contact_id:
        query = query.where(Signal.contact_id == contact_id)
    elif contact_email.strip():
        query = query.where(func.lower(Signal.contact_email) == contact_email.strip().lower())
    else:
        return None
    if channel == "email" and subject.strip():
        query = query.where(Signal.subject == subject.strip())
    result = await session.execute(query.order_by(Signal.last_message_at.desc()).limit(1))
    return result.scalar_one_or_none()


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
