"""Outbound delivery: route a Signal reply to the channel's provider."""

from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels import email as email_adapter
from app.channels import slack as slack_adapter
from app.channels import whatsapp as whatsapp_adapter
from app.models.channel import ChannelAccount
from app.models.signal import Signal, SignalMessage


@dataclass(frozen=True)
class OutboundDelivery:
    """Result of delivering a reply to an external channel.

    ``body_html`` is set for email and is the exact HTML that was sent
    (including signature), so callers can persist it on the timeline.
    """

    status: str
    body_html: str | None = None

    def startswith(self, prefix: str) -> bool:
        return self.status.startswith(prefix)


def _message_metadata(message: SignalMessage) -> dict:
    try:
        data = json.loads(message.metadata_json or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def _reply_context(
    session: AsyncSession, signal_id
) -> tuple[str | None, str | None, str | None]:
    """(In-Reply-To, References, provider message id) for replying in-thread.

    In-Reply-To/References use the RFC 5322 Message-ID captured at ingest —
    provider ids (Gmail/Graph API ids) are useless as threading headers. The
    provider id is returned separately for Graph's reply endpoint.
    """
    result = await session.execute(
        select(SignalMessage)
        .where(
            SignalMessage.signal_id == signal_id,
            SignalMessage.direction == "inbound",
        )
        .order_by(SignalMessage.created_at.desc())
        .limit(1)
    )
    message = result.scalar_one_or_none()
    if not message:
        return None, None, None
    provider_id = (message.external_id or "").strip() or None
    metadata = _message_metadata(message)
    rfc_id = str(metadata.get("rfc_message_id") or "").strip()
    if not rfc_id:
        return None, None, provider_id
    prior_refs = str(metadata.get("references") or "").strip()
    references = f"{prior_refs} {rfc_id}".strip() if prior_refs else rfc_id
    return rfc_id, references, provider_id


async def _workspace_email_account(
    session: AsyncSession, tenant_id
) -> ChannelAccount | None:
    """Sendable mailbox when a thread was never bound to one.

    The workspace's chosen primary wins; otherwise any channel that can send
    right now, preferring a real mailbox over a relay address.
    """
    from app.services.channel_registry import can_send, resolve_channel

    result = await session.execute(
        select(ChannelAccount)
        .where(
            ChannelAccount.tenant_id == tenant_id,
            ChannelAccount.channel == "email",
            ChannelAccount.is_enabled.is_(True),
        )
        .order_by(ChannelAccount.created_at)
    )
    candidates = [a for a in result.scalars().all() if can_send(resolve_channel(a))]
    if not candidates:
        return None
    from app.channels.base import account_settings

    primary = next(
        (a for a in candidates if account_settings(a).get("is_primary")), None
    )
    if primary:
        return primary
    for preferred in ("gmail", "outlook", "bokito", "mock"):
        match = next((a for a in candidates if a.provider == preferred), None)
        if match:
            return match
    return candidates[0]


async def deliver_outbound(
    session: AsyncSession,
    signal: Signal,
    *,
    body_text: str,
    subject: str = "",
    body_html: str | None = None,
    to_address: str | None = None,
    cc: str | None = None,
    bcc: str | None = None,
    attachments: list[dict] | None = None,
    signature_html: str | None = None,
    from_display_name: str | None = None,
) -> OutboundDelivery:
    """Send `body_text` to the external party of this thread.

    Returns an ``OutboundDelivery`` whose ``status`` is `sent`, `failed:…`,
    or `skipped` (channels without external delivery). For email, ``body_html``
    is the final HTML including the signature that was handed to the provider.

    `signature_html` is the identity-resolved signature (user or agent, see
    services/signatures.py); when None the mailbox signature is the fallback.
    `from_display_name` is the visible From name for the same identity; the
    mailbox address is never changed.
    """
    if signal.channel not in ("email", "slack", "whatsapp"):
        return OutboundDelivery("skipped")
    if signal.channel == "email" and not signal.channel_account_id:
        fallback = await _workspace_email_account(session, signal.tenant_id)
        if fallback:
            signal.channel_account_id = fallback.id
            session.add(signal)
        else:
            return OutboundDelivery("skipped")
    if not signal.channel_account_id:
        return OutboundDelivery("skipped")
    result = await session.execute(
        select(ChannelAccount).where(ChannelAccount.id == signal.channel_account_id)
    )
    account = result.scalar_one_or_none()
    if not account or not account.is_enabled:
        return OutboundDelivery("failed:no_account")

    from app.services.channel_registry import account_can_send

    if not account_can_send(account):
        return OutboundDelivery("failed:cannot_send")

    if signal.channel == "email":
        recipient = (to_address or "").strip() or signal.contact_email
        if not recipient:
            return OutboundDelivery("failed:no_recipient")
        in_reply_to, references, reply_to_provider_id = await _reply_context(session, signal.id)
        status, final_html = await email_adapter.send_via_provider(
            account,
            to_address=recipient,
            subject=subject or signal.subject,
            body_text=body_text,
            body_html=body_html,
            cc=cc,
            bcc=bcc,
            in_reply_to=in_reply_to,
            references=references,
            reply_to_provider_id=reply_to_provider_id,
            thread_provider_id=(signal.external_id or "").strip() or None,
            attachments=attachments,
            session=session,
            signature_html=signature_html,
            from_display_name=from_display_name,
        )
        return OutboundDelivery(status, body_html=final_html)
    if signal.channel == "whatsapp":
        # thread_external_id IS the customer's wa_id (one thread per number).
        recipient = (to_address or "").strip() or (signal.external_id or "").strip()
        status = await whatsapp_adapter.send_message(
            account, to_address=recipient, body_text=body_text
        )
        return OutboundDelivery(status)
    status = await slack_adapter.send_message(
        account, thread_external_id=signal.external_id, body_text=body_text
    )
    return OutboundDelivery(status)
