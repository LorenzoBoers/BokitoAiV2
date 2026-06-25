"""Push notifications: web push (VAPID) + Expo push for the native mobile app.

Subscription endpoints prefixed with ``expo:`` hold an Expo push token and are
delivered via the Expo push API; everything else is treated as a standard web
push subscription.
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
    from app.models.signal import Signal, SignalMessage

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_ENDPOINT_PREFIX = "expo:"

_SKIP_MESSAGE_KINDS = frozenset({"internal_note", "system_event"})


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


async def notify_thread_message(
    session: AsyncSession,
    signal: "Signal",
    message: "SignalMessage",
) -> int:
    """Send push for a new inbound thread message. Returns number of deliveries."""
    if message.direction != "inbound":
        return 0
    if message.kind in _SKIP_MESSAGE_KINDS:
        return 0

    title = signal.subject or "New message"
    preview = (message.body_preview or message.body_text or "").strip()
    body = preview[:200] if preview else "You have a new message"
    payload = {
        "kind": "thread_message",
        "signal_id": str(signal.id),
        "message_id": str(message.id),
    }

    sent = 0
    for user_id in await resolve_thread_recipient_ids(session, signal):
        sent += await send_push_to_user(session, signal.tenant_id, user_id, title, body, payload)
    return sent


async def notify_decision(
    session: AsyncSession,
    decision: "DecisionRequest",
    *,
    signal_id: UUID | None = None,
) -> int:
    """Send push when a decision awaits human input. Returns number of deliveries."""
    if decision.status != "awaiting_human":
        return 0

    from app.models.signal import Signal

    title = "Decision required"
    body = (decision.title or decision.summary or "A decision needs your attention")[:200]
    resolved_signal_id = signal_id or decision.signal_id
    payload = {
        "kind": "decision",
        "decision_id": str(decision.id),
        "signal_id": str(resolved_signal_id) if resolved_signal_id else "",
    }

    recipients: list[UUID] = []
    if resolved_signal_id:
        signal_result = await session.execute(
            select(Signal).where(Signal.id == resolved_signal_id, Signal.tenant_id == decision.tenant_id)
        )
        signal = signal_result.scalar_one_or_none()
        if signal:
            recipients = await resolve_thread_recipient_ids(session, signal)

    if not recipients:
        result = await session.execute(
            select(Membership.user_id).where(
                Membership.tenant_id == decision.tenant_id,
                Membership.role.in_(("owner", "admin")),
            )
        )
        recipients = list(result.scalars().all())

    sent = 0
    for user_id in recipients:
        sent += await send_push_to_user(session, decision.tenant_id, user_id, title, body, payload)
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


def schedule_notify_thread_message(signal_id: UUID, message_id: UUID) -> None:
    async def _run() -> None:
        from app.db.session import async_session_factory
        from app.models.signal import Signal, SignalMessage

        async with async_session_factory() as session:
            signal = (
                await session.execute(select(Signal).where(Signal.id == signal_id))
            ).scalar_one_or_none()
            message = (
                await session.execute(select(SignalMessage).where(SignalMessage.id == message_id))
            ).scalar_one_or_none()
            if signal and message:
                await notify_thread_message(session, signal, message)

    _schedule_push_task(_run())


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
