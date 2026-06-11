"""Outbound delivery: route a Signal reply to the channel's provider."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels import email as email_adapter
from app.channels import slack as slack_adapter
from app.models.channel import ChannelAccount
from app.models.signal import Signal


async def deliver_outbound(
    session: AsyncSession,
    signal: Signal,
    *,
    body_text: str,
    subject: str = "",
) -> str:
    """Send `body_text` to the external party of this thread.

    Returns a send status string (`sent`, `failed:...`, or `skipped` for
    channels without external delivery such as internal/assistant threads).
    """
    if signal.channel not in ("email", "slack"):
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
        if not signal.contact_email:
            return "failed:no_recipient"
        return await email_adapter.send_via_provider(
            account,
            to_address=signal.contact_email,
            subject=subject or signal.subject,
            body_text=body_text,
        )
    return await slack_adapter.send_message(
        account, thread_external_id=signal.external_id, body_text=body_text
    )
