"""Operational alerts for tenant admins.

When something breaks that a tenant can act on — an agent run fails, a
trigger errors, a mailbox stops syncing — owners and admins get an in-app
Notification (and optionally email, via their notification preferences).
Alerts are deduped per tenant + title within a cooldown window so a burst
of failures produces one alert, not a flood.

Everything here is best-effort: alerting must never break the calling flow,
so `notify_tenant_admins` swallows and logs its own failures.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership
from app.services.notify import TIER_LATER, TIER_NOW, notify

logger = logging.getLogger(__name__)

# System notice categories; they follow the tier switches, not a category row.
OPS_RUN_FAILED = "ops-run-failed"
OPS_CHANNEL_DISCONNECT = "ops-channel-disconnect"

DEFAULT_COOLDOWN_MINUTES = 30


async def notify_tenant_admins(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    category: str,
    title: str,
    body: str = "",
    payload: dict[str, Any] | None = None,
    cooldown_minutes: int = DEFAULT_COOLDOWN_MINUTES,
    user_ids: list[UUID] | None = None,
    kind: str = "ops_alert",
    tier: int = TIER_LATER,
    critical: bool = False,
    signal_id: UUID | None = None,
) -> int:
    """Notify every owner/admin (or ``user_ids``) through ``notify``. Returns rows created.

    Dedupe: identical titles within the cooldown window are dropped, so
    repeated failures of the same thing alert once per window.
    """
    try:
        if user_ids is None:
            admins = await session.execute(
                select(Membership.user_id).where(
                    Membership.tenant_id == tenant_id,
                    Membership.role.in_(("owner", "admin")),
                )
            )
            user_ids = [row[0] for row in admins.all()]
        created = await notify(
            session,
            tenant_id,
            kind=kind,
            recipients=user_ids,
            title=title,
            body=body,
            tier=tier,
            category=category,
            signal_id=signal_id,
            payload=payload,
            critical=critical,
            cooldown_minutes=cooldown_minutes,
        )
        return len(created)
    except Exception:  # noqa: BLE001 - alerting must never break callers
        logger.exception("ops alert failed for tenant=%s title=%r", tenant_id, title)
        return 0


async def alert_run_failure(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    subject: str,
    error: BaseException | str,
    run_id: UUID | None = None,
    signal_id: UUID | None = None,
    task_id: UUID | None = None,
) -> int:
    """Alert admins that an agent run / trigger / workstream task failed."""
    if isinstance(error, BaseException):
        reason = (str(error) or type(error).__name__)[:300]
    else:
        reason = str(error)[:300]
    payload: dict[str, Any] = {}
    if run_id:
        payload["run_id"] = str(run_id)
    if signal_id:
        payload["signal_id"] = str(signal_id)
    if task_id:
        payload["task_id"] = str(task_id)

    from app.services.webhooks import emit_webhook_event

    await emit_webhook_event(
        session,
        tenant_id,
        "agent.run_failed",
        {"subject": subject[:200], "error": reason, **payload},
    )
    return await notify_tenant_admins(
        session,
        tenant_id,
        category=OPS_RUN_FAILED,
        title=f"Run failed: {subject[:120]}",
        body=reason,
        payload=payload,
    )


_BLOCK_TITLES = {
    "spend_cap": "AI replies paused: LLM spend cap reached",
    "provider_credits": "AI replies paused: AI provider credits exhausted",
    "provider_auth": "AI replies paused: AI provider key rejected",
}


async def alert_workspace_block(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    block: str,
    error: BaseException | str,
) -> int:
    """One alert per block kind per window, instead of one per failed message."""
    reason = (str(error) or block)[:300]
    return await notify_tenant_admins(
        session,
        tenant_id,
        category=OPS_RUN_FAILED,
        title=_BLOCK_TITLES.get(block, "AI replies paused"),
        body=reason,
        payload={"block": block},
        cooldown_minutes=6 * 60,
        tier=TIER_NOW,
        critical=True,
    )


async def alert_channel_disconnect(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    channel_label: str,
    reason: str,
    account_id: UUID | None = None,
) -> int:
    """Alert admins that a connected channel stopped working (e.g. mailbox auth)."""
    return await notify_tenant_admins(
        session,
        tenant_id,
        category=OPS_CHANNEL_DISCONNECT,
        title=f"Channel needs attention: {channel_label[:120]}",
        body=reason[:500],
        payload={"account_id": str(account_id)} if account_id else None,
        # Channel problems persist until fixed; don't re-alert within a day.
        cooldown_minutes=24 * 60,
        tier=TIER_NOW,
        critical=True,
    )
