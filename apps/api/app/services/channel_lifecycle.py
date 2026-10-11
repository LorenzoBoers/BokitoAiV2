"""Channel lifecycle: active or paused, archived, permanently deleted.

Removing a channel never orphans its conversations. Archive is the default way
out: the row stays so its threads keep ``channel_account_id`` (and with it the
channel's access list), while sync, inbound webhooks and sending stop and the
stored credentials are wiped. Reconnecting the same mailbox, or Restore,
brings the row back. Permanent delete is a separate, explicit step that is
only allowed on an archived channel (or one without conversations) and removes
the channel together with every conversation on it.
"""

from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import ChannelAccount, ChannelBinding
from app.models.signal import Signal
from app.services.audit import record_audit
from app.services.crypto import set_connection_credentials


def is_archived(account: ChannelAccount | None) -> bool:
    return account is not None and account.archived_at is not None


def require_not_archived(account: ChannelAccount) -> None:
    if is_archived(account):
        raise HTTPException(
            status_code=409,
            detail="This channel is archived. Restore it or reconnect it first.",
        )


async def conversation_count(session: AsyncSession, account: ChannelAccount) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(Signal)
        .where(Signal.tenant_id == account.tenant_id, Signal.channel_account_id == account.id)
    )
    return int(result.scalar_one() or 0)


def _settings(account: ChannelAccount) -> dict:
    try:
        data = json.loads(account.settings_json or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


async def archive_channel(
    session: AsyncSession, account: ChannelAccount, *, user_id: UUID | None
) -> ChannelAccount:
    """Stop the channel for good but keep its conversations and access list."""
    if is_archived(account):
        return account
    from app.services.email_sync import clear_sync_pause

    settings = _settings(account)
    settings["is_primary"] = False
    # Webhooks authenticate with this secret; dropping it closes inbound.
    settings.pop("inbound_secret", None)
    clear_sync_pause(settings)
    account.settings_json = json.dumps(settings)
    set_connection_credentials(account, {})
    account.is_enabled = False
    account.archived_at = datetime.utcnow()
    session.add(account)
    await record_audit(
        session,
        account.tenant_id,
        action="channel:archived",
        actor_type="user" if user_id else "system",
        actor_id=user_id or "",
        resource_type="channel_account",
        resource_id=account.id,
        summary=(account.display_name or account.address or account.channel)[:120],
        commit=False,
    )
    await session.commit()
    await session.refresh(account)
    return account


async def restore_channel(
    session: AsyncSession, account: ChannelAccount, *, user_id: UUID | None
) -> ChannelAccount:
    """Bring an archived channel back as paused; credentials need a reconnect."""
    if not is_archived(account):
        return account
    account.archived_at = None
    account.is_enabled = False
    session.add(account)
    await record_audit(
        session,
        account.tenant_id,
        action="channel:restored",
        actor_type="user" if user_id else "system",
        actor_id=user_id or "",
        resource_type="channel_account",
        resource_id=account.id,
        summary=(account.display_name or account.address or account.channel)[:120],
        commit=False,
    )
    await session.commit()
    await session.refresh(account)
    return account


def unarchive_on_reconnect(account: ChannelAccount) -> None:
    """Reconnecting an archived mailbox reuses the row; caller commits."""
    account.archived_at = None


async def delete_channel_permanently(
    session: AsyncSession, account: ChannelAccount, *, user_id: UUID | None
) -> int:
    """Delete the channel and every conversation on it. Returns the thread count."""
    from app.models.customer_verify import HandoverCode
    from app.models.learning import InboxRule
    from app.services.signal_threads import delete_thread

    count = await conversation_count(session, account)
    if count and not is_archived(account):
        raise HTTPException(
            status_code=409,
            detail="Archive the channel before deleting it with its conversations.",
        )
    signal_ids = list(
        (
            await session.execute(
                select(Signal.id).where(
                    Signal.tenant_id == account.tenant_id,
                    Signal.channel_account_id == account.id,
                )
            )
        ).scalars().all()
    )
    for signal_id in signal_ids:
        await delete_thread(
            session, account.tenant_id, signal_id, user_id=user_id, permanent=True, commit=False
        )
    await session.execute(sa_delete(InboxRule).where(InboxRule.channel_account_id == account.id))
    await session.execute(
        sa_delete(ChannelBinding).where(ChannelBinding.channel_account_id == account.id)
    )
    await session.execute(
        sa_update(HandoverCode)
        .where(HandoverCode.whatsapp_account_id == account.id)
        .values(whatsapp_account_id=None)
    )
    await record_audit(
        session,
        account.tenant_id,
        action="channel:deleted",
        actor_type="user" if user_id else "system",
        actor_id=user_id or "",
        resource_type="channel_account",
        resource_id=account.id,
        summary=(account.display_name or account.address or account.channel)[:120],
        payload={"conversations_deleted": len(signal_ids)},
        commit=False,
    )
    await session.delete(account)
    await session.commit()
    return len(signal_ids)
