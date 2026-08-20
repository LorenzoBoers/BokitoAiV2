"""Daily/weekly tenant digest mails: open threads, pending decisions, agent stats.

Opt-in per user via the `digest-daily` / `digest-weekly` notification
preference rows (email channel). Sent by the arq cron `send_tenant_digests_job`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.agent import AgentRun
from app.models.auth import Membership, Tenant, User
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage

logger = logging.getLogger(__name__)

DIGEST_PERIODS = ("daily", "weekly")


async def build_tenant_digest(
    session: AsyncSession, tenant_id: UUID, *, period: str
) -> dict[str, Any]:
    """Aggregate the digest numbers for one tenant."""
    window = timedelta(days=7 if period == "weekly" else 1)
    since = datetime.utcnow() - window

    async def _count(query) -> int:
        return int((await session.execute(query)).scalar_one() or 0)

    open_threads = await _count(
        select(func.count()).select_from(Signal).where(
            Signal.tenant_id == tenant_id,
            Signal.status == "open",
            Signal.channel.not_in(("internal", "assistant")),
        )
    )
    unassigned = await _count(
        select(func.count()).select_from(Signal).where(
            Signal.tenant_id == tenant_id,
            Signal.status == "open",
            Signal.assigned_user_id.is_(None),
            Signal.channel.not_in(("internal", "assistant")),
        )
    )
    pending_decisions = await _count(
        select(func.count()).select_from(DecisionRequest).where(
            DecisionRequest.tenant_id == tenant_id,
            DecisionRequest.status == "awaiting_human",
        )
    )
    new_messages = await _count(
        select(func.count()).select_from(SignalMessage).where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.direction == "inbound",
            SignalMessage.created_at >= since,
        )
    )
    runs_total = await _count(
        select(func.count()).select_from(AgentRun).where(
            AgentRun.tenant_id == tenant_id,
            AgentRun.started_at >= since,
        )
    )
    runs_failed = await _count(
        select(func.count()).select_from(AgentRun).where(
            AgentRun.tenant_id == tenant_id,
            AgentRun.started_at >= since,
            AgentRun.status == "failed",
        )
    )

    from app.models.learning import InboxRule
    from app.models.platform_change import PlatformChange

    rules_active = await _count(
        select(func.count()).select_from(InboxRule).where(
            InboxRule.tenant_id == tenant_id, InboxRule.status == "active"
        )
    )
    rules_suggested = await _count(
        select(func.count()).select_from(InboxRule).where(
            InboxRule.tenant_id == tenant_id, InboxRule.status == "suggested"
        )
    )
    learning_proposals = await _count(
        select(func.count()).select_from(PlatformChange).where(
            PlatformChange.tenant_id == tenant_id,
            PlatformChange.proposed_by_type == "system",
            PlatformChange.status.in_(("draft", "pending_review")),
        )
    )
    return {
        "period": period,
        "open_threads": open_threads,
        "unassigned": unassigned,
        "pending_decisions": pending_decisions,
        "new_messages": new_messages,
        "runs_total": runs_total,
        "runs_failed": runs_failed,
        "rules_active": rules_active,
        "rules_suggested": rules_suggested,
        "learning_proposals": learning_proposals,
    }


def digest_paragraphs(digest: dict[str, Any], tenant_name: str) -> list[str]:
    window_label = "the past week" if digest["period"] == "weekly" else "the past 24 hours"
    lines = [
        f"Here is the {tenant_name} status for {window_label}.",
        f"Inbox: {digest['open_threads']} open conversation(s), "
        f"{digest['unassigned']} unassigned, {digest['new_messages']} new inbound message(s).",
        f"Decisions waiting on you or your team: {digest['pending_decisions']}.",
    ]
    if digest["runs_total"] or digest["runs_failed"]:
        lines.append(
            f"Agents: {digest['runs_total']} run(s), of which {digest['runs_failed']} failed."
        )
    learning_bits: list[str] = []
    if digest.get("rules_active"):
        learning_bits.append(f"{digest['rules_active']} automation rule(s) active")
    if digest.get("rules_suggested"):
        learning_bits.append(f"{digest['rules_suggested']} rule suggestion(s) to review")
    if digest.get("learning_proposals"):
        learning_bits.append(
            f"{digest['learning_proposals']} learning proposal(s) waiting in Govern"
        )
    if learning_bits:
        lines.append("Learning: " + ", ".join(learning_bits) + ".")
    return lines


def _digest_is_empty(digest: dict[str, Any]) -> bool:
    return not any(
        digest[key]
        for key in ("open_threads", "unassigned", "pending_decisions", "new_messages", "runs_total")
    )


async def send_tenant_digests(session: AsyncSession, *, period: str) -> int:
    """Send digest mails to every opted-in member across all tenants.

    Returns the number of mails scheduled. Empty digests (nothing happened,
    nothing open) are skipped so quiet workspaces get no noise.
    """
    if period not in DIGEST_PERIODS:
        raise ValueError(f"Unknown digest period: {period}")

    from app.services.notification_mail import notification_channels
    from app.services.transactional_mail import render_mail_html, send_mail

    category = f"digest-{period}"
    tenants = list((await session.execute(select(Tenant))).scalars().all())
    app_url = get_settings().public_app_url.rstrip("/")
    sent = 0
    for tenant in tenants:
        digest: dict[str, Any] | None = None
        members = list(
            (
                await session.execute(
                    select(Membership.user_id).where(Membership.tenant_id == tenant.id)
                )
            ).scalars().all()
        )
        for user_id in members:
            channels = await notification_channels(session, tenant.id, user_id, category)
            if not channels.get("email"):
                continue
            if digest is None:
                digest = await build_tenant_digest(session, tenant.id, period=period)
            if _digest_is_empty(digest):
                break  # same for every member of this tenant
            user = (
                await session.execute(select(User).where(User.id == user_id))
            ).scalar_one_or_none()
            if not user or not user.email:
                continue
            label = "Daily" if period == "daily" else "Weekly"
            subject = f"{label} digest - {tenant.name}"
            paragraphs = digest_paragraphs(digest, tenant.name)
            html = render_mail_html(
                title=f"{label} digest",
                paragraphs=paragraphs,
                cta_label="Open Bokito",
                cta_url=f"{app_url}/communication",
                footer="You receive this because the digest is enabled in your notification settings.",
            )
            ok = await send_mail(
                user.email, subject, "\n\n".join(paragraphs), html, kind=category
            )
            if ok:
                sent += 1
    return sent
