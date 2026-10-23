"""Replies, scheduled outbound, and agent reply generation."""

from __future__ import annotations

import json
import logging
import re
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.exceptions import AppError, NotFoundError, status_error
from app.gateway.publish import publish_signal_message, publish_thread_update
from app.models.auth import User
from app.models.channel import ChannelAccount
from app.models.signal import (
    Signal,
    SignalEvent,
    SignalMessage,
)

logger = logging.getLogger(__name__)



async def _rebind_email_account_for_reply(
    session: AsyncSession,
    signal: Signal,
    *,
    channel_account_id: UUID,
    user_id: UUID,
    actor_role: str,
) -> None:
    """Bind an email thread to a chosen mailbox before outbound delivery.

    Cross-channel hops (WhatsApp/widget) are refused. Visibility and send
    capability are enforced so members cannot escape ACL via reply.
    """
    from app.services.channel_access import can_handle_account
    from app.services.channel_registry import account_can_send

    if signal.channel != "email":
        raise status_error(
            status_code=400,
            detail="channel_account_id is only valid on email threads",
        )

    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.id == channel_account_id,
            ChannelAccount.tenant_id == signal.tenant_id,
        )
    )
    account = result.scalar_one_or_none()
    if account is None or not await can_handle_account(
        session, account, user_id=user_id, role=actor_role
    ):
        raise NotFoundError("Channel not found")
    if account.channel != "email":
        raise AppError("Selected channel is not an email mailbox", code="app_error", status_code=400)
    if not account.is_enabled or not account_can_send(account):
        raise status_error(status_code=409, detail="Selected mailbox cannot send")

    if signal.channel_account_id != account.id:
        signal.channel_account_id = account.id
        session.add(signal)


