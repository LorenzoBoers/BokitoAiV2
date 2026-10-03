"""Push notifications: web push (VAPID) + Expo push for the native mobile app.

Subscription endpoints prefixed with ``expo:`` hold an Expo push token and are
delivered via the Expo push API; everything else is treated as a standard web
push subscription. Which events push, and when, is decided in
``services/notify.py``; this module only transports.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import Membership
from app.models.usage import PushSubscription

if TYPE_CHECKING:
    from app.models.notification import DecisionRequest
    from app.models.signal import Signal

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_ENDPOINT_PREFIX = "expo:"


async def _send_expo_push(token: str, title: str, body: str, payload: dict | None) -> bool:
    message = {
        "to": token,
        "title": title,
        "body": body,
        "data": payload or {},
        "sound": "default",
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(EXPO_PUSH_URL, json=message)
            response.raise_for_status()
        return True
    except Exception:
        logger.debug("expo push failed", exc_info=True)
        return False


def _send_web_push(sub: PushSubscription, title: str, body: str, payload: dict | None) -> bool:
    settings = get_settings()
    if not settings.vapid_private_key:
        return False
    try:
        from pywebpush import webpush

        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": json.loads(sub.keys_json or "{}"),
            },
            data=json.dumps({"title": title, "body": body, **(payload or {})}),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_claims_email},
        )
        return True
    except Exception:
        return False


async def send_push_to_user(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    title: str,
    body: str,
    payload: dict | None = None,
) -> int:
    result = await session.execute(
        select(PushSubscription).where(
            PushSubscription.tenant_id == tenant_id,
            PushSubscription.user_id == user_id,
        )
    )
    subs = result.scalars().all()
    sent = 0
    for sub in subs:
        if sub.endpoint.startswith(EXPO_ENDPOINT_PREFIX):
            token = sub.endpoint.removeprefix(EXPO_ENDPOINT_PREFIX)
            if await _send_expo_push(token, title, body, payload):
                sent += 1
        elif _send_web_push(sub, title, body, payload):
            sent += 1
    return sent


async def resolve_thread_recipient_ids(session: AsyncSession, signal: "Signal") -> list[UUID]:
    """Resolve users who should receive push for a thread event."""
    recipients: list[UUID] = []
    if signal.assigned_user_id:
        recipients.append(signal.assigned_user_id)
    if signal.owner_user_id and signal.owner_user_id not in recipients:
        recipients.append(signal.owner_user_id)
    if recipients:
        return recipients

    result = await session.execute(
        select(Membership.user_id).where(
            Membership.tenant_id == signal.tenant_id,
            Membership.role.in_(("owner", "admin")),
        )
    )
    return list(result.scalars().all())


async def notify_decision(
    session: AsyncSession,
    decision: "DecisionRequest",
    *,
    signal_id: UUID | None = None,
) -> int:
    """Deliver a waiting decision outside the app (push, email) to its addressee.

    Tier 1 with the ``decisions`` category, gated by availability through
    ``notify.channels_for``. Returns the number of push deliveries.
    """
    if decision.status != "awaiting_human":
        return 0

    from app.models.auth import User
    from app.models.signal import Signal
    from app.services.addressee import addressee_user_ids
    from app.services.notification_mail import send_notification_mail, thread_link
    from app.services.notify import TIER_NOW, channels_for, load_prefs
    from app.services.presence import user_status

    title = "Decision required"
    body = (decision.title or decision.summary or "A decision needs your attention")[:200]
    resolved_signal_id = signal_id or decision.signal_id
    payload = {
        # `decision_request` matches the notification kind the dashboard router
        # and the service worker both switch on.
        "kind": "decision_request",
        "decision_id": str(decision.id),
        "signal_id": str(resolved_signal_id) if resolved_signal_id else "",
        # Deep-link target: the card itself, not the top of the thread.
        "message_id": str(decision.message_id) if decision.message_id else "",
    }

    recipients: list[UUID] = await addressee_user_ids(session, decision)
    if not recipients and not decision.addressee_kind and resolved_signal_id:
        signal_result = await session.execute(
            select(Signal).where(Signal.id == resolved_signal_id, Signal.tenant_id == decision.tenant_id)
        )
        signal = signal_result.scalar_one_or_none()
        if signal:
            recipients = await resolve_thread_recipient_ids(session, signal)

    sent = 0
    for user_id in dict.fromkeys(recipients):
        user = await session.get(User, user_id)
        if not user or not user.is_active:
            continue
        prefs = await load_prefs(session, decision.tenant_id, user_id)
        channels = channels_for(prefs, tier=TIER_NOW, category="decisions", status=user_status(user))
        if "push" in channels:
            sent += await send_push_to_user(session, decision.tenant_id, user_id, title, body, payload)
        if "email" in channels:
            text = f"{decision.title}\n\n{(decision.summary or '').strip()[:500]}".strip()
            if resolved_signal_id:
                text += f"\n\nReview and decide:\n{thread_link(resolved_signal_id)}"
            await send_notification_mail(
                session,
                user_id,
                subject=f"Decision needed: {decision.title}"[:200],
                text=text,
                tenant_id=decision.tenant_id,
            )
    return sent


def _schedule_push_task(coro) -> None:
    """Fire-and-forget push dispatch; never breaks the caller."""

    async def _runner() -> None:
        try:
            await coro
        except Exception:
            logger.exception("push notification task failed")

    try:
        asyncio.get_running_loop().create_task(_runner())
    except RuntimeError:
        logger.debug("no running event loop for push task")


def schedule_notify_decision(decision_id: UUID, *, signal_id: UUID | None = None) -> None:
    async def _run() -> None:
        from app.db.session import async_session_factory
        from app.models.notification import DecisionRequest

        async with async_session_factory() as session:
            decision = (
                await session.execute(select(DecisionRequest).where(DecisionRequest.id == decision_id))
            ).scalar_one_or_none()
            if decision:
                await notify_decision(session, decision, signal_id=signal_id)

    _schedule_push_task(_run())
