"""Notification email transport and the stored per-category switches.

Which notice goes where is decided in ``services/notify.py``. Delivery is
best-effort: failures are logged by `transactional_mail` and never break the
calling flow.
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import User
from app.services.transactional_mail import send_mail

logger = logging.getLogger(__name__)

async def notification_channels(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, category: str
) -> dict[str, bool]:
    """Stored switches for one category, without availability: ``inapp``, ``email``, ``push``.

    ``digest-daily`` is the tier 3 email switch. A known category combines its
    tier (see ``CATEGORY_TIER``) with the category row. Unknown ids use tier 2.
    Live delivery goes through ``services/notify.py``; this view serves the
    digest cron and Slack.
    """
    from app.services.notify import CATEGORY_TIER, TIER_DIGEST, TIER_LATER, TIER_NOW, load_prefs

    prefs = await load_prefs(session, tenant_id, user_id)
    if category == "digest-daily":
        channels = {"inapp": False, "push": False, "email": prefs["tiers"][TIER_DIGEST]["email"]}
    elif category in prefs["categories"]:
        tier_key = CATEGORY_TIER.get(category, TIER_NOW)
        # The weekly digest row is the switch itself; it does not also need tier 3.
        tier = (
            {"inapp": True, "push": True, "email": True}
            if category == "digest-weekly"
            else prefs["tiers"][tier_key]
        )
        row = prefs["categories"][category]
        channels = {key: bool(tier.get(key) and row.get(key)) for key in ("inapp", "push", "email")}
    else:
        channels = dict(prefs["tiers"][TIER_LATER])
    return {**channels, "desktop": channels["inapp"], "slack": False}


async def decision_bell_status(
    session: AsyncSession, tenant_id: UUID, user_id: UUID | None
) -> str:
    """Initial status of a decision's anchor Notification row.

    The row must always exist; a person who switched decisions off in the app
    gets it as already read. Team and broadcast rows stay unread.
    """
    if user_id is None:
        return "unread"
    channels = await notification_channels(session, tenant_id, user_id, "decisions")
    return "unread" if channels["inapp"] else "read"


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
