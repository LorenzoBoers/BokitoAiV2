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
from pydantic import BaseModel, Field
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


class SignalSummary(BaseModel):
    """A conversation thread in the inbox."""

    id: str = Field(description="Signal UUID.")
    channel: str = Field(description="Origin channel, e.g. `email`, `chat`, `whatsapp`, `api`.")
    source: str = Field(description="Producer of the signal, e.g. `public_api` or a connector name.")
    subject: str = Field(description="Thread subject line.")
    status: str = Field(description="One of `open`, `pending`, `closed`, `spam`.")
    priority: str = Field(description="One of `low`, `normal`, `high`, `urgent`.")
    contact_name: str = Field(description="Display name of the contact, if known.")
    contact_email: str = Field(description="Email address of the contact, if known.")
    tags: list[str] = Field(description="Free-form labels on the thread.")
    created_at: str | None = Field(description="ISO 8601 creation timestamp.")
    last_message_at: str | None = Field(description="ISO 8601 timestamp of the latest message.")


class SignalListResponse(BaseModel):
    """One page of signals, newest activity first."""

    items: list[SignalSummary]
    total: int = Field(description="Total signals matching the filters, ignoring paging.")
    limit: int
    offset: int


class SignalMessageOut(BaseModel):
    """A single message inside a signal thread."""

    id: str = Field(description="Message UUID.")
    kind: str = Field(description="Message kind, e.g. `user_message`, `agent_message`.")
    direction: str = Field(description="`inbound` or `outbound`.")
    role: str = Field(description="Author role, e.g. `user`, `assistant`, `operator`.")
    from_address: str = Field(description="Sender address, when the channel has one.")
    subject: str = Field(description="Message subject, when the channel has one.")
    body_text: str = Field(description="Plain-text message body.")
    created_at: str | None = Field(description="ISO 8601 creation timestamp.")


class SignalDetail(SignalSummary):
    """A signal plus its messages in chronological order (up to 200)."""

    messages: list[SignalMessageOut]


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


@router.get(
    "/signals",
    dependencies=[Depends(rate_limit("public-api", limit=120))],
    response_model=SignalListResponse,
    summary="List signals",
)
async def list_signals(
    token: Annotated[ApiToken, Depends(get_api_token)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: str | None = None,
    channel: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """List conversation threads in the workspace inbox.

    Requires the `signals:read` scope. Filter with `status` (`open`,
    `pending`, `closed`, `spam`) and `channel` (for example `email`, `chat`,
    `api`); page with `limit` and `offset`. Results are ordered by most
    recent activity.
    """
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


@router.get(
    "/signals/{signal_id}",
    dependencies=[Depends(rate_limit("public-api", limit=120))],
    response_model=SignalDetail,
    summary="Get a signal with messages",
)
async def get_signal(
    signal_id: UUID,
    token: Annotated[ApiToken, Depends(get_api_token)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Fetch one signal plus up to 200 messages in chronological order.

    Requires the `signals:read` scope. Returns `404` when the signal does
    not exist in the token's workspace.
    """
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
    """Payload for creating an inbound signal from an external system."""

    subject: str = Field(description="Thread subject, required, max 200 characters.")
    body: str = Field(description="Plain-text message body, required.")
    contact_name: str = Field(default="", description="Display name of the sender, optional.")
    contact_email: str = Field(default="", description="Email address of the sender, optional.")
    priority: str = Field(
        default="normal", description="One of `low`, `normal`, `high`, `urgent`."
    )
    tags: list[str] = Field(default=[], description="Up to 10 labels, max 50 characters each.")


@router.post(
    "/signals",
    dependencies=[Depends(rate_limit("public-api-write", limit=30))],
    response_model=SignalSummary,
    summary="Create a signal",
)
async def create_signal(
    body: SignalCreate,
    token: Annotated[ApiToken, Depends(get_api_token)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Push an external event or message into the inbox as an `api`-channel signal.

    Requires the `signals:write` scope. The signal enters the same flow as
    customer mail: routing rules and agents pick it up, and a
    `signal.created` webhook fires. Use this to route alerts, form
    submissions or events from other systems into the inbox.
    """
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