async def reply_to_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    signal_id: UUID,
    *,
    body_text: str,
    body_html: str | None = None,
    action: str = "send",
    direction: str = "outbound",
    kind: str = "user_message",
    attachments: list[dict] | None = None,
    snooze_minutes: int | None = None,
    cc: str | None = None,
    bcc: str | None = None,
    send_after_seconds: int | None = None,
    channel_account_id: UUID | None = None,
    actor_role: str = "member",
    to: str | None = None,
    reply_mode: str = "reply",
    source_message_id: UUID | None = None,
    subject: str | None = None,
    quoted_html: str | None = None,
    handback: bool | None = None,
    keep_open: bool = False,
) -> dict[str, Any] | None:
    from app.services.signal_threads.mutations import _defer_open_reply_suggestions, _get_signal_row
    from app.services.signal_threads.serialize import clean_message_preview, serialize_message
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None

    routing_policy = None
    was_closed = False
    if direction == "outbound":
        from app.models.auth import Tenant
        from app.services import ai_handling as handling_svc

        tenant = await session.get(Tenant, tenant_id)
        routing_policy = await handling_svc.routing_for_signal(session, tenant, signal)
        # A reply on a closed conversation is the reopen (same as other
        # inboxes). Close-after-reply only applies while the thread is open;
        # an explicit send-and-close still stays closed.
        was_closed = signal.status == "closed"
        from app.services.operator_prefs import close_email_on_send

        sender = await session.get(User, user_id)
        personal_close = signal.channel == "email" and close_email_on_send(
            sender.settings_json if sender else None
        )
        if (
            action == "send"
            and not keep_open
            and not was_closed
            and (routing_policy.effective["close_after_human_reply"] or personal_close)
        ):
            # Channel policy: a plain send closes the conversation; a new
            # customer message reopens it. The dashboard composer passes
            # keep_open when it closes through its own flow or when the
            # sender picks "send and keep open".
            action = "send_and_close"

    if channel_account_id is not None and direction == "outbound":
        await _rebind_email_account_for_reply(
            session,
            signal,
            channel_account_id=channel_account_id,
            user_id=user_id,
            actor_role=actor_role,
        )

    now = utcnow()
    # Soft undo / scheduled send: persist the message without delivering it;
    # the scheduler tick delivers once `send_after` passes, and the cancel
    # endpoint can remove it before that.
    scheduled = bool(send_after_seconds and send_after_seconds > 0) and direction == "outbound"
    # Forward goes to a fresh recipient: skip In-Reply-To / Graph reply
    # threading so the mail arrives as its own message with our subject.
    is_forward = reply_mode == "forward"
    to_override = (to or "").strip() or None
    subject_override = (subject or "").strip() or None
    send_status = None
    delivered_from = ""
    delivered_to = ""
    provider_message_id = ""
    if scheduled:
        send_status = "scheduled"
    elif direction == "outbound":
        from app.channels import deliver_outbound
        from app.services.signatures import resolve_from_display_name, resolve_signature_html

        signature_html = await resolve_signature_html(
            session,
            tenant_id,
            send_as="user",
            user_id=user_id,
            channel_account_id=signal.channel_account_id,
        )
        from_display_name = await resolve_from_display_name(
            session, tenant_id, send_as="user", user_id=user_id
        )
        delivery = await deliver_outbound(
            session,
            signal,
            body_text=body_text,
            body_html=body_html,
            subject=subject_override or "",
            to_address=to_override,
            cc=cc,
            bcc=bcc,
            attachments=attachments,
            signature_html=signature_html,
            from_display_name=from_display_name,
            quoted_html=quoted_html,
            suppress_threading=is_forward,
        )
        send_status = delivery.status
        if send_status == "skipped":
            send_status = "sent"
        if delivery.body_html:
            body_html = delivery.body_html
        delivered_from = delivery.from_address
        delivered_to = delivery.to_address
        provider_message_id = delivery.provider_message_id
    message_meta: dict[str, Any] = {}
    if cc:
        message_meta["cc"] = cc
    if bcc:
        message_meta["bcc"] = bcc
    if reply_mode and reply_mode != "reply":
        message_meta["reply_mode"] = reply_mode
    if source_message_id:
        message_meta["source_message_id"] = str(source_message_id)
    if scheduled:
        # The flush tick needs the full send intent to deliver faithfully.
        if to_override:
            message_meta["to"] = to_override
        if subject_override:
            message_meta["subject"] = subject_override
        if quoted_html:
            message_meta["quoted_html"] = quoted_html
    resolved_kind = kind if direction == "internal" else "user_message"
    # Team chat (@teammate) uses direction=internal + user_message so it never
    # hits deliver_outbound, but still renders as a normal chat bubble.
    # Amber note chrome is reserved for kind=internal_note.
    if direction == "internal" and resolved_kind == "internal_note":
        resolved_role = "system"
    else:
        resolved_role = "user"
    message = SignalMessage(
        signal_id=signal_id,
        tenant_id=tenant_id,
        kind=resolved_kind,
        direction=direction,
        role=resolved_role,
        author_user_id=user_id,
        from_address=delivered_from,
        to_addresses=delivered_to or to_override or signal.contact_email,
        external_id=provider_message_id,
        subject=subject_override or signal.subject,
        body_text=body_text,
        body_preview=clean_message_preview(body_text, limit=200),
        body_html=body_html or f"<p>{body_text}</p>",
        attachments_json=json.dumps(attachments or []),
        metadata_json=json.dumps(message_meta) if message_meta else "{}",
        send_status=send_status,
        send_after=(now + timedelta(seconds=send_after_seconds)) if scheduled else None,
        received_at=now,
    )
    session.add(message)
    await session.flush()
    # Operator/teammate Send interrupts an open handoff tree (not draft typing).
    try:
        from app.services.handoff_sessions import interrupt_handoff_session

        await interrupt_handoff_session(
            session,
            signal,
            by_message_id=message.id,
            reason="user_send",
        )
    except Exception:  # noqa: BLE001
        logger.debug("handoff interrupt on send failed", exc_info=True)
    signal.last_message_at = now
    signal.updated_at = now
    if direction == "outbound":
        signal.has_unread = False
    picked = False
    if direction == "outbound":
        from app.services.handover import apply_after_human_reply

        await _defer_open_reply_suggestions(session, tenant_id, signal_id)
        settled = await apply_after_human_reply(
            session, None, signal, user_id, handback=handback, via="reply"
        )
        picked = bool(settled.get("owner_changed"))
    if action == "send_and_close":
        from app.services.ai_handling import on_status_change

        signal.status = "closed"
        signal.has_unread = False
        on_status_change(session, signal, actor_id=str(user_id))
        from app.services.tickets import settle_ticket_on_close

        await settle_ticket_on_close(session, signal, actor_type="user", actor_id=str(user_id))
    elif action == "send_and_pending":
        # No park: the thread stays open and visible; a wait time becomes
        # its date, so it comes back unread when the customer stays quiet.
        if signal.status == "pending":
            signal.status = "open"
        signal.has_unread = True
        if snooze_minutes and snooze_minutes > 0:
            signal.next_at = utcnow() + timedelta(minutes=int(snooze_minutes))
    reopened_by_reply = False
    if direction == "outbound" and was_closed and action != "send_and_close" and signal.status == "closed":
        signal.status = "open"
        reopened_by_reply = True
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type=(
                "reply_sent"
                if direction == "outbound"
                else "note_added"
                if resolved_kind == "internal_note"
                else "team_message"
            ),
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps(
                {"action": action, **({"reopened": True} if reopened_by_reply else {})}
            ),
        )
    )
    if direction == "outbound":
        from app.services.deliveries import TARGET_REPLY, record_delivery

        await record_delivery(
            session,
            tenant_id,
            signal_id,
            target_kind=TARGET_REPLY,
            ref=str(message.id),
            channel=signal.channel,
            user_id=user_id,
        )
    await session.commit()
    await session.refresh(message)
    await publish_signal_message(signal, message)
    if picked or reopened_by_reply or action in ("send_and_close", "send_and_pending"):
        # Status or owner changed alongside the reply; widget conversations also need
        # the visitor-safe status event (e.g. to show the CSAT prompt).
        await publish_thread_update(signal)
    if action == "send_and_close":
        from app.services.webhooks import emit_webhook_event, signal_event_data

        await emit_webhook_event(session, tenant_id, "signal.closed", signal_event_data(signal))
    # @mentions in replies and internal notes notify the mentioned teammates.
    author_result = await session.execute(select(User).where(User.id == user_id))
    author = author_result.scalar_one_or_none()
    author_name = (author.display_name or author.email) if author else ""
    await notify_mentions(
        session,
        tenant_id,
        signal,
        body_text=body_text,
        author_user_id=user_id,
        author_name=author_name,
    )
    if not scheduled:
        from app.services.thread_dispatch import dispatch_mentions

        # Tagged agents, or the team router's pick, get a queued turn. Commit
        # so the worker can claim it.
        await dispatch_mentions(
            session,
            tenant_id,
            signal,
            body_text=body_text,
            author_user_id=user_id,
            author_name=author_name,
            user_role=actor_role,
        )
        await session.commit()
    return serialize_message(message)


