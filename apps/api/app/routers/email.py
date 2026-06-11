"""Email channel API backed by ChannelAccount + the unified Signal model."""

import json
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels import deliver_outbound
from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.auth import user_numeric_id
from app.models.channel import ChannelAccount
from app.models.signal import Signal, SignalMessage
from app.services.signals import create_inbound_signal
from app.workers.tasks import enqueue_signal_processing

router = APIRouter(prefix="/email", tags=["email"])


class SendEmailRequest(BaseModel):
    thread_id: UUID
    body_text: str
    subject: str | None = None


class MockInboundEmail(BaseModel):
    from_address: str
    subject: str
    body_text: str


@router.get("/accounts")
async def list_accounts(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.tenant_id == auth.tenant.id,
            ChannelAccount.channel == "email",
        )
    )
    return [
        {
            # Numeric id matches the `email_connection_id` filter on /api/signals.
            "id": user_numeric_id(a.id),
            "uuid": str(a.id),
            "email_address": a.address,
            "mailbox_email": a.address,
            "display_name": a.display_name or a.address,
            "provider": a.provider,
            "is_enabled": a.is_enabled,
            "status": "active" if a.is_enabled else "revoked",
        }
        for a in result.scalars().all()
    ]


@router.get("/threads")
async def list_threads(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(Signal)
        .where(Signal.tenant_id == auth.tenant.id, Signal.channel == "email")
        .order_by(Signal.updated_at.desc())
    )
    return [
        {
            "id": str(s.id),
            "subject": s.subject,
            "has_unread": s.has_unread,
            "updated_at": s.updated_at.isoformat(),
        }
        for s in result.scalars().all()
    ]


@router.get("/threads/{thread_id}/messages")
async def list_thread_messages(
    thread_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(SignalMessage)
        .where(SignalMessage.signal_id == thread_id, SignalMessage.tenant_id == auth.tenant.id)
        .order_by(SignalMessage.created_at)
    )
    return [
        {
            "id": str(m.id),
            "direction": m.direction,
            "from_address": m.from_address,
            "subject": m.subject,
            "body_text": m.body_text,
            "created_at": m.created_at.isoformat(),
        }
        for m in result.scalars().all()
    ]


@router.post("/send")
async def send_email(
    body: SendEmailRequest,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    thread_result = await session.execute(
        select(Signal).where(
            Signal.id == body.thread_id,
            Signal.tenant_id == auth.tenant.id,
            Signal.channel == "email",
        )
    )
    signal = thread_result.scalar_one_or_none()
    if not signal:
        raise HTTPException(status_code=404, detail="Thread not found")
    account = None
    if signal.channel_account_id:
        account_result = await session.execute(
            select(ChannelAccount).where(ChannelAccount.id == signal.channel_account_id)
        )
        account = account_result.scalar_one_or_none()
    send_status = await deliver_outbound(
        session, signal, body_text=body.body_text, subject=body.subject or signal.subject
    )
    if send_status == "skipped":
        send_status = "sent"
    now = datetime.utcnow()
    msg = SignalMessage(
        signal_id=signal.id,
        tenant_id=auth.tenant.id,
        kind="user_message",
        direction="outbound",
        role="user",
        author_user_id=auth.user.id,
        from_address=account.address if account else "noreply@bokito.ai",
        to_addresses=json.dumps([signal.contact_email] if signal.contact_email else []),
        subject=body.subject or signal.subject,
        body_text=body.body_text,
        body_preview=body.body_text[:200],
        send_status=send_status,
        received_at=now,
    )
    session.add(msg)
    signal.last_message_at = now
    signal.updated_at = now
    await session.commit()
    return {"id": str(msg.id), "status": "sent"}


@router.post("/mock/inbound")
async def mock_inbound_email(
    body: MockInboundEmail,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Dev-only: simulate inbound email and trigger AI proposal flow."""
    account_result = await session.execute(
        select(ChannelAccount)
        .where(
            ChannelAccount.tenant_id == auth.tenant.id,
            ChannelAccount.channel == "email",
        )
        .limit(1)
    )
    account = account_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=400, detail="No email account configured")
    signal = await create_inbound_signal(
        session,
        auth.tenant.id,
        channel="email",
        source=account.provider,
        subject=body.subject,
        body_text=body.body_text,
        contact_email=body.from_address,
    )
    await enqueue_signal_processing(str(auth.tenant.id), str(signal.id))
    return {"thread_id": str(signal.id), "message_id": str(signal.id), "status": "queued_for_ai"}
