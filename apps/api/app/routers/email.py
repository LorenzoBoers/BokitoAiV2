from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.email import EmailAccount, EmailMessage, EmailThread
from app.workers.tasks import enqueue_email_processing

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
    result = await session.execute(select(EmailAccount).where(EmailAccount.tenant_id == auth.tenant.id))
    return [
        {"id": str(a.id), "email_address": a.email_address, "provider": a.provider, "is_enabled": a.is_enabled}
        for a in result.scalars().all()
    ]


@router.get("/threads")
async def list_threads(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(EmailThread).where(EmailThread.tenant_id == auth.tenant.id).order_by(EmailThread.updated_at.desc())
    )
    return [
        {
            "id": str(t.id),
            "subject": t.subject,
            "has_unread": t.has_unread,
            "updated_at": t.updated_at.isoformat(),
        }
        for t in result.scalars().all()
    ]


@router.get("/threads/{thread_id}/messages")
async def list_thread_messages(
    thread_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(EmailMessage)
        .where(EmailMessage.thread_id == thread_id, EmailMessage.tenant_id == auth.tenant.id)
        .order_by(EmailMessage.created_at)
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
        select(EmailThread).where(EmailThread.id == body.thread_id, EmailThread.tenant_id == auth.tenant.id)
    )
    thread = thread_result.scalar_one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    account_result = await session.execute(select(EmailAccount).where(EmailAccount.id == thread.account_id))
    account = account_result.scalar_one_or_none()
    msg = EmailMessage(
        tenant_id=auth.tenant.id,
        thread_id=thread.id,
        account_id=account.id if account else thread.account_id,
        direction="outbound",
        from_address=account.email_address if account else "noreply@bokito.ai",
        subject=body.subject or thread.subject,
        body_text=body.body_text,
    )
    session.add(msg)
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
        select(EmailAccount).where(EmailAccount.tenant_id == auth.tenant.id).limit(1)
    )
    account = account_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=400, detail="No email account configured")
    thread = EmailThread(
        tenant_id=auth.tenant.id,
        account_id=account.id,
        subject=body.subject,
        has_unread=True,
    )
    session.add(thread)
    await session.flush()
    msg = EmailMessage(
        tenant_id=auth.tenant.id,
        thread_id=thread.id,
        account_id=account.id,
        direction="inbound",
        from_address=body.from_address,
        subject=body.subject,
        body_text=body.body_text,
    )
    session.add(msg)
    await session.commit()
    await session.refresh(msg)
    await enqueue_email_processing(str(auth.tenant.id), str(msg.id))
    return {"thread_id": str(thread.id), "message_id": str(msg.id), "status": "queued_for_ai"}
