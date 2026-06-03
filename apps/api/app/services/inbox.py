"""Unified inbox aggregation."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import Conversation
from app.models.email import EmailThread
from app.models.notification import DecisionRequest


async def list_inbox_items(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    channel: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    conv_query = select(Conversation).where(Conversation.tenant_id == tenant_id)
    if channel:
        conv_query = conv_query.where(Conversation.channel == channel)
    conv_result = await session.execute(conv_query.order_by(Conversation.last_message_at.desc()).limit(limit))
    for conv in conv_result.scalars().all():
        items.append(
            {
                "kind": "conversation",
                "id": str(conv.id),
                "channel": conv.channel,
                "title": conv.title,
                "ai_paused": conv.ai_paused,
                "updated_at": conv.last_message_at.isoformat(),
            }
        )

    dec_result = await session.execute(
        select(DecisionRequest)
        .where(DecisionRequest.tenant_id == tenant_id, DecisionRequest.status == "awaiting_human")
        .order_by(DecisionRequest.created_at.desc())
        .limit(limit)
    )
    for dec in dec_result.scalars().all():
        items.append(
            {
                "kind": "decision",
                "id": str(dec.id),
                "channel": "decision",
                "title": dec.title,
                "conversation_id": str(dec.conversation_id) if dec.conversation_id else None,
                "updated_at": dec.created_at.isoformat(),
            }
        )

    thread_result = await session.execute(
        select(EmailThread)
        .where(EmailThread.tenant_id == tenant_id)
        .order_by(EmailThread.updated_at.desc())
        .limit(limit)
    )
    for thread in thread_result.scalars().all():
        items.append(
            {
                "kind": "email_thread",
                "id": str(thread.id),
                "channel": "email",
                "title": thread.subject or "(no subject)",
                "updated_at": thread.updated_at.isoformat() if thread.updated_at else datetime.utcnow().isoformat(),
            }
        )

    items.sort(key=lambda x: x["updated_at"], reverse=True)
    return items[:limit]
