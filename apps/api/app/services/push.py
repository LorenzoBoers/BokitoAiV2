"""Web push notifications."""

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.usage import PushSubscription


async def send_push_to_user(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    title: str,
    body: str,
    payload: dict | None = None,
) -> int:
    settings = get_settings()
    if not settings.vapid_private_key:
        return 0
    result = await session.execute(
        select(PushSubscription).where(
            PushSubscription.tenant_id == tenant_id,
            PushSubscription.user_id == user_id,
        )
    )
    subs = result.scalars().all()
    sent = 0
    for sub in subs:
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
            sent += 1
        except Exception:
            continue
    return sent