async def deliver_due_outbound_messages(session: AsyncSession) -> int:
    """Deliver scheduled outbound messages whose send time passed (scheduler tick).

    Runs across all tenants. Failures mark the message `failed:*` so the
    operator sees it in the thread instead of a silent drop.
    """
    from app.channels import deliver_outbound

    now = utcnow()
    result = await session.execute(
        select(SignalMessage)
        .where(
            SignalMessage.send_status == "scheduled",
            SignalMessage.send_after.is_not(None),
            SignalMessage.send_after <= now,
        )
        .order_by(SignalMessage.send_after)
        .limit(25)
    )
    due = list(result.scalars().all())
    delivered = 0
    for message in due:
        signal = await session.get(Signal, message.signal_id)
        if not signal:
            message.send_status = "failed:thread_missing"
            session.add(message)
            continue
        meta: dict[str, Any] = {}
        try:
            meta = json.loads(message.metadata_json or "{}")
        except (TypeError, ValueError):
            meta = {}
        try:
            attachments = json.loads(message.attachments_json or "[]")
        except (TypeError, ValueError):
            attachments = []
        from app.services.signatures import resolve_from_display_name, resolve_signature_html

        send_as = "user" if message.author_user_id else "agent"
        signature_html = await resolve_signature_html(
            session,
            message.tenant_id,
            send_as=send_as,
            user_id=message.author_user_id,
            agent_id=message.author_agent_id or signal.agent_id,
            channel_account_id=signal.channel_account_id,
        )
        from_display_name = await resolve_from_display_name(
            session,
            message.tenant_id,
            send_as=send_as,
            user_id=message.author_user_id,
            agent_id=message.author_agent_id or signal.agent_id,
        )
        try:
            delivery = await deliver_outbound(
                session,
                signal,
                body_text=message.body_text,
                body_html=message.body_html or None,
                subject=str(meta.get("subject") or ""),
                to_address=str(meta.get("to") or "") or None,
                cc=meta.get("cc"),
                bcc=meta.get("bcc"),
                attachments=attachments or None,
                signature_html=signature_html,
                from_display_name=from_display_name,
                quoted_html=str(meta.get("quoted_html") or "") or None,
                suppress_threading=meta.get("reply_mode") == "forward",
            )
            status = delivery.status
            if delivery.body_html:
                message.body_html = delivery.body_html
            if delivery.from_address:
                message.from_address = delivery.from_address
            if delivery.to_address:
                message.to_addresses = delivery.to_address
            if delivery.provider_message_id:
                message.external_id = delivery.provider_message_id
        except Exception as exc:  # noqa: BLE001 — one bad message must not stall the queue
            logger.exception("Scheduled send failed for message %s", message.id)
            status = f"failed:{type(exc).__name__}"[:80]
        message.send_status = "sent" if status == "skipped" else status
        message.send_after = None
        session.add(message)
        delivered += 1
        await session.commit()
        await session.refresh(message)
        await publish_signal_message(signal, message)
    if due:
        await session.commit()
    return delivered


