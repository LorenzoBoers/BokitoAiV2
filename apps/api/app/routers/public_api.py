"""Public REST API v1, authenticated with tenant API tokens (`bok_...`).

Tokens are managed under Settings (govern token CRUD). This surface is
intentionally small: read signals/messages and create inbound signals so
external systems can push work into the inbox.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.middleware.rate_limit import rate_limit
from app.models.api_token import ApiToken
from app.models.signal import Signal, SignalMessage
from app.routers.mcp import get_api_token

router = APIRouter(prefix="/public/v1", tags=["public-api"])

_STATUSES = ("open", "pending", "closed", "spam")

# REST scopes recognized on API tokens. Empty scopes_json = full access
# (legacy tokens and deliberately unrestricted ones).
REST_SCOPES = ("signals:read", "signals:write")


def _require_scope(token: ApiToken, scope: str) -> None:
    try:
        scopes = json.loads(token.scopes_json or "[]")
    except (json.JSONDecodeError, TypeError):
        scopes = []
    if not isinstance(scopes, list) or not scopes:
        return
    if scope not in {str(s) for s in scopes}:
        raise HTTPException(
            status_code=403, detail=f"Token is missing the '{scope}' scope"
        )


def _serialize_signal(signal: Signal) -> dict:
    return {
        "id": str(signal.id),
        "channel": signal.channel,
        "source": signal.source,
        "subject": signal.subject or "",
        "status": signal.status,
        "priority": signal.priority,
        "contact_name": signal.contact_name or "",
        "contact_email": signal.contact_email or "",
        "tags": json.loads(signal.tags_json or "[]"),
        "created_at": signal.created_at.isoformat() if signal.created_at else None,
        "last_message_at": (
            signal.last_message_at.isoformat() if signal.last_message_at else None
        ),
    }


def _serialize_message(message: SignalMessage) -> dict:
    return {
        "id": str(message.id),
        "kind": message.kind,
        "direction": message.direction,
        "role": message.role,
        "from_address": message.from_address or "",
        "subject": message.subject or "",
        "body_text": message.body_text or "",
        "created_at": message.created_at.isoformat() if message.created_at else None,
    }


@router.get("/signals", dependencies=[Depends(rate_limit("public-api", limit=120))])
async def list_signals(
    token: Annotated[ApiToken, Depends(get_api_token)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: str | None = None,
    channel: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    _require_scope(token, "signals:read")
    query = select(Signal).where(Signal.tenant_id == token.tenant_id)
    count_query = select(func.count()).select_from(Signal).where(Signal.tenant_id == token.tenant_id)
    if status:
        if status not in _STATUSES:
            raise HTTPException(status_code=400, detail=f"Unknown status: {status}")
        query = query.where(Signal.status == status)
        count_query = count_query.where(Signal.status == status)
    if channel:
        query = query.where(Signal.channel == channel)
        count_query = count_query.where(Signal.channel == channel)
    total = (await session.execute(count_query)).scalar_one()
    result = await session.execute(
        query.order_by(Signal.last_message_at.desc().nullslast()).limit(limit).offset(offset)
    )
    return {
        "items": [_serialize_signal(s) for s in result.scalars().all()],
        "total": int(total),
        "limit": limit,
        "offset": offset,
    }


@router.get("/signals/{signal_id}", dependencies=[Depends(rate_limit("public-api", limit=120))])
async def get_signal(
    signal_id: UUID,
    token: Annotated[ApiToken, Depends(get_api_token)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    _require_scope(token, "signals:read")
    result = await session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == token.tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")
    messages = await session.execute(
        select(SignalMessage)
        .where(SignalMessage.signal_id == signal.id)
        .order_by(SignalMessage.created_at.asc())
        .limit(200)
    )
    return {
        **_serialize_signal(signal),
        "messages": [_serialize_message(m) for m in messages.scalars().all()],
    }


class SignalCreate(BaseModel):
    subject: str
    body: str
    contact_name: str = ""
    contact_email: str = ""
    priority: str = "normal"
    tags: list[str] = []


@router.post("/signals", dependencies=[Depends(rate_limit("public-api-write", limit=30))])
async def create_signal(
    body: SignalCreate,
    token: Annotated[ApiToken, Depends(get_api_token)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Push an external event/message into the inbox as an API-channel signal."""
    _require_scope(token, "signals:write")
    subject = body.subject.strip()[:200]
    text = body.body.strip()
    if not subject or not text:
        raise HTTPException(status_code=400, detail="subject and body are required")
    if body.priority not in ("low", "normal", "high", "urgent"):
        raise HTTPException(status_code=400, detail=f"Unknown priority: {body.priority}")

    now = datetime.utcnow()
    signal = Signal(
        tenant_id=token.tenant_id,
        channel="api",
        source="public_api",
        subject=subject,
        contact_name=body.contact_name.strip()[:120],
        contact_email=body.contact_email.strip().lower()[:254],
        status="open",
        priority=body.priority,
        tags_json=json.dumps([t.strip()[:50] for t in body.tags if t.strip()][:10]),
        has_unread=True,
        last_message_at=now,
    )
    session.add(signal)
    await session.flush()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=token.tenant_id,
        kind="user_message",
        direction="inbound",
        role="user",
        from_address=signal.contact_email,
        subject=subject,
        body_text=text,
        body_preview=text[:200],
        received_at=now,
        created_at=now,
    )
    session.add(message)
    await session.commit()
    await session.refresh(signal)

    from app.gateway.publish import publish_signal_message

    await session.refresh(message)
    await publish_signal_message(signal, message)

    from app.services.webhooks import emit_webhook_event, signal_event_data

    await emit_webhook_event(
        session, token.tenant_id, "signal.created", signal_event_data(signal)
    )
    return _serialize_signal(signal)
