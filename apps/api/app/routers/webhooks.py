"""Tenant webhook endpoint management (Settings > Integrations > Webhooks)."""

from __future__ import annotations

import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.webhook import WebhookDelivery, WebhookEndpoint
from app.services.audit import record_audit
from app.services.webhooks import (
    WEBHOOK_EVENTS,
    new_endpoint,
    perform_delivery,
    serialize_delivery,
    serialize_endpoint,
)

router = APIRouter(prefix="/settings/webhooks", tags=["webhooks"])


class WebhookCreate(BaseModel):
    url: str
    description: str = ""
    events: list[str] = []


class WebhookUpdate(BaseModel):
    url: str | None = None
    description: str | None = None
    events: list[str] | None = None
    active: bool | None = None


def _validate_url(url: str) -> str:
    url = url.strip()
    if not url.startswith(("https://", "http://")):
        raise HTTPException(status_code=400, detail="URL must start with https:// or http://")
    return url


def _validate_events(events: list[str]) -> list[str]:
    for event in events:
        if event != "*" and event not in WEBHOOK_EVENTS:
            raise HTTPException(status_code=400, detail=f"Unknown event: {event}")
    return events or ["*"]


async def _get_endpoint(
    session: AsyncSession, tenant_id: UUID, endpoint_id: UUID
) -> WebhookEndpoint:
    result = await session.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == endpoint_id, WebhookEndpoint.tenant_id == tenant_id
        )
    )
    endpoint = result.scalar_one_or_none()
    if not endpoint:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return endpoint


@router.get("")
async def list_webhooks(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = Query(50, ge=1, le=100),
):
    auth.require_role("owner", "admin")
    result = await session.execute(
        select(WebhookEndpoint)
        .where(WebhookEndpoint.tenant_id == auth.tenant.id)
        .order_by(WebhookEndpoint.created_at.desc())
        .limit(limit)
    )
    return {
        "items": [serialize_endpoint(e, include_secret=True) for e in result.scalars().all()],
        "events": list(WEBHOOK_EVENTS),
    }


@router.post("")
async def create_webhook(
    body: WebhookCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    endpoint = new_endpoint(
        auth.tenant.id,
        url=_validate_url(body.url),
        description=body.description.strip()[:200],
        events=_validate_events(body.events),
        created_by_user_id=auth.user.id,
    )
    session.add(endpoint)
    await record_audit(
        session,
        auth.tenant.id,
        action="settings:webhook_create",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type="webhook_endpoint",
        resource_id=str(endpoint.id),
        outcome="applied",
        summary=f"Webhook endpoint added: {endpoint.url}",
        commit=False,
    )
    await session.commit()
    await session.refresh(endpoint)
    return serialize_endpoint(endpoint, include_secret=True)


@router.patch("/{endpoint_id}")
async def update_webhook(
    endpoint_id: UUID,
    body: WebhookUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    endpoint = await _get_endpoint(session, auth.tenant.id, endpoint_id)
    if body.url is not None:
        endpoint.url = _validate_url(body.url)
    if body.description is not None:
        endpoint.description = body.description.strip()[:200]
    if body.events is not None:
        endpoint.events_json = json.dumps(_validate_events(body.events))
    if body.active is not None:
        endpoint.active = body.active
    from datetime import datetime

    endpoint.updated_at = datetime.utcnow()
    session.add(endpoint)
    await session.commit()
    await session.refresh(endpoint)
    return serialize_endpoint(endpoint, include_secret=True)


@router.delete("/{endpoint_id}")
async def delete_webhook(
    endpoint_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    endpoint = await _get_endpoint(session, auth.tenant.id, endpoint_id)
    deliveries = await session.execute(
        select(WebhookDelivery).where(WebhookDelivery.endpoint_id == endpoint.id)
    )
    for delivery in deliveries.scalars().all():
        await session.delete(delivery)
    await session.delete(endpoint)
    await record_audit(
        session,
        auth.tenant.id,
        action="settings:webhook_delete",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type="webhook_endpoint",
        resource_id=str(endpoint_id),
        outcome="applied",
        summary=f"Webhook endpoint removed: {endpoint.url}",
        commit=False,
    )
    await session.commit()
    return {"ok": True}


@router.post("/{endpoint_id}/test")
async def test_webhook(
    endpoint_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Send a synchronous test event and report the outcome."""
    auth.require_role("owner", "admin")
    endpoint = await _get_endpoint(session, auth.tenant.id, endpoint_id)
    delivery = WebhookDelivery(
        tenant_id=auth.tenant.id,
        endpoint_id=endpoint.id,
        event="test.ping",
        payload_json=json.dumps(
            {"event": "test.ping", "data": {"message": "Test delivery from Bokito"}}
        ),
    )
    session.add(delivery)
    await session.commit()
    await session.refresh(delivery)
    delivery = await perform_delivery(session, delivery)
    return serialize_delivery(delivery)


@router.get("/{endpoint_id}/deliveries")
async def list_deliveries(
    endpoint_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    endpoint = await _get_endpoint(session, auth.tenant.id, endpoint_id)
    result = await session.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.endpoint_id == endpoint.id)
        .order_by(WebhookDelivery.created_at.desc())
        .limit(20)
    )
    return {"items": [serialize_delivery(d) for d in result.scalars().all()]}