async def cancel_scheduled_message(
    session: AsyncSession,
    tenant_id: UUID,
    message_id: UUID,
) -> dict[str, Any] | None:
    """Soft undo: remove a still-scheduled outbound message before delivery.

    Returns the removed message's body so the composer can restore the draft,
    or None when the message is unknown or already (being) sent.
    """
    result = await session.execute(
        select(SignalMessage).where(
            SignalMessage.id == message_id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.send_status == "scheduled",
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        return None
    signal = await session.get(Signal, message.signal_id)
    body_text = message.body_text
    signal_id = message.signal_id
    await session.delete(message)
    if signal:
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant_id,
                event_type="scheduled_send_cancelled",
                actor_type="user",
                actor_id="",
                payload_json="{}",
            )
        )
    await session.commit()
    if signal:
        await publish_thread_update(signal)
    return {"signal_id": str(signal_id), "body_text": body_text}


# Mentions use a stable inline markup so plain text stays readable:
# "@[Jane Doe](user:123456)" where the id is the dashboard numeric user id.
MENTION_PATTERN = re.compile(r"@\[([^\]]+)\]\(user:(\d+)\)")


async def notify_mentions(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    body_text: str,
    author_user_id: UUID | None,
    author_name: str = "",
) -> list[UUID]:
    """Notify @[Name](user:id) mentions in a message (tier 1). Returns the people mentioned."""
    from app.services.notify import TIER_NOW, notify
    from app.services.signal_threads.serialize import _user_map

    mention_nums = {int(num) for _, num in MENTION_PATTERN.findall(body_text or "")}
    if not mention_nums:
        return []
    user_map = await _user_map(session, tenant_id)
    plain = MENTION_PATTERN.sub(lambda m: f"@{m.group(1)}", body_text or "")
    targets = [
        user_map[num]
        for num in sorted(mention_nums)
        if user_map.get(num) and user_map[num] != author_user_id
    ]
    if not targets:
        return []
    from app.services.notify import from_user

    payload: dict[str, Any] = {}
    if author_user_id:
        author = await session.get(User, author_user_id)
        mark = from_user(author)
        if mark:
            payload["from"] = mark
    await notify(
        session,
        tenant_id,
        kind="mention",
        recipients=targets,
        title=f"{author_name or 'A teammate'} mentioned you in {signal.subject or 'a conversation'}",
        body=plain[:300],
        tier=TIER_NOW,
        category="mentions",
        signal_id=signal.id,
        payload=payload or None,
    )
    return targets


# Rapid Ja/Nee on stacked proposals would otherwise spawn one agent turn each.
_AGENT_REPLY_COALESCE_S = 1.25
_pending_agent_replies: dict[UUID, Any] = {}
_pending_decision_outcomes: dict[UUID, list[dict[str, Any]]] = {}


def _schedule_agent_reply(
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    *,
    attachments: list[dict] | None = None,
    decision_outcomes: list[dict[str, Any]] | None = None,
) -> None:
    """Fire-and-forget agent reply on a fresh DB session (does not block HTTP).

    Multiple schedules for the same thread within ``_AGENT_REPLY_COALESCE_S``
    collapse into one wake (latest attachments win, decision outcomes add up).
    """
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("No running loop to schedule agent reply for %s", signal_id)
        return

    existing = _pending_agent_replies.pop(signal_id, None)
    if existing is not None:
        try:
            existing.cancel()
        except Exception:
            logger.debug("cancel coalesced agent reply task failed", exc_info=True)
    if decision_outcomes:
        _pending_decision_outcomes.setdefault(signal_id, []).extend(decision_outcomes)

    async def _run() -> None:
        from app.db.session import async_session_factory

        _pending_agent_replies.pop(signal_id, None)
        outcomes = _pending_decision_outcomes.pop(signal_id, [])
        async with async_session_factory() as bg_session:
            signal = await bg_session.get(Signal, signal_id)
            if not signal or signal.tenant_id != tenant_id:
                return
            await _generate_agent_reply(
                bg_session,
                tenant_id,
                user_id,
                signal,
                attachments=attachments,
                decision_outcomes=outcomes,
            )

    def _fire() -> None:
        task = loop.create_task(_run())
        task.add_done_callback(
            lambda t: logger.exception(
                "Background agent reply failed for %s", signal_id, exc_info=t.exception()
            )
            if not t.cancelled() and t.exception()
            else None
        )

    _pending_agent_replies[signal_id] = loop.call_later(_AGENT_REPLY_COALESCE_S, _fire)


