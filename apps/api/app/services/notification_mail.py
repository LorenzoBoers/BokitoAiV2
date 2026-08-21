"""Email delivery for in-app notifications (assignment, mention, decision).

Per-user notification preferences (`user_notification_preferences`) expose a
desktop and an email channel per category. This module resolves those channels
and sends a plain-text mail via the transactional SMTP path when the email
channel is enabled. Delivery is best-effort: failures are logged by
`transactional_mail` and never break the calling flow.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import User
from app.services.transactional_mail import send_mail

logger = logging.getLogger(__name__)

DEFAULT_CHANNELS = {"desktop": True, "email": False, "slack": False}


async def notification_channels(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, category: str
) -> dict[str, bool]:
    """The user's enabled channels for a notification category.

    Channels: `desktop` (in-app bell + device push), `email`, and `slack`
    (decision DMs). Unknown categories and missing/corrupt pref rows fall back
    to the default (desktop on, everything else off) so notification behavior
    never silently vanishes.
    """
    from app.models.notification import UserNotificationPreference

    result = await session.execute(
        select(UserNotificationPreference).where(
            UserNotificationPreference.tenant_id == tenant_id,
            UserNotificationPreference.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row or not row.prefs_json.strip():
        return dict(DEFAULT_CHANNELS)
    try:
        rows = json.loads(row.prefs_json)
    except json.JSONDecodeError:
        return dict(DEFAULT_CHANNELS)
    for pref in rows if isinstance(rows, list) else []:
        if isinstance(pref, dict) and pref.get("id") == category:
            channels = pref.get("channels") or {}
            return {
                "desktop": bool(channels.get("desktop", DEFAULT_CHANNELS["desktop"])),
                "email": bool(channels.get("email", DEFAULT_CHANNELS["email"])),
                "slack": bool(channels.get("slack", DEFAULT_CHANNELS["slack"])),
            }
    return dict(DEFAULT_CHANNELS)


async def decision_bell_status(
    session: AsyncSession, tenant_id: UUID, user_id: UUID | None
) -> str:
    """Initial bell status for a decision notification targeted at a user.

    Decision notifications anchor DecisionRequest rows, so the row must always
    exist; honoring the user's `decisions` preference means creating it as
    already-read (no unread badge, no realtime ping) instead of skipping it.
    Broadcasts (no target user) stay unread: unassigned decisions must reach
    someone.
    """
    if user_id is None:
        return "unread"
    channels = await notification_channels(session, tenant_id, user_id, "decisions")
    return "unread" if channels["desktop"] else "read"


def thread_link(signal_id: UUID | str) -> str:
    base = get_settings().public_app_url.rstrip("/")
    return f"{base}/communication/inbox/all/t/{signal_id}"


async def send_notification_mail(
    session: AsyncSession,
    user_id: UUID,
    *,
    subject: str,
    text: str,
    tenant_id: UUID | None = None,
) -> bool:
    """Send a notification email to a user's account address. Best-effort.

    When `tenant_id` is given the mail renders in the branded HTML layout
    (tenant name/logo/color); the plain-text body remains the alternative.
    """
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.email:
        return False
    html: str | None = None
    if tenant_id is not None:
        from app.models.auth import Tenant
        from app.services.transactional_mail import render_mail_html, tenant_mail_branding

        tenant = await session.get(Tenant, tenant_id)
        branding = tenant_mail_branding(tenant)
        html = render_mail_html(
            title=subject,
            paragraphs=[p for p in text.split("\n\n") if p.strip()],
            brand_name=branding["brand_name"],
            brand_color=branding["brand_color"],
            logo_url=branding["logo_url"],
        )
    return await send_mail(user.email, subject, text, html, kind="notification")
