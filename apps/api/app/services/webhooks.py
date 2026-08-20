"""Outbound webhooks: signed event delivery to tenant-configured endpoints.

Events are emitted at signal/decision lifecycle points. Each matching active
endpoint gets a `WebhookDelivery` row; delivery runs in the arq worker (with
an in-process fallback when Redis is unavailable) and retries transient
failures with short backoff.

Signature scheme (documented for receivers):
    signed = f"{X-Bokito-Timestamp}.{raw_body}"
    X-Bokito-Signature: v1=HMAC_SHA256_hex(secret, signed)
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import secrets as pysecrets
import time
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.webhook import WebhookDelivery, WebhookEndpoint
from app.services.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

# Event catalogue (also the allow-list for endpoint subscriptions).
WEBHOOK_EVENTS = (
    "signal.created",
    "signal.closed",
    "decision.created",
    "decision.resolved",
)

_DELIVERY_TIMEOUT_S = 10.0
_MAX_ATTEMPTS = 3
_RETRY_DELAYS_S = (2.0, 8.0)
_KEEP_DELIVERIES_PER_ENDPOINT = 50


def generate_webhook_secret() -> str:
    return f"whsec_{pysecrets.token_urlsafe(24)}"


def sign_payload(secret: str, timestamp: str, body: str) -> str:
    digest = hmac.new(
        secret.encode("utf-8"), f"{timestamp}.{body}".encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"v1={digest}"


def endpoint_events(endpoint: WebhookEndpoint) -> list[str]:
    try:
        events = json.loads(endpoint.events_json or "[]")
    except json.JSONDecodeError:
        return []
    return [str(e) for e in events] if isinstance(events, list) else []


def _matches(endpoint: WebhookEndpoint, event: str) -> bool:
    events = endpoint_events(endpoint)
    return "*" in events or event in events


def serialize_endpoint(endpoint: WebhookEndpoint, *, include_secret: bool = False) -> dict:
    data = {
        "id": str(endpoint.id),
        "url": endpoint.url,
        "description": endpoint.description,
        "events": endpoint_events(endpoint),
        "active": endpoint.active,
        "last_delivery_at": (
            endpoint.last_delivery_at.isoformat() if endpoint.last_delivery_at else None
        ),
        "last_status": endpoint.last_status,
        "created_at": endpoint.created_at.isoformat(),
    }
    if include_secret:
        data["secret"] = decrypt_secret(endpoint.secret_encrypted)
    return data


def serialize_delivery(delivery: WebhookDelivery) -> dict:
    return {
        "id": str(delivery.id),
        "endpoint_id": str(delivery.endpoint_id),
        "event": delivery.event,
        "status": delivery.status,
        "status_code": delivery.status_code,
        "attempts": delivery.attempts,
        "error": delivery.error,
        "created_at": delivery.created_at.isoformat(),
        "delivered_at": delivery.delivered_at.isoformat() if delivery.delivered_at else None,
    }


def new_endpoint(
    tenant_id: UUID,
    *,
    url: str,
    description: str = "",
    events: list[str] | None = None,
    created_by_user_id: UUID | None = None,
) -> WebhookEndpoint:
    return WebhookEndpoint(
        tenant_id=tenant_id,
        url=url,
        description=description,
        events_json=json.dumps(events if events else ["*"]),
        secret_encrypted=encrypt_secret(generate_webhook_secret()),
        created_by_user_id=created_by_user_id,
    )


async def emit_webhook_event(
    session: AsyncSession,
    tenant_id: UUID,
    event: str,
    data: dict[str, Any],
) -> list[WebhookDelivery]:
    """Queue the event for every subscribed active endpoint.

    Commits the delivery rows itself (call after your own commit) so the
    worker can load them; failures here never break the calling flow.
    """
    try:
        result = await session.execute(
            select(WebhookEndpoint).where(
                WebhookEndpoint.tenant_id == tenant_id,
                WebhookEndpoint.active.is_(True),
            )
        )
        endpoints = [e for e in result.scalars().all() if _matches(e, event)]
        if not endpoints:
            return []

        deliveries: list[WebhookDelivery] = []
        for endpoint in endpoints:
            delivery = WebhookDelivery(
                tenant_id=tenant_id,
                endpoint_id=endpoint.id,
                event=event,
                payload_json=json.dumps({"event": event, "data": data}),
            )
            session.add(delivery)
            deliveries.append(delivery)
        await session.commit()
        for delivery in deliveries:
            await session.refresh(delivery)

        from app.workers.tasks import enqueue_webhook_delivery

        for delivery in deliveries:
            await enqueue_webhook_delivery(str(delivery.id))
        return deliveries
    except Exception:  # noqa: BLE001
        logger.exception("Webhook emit failed for event %s (tenant %s)", event, tenant_id)
        return []


async def _send(url: str, headers: dict[str, str], body: str) -> httpx.Response:
    """Isolated so tests can monkeypatch the network call."""
    async with httpx.AsyncClient(timeout=_DELIVERY_TIMEOUT_S, follow_redirects=False) as client:
        return await client.post(url, content=body, headers=headers)


async def perform_delivery(session: AsyncSession, delivery: WebhookDelivery) -> WebhookDelivery:
    """Attempt delivery with retries; persists the outcome."""
    result = await session.execute(
        select(WebhookEndpoint).where(WebhookEndpoint.id == delivery.endpoint_id)
    )
    endpoint = result.scalar_one_or_none()
    if not endpoint or not endpoint.active:
        delivery.status = "failed"
        delivery.error = "Endpoint removed or inactive"
        session.add(delivery)
        await session.commit()
        return delivery

    payload = json.loads(delivery.payload_json or "{}")
    body = json.dumps(
        {
            "id": str(delivery.id),
            "event": delivery.event,
            "created_at": delivery.created_at.isoformat(),
            "data": payload.get("data", {}),
        }
    )
    secret = decrypt_secret(endpoint.secret_encrypted)

    last_error = ""
    status_code = 0
    for attempt in range(_MAX_ATTEMPTS):
        timestamp = str(int(time.time()))
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Bokito-Webhooks/1.0",
            "X-Bokito-Event": delivery.event,
            "X-Bokito-Delivery": str(delivery.id),
            "X-Bokito-Timestamp": timestamp,
            "X-Bokito-Signature": sign_payload(secret, timestamp, body),
        }
        try:
            response = await _send(endpoint.url, headers, body)
            status_code = response.status_code
            if 200 <= status_code < 300:
                delivery.status = "delivered"
                delivery.status_code = status_code
                delivery.attempts = attempt + 1
                delivery.error = ""
                delivery.delivered_at = datetime.utcnow()
                break
            last_error = f"HTTP {status_code}"
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)[:500]
        if attempt < _MAX_ATTEMPTS - 1:
            await asyncio.sleep(_RETRY_DELAYS_S[attempt])
    else:
        delivery.status = "failed"
        delivery.status_code = status_code
        delivery.attempts = _MAX_ATTEMPTS
        delivery.error = last_error

    endpoint.last_delivery_at = datetime.utcnow()
    endpoint.last_status = str(delivery.status_code) if delivery.status == "delivered" else "failed"
    session.add(delivery)
    session.add(endpoint)
    await session.commit()
    await _prune_deliveries(session, endpoint.id)
    return delivery


async def _prune_deliveries(session: AsyncSession, endpoint_id: UUID) -> None:
    """Keep only the most recent delivery rows per endpoint."""
    result = await session.execute(
        select(WebhookDelivery.id)
        .where(WebhookDelivery.endpoint_id == endpoint_id)
        .order_by(WebhookDelivery.created_at.desc())
        .offset(_KEEP_DELIVERIES_PER_ENDPOINT)
    )
    stale_ids = [row[0] for row in result.all()]
    if not stale_ids:
        return
    for row in (
        (
            await session.execute(
                select(WebhookDelivery).where(WebhookDelivery.id.in_(stale_ids))
            )
        )
        .scalars()
        .all()
    ):
        await session.delete(row)
    await session.commit()


# ── Compact event payload builders ─────────────────────────────────


def signal_event_data(signal: Any) -> dict[str, Any]:
    return {
        "signal_id": str(signal.id),
        "channel": signal.channel,
        "subject": signal.subject or "",
        "status": signal.status,
        "contact_name": signal.contact_name or "",
        "created_at": signal.created_at.isoformat() if signal.created_at else None,
    }


def decision_event_data(decision: Any) -> dict[str, Any]:
    return {
        "decision_id": str(decision.id),
        "signal_id": str(decision.signal_id) if decision.signal_id else None,
        "title": decision.title or "",
        "summary": decision.summary or "",
        "status": decision.status,
        "chosen_option_id": decision.chosen_option_id or "",
        "resolved_at": decision.resolved_at.isoformat() if decision.resolved_at else None,
    }
