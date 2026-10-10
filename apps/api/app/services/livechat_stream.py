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
    channel_account_id: UUID | None = None,
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
            # Anonymous widget visitors wait for an email before "Approved" (F-16).
            status="pending",
        )
        session.add(contact)
        await session.flush()
    from app.services.widget_channel import get_widget_account
    from app.services.tenant_bootstrap import ensure_widget_channel

    account = await get_widget_account(session, tenant.id, channel_account_id)
    if account is None:
        account = await ensure_widget_channel(session, tenant.id, commit=False)
    signal = Signal(
        tenant_id=tenant.id,
        channel="widget",
        source="widget",
        subject="Website chat",
        channel_account_id=account.id,
        contact_id=contact.id,
        contact_name=contact.display_name,
        has_unread=False,
    )
    session.add(signal)
    await session.flush()
    try:
        meta = json.loads(contact.metadata_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    visitor_email = str(meta.get("email") or "").strip() if isinstance(meta, dict) else ""
    if visitor_email:
        from app.services.contact_identity import link_visitor_email

        visitor_name = (contact.display_name or "").strip()
        if visitor_name.lower() in {"website visitor", "websitebezoeker", "website bezoeker", "visitor", "bezoeker"}:
            visitor_name = ""
        await link_visitor_email(
            session, tenant, signal, email=visitor_email, name=visitor_name
        )
    from app.services.distribution import distribute

    if await distribute(session, signal):
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
        from app.services import ai_handling

        # A team member holds this thread (manual override), so the AI stays
        # silent. The visitor's message is persisted (and published to the
        # gateway above) so the operator sees it live and replies via the dashboard.
        if ai_handling.is_held(signal):
            payload = {
                "type": "done",
                "content": "",
                "ai_paused": True,
                "conversation_id": str(signal.id),
            }
            yield f"data: {json.dumps(payload)}\n\n"
            return
        # Visitor threads follow AI handling for the widget channel, contact and
        # conversation. Autonomous streams a live reply below; assisted drafts a
        # reply card for the team instead; manual leaves the thread to humans.
        if signal.channel == "widget":
            account, contact = await ai_handling.load_layers(session, tenant.id, signal)
            handling = ai_handling.resolve_ai_handling(tenant, account, contact, signal)
            run_mode, _reason = await ai_handling.apply_safeguards(
                session, tenant, signal, handling, contact=contact
            )
            if run_mode != "autonomous":
                if signal.subject == "Website chat" and message:
                    signal.subject = message[:60]
                await session.commit()
                if run_mode == "assisted":
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
    segment_id: str | None = None
    async for event in loop.stream_chat(
        history,
        extra_context=page_context_block(page_context) if user_id else "",
        attachments=attachments,
    ):
        if event.get("type") == "delta":
            chunk = str(event.get("text") or "")
            if not chunk:
                continue
            next_segment = event.get("segment_id")
            if segment_id and next_segment and next_segment != segment_id:
                # Speech before and after a tool call are separate bubbles.
                yield f"data: {json.dumps({'type': 'message_break', 'id': next_segment})}\n\n"
                full_text += "\n\n"
            segment_id = next_segment or segment_id
            full_text += chunk
            yield f"data: {json.dumps({'t': chunk})}\n\n"
        elif event.get("type") == "done":
            # Deflection: when the reply drew on published help-center docs,
            # append deterministic article links for the visitor (widget only —
            # internal assistant threads do not need public help links).
            related = ""
            if signal and signal.channel == "widget" and loop.last_rag_hits:
                from app.services.help_articles import (
                    format_related_articles,
                    related_published_articles,
                )

                articles = await related_published_articles(
                    session, tenant, loop.last_rag_hits, limit=2
                )
                related = format_related_articles(articles)
            disclosure: str | None = None
            bubbles: list[str]
            message_ids: list[str] = []
            if signal:
                metadata: dict[str, Any] | None = None
                if signal.channel == "widget":
                    from app.services.chat_delivery import conversation_has_disclosure
                    from app.services.inbound_agent import _disclosure_line

                    if not await conversation_has_disclosure(session, signal):
                        disclosure = await _disclosure_line(session, tenant.id, signal)
                    metadata = {"ai_handling": "autonomous"}
                saved = await loop.persist_turn(
                    signal,
                    metadata=metadata,
                    first_metadata={"ai_disclosure": disclosure} if disclosure else None,
                    final_metadata={"usage": event.get("usage") or {}},
                    fallback_text=str(event.get("text") or full_text) or "Done.",
                    append_to_last=related,
                )
                bubbles = [m.body_text or "" for m in saved]
                message_ids = [str(m.id) for m in saved]
                if signal.subject in ("New conversation", "Website chat") and message:
                    from app.services.conversation_title import maybe_apply_intent_title

                    maybe_apply_intent_title(signal, message)
                if signal.channel == "widget":
                    from app.services.inbound_agent import apply_suggested_actions

                    apply_suggested_actions(signal)
                await session.commit()
                if signal.channel == "widget":
                    account, _contact = await ai_handling.load_layers(session, tenant.id, signal)
                    await ai_handling.check_breaker(session, tenant, account)
            else:
                from app.services.agent.reply_mode import CHAT
                from app.services.agent.turn_persist import plan_turn_messages

                bubbles = [
                    b["text"]
                    for b in plan_turn_messages(
                        list(event.get("segments") or []),
                        CHAT,
                        fallback_text=str(event.get("text") or full_text) or "Done.",
                    )
                ]
            payload: dict[str, Any] = {
                "type": "done",
                "content": "\n\n".join(bubbles),
                "messages": bubbles,
            }
            if signal:
                payload["conversation_id"] = str(signal.id)
                payload["message_ids"] = message_ids
                if message_ids:
                    payload["id"] = message_ids[-1]
            if disclosure:
                payload["ai_disclosure"] = disclosure
            yield f"data: {json.dumps(payload)}\n\n"
            final_sent = True
            return
    if not final_sent:
        if signal:
            await append_signal_chat_message(
                session, signal, role="assistant", content=full_text, author_agent_id=agent.id
            )
            await session.commit()
        yield f"data: {json.dumps({'type': 'done', 'content': full_text, 'messages': [full_text]})}\n\n"
