"""SSE stream-chat for the bokito-chat widget (livechat API group)."""

from __future__ import annotations

import json
from typing import Any, AsyncGenerator
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.services.agent.loop import AgentLoop


async def _assistant_agent(session: AsyncSession, tenant_id: UUID) -> Agent:
    result = await session.execute(
        select(Agent)
        .where(Agent.tenant_id == tenant_id, Agent.role == "assistant", Agent.is_active == True)  # noqa: E712
        .order_by(Agent.updated_at.desc())
        .limit(1)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        result = await session.execute(
            select(Agent).where(Agent.tenant_id == tenant_id, Agent.is_active == True).limit(1)  # noqa: E712
        )
        agent = result.scalar_one_or_none()
    if not agent:
        raise LookupError("No active agent for tenant")
    return agent


async def widget_stream_events(
    session: AsyncSession,
    tenant: Tenant,
    user: User | None,
    *,
    message: str,
    attachments: list[dict[str, Any]] | None = None,
) -> AsyncGenerator[str, None]:
    """Yield SSE lines compatible with bokito-chat (`evt.t` chunks + `type: done`)."""
    agent = await _assistant_agent(session, tenant.id)
    user_id = user.id if user else None
    loop = AgentLoop(session, tenant.id, user_id, agent=agent)
    history = [{"role": "user", "content": message or "Hello"}]
    full_text = ""
    async for event in loop.stream_chat(history, attachments=attachments):
        if event.get("type") == "delta":
            chunk = str(event.get("text") or "")
            if chunk:
                full_text += chunk
                yield f"data: {json.dumps({'t': chunk})}\n\n"
        elif event.get("type") == "done":
            final = str(event.get("text") or full_text)
            yield f"data: {json.dumps({'type': 'done', 'content': final})}\n\n"
            return
    yield f"data: {json.dumps({'type': 'done', 'content': full_text})}\n\n"
