"""Onboarding demo thread + channel-connect return nudge.

The demo thread is an opt-in CTA from the Getting Started checklist: one
email-style Signal (`source="demo"`) with an inbound message and a pending
decision card, so a new tenant can experience the resolve loop before
connecting a real channel. It is removed automatically once a real channel
connects, and it never feeds learning (see `_record_no_reply_outcome`).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership, Tenant, User
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalEvent, SignalMessage, SignalThreadPin

logger = logging.getLogger(__name__)

DEMO_SOURCE = "demo"

_DEMO_SUBJECT = "Try your first decision"
_DEMO_BODY = (
    "Hi! I'm a demo customer. This is what an incoming conversation looks like "
    "in Bokito.\n\nWhen the AI is unsure, it asks you instead of guessing - "
    "that question appears as a decision card right inside the thread. "
    "Resolve the card below to see how the loop works. You can delete this "
    "demo conversation at any time; it disappears automatically once you "
    "connect a real channel."
)


async def _demo_signal(session: AsyncSession, tenant_id: UUID) -> Signal | None:
    result = await session.execute(
        select(Signal).where(Signal.tenant_id == tenant_id, Signal.source == DEMO_SOURCE).limit(1)
    )
    return result.scalars().first()


async def seed_demo_thread(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    """Create (or return) the tenant's demo thread. Idempotent."""
    existing = await _demo_signal(session, tenant_id)
    if existing:
        return {"signal_id": str(existing.id), "created": False}

    now = datetime.utcnow()
    signal = Signal(
        tenant_id=tenant_id,
        channel="email",
        source=DEMO_SOURCE,
        subject=_DEMO_SUBJECT,
        contact_name="Demo Customer",
        contact_email="demo@bokito.ai",
        status="open",
        has_unread=True,
        last_message_at=now,
    )
    session.add(signal)
    await session.flush()

    session.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant_id,
            kind="user_message",
            direction="inbound",
            role="user",
            from_address="demo@bokito.ai",
            subject=_DEMO_SUBJECT,
            body_text=_DEMO_BODY,
            body_preview=_DEMO_BODY[:200],
            received_at=now,
        )
    )

    decision = DecisionRequest(
        tenant_id=tenant_id,
        signal_id=signal.id,
        title="Does this demo make sense?",
        summary="This is a decision card - the AI asks you instead of acting on its own. Pick an option to resolve it.",
        status="awaiting_human",
        options_json=json.dumps(
            [
                {"id": "approve", "label": "Got it"},
                {"id": "reject", "label": "Dismiss"},
            ]
        ),
    )
    session.add(decision)
    await session.flush()
    card = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant_id,
        kind="decision_request",
        direction="inbound",
        role="assistant",
        subject=decision.title,
        body_text=decision.summary,
        body_preview=decision.summary[:200],
        decision_id=decision.id,
        received_at=now,
    )
    session.add(card)
    await session.flush()
    decision.message_id = card.id
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="signal_created",
            actor_type="system",
            payload_json=json.dumps({"source": DEMO_SOURCE}),
        )
    )
    await session.commit()
    return {"signal_id": str(signal.id), "created": True}


async def remove_demo_threads(session: AsyncSession, tenant_id: UUID) -> int:
    """Delete every demo thread with its messages, events and decisions."""
    result = await session.execute(
        select(Signal.id).where(Signal.tenant_id == tenant_id, Signal.source == DEMO_SOURCE)
    )
    signal_ids = [row for row in result.scalars().all()]
    if not signal_ids:
        return 0
    await session.execute(delete(DecisionRequest).where(DecisionRequest.signal_id.in_(signal_ids)))
    await session.execute(delete(SignalMessage).where(SignalMessage.signal_id.in_(signal_ids)))
    await session.execute(delete(SignalEvent).where(SignalEvent.signal_id.in_(signal_ids)))
    await session.execute(delete(SignalThreadPin).where(SignalThreadPin.signal_id.in_(signal_ids)))
    await session.execute(delete(Signal).where(Signal.id.in_(signal_ids)))
    await session.commit()
    return len(signal_ids)


# ---------------------------------------------------------------------------
# Return nudge: one mail when a tenant is >=24h old without any channel
# ---------------------------------------------------------------------------

_NUDGE_SETTINGS_KEY = "onboarding_channel_nudge_at"
_EXTERNAL_CHANNELS = ("email", "widget", "slack")


async def send_channel_nudges(session: AsyncSession) -> int:
    """One-time return mail for tenants >=24h old with no connected channel.

    Runs on the hourly scheduler pass. The sent-at timestamp lives in
    `Tenant.settings_json` so the nudge never repeats.
    """
    from app.models.channel import ChannelAccount
    from app.services.transactional_mail import send_onboarding_channel_nudge

    now = datetime.utcnow()
    cutoff = now - timedelta(hours=24)
    # Only recently created tenants: a deploy must not suddenly mail ancient
    # dormant workspaces.
    window_start = now - timedelta(days=14)
    tenants = list(
        (
            await session.execute(
                select(Tenant).where(Tenant.created_at <= cutoff, Tenant.created_at >= window_start)
            )
        ).scalars().all()
    )
    sent = 0
    for tenant in tenants:
        try:
            tenant_settings = json.loads(tenant.settings_json or "{}")
        except json.JSONDecodeError:
            tenant_settings = {}
        if not isinstance(tenant_settings, dict) or tenant_settings.get(_NUDGE_SETTINGS_KEY):
            continue
        has_channel = (
            await session.execute(
                select(ChannelAccount.id)
                .where(
                    ChannelAccount.tenant_id == tenant.id,
                    ChannelAccount.channel.in_(_EXTERNAL_CHANNELS),
                    # The website chat row exists from signup; the nudge is
                    # about channels someone connected on purpose.
                    ChannelAccount.channel != "widget",
                )
                .limit(1)
            )
        ).first()
        if has_channel:
            continue
        owner_emails = list(
            (
                await session.execute(
                    select(User.email)
                    .join(Membership, Membership.user_id == User.id)
                    .where(Membership.tenant_id == tenant.id, Membership.role == "owner")
                )
            ).scalars().all()
        )
        for email in owner_emails:
            if email:
                await send_onboarding_channel_nudge(email, tenant_name=tenant.name)
                sent += 1
        # Mark even without owners/emails so the loop never retries forever.
        tenant_settings[_NUDGE_SETTINGS_KEY] = datetime.utcnow().isoformat()
        tenant.settings_json = json.dumps(tenant_settings)
        session.add(tenant)
        await session.commit()
    return sent
