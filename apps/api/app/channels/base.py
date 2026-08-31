"""Shared channel-adapter contract and the single inbound ingestion path.

`InboundMessage` is the normalized shape every adapter produces. `ingest_inbound`
applies contact pairing (per-account `require_pairing` setting), threads the
message into an existing Signal when possible, and enqueues agent processing
only for approved contacts.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import ChannelAccount, Contact
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.signal_threads import clean_message_preview

# Outlook (and some relays) assign a new conversationId when a Gmail client
# replies even though In-Reply-To/References are intact. Fall back to RFC
# headers and then subject+sender within this window.
_SUBJECT_THREAD_LOOKBACK = timedelta(days=45)
_SUBJECT_PREFIX_RE = re.compile(
    r"^(?:(?:re|fw|fwd|aw|wg|sv|antw)\s*:\s*)+",
    re.IGNORECASE,
)
_RFC_MSG_ID_RE = re.compile(r"<[^<>@\s]+@[^<>\s]+>")


def normalize_email_subject(subject: str) -> str:
    """Strip reply/forward prefixes so follow-ups match the root subject."""
    text = (subject or "").strip()
    while True:
        stripped = _SUBJECT_PREFIX_RE.sub("", text).strip()
        if stripped == text:
            break
        text = stripped
    return text.casefold()


def extract_rfc_message_ids(*header_values: str | None) -> list[str]:
    """Unique RFC 5322 Message-IDs from In-Reply-To / References strings."""
    found: list[str] = []
    seen: set[str] = set()
    for raw in header_values:
        if not raw:
            continue
        for match in _RFC_MSG_ID_RE.findall(str(raw)):
            key = match.casefold()
            if key in seen:
                continue
            seen.add(key)
            found.append(match)
    return found


@dataclass
class InboundMessage:
    """Provider-agnostic inbound message produced by a channel adapter."""

    channel: str  # email | slack | widget | internal
    source: str  # provider tag (gmail, outlook, slack, mock, ...)
    sender_address: str  # email address / slack user id / visitor key
    sender_name: str = ""
    subject: str = ""
    body_text: str = ""
    external_id: str = ""  # provider message id (dedupe)
    thread_external_id: str = ""  # provider thread/conversation id
    channel_account_id: UUID | None = None
    # Actual delivery time at the provider (naive UTC). Without it the message
    # is stamped with the sync time, which is wrong for backfilled mail.
    received_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


def account_settings(account: ChannelAccount | None) -> dict[str, Any]:
    if not account:
        return {}
    try:
        data = json.loads(account.settings_json or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def _resolve_contact(
    session: AsyncSession,
    tenant_id: UUID,
    inbound: InboundMessage,
    *,
    require_pairing: bool,
) -> Contact | None:
    if not inbound.sender_address:
        return None

    # Workspace members are operators, not CRM customers. Never create a
    # Contact row for their login email — ContactPanel / pairing must not
    # treat a teammate as someone to Block or Approve.
    from app.services.workspace_members import find_member_by_email

    if await find_member_by_email(session, tenant_id, inbound.sender_address):
        return None

    result = await session.execute(
        select(Contact).where(
            Contact.tenant_id == tenant_id,
            Contact.channel == inbound.channel,
            Contact.address == inbound.sender_address,
        )
    )
    contact = result.scalar_one_or_none()
    if contact:
        contact.last_seen_at = datetime.utcnow()
        if inbound.sender_name and not contact.display_name:
            contact.display_name = inbound.sender_name
        session.add(contact)
        return contact

    # Automated senders (no-reply mailboxes, newsletters, bounces) are not
    # customers: never create CRM contact rows for them. An existing contact
    # above still matches so blocking such a sender keeps working.
    from app.services.automated_mail import classify_automated_email

    headers = inbound.metadata.get("auto_headers") if isinstance(inbound.metadata, dict) else None
    if classify_automated_email(inbound.sender_address, headers=headers)["automated"]:
        return None

    contact = Contact(
        tenant_id=tenant_id,
        channel=inbound.channel,
        address=inbound.sender_address,
        display_name=inbound.sender_name,
        status="pending" if require_pairing else "approved",
        last_seen_at=datetime.utcnow(),
    )
    session.add(contact)
    await session.flush()
    from app.services.companies import link_contact_company

    await link_contact_company(session, contact)
    return contact


async def _find_by_rfc_headers(
    session: AsyncSession, tenant_id: UUID, inbound: InboundMessage
) -> Signal | None:
    """Match In-Reply-To / References against stored message Message-IDs."""
    meta = inbound.metadata if isinstance(inbound.metadata, dict) else {}
    ids = extract_rfc_message_ids(
        str(meta.get("in_reply_to") or ""),
        str(meta.get("references") or ""),
    )
    if not ids:
        return None
    # Narrow by contact when known so a shared Message-ID collision across
    # unrelated mailboxes cannot merge threads.
    clauses = [
        SignalMessage.tenant_id == tenant_id,
        SignalMessage.metadata_json.is_not(None),
    ]
    result = await session.execute(
        select(SignalMessage)
        .where(*clauses)
        .order_by(SignalMessage.created_at.desc())
        .limit(400)
    )
    needle = {mid.casefold() for mid in ids}
    for message in result.scalars().all():
        try:
            stored = json.loads(message.metadata_json or "{}")
        except json.JSONDecodeError:
            continue
        if not isinstance(stored, dict):
            continue
        rfc = str(stored.get("rfc_message_id") or "").strip().casefold()
        if rfc and rfc in needle:
            signal = await session.get(Signal, message.signal_id)
            if signal and signal.channel == inbound.channel:
                return signal
    return None


async def _find_by_subject_sender(
    session: AsyncSession, tenant_id: UUID, inbound: InboundMessage
) -> Signal | None:
    """Last-resort thread merge when providers split conversation ids."""
    if inbound.channel != "email" or not inbound.sender_address:
        return None
    norm = normalize_email_subject(inbound.subject)
    if not norm:
        return None
    since = datetime.utcnow() - _SUBJECT_THREAD_LOOKBACK
    filters = [
        Signal.tenant_id == tenant_id,
        Signal.channel == "email",
        Signal.contact_email == inbound.sender_address,
        Signal.last_message_at.is_not(None),
        Signal.last_message_at >= since,
    ]
    if inbound.channel_account_id:
        filters.append(Signal.channel_account_id == inbound.channel_account_id)
    result = await session.execute(
        select(Signal).where(*filters).order_by(Signal.last_message_at.desc()).limit(40)
    )
    candidates = [
        s for s in result.scalars().all() if normalize_email_subject(s.subject) == norm
    ]
    if not candidates:
        return None
    open_ones = [s for s in candidates if s.status in ("open", "pending")]
    return (open_ones or candidates)[0]


async def _find_existing_thread(
    session: AsyncSession, tenant_id: UUID, inbound: InboundMessage
) -> Signal | None:
    if inbound.thread_external_id:
        result = await session.execute(
            select(Signal).where(
                Signal.tenant_id == tenant_id,
                Signal.channel == inbound.channel,
                Signal.external_id == inbound.thread_external_id,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            return existing
    by_rfc = await _find_by_rfc_headers(session, tenant_id, inbound)
    if by_rfc:
        return by_rfc
    return await _find_by_subject_sender(session, tenant_id, inbound)


async def ingest_inbound(
    session: AsyncSession,
    tenant_id: UUID,
    inbound: InboundMessage,
) -> tuple[Signal, bool]:
    """Create or extend a Signal from a normalized inbound message.

    Returns (signal, should_process): `should_process` is False when the
    contact is blocked or pending pairing approval — the message is stored
    but no agent run is enqueued.
    """
    account = None
    if inbound.channel_account_id:
        result = await session.execute(
            select(ChannelAccount).where(
                ChannelAccount.id == inbound.channel_account_id,
                ChannelAccount.tenant_id == tenant_id,
            )
        )
        account = result.scalar_one_or_none()

    require_pairing = bool(account_settings(account).get("require_pairing"))
    contact = await _resolve_contact(session, tenant_id, inbound, require_pairing=require_pairing)

    if contact and contact.status == "blocked":
        # Blocked senders are dropped entirely (no thread, no agent).
        await session.commit()
        raise BlockedContactError(inbound.sender_address)

    # Dedupe on provider message id.
    if inbound.external_id:
        dup = await session.execute(
            select(SignalMessage).where(
                SignalMessage.tenant_id == tenant_id,
                SignalMessage.external_id == inbound.external_id,
            )
        )
        existing_msg = dup.scalar_one_or_none()
        if existing_msg:
            sig = await session.execute(select(Signal).where(Signal.id == existing_msg.signal_id))
            signal = sig.scalar_one()
            return signal, False

    now = datetime.utcnow()
    # Prefer the provider's delivery time; clamp future values (clock skew).
    received = inbound.received_at if inbound.received_at and inbound.received_at <= now else now
    signal = await _find_existing_thread(session, tenant_id, inbound)
    created = False
    if not signal:
        signal = Signal(
            tenant_id=tenant_id,
            channel=inbound.channel,
            source=inbound.source,
            subject=inbound.subject or "(No subject)",
            contact_email=inbound.sender_address if inbound.channel == "email" else "",
            contact_name=inbound.sender_name,
            external_id=inbound.thread_external_id,
            channel_account_id=account.id if account else None,
            contact_id=contact.id if contact else None,
            status="open",
            priority="normal",
            has_unread=True,
            last_message_at=received,
        )
        session.add(signal)
        await session.flush()
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant_id,
                event_type="signal_created",
                actor_type="system",
                payload_json=json.dumps({"channel": inbound.channel, "source": inbound.source}),
            )
        )
        created = True
        if inbound.channel == "email":
            # Labels + assignee from the mailbox routing rules (same behavior
            # as manually created inbound signals).
            from app.services.signals import apply_email_routing

            await apply_email_routing(session, tenant_id, signal)

    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant_id,
        kind="user_message",
        direction="inbound",
        role="user",
        from_address=inbound.sender_address,
        subject=inbound.subject,
        body_text=inbound.body_text,
        body_preview=clean_message_preview(inbound.body_text, limit=200),
        body_html=str(inbound.metadata.get("body_html") or ""),
        attachments_json=json.dumps(inbound.metadata.get("attachments") or []),
        external_id=inbound.external_id,
        metadata_json=json.dumps(inbound.metadata) if inbound.metadata else "{}",
        received_at=received,
        created_at=received,
    )
    # If the sender is a workspace member, stamp authorship so the timeline
    # can render them as a teammate (or self) instead of an anonymous inbound.
    from app.services.workspace_members import find_member_by_email

    member_hit = await find_member_by_email(session, tenant_id, inbound.sender_address)
    if member_hit:
        message.author_user_id = member_hit[0].id
    session.add(message)
    signal.has_unread = True
    if (
        not created
        and signal.status in ("closed", "pending")
        and (signal.last_message_at is None or received >= signal.last_message_at)
    ):
        # A fresh customer message must surface the thread again: reopen a
        # closed conversation and wake a snoozed one (snooze-until-reply).
        # Spam stays parked, and backfilled older mail never reopens a thread.
        signal.status = "open"
        signal.snoozed_until = None
    # Backfill can ingest older mail after newer mail: never move the thread
    # back in time in the list ordering.
    if signal.last_message_at is None or received > signal.last_message_at:
        signal.last_message_at = received
    signal.updated_at = now
    await session.commit()
    await session.refresh(signal)
    await session.refresh(message)

    from app.gateway.publish import publish_signal_message

    await publish_signal_message(signal, message)

    if created:
        from app.services.webhooks import emit_webhook_event, signal_event_data

        await emit_webhook_event(session, tenant_id, "signal.created", signal_event_data(signal))

    pending = bool(contact and contact.status == "pending")
    if pending and created:
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant_id,
                event_type="pairing_pending",
                actor_type="system",
                payload_json=json.dumps({"contact": inbound.sender_address}),
            )
        )
        await session.commit()
    # Workspace members are operators, not customers: never enqueue the inbound
    # agent (no drafted "customer reply" to a teammate).
    if member_hit:
        return signal, False
    return signal, not pending


class BlockedContactError(Exception):
    def __init__(self, address: str):
        super().__init__(f"Contact {address} is blocked")
        self.address = address
