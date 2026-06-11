"""Public embeddable widget endpoints backed by the unified Signal model.

Anonymous visitors get a `Contact` (channel="widget") and a Signal thread per
session. Messages run through the same AgentLoop as every other channel.
"""

import secrets
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import tenant_settings
from app.models.auth import Tenant
from app.models.channel import Contact
from app.models.signal import Signal
from app.services.agent.loop import AgentLoop
from app.services.assistant_threads import (
    append_signal_chat_message,
    signal_chat_history,
)

router = APIRouter(prefix="/widget", tags=["widget"])


class WidgetMessage(BaseModel):
    content: str
    session_id: str | None = None


@router.post("/{tenant_slug}/session")
async def widget_session(
    tenant_slug: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(select(Tenant).where(Tenant.slug == tenant_slug))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    visitor_key = f"visitor_{secrets.token_hex(8)}"
    contact = Contact(
        tenant_id=tenant.id,
        channel="widget",
        address=visitor_key,
        display_name="Website visitor",
        status="approved",
    )
    session.add(contact)
    await session.flush()
    signal = Signal(
        tenant_id=tenant.id,
        channel="widget",
        source="widget",
        subject="Website chat",
        contact_id=contact.id,
        contact_name="Website visitor",
        has_unread=False,
    )
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    appearance = tenant_settings(tenant).get("appearance", {})
    return {
        "conversation_id": str(signal.id),
        "appearance": appearance,
        "powered_by": appearance.get("powered_by", True),
    }


@router.post("/{tenant_slug}/conversations/{conversation_id}/messages")
async def widget_message(
    tenant_slug: str,
    conversation_id: UUID,
    body: WidgetMessage,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant_result = await session.execute(select(Tenant).where(Tenant.slug == tenant_slug))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    signal_result = await session.execute(
        select(Signal).where(
            Signal.id == conversation_id,
            Signal.tenant_id == tenant.id,
            Signal.channel == "widget",
        )
    )
    signal = signal_result.scalar_one_or_none()
    if not signal:
        raise HTTPException(status_code=404, detail="Conversation not available")

    await append_signal_chat_message(session, signal, role="user", content=body.content)
    await session.commit()

    if signal.ai_paused:
        return {"message": {"role": "assistant", "content": "A team member will respond shortly."}}

    from app.services.routing import resolve_agent_for_signal

    agent = await resolve_agent_for_signal(session, signal)
    history = await signal_chat_history(session, conversation_id)
    loop = AgentLoop(session, tenant.id, None, agent=agent, signal_id=signal.id, trust="external")
    reply_text, _tokens = await loop.run_chat(history)
    await append_signal_chat_message(
        session,
        signal,
        role="assistant",
        content=reply_text,
        author_agent_id=agent.id if agent else None,
    )
    await session.commit()
    return {"message": {"role": "assistant", "content": reply_text}}
