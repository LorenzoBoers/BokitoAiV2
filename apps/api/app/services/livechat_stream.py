"""SSE stream-chat for the bokito-chat widget, persisted on Signal threads."""

from __future__ import annotations

import json
from typing import Any, AsyncGenerator
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.channel import Contact
from app.models.signal import Signal
from app.services.agent.loop import AgentLoop
from app.services.assistant_threads import (
    append_signal_chat_message,
    signal_chat_history,
)
from app.services.routing import resolve_agent_for_channel, resolve_agent_for_signal


async def _assistant_agent(
    session: AsyncSession, tenant_id: UUID, signal: Signal | None = None
) -> Agent:
    if signal:
        agent = await resolve_agent_for_signal(session, signal)
    else:
        agent = await resolve_agent_for_channel(session, tenant_id, "widget")
    if not agent:
        raise LookupError("No active agent for tenant")
    return agent


async def get_or_create_widget_thread(
    session: AsyncSession,
    tenant: Tenant,
    user: User | None,
    *,
    conversation_id: str | None = None,
    customer_id: str | None = None,
) -> Signal:
    """Resolve the Signal thread for a widget session.

    Logged-in users get a personal assistant thread (channel="assistant");
    anonymous visitors get a widget thread linked to a Contact.
    """
    if conversation_id:
        try:
            sig_uuid = UUID(conversation_id)
        except ValueError:
            sig_uuid = None
        if sig_uuid:
            result = await session.execute(
                select(Signal).where(Signal.id == sig_uuid, Signal.tenant_id == tenant.id)
            )
            existing = result.scalar_one_or_none()
            if existing:
                return existing

    if user:
        signal = Signal(
            tenant_id=tenant.id,
            channel="assistant",
            source="widget",
            subject="New conversation",
            owner_user_id=user.id,
            contact_name=user.display_name or user.email,
            has_unread=False,
        )
        session.add(signal)
        await session.flush()
        return signal

    contact: Contact | None = None
    if customer_id:
        result = await session.execute(
            select(Contact).where(
                Contact.tenant_id == tenant.id,
                Contact.channel == "widget",
                Contact.address == customer_id,
            )
        )
        contact = result.scalar_one_or_none()
    if not contact:
        contact = Contact(
            tenant_id=tenant.id,
            channel="widget",
            address=customer_id or "",
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
        contact_name=contact.display_name,
        has_unread=False,
    )
    session.add(signal)
    await session.flush()
    return signal


async def widget_stream_events(
    session: AsyncSession,
    tenant: Tenant,
    user: User | None,
    *,
    message: str,
    attachments: list[dict[str, Any]] | None = None,
    signal: Signal | None = None,
) -> AsyncGenerator[str, None]:
    """Yield SSE lines compatible with bokito-chat (`evt.t` chunks + `type: done`)."""
    agent = await _assistant_agent(session, tenant.id, signal)
    user_id = user.id if user else None

    history: list[dict[str, Any]]
    if signal:
        await append_signal_chat_message(
            session,
            signal,
            role="user",
            content=message or "Hello",
            author_user_id=user_id,
            attachments=attachments,
        )
        await session.commit()
        history = await signal_chat_history(session, signal.id)
    else:
        history = [{"role": "user", "content": message or "Hello"}]

    loop = AgentLoop(
        session,
        tenant.id,
        user_id,
        agent=agent,
        signal_id=signal.id if signal else None,
        trust="operator" if user_id else "external",
    )
    full_text = ""
    final_sent = False
    async for event in loop.stream_chat(history, attachments=attachments):
        if event.get("type") == "delta":
            chunk = str(event.get("text") or "")
            if chunk:
                full_text += chunk
                yield f"data: {json.dumps({'t': chunk})}\n\n"
        elif event.get("type") == "done":
            final = str(event.get("text") or full_text)
            if signal:
                await append_signal_chat_message(
                    session, signal, role="assistant", content=final, author_agent_id=agent.id
                )
                if signal.subject in ("New conversation", "Website chat") and message:
                    signal.subject = message[:60]
                await session.commit()
            payload: dict[str, Any] = {"type": "done", "content": final}
            if signal:
                payload["conversation_id"] = str(signal.id)
            yield f"data: {json.dumps(payload)}\n\n"
            final_sent = True
            return
    if not final_sent:
        if signal:
            await append_signal_chat_message(
                session, signal, role="assistant", content=full_text, author_agent_id=agent.id
            )
            await session.commit()
        yield f"data: {json.dumps({'type': 'done', 'content': full_text})}\n\n"
