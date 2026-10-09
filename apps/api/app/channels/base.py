"""Shared channel-adapter contract and the single inbound ingestion path.

`InboundMessage` is the normalized shape every adapter produces. `ingest_inbound`
applies contact pairing (per-account `require_pairing` setting), threads the
message into an existing Signal when possible, and enqueues agent processing
only for approved contacts.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import ChannelAccount, Contact
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.signal_threads import clean_message_preview

logger = logging.getLogger(__name__)

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


_FORWARD_SUBJECT_RE = re.compile(r"^\s*(?:fwd?|wg|tr|doorst\.?)\s*:", re.IGNORECASE)
_FORWARD_FROM_RE = re.compile(
    r"^\s*(?:>\s*)?\**\s*(?:from|van|von|de)\s*\**\s*:\s*\**\s*(?P<name>[^<\n]*?)\s*(?:<\s*(?P<email>[^>\s]+@[^>\s]+)\s*>|(?P<bare>[^\s<>]+@[^\s<>]+))?\s*\**\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def detect_forwarded_message(subject: str, body_text: str) -> dict[str, str] | None:
    """Name and address of the original sender of a forwarded mail.

    Recognises the FW/Fwd subject prefix together with the first
    ``From:``/``Van:`` line in the body (Outlook, Gmail and Apple Mail all
    write one). Returns ``None`` when the mail is not a forward.
    """
    if not _FORWARD_SUBJECT_RE.match(subject or ""):
        return None
    match = _FORWARD_FROM_RE.search(body_text or "")
    if not match:
        return {"name": "", "email": ""}
    email_addr = (match.group("email") or match.group("bare") or "").strip().lower()
    name = (match.group("name") or "").strip().strip('"').strip()
    if not name and not email_addr:
        return {"name": "", "email": ""}
    return {"name": name, "email": email_addr}


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
    # "inbound": the external party wrote to us. "outbound": a teammate wrote
    # to the external party from their own mailbox (Sent items) and the copy
    # is logged on the customer's thread as a team reply.
    direction: str = "inbound"
    # To/Cc addresses (lowercase). Required to thread an outbound copy onto
    # the right customer conversation.
    recipient_addresses: list[str] = field(default_factory=list)


class UnknownRecipientError(Exception):
    """An outbound copy addressed to nobody Bokito knows: skipped on purpose."""

    def __init__(self, recipients: list[str]):
        super().__init__(f"No known contact or conversation for {', '.join(recipients) or '(none)'}")
        self.recipients = recipients


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
    contact = result.scalars().first()
    if contact:
        contact.last_seen_at = datetime.utcnow()
        if inbound.sender_name and not contact.display_name:
            contact.display_name = inbound.sender_name
        session.add(contact)
        if contact.status == "blocked" or not contact.merged_into_id:
            return contact
        from app.services.contact_identity import canonical

        return await canonical(session, contact) or contact

    # Automated senders (no-reply mailboxes, newsletters, bounces) are not
    # customers: never create CRM contact rows for them. An existing contact
    # above still matches so blocking such a sender keeps working.
    from app.services.automated_mail import classify_automated_email

    headers = inbound.metadata.get("auto_headers") if isinstance(inbound.metadata, dict) else None
    if classify_automated_email(inbound.sender_address, headers=headers)["automated"]:
        return None

    from app.services.signals import _is_anonymous_contact_identity

    if _is_anonymous_contact_identity(inbound.sender_address, inbound.sender_name):
        return None

    contact = Contact(
        tenant_id=tenant_id,
        channel=inbound.channel,
        address=inbound.sender_address,
        display_name=inbound.sender_name,
        status="pending" if require_pairing else "approved",
        last_seen_at=datetime.utcnow(),
    )
    person = await _existing_person(session, tenant_id, inbound)
    if person is not None:
        contact.merged_into_id = person.id
    session.add(contact)
    await session.flush()
    if person is not None:
        return person
    from app.services.companies import link_contact_company

    await link_contact_company(session, contact)
    return contact


async def _existing_person(
    session: AsyncSession, tenant_id: UUID, inbound: InboundMessage
) -> Contact | None:
    """A new email address or WhatsApp number that already belongs to exactly
    one person becomes an identity of that person."""
    from app.models.auth import Tenant
    from app.services import contact_identity as identity

    if inbound.channel == "email":
        email = identity.normalize_email(inbound.sender_address)
        persons = await identity.find_person(session, tenant_id, email=email) if email else []
    elif inbound.channel == "whatsapp":
        region = identity.phone_region(await session.get(Tenant, tenant_id))
        phone = identity.normalize_phone(inbound.sender_address, region)
        persons = (
            await identity.find_person(session, tenant_id, phone=phone, region=region) if phone else []
        )
    else:
        return None
    return persons[0] if len(persons) == 1 else None


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


def _counterparty_addresses(inbound: InboundMessage) -> list[str]:
    """The external side of the mail: the sender for inbound, To/Cc for outbound."""
    if inbound.direction == "outbound":
        return [a.strip().lower() for a in inbound.recipient_addresses if a and a.strip()]
    return [inbound.sender_address] if inbound.sender_address else []


async def _find_by_subject_sender(
    session: AsyncSession, tenant_id: UUID, inbound: InboundMessage
) -> Signal | None:
    """Last-resort thread merge when providers split conversation ids.

    For an outbound copy the recipient plays the role of the sender: the
    thread is the one whose contact we wrote to.
    """
    counterparty = _counterparty_addresses(inbound)
    if inbound.channel != "email" or not counterparty:
        return None
    norm = normalize_email_subject(inbound.subject)
    if not norm:
        return None
    since = datetime.utcnow() - _SUBJECT_THREAD_LOOKBACK
    filters = [
        Signal.tenant_id == tenant_id,
        Signal.channel == "email",
        func.lower(Signal.contact_email).in_(counterparty),
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
    """The conversation this message continues, after any splits on it."""
    from app.services.conversation_split import active_conversation

    if inbound.thread_external_id:
        # A split copies the provider thread id; the oldest row heads the chain.
        result = await session.execute(
            select(Signal)
            .where(
                Signal.tenant_id == tenant_id,
                Signal.channel == inbound.channel,
                Signal.external_id == inbound.thread_external_id,
            )
            .order_by(Signal.created_at)
            .limit(1)
        )
        existing = result.scalar_one_or_none()
        if existing:
            return await active_conversation(session, existing)
    by_rfc = await _find_by_rfc_headers(session, tenant_id, inbound)
    if by_rfc:
        return await active_conversation(session, by_rfc)
    return await active_conversation(
        session, await _find_by_subject_sender(session, tenant_id, inbound)
    )


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

    if inbound.direction == "outbound":
        return await _ingest_outbound_copy(session, tenant_id, inbound, account)

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
                payload_json=json.dumps(
                    {
                        "channel": inbound.channel,
                        "source": inbound.source,
                        "started_by": inbound.sender_name or inbound.sender_address or "",
                    }
                ),
            )
        )
        created = True
        if inbound.channel == "email":
            # Labels + assignee from the mailbox routing rules (same behavior
            # as manually created inbound signals).
            from app.services.signals import apply_email_routing

            await apply_email_routing(session, tenant_id, signal)
        from app.services.distribution import distribute

        await distribute(session, signal)

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
        # A colleague forwarding a customer's mail into the inbox: remember
        # whose message it contains so the timeline and the agent can tell.
        forwarded = detect_forwarded_message(inbound.subject, inbound.body_text)
        if forwarded:
            meta = dict(inbound.metadata) if isinstance(inbound.metadata, dict) else {}
            meta["forwarded_from"] = forwarded
            message.metadata_json = json.dumps(meta)
    session.add(message)
    signal.has_unread = True
    is_newest = signal.last_message_at is None or received >= signal.last_message_at
    if not created and signal.status in ("closed", "pending") and is_newest:
        # A fresh customer message must surface the thread again: reopen a
        # closed conversation and wake a snoozed one (snooze-until-reply).
        # Spam stays parked, and backfilled older mail never reopens a thread.
        signal.status = "open"
        signal.snoozed_until = None
    if not created and not member_hit and is_newest:
        # The contact wrote again: an open reply proposal answered the previous
        # message and is now out of date. Set it aside; the agent drafts anew.
        from app.services.signal_threads import (
            DEFER_SUPERSEDED_BY_INBOUND,
            _defer_open_reply_suggestions,
        )

        deferred = await _defer_open_reply_suggestions(
            session, tenant_id, signal.id, reason=DEFER_SUPERSEDED_BY_INBOUND
        )
        if deferred:
            session.add(
                SignalEvent(
                    signal_id=signal.id,
                    tenant_id=tenant_id,
                    event_type="suggestion_deferred",
                    actor_type="system",
                    actor_id="",
                    payload_json=json.dumps(
                        {"reason": DEFER_SUPERSEDED_BY_INBOUND, "count": deferred}
                    ),
                )
            )
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

    if is_newest and signal.status != "spam" and signal.channel not in ("internal", "assistant"):
        try:
            from app.services.notify import notify_new_inbound

            await notify_new_inbound(
                session,
                tenant_id,
                signal,
                sender=inbound.sender_name or signal.contact_name or inbound.sender_address,
                subject=inbound.subject or signal.subject or "",
                exclude=member_hit[0].id if member_hit else None,
            )
        except Exception:
            logger.exception("new-message notice failed for signal=%s", signal.id)

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


async def _find_message_by_rfc_id(
    session: AsyncSession, tenant_id: UUID, rfc_message_id: str
) -> SignalMessage | None:
    """A message already stored under this RFC Message-ID (any direction).

    The Sent copy of a mail Bokito delivered, or of a mail a teammate Cc'd to
    the shared inbox, carries the same Message-ID as the stored row.
    """
    needle = (rfc_message_id or "").strip().casefold()
    if not needle:
        return None
    result = await session.execute(
        select(SignalMessage)
        .where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.metadata_json.like(f"%{needle[1:-1] if needle.startswith('<') else needle}%"),
        )
        .order_by(SignalMessage.created_at.desc())
        .limit(20)
    )
    for message in result.scalars().all():
        try:
            stored = json.loads(message.metadata_json or "{}")
        except json.JSONDecodeError:
            continue
        if not isinstance(stored, dict):
            continue
        if str(stored.get("rfc_message_id") or "").strip().casefold() == needle:
            return message
    return None


_COPY_WINDOW = timedelta(minutes=15)


def _normalize_body(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip().casefold()


async def _is_copy_of_bokito_reply(
    session: AsyncSession, signal: Signal, inbound: InboundMessage, received: datetime
) -> bool:
    """A Sent item that is the provider's copy of a reply Bokito delivered.

    Providers do not hand back the RFC Message-ID on send, so the match is
    an outbound reply on the same thread, sent within a short window, whose
    stored body opens the Sent copy (the copy adds signature and history).
    """
    result = await session.execute(
        select(SignalMessage)
        .where(
            SignalMessage.signal_id == signal.id,
            SignalMessage.direction == "outbound",
            SignalMessage.kind.in_(("user_message", "agent_message")),
            SignalMessage.created_at >= received - _COPY_WINDOW,
            SignalMessage.created_at <= received + _COPY_WINDOW,
        )
        .order_by(SignalMessage.created_at.desc())
        .limit(10)
    )
    copy_text = _normalize_body(inbound.body_text)
    for message in result.scalars().all():
        try:
            stored = json.loads(message.metadata_json or "{}")
        except json.JSONDecodeError:
            stored = {}
        if isinstance(stored, dict) and stored.get("origin") == "external_mailbox":
            continue
        own = _normalize_body(message.body_text)
        if not own:
            continue
        head = own[:160]
        if head and (head in copy_text or copy_text[:160] == head):
            return True
    return False


async def mailbox_owner_user_id(
    session: AsyncSession, account: ChannelAccount | None, from_address: str = ""
) -> UUID | None:
    """Who wrote a mail that left this mailbox.

    The member whose login email matches the From address wins; otherwise
    the member whose email is the mailbox address; otherwise, for a personal
    mailbox shared with exactly one person, that person.
    """
    if account is None:
        return None
    from app.services.workspace_members import find_member_by_email

    for candidate in (from_address, account.address):
        hit = await find_member_by_email(session, account.tenant_id, candidate)
        if hit:
            return hit[0].id
    from app.services.channel_access import account_access

    users = [e for e in account_access(account) if e.get("kind") == "user"]
    if len(users) == 1:
        try:
            return UUID(str(users[0]["id"]))
        except (KeyError, ValueError):
            return None
    return None


async def _known_recipient_contact(
    session: AsyncSession, tenant_id: UUID, recipients: list[str]
) -> Contact | None:
    """The first recipient that is a known (not blocked) contact, as a person."""
    if not recipients:
        return None
    from app.services.contact_identity import canonical

    rows = (
        await session.execute(
            select(Contact).where(
                Contact.tenant_id == tenant_id,
                func.lower(Contact.address).in_(recipients),
            )
        )
    ).scalars().all()
    by_address = {row.address.lower(): row for row in rows}
    for address in recipients:
        row = by_address.get(address)
        if row is None or row.status == "blocked":
            continue
        return await canonical(session, row) or row
    return None


async def _ingest_outbound_copy(
    session: AsyncSession,
    tenant_id: UUID,
    inbound: InboundMessage,
    account: ChannelAccount | None,
) -> tuple[Signal, bool]:
    """Log a mail a teammate sent from their own mailbox as a team reply.

    Only mail to a known contact or onto an existing conversation is logged;
    anything else (suppliers, private mail) raises ``UnknownRecipientError``
    and stays out of Bokito. The copy never marks the thread unread, never
    reopens it and never enqueues the agent. An open reply proposal on the
    thread is set aside (``superseded_by_external_reply``).
    """
    meta = inbound.metadata if isinstance(inbound.metadata, dict) else {}
    recipients = _counterparty_addresses(inbound)
    from app.services.workspace_members import find_member_by_email

    # Keep only external recipients: a Cc to the shared inbox or a colleague
    # is not the counterparty.
    external: list[str] = []
    for address in recipients:
        if account is not None and address == (account.address or "").lower():
            continue
        if await find_member_by_email(session, tenant_id, address):
            continue
        external.append(address)
    inbound.recipient_addresses = external

    # Dedupe: provider id first, then the RFC Message-ID (the stored outbound
    # row Bokito sent itself, or the inbound copy of a Cc'd mail).
    if inbound.external_id:
        existing_msg = (
            await session.execute(
                select(SignalMessage).where(
                    SignalMessage.tenant_id == tenant_id,
                    SignalMessage.external_id == inbound.external_id,
                )
            )
        ).scalar_one_or_none()
        if existing_msg:
            return (await session.get(Signal, existing_msg.signal_id)), False
    rfc_id = str(meta.get("rfc_message_id") or "")
    if rfc_id:
        existing_msg = await _find_message_by_rfc_id(session, tenant_id, rfc_id)
        if existing_msg:
            return (await session.get(Signal, existing_msg.signal_id)), False

    signal = await _find_existing_thread(session, tenant_id, inbound)
    contact: Contact | None = None
    created = False
    now = datetime.utcnow()
    received = inbound.received_at if inbound.received_at and inbound.received_at <= now else now
    if signal is not None and await _is_copy_of_bokito_reply(session, signal, inbound, received):
        # The Sent folder also holds the mail Bokito itself delivered from
        # this mailbox; that reply is already on the timeline.
        return signal, False
    if signal is None:
        contact = await _known_recipient_contact(session, tenant_id, external)
        if contact is None:
            raise UnknownRecipientError(external)
        to_address = next(
            (a for a in external if a == contact.address.lower()), external[0] if external else ""
        )
        signal = Signal(
            tenant_id=tenant_id,
            channel=inbound.channel,
            source=inbound.source,
            subject=inbound.subject or "(No subject)",
            contact_email=to_address if inbound.channel == "email" else "",
            contact_name=contact.display_name or "",
            external_id=inbound.thread_external_id,
            channel_account_id=account.id if account else None,
            contact_id=contact.id,
            status="open",
            priority="normal",
            has_unread=False,
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
                payload_json=json.dumps(
                    {
                        "channel": inbound.channel,
                        "source": inbound.source,
                        "origin": "external_mailbox",
                        "started_by": (contact.display_name if contact else "") or inbound.sender_address or "",
                    }
                ),
            )
        )
        created = True
        if inbound.channel == "email":
            from app.services.signals import apply_email_routing

            await apply_email_routing(session, tenant_id, signal)

    author_id = await mailbox_owner_user_id(session, account, inbound.sender_address)
    message_meta = {
        **meta,
        "origin": "external_mailbox",
        "provider": inbound.source,
        "mailbox": account.address if account else "",
        "sender_name": inbound.sender_name,
    }
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant_id,
        kind="user_message",
        direction="outbound",
        role="user",
        author_user_id=author_id,
        from_address=inbound.sender_address,
        to_addresses=", ".join(external),
        subject=inbound.subject,
        body_text=inbound.body_text,
        body_preview=clean_message_preview(inbound.body_text, limit=200),
        body_html=str(meta.get("body_html") or ""),
        attachments_json=json.dumps(meta.get("attachments") or []),
        external_id=inbound.external_id,
        metadata_json=json.dumps(message_meta),
        received_at=received,
        created_at=received,
        send_status="sent",
    )
    session.add(message)
    is_newest = signal.last_message_at is None or received >= signal.last_message_at
    if is_newest:
        signal.last_message_at = received
        # A colleague answered: the thread no longer waits for the team.
        signal.has_unread = False
        if not created:
            from app.services.signal_threads import (
                DEFER_SUPERSEDED_BY_EXTERNAL_REPLY,
                _defer_open_reply_suggestions,
            )

            deferred = await _defer_open_reply_suggestions(
                session, tenant_id, signal.id, reason=DEFER_SUPERSEDED_BY_EXTERNAL_REPLY
            )
            if deferred:
                session.add(
                    SignalEvent(
                        signal_id=signal.id,
                        tenant_id=tenant_id,
                        event_type="suggestion_deferred",
                        actor_type="system",
                        actor_id=str(author_id or ""),
                        payload_json=json.dumps(
                            {"reason": DEFER_SUPERSEDED_BY_EXTERNAL_REPLY, "count": deferred}
                        ),
                    )
                )
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="reply_logged_externally",
            actor_type="user" if author_id else "system",
            actor_id=str(author_id or ""),
            payload_json=json.dumps(
                {
                    "mailbox": account.address if account else "",
                    "provider": inbound.source,
                    "from": inbound.sender_address,
                    "to": external,
                }
            ),
        )
    )
    signal.updated_at = now
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    await session.refresh(message)

    from app.gateway.publish import publish_signal_message, publish_thread_update

    await publish_signal_message(signal, message)
    await publish_thread_update(signal)
    return signal, False
