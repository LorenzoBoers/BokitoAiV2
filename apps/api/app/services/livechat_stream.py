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
from app.services.assistant_context import page_context_block
from app.services.assistant_threads import (
    append_signal_chat_message,
    signal_chat_history,
)
from app.services.livechat_compat import SURFACE_IN_APP, SURFACE_SITE, normalize_surface
from app.services.personal_assistant import (
    PERSONAL_THREAD_SOURCE,
    ensure_personal_assistant,
)
from app.services.routing import resolve_agent_for_channel, resolve_agent_for_signal


async def _assistant_agent(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal | None = None,
    *,
    surface: str = SURFACE_SITE,
) -> Agent:
    # The in-app surface always answers as the tenant's Bokito helper, never
    # as a channel-bound tenant agent.
    if normalize_surface(surface) == SURFACE_IN_APP:
        return await ensure_personal_assistant(session, tenant_id)
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
    surface: str = SURFACE_SITE,
) -> Signal:
    """Resolve the Signal thread for a widget session.

    In-app helper sessions get a private per-user thread pinned to the Bokito
    agent (source="personal"). Other logged-in users get an assistant-channel
    thread (source="widget"); anonymous visitors get a widget thread linked to
    a Contact.
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
        in_app = normalize_surface(surface) == SURFACE_IN_APP
        helper = await ensure_personal_assistant(session, tenant.id) if in_app else None
        signal = Signal(
            tenant_id=tenant.id,
            channel="assistant",
            source=PERSONAL_THREAD_SOURCE if in_app else "widget",
            subject="New conversation",
            owner_user_id=user.id,
            agent_id=helper.id if helper else None,
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
    # Transient flag: callers emit the signal.created webhook after their
    # own commit (this function only flushes).
    signal._newly_created = True  # type: ignore[attr-defined]
    return signal


async def widget_stream_events(
    session: AsyncSession,
    tenant: Tenant,
    user: User | None,
    *,
    message: str,
    attachments: list[dict[str, Any]] | None = None,
    signal: Signal | None = None,
    surface: str = SURFACE_SITE,
    page_context: str = "",
) -> AsyncGenerator[str, None]:
    """Yield SSE lines compatible with bokito-chat (`evt.t` chunks + `type: done`)."""
    surface = normalize_surface(surface)
    agent = await _assistant_agent(session, tenant.id, signal, surface=surface)
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
        if getattr(signal, "_newly_created", False):
            from app.services.webhooks import emit_webhook_event, signal_event_data

            signal._newly_created = False  # type: ignore[attr-defined]
            await emit_webhook_event(
                session, tenant.id, "signal.created", signal_event_data(signal)
            )
        # Human takeover: a team member owns this thread, so the AI stays silent.
        # The visitor's message is persisted (and published to the gateway above)
        # so the operator sees it live and replies via the dashboard.
        if signal.ai_paused:
            payload = {
                "type": "done",
                "content": "",
                "ai_paused": True,
                "conversation_id": str(signal.id),
            }
            yield f"data: {json.dumps(payload)}\n\n"
            return
        # Visitor threads honour the tenant's widget AI mode. `auto` streams a
        # live reply below; `suggest` drafts a reply card for the team instead;
        # `off` leaves the thread to humans entirely.
        if signal.channel == "widget":
            from app.services.channel_ai import resolve_ai_mode

            ai_mode = resolve_ai_mode(tenant, None, "widget")
            if ai_mode != "auto":
                if signal.subject == "Website chat" and message:
                    signal.subject = message[:60]
                    await session.commit()
                if ai_mode == "suggest":
                    from app.workers.tasks import enqueue_signal_processing

                    await enqueue_signal_processing(str(tenant.id), str(signal.id))
                payload = {
                    "type": "done",
                    "content": "",
                    "ai_paused": True,
                    "conversation_id": str(signal.id),
                }
                yield f"data: {json.dumps(payload)}\n\n"
                return
        history = await signal_chat_history(session, signal.id)
    else:
        history = [{"role": "user", "content": message or "Hello"}]

    # A signed-in teammate's session is clamped to their own workspace role
    # (AgentLoop resolves the membership row itself), so the effective mode is
    # the minimum of the agent passport and what that person may do in the API.
    loop = AgentLoop(
        session,
        tenant.id,
        user_id,
        agent=agent,
        signal_id=signal.id if signal else None,
        trust="operator" if user_id else "external",
        enable_chat_thinking=surface == SURFACE_IN_APP,
        surface=surface,
    )
    full_text = ""
    final_sent = False
    async for event in loop.stream_chat(
        history,
        extra_context=page_context_block(page_context) if user_id else "",
        attachments=attachments,
    ):
        if event.get("type") == "delta":
            chunk = str(event.get("text") or "")
            if chunk:
                full_text += chunk
                yield f"data: {json.dumps({'t': chunk})}\n\n"
        elif event.get("type") == "done":
            final = str(event.get("text") or full_text)
            # Deflection: when the reply drew on published help-center docs,
            # append deterministic article links for the visitor (widget only —
            # internal assistant threads do not need public help links).
            if signal and signal.channel == "widget" and final.strip() and loop.last_rag_hits:
                from app.services.help_articles import (
                    format_related_articles,
                    related_published_articles,
                )

                articles = await related_published_articles(
                    session, tenant, loop.last_rag_hits, limit=2
                )
                final += format_related_articles(articles)
            if signal:
                await append_signal_chat_message(
                    session, signal, role="assistant", content=final, author_agent_id=agent.id
                )
                if signal.subject in ("New conversation", "Website chat") and message:
                    signal.subject = message[:60]
                if signal.channel == "widget":
                    from app.services.inbound_agent import apply_suggested_actions

                    apply_suggested_actions(signal)
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
