"""Outbound delivery: route a Signal reply to the channel's provider."""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels import email as email_adapter
from app.channels import slack as slack_adapter
from app.channels import whatsapp as whatsapp_adapter
from app.models.channel import ChannelAccount
from app.models.signal import Signal, SignalMessage


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
) -> str:
    """Send `body_text` to the external party of this thread.

    Returns a send status string (`sent`, `failed:...`, or `skipped` for
    channels without external delivery such as internal/assistant threads).

    `signature_html` is the identity-resolved signature (user or agent, see
    services/signatures.py); when None the mailbox signature is the fallback.
    """
    if signal.channel not in ("email", "slack", "whatsapp"):
        return "skipped"
    if not signal.channel_account_id:
        return "skipped"
    result = await session.execute(
        select(ChannelAccount).where(ChannelAccount.id == signal.channel_account_id)
    )
    account = result.scalar_one_or_none()
    if not account or not account.is_enabled:
        return "failed:no_account"

    if signal.channel == "email":
        recipient = (to_address or "").strip() or signal.contact_email
        if not recipient:
            return "failed:no_recipient"
        in_reply_to, references, reply_to_provider_id = await _reply_context(session, signal.id)
        return await email_adapter.send_via_provider(
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
        )
    if signal.channel == "whatsapp":
        # thread_external_id IS the customer's wa_id (one thread per number).
        recipient = (to_address or "").strip() or (signal.external_id or "").strip()
        return await whatsapp_adapter.send_message(
            account, to_address=recipient, body_text=body_text
        )
    return await slack_adapter.send_message(
        account, thread_external_id=signal.external_id, body_text=body_text
    )