async def _generate_agent_reply(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal: Signal,
    *,
    attachments: list[dict] | None = None,
    decision_outcomes: list[dict[str, Any]] | None = None,
) -> None:
    """Run the thread's agent and append its reply.

    Best-effort: the user's message is already committed, so any failure here
    is logged and swallowed rather than surfaced to the caller. Gateway events
    (agent.turn / agent.activity / message.delta / message) keep the open
    thread live; each chat bubble arrives as its own message.
    """
    from app.services.agent_turns import close_on_brief
    from app.services.assistant_threads import signal_chat_history
    from app.services.chat_runtime import build_agent_loop
    from app.services.participants import ensure_participant
    from app.services.signal_threads.decisions import (
        _decision_outcome_brief,
        _fill_silent_decision_follow_up,
    )
    from app.services.signal_threads.serialize import _resolve_thread_agent

    signal_id = signal.id
    agent = None
    agent_id: UUID | None = None
    try:
        # Auto-reply only when the thread explicitly involves an agent (pinned,
        # in the message history, or via its project) — the lead-agent fallback
        # would otherwise answer every bare internal thread.
        agent = await _resolve_thread_agent(
            session, tenant_id, signal, fallback_to_lead=False
        )
        if not agent or not agent.is_active:
            return
        agent_id = agent.id
        from app.services.workforce_runtime import mark_agent_activity

        await mark_agent_activity(
            session,
            agent,
            status="working",
            # Fixed label: subject on agent chats is often the last user line.
            summary="Replying",
            signal_id=signal.id,
        )
        await ensure_participant(
            session,
            signal,
            kind="agent",
            ref_id=agent.id,
            role="member",
            joined_via="thread_reply",
        )
        history = await signal_chat_history(session, signal_id, for_agent_id=agent.id)
        loop = build_agent_loop(
            session,
            tenant_id=tenant_id,
            user_id=user_id,
            agent=agent,
            signal_id=signal_id,
            trust="operator",
            surface="thread_reply",
        )
        tokens: dict = {"input_tokens": 0, "output_tokens": 0}
        thinking_meta = None
        from app.services.thread_schedule import rule_context

        context = await rule_context(session, signal)
        brief = _decision_outcome_brief(decision_outcomes) if decision_outcomes else ""
        history, brief = close_on_brief(history, brief)
        if brief:
            context = f"{context}\n\n{brief}" if context else brief
        async for event in loop.stream_chat(history, extra_context=context, attachments=attachments):
            if event["type"] == "done":
                tokens = event.get("usage", tokens)
                thinking_meta = loop.thinking_payload()
        final_meta: dict = {"usage": tokens}
        if thinking_meta:
            final_meta["thinking"] = thinking_meta
        saved = await loop.persist_turn(signal, final_metadata=final_meta)
        await _fill_silent_decision_follow_up(session, signal, saved, agent_id, decision_outcomes or [])
        await session.commit()
    except Exception:  # noqa: BLE001 - never break the user's reply
        await session.rollback()
        logger.exception("Failed to generate agent reply for signal %s", signal_id)
        if agent_id is not None and decision_outcomes:
            try:
                signal = await session.get(Signal, signal_id)
                if signal is not None and signal.tenant_id == tenant_id:
                    await _fill_silent_decision_follow_up(session, signal, [], agent_id, decision_outcomes)
            except Exception:  # noqa: BLE001
                logger.exception("Decision follow-up confirm failed for %s", signal_id)
    finally:
        if agent is not None:
            try:
                from app.services.workforce_runtime import mark_agent_activity

                await mark_agent_activity(session, agent, status="standby")
            except Exception:  # noqa: BLE001
                logger.exception("Failed to reset agent runtime after reply %s", signal_id)
