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

import json
import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership
from app.models.notification import Notification

logger = logging.getLogger(__name__)

# Preference category ids; rows live in inbox_settings.DEFAULT_NOTIFICATION_ROWS.
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
) -> int:
    """Create an ops Notification for every owner/admin. Returns count created.

    Dedupe: identical titles within the cooldown window are dropped, so
    repeated failures of the same thing alert once per window.
    """
    try:
        return await _notify_tenant_admins(
            session,
            tenant_id,
            category=category,
            title=title,
            body=body,
            payload=payload,
            cooldown_minutes=cooldown_minutes,
        )
    except Exception:  # noqa: BLE001 - alerting must never break callers
        logger.exception("ops alert failed for tenant=%s title=%r", tenant_id, title)
        return 0


async def _notify_tenant_admins(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    category: str,
    title: str,
    body: str,
    payload: dict[str, Any] | None,
    cooldown_minutes: int,
) -> int:
    from app.gateway.publish import publish_notification
    from app.services.notification_mail import notification_channels, send_notification_mail

    if cooldown_minutes > 0:
        since = datetime.utcnow() - timedelta(minutes=cooldown_minutes)
        recent = await session.execute(
            select(Notification.id)
            .where(
                Notification.tenant_id == tenant_id,
                Notification.kind == "ops_alert",
                Notification.title == title,
                Notification.created_at >= since,
            )
            .limit(1)
        )
        if recent.first():
            return 0

    admins = await session.execute(
        select(Membership.user_id).where(
            Membership.tenant_id == tenant_id,
            Membership.role.in_(("owner", "admin")),
        )
    )
    created: list[Notification] = []
    email_targets: list[UUID] = []
    for (user_id,) in admins.all():
        channels = await notification_channels(session, tenant_id, user_id, category)
        if channels["desktop"]:
            notification = Notification(
                tenant_id=tenant_id,
                user_id=user_id,
                kind="ops_alert",
                title=title[:200],
                body=body[:500],
                payload_json=json.dumps({"category": category, **(payload or {})}),
            )
            session.add(notification)
            created.append(notification)
        if channels["email"]:
            email_targets.append(user_id)

    if created:
        await session.commit()
        for notification in created:
            await publish_notification(
                tenant_id,
                notification_id=notification.id,
                kind="ops_alert",
                title=notification.title,
            )
    for user_id in email_targets:
        await send_notification_mail(
            session,
            user_id,
            subject=title,
            text=f"{title}\n\n{body}".strip(),
            tenant_id=tenant_id,
        )
    return len(created)


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
    )
