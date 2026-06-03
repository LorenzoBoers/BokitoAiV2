from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import tenant_settings
from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.chat import Conversation, ConversationMessage
from app.services.agent.loop import AgentLoop

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
    conv = Conversation(
        tenant_id=tenant.id,
        title="Website chat",
        audience="external",
        channel="customer_widget",
    )
    session.add(conv)
    await session.commit()
    await session.refresh(conv)
    appearance = tenant_settings(tenant).get("appearance", {})
    return {
        "conversation_id": str(conv.id),
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
    conv_result = await session.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.tenant_id == tenant.id,
            Conversation.channel == "customer_widget",
        )
    )
    conv = conv_result.scalar_one_or_none()
    if not conv or conv.ai_paused:
        raise HTTPException(status_code=404, detail="Conversation not available")

    user_msg = ConversationMessage(
        conversation_id=conversation_id,
        tenant_id=tenant.id,
        role="user",
        content=body.content,
    )
    session.add(user_msg)
    await session.commit()

    if conv.ai_paused:
        return {"message": {"role": "assistant", "content": "A team member will respond shortly."}}

    agent_result = await session.execute(
        select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant").limit(1)
    )
    agent = agent_result.scalar_one_or_none()
    history_result = await session.execute(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.created_at)
    )
    history = [{"role": m.role, "content": m.content} for m in history_result.scalars().all()]
    loop = AgentLoop(session, tenant.id, None, agent=agent)
    reply_text, _tokens = await loop.run_chat(history)
    assistant_msg = ConversationMessage(
        conversation_id=conversation_id,
        tenant_id=tenant.id,
        role="assistant",
        content=reply_text,
    )
    session.add(assistant_msg)
    await session.commit()
    return {"message": {"role": "assistant", "content": reply_text}}
