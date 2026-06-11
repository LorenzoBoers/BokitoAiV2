"""Push notifications: web push (VAPID) + Expo push for the native mobile app.

Subscription endpoints prefixed with ``expo:`` hold an Expo push token and are
delivered via the Expo push API; everything else is treated as a standard web
push subscription.
"""

import json
import logging
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.usage import PushSubscription

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
