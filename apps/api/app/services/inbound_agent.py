"""Complete inbound signal processing: agent reply persistence + external delivery."""

from __future__ import annotations

import json
import re
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.outbound import deliver_outbound
from app.models.agent import Agent
from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.assistant_threads import append_signal_chat_message
from app.services.suggestion_format import format_customer_email_body, split_suggestion


_SKIP_REPLIES = frozenset({"", "Done.", "HEARTBEAT_OK"})

# Meta / operator scaffolding that must never become a customer-facing draft.
_META_DRAFT_RE = re.compile(
    r"(?i)("
    r"conceptreactie staat klaar|nog niets verstuurd|via govern|"
    r"openstaande concepten|/decisions\b|beoordeel en verstuur|"
    r"do not repeat these instructions|teammate'?s request|"
    r"output only the customer-facing"
    r")"
)

# Channels where an approved/auto reply can be delivered to the external party
# (widget/chat visitors receive replies live via the gateway instead).
_DELIVERABLE_CHANNELS = ("email", "slack")


def looks_like_empty_agent_ack(text: str | None) -> bool:
    """True when the model returned only Done./empty without a real draft."""
    return (text or "").strip() in _SKIP_REPLIES


def looks_like_meta_draft(text: str | None) -> bool:
    """True when the draft talks about the platform instead of the customer."""
    body = (text or "").strip()
    if not body:
        return False
    return bool(_META_DRAFT_RE.search(body))


def compute_suggested_actions(signal: Signal) -> list[str]:
    """Compact next-action chips for the thread header (max 3, no new model).

    Heuristic V1: after AI processing an operator typically resolves, claims,
    or converts the thread into work.
    """
    actions = ["close"]
    if not signal.assigned_user_id:
        actions.append("assign")
    actions.append("create_task")
    return actions[:3]


def apply_suggested_actions(signal: Signal) -> None:
    signal.suggested_actions_json = json.dumps(compute_suggested_actions(signal))


def _suggestion_options(
    *,
    body_text: str,
    subject: str,
    to_address: str,
    internal_note: str = "",
) -> list[dict]:
    payload = {
        "body_text": body_text,
        "body": body_text,
        "subject": subject,
        "to": to_address,
        "signal_id": None,  # filled by caller
    }
    if internal_note:
        # Team-facing context extracted from the model output; the decision
        # card shows it collapsed and it is never part of the outbound email.
        payload["internal_note"] = internal_note
    return [
        {
            "id": "send",
            "label": "Send",
            "action_type": "send_reply",
            "payload": dict(payload),
        },
        {
            "id": "edit",
            "label": "Edit",
            "action_type": "draft",
            "payload": dict(payload),
        },
        {
            "id": "escalate",
            "label": "Escalate",
            "action_type": "escalate",
            "payload": {},
        },
    ]


async def create_action_suggestion(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    agent: Agent | None,
    *,
    summary: str,
    reason: str = "",
    run_id: UUID | None = None,
) -> dict:
    """Persist an inline action DecisionRequest for mail that needs no reply.

    Automated / no-reply senders (system notifications, newsletters, bounces)
    must never get a drafted reply. Instead the operator gets a compact card:
    close the thread, turn it into a task, or keep it open.
    """
    text = (summary or "").strip() or "Automated notification; no reply needed."
    subject = signal.subject or "Automated message"

    options = [
        {
            "id": "close",
            "label": "Close thread",
            "action_type": "close_thread",
            "payload": {"signal_id": str(signal.id)},
        },
        {
            "id": "create_task",
            "label": "Create task",
            "action_type": "create_task",
            "payload": {"title": f"Follow up: {subject}"[:120], "description": text},
        },
        {
            "id": "keep_open",
            "label": "Keep open",
            "action_type": "defer",
            "payload": {},
        },
    ]
    if signal.project_id:
        # Project thread: the notification may be work in disguise — offer to
        # queue it on the project alongside the generic task option.
        options.insert(
            2,
            {
                "id": "add_to_queue",
                "label": "Add to project queue",
                "action_type": "create_queue_item",
                "payload": {
                    "project_id": str(signal.project_id),
                    "kind": "task",
                    "title": f"Follow up: {subject}"[:120],
                    "body": text,
                },
            },
        )

    from app.services.notification_mail import decision_bell_status

    notification = Notification(
        tenant_id=tenant_id,
        user_id=signal.assigned_user_id,
        kind="decision_request",
        title="No reply needed",
        body=text[:500],
        status=await decision_bell_status(session, tenant_id, signal.assigned_user_id),
        payload_json=json.dumps(
            {
                "kind": "action_suggestion",
                "channel": signal.channel,
                "signal_id": str(signal.id),
                "reason": reason,
                "run_id": str(run_id) if run_id else None,
            }
        ),
    )
    session.add(notification)
    await session.flush()

    decision = DecisionRequest(
        tenant_id=tenant_id,
        notification_id=notification.id,
        title="No reply needed",
        summary=text,
        options_json=json.dumps(options),
        status="awaiting_human",
        project_id=signal.project_id,
    )
    session.add(decision)
    await session.flush()

    from app.services.signal_decisions import ingest_decision_request

    message = await ingest_decision_request(
        session,
        tenant_id,
        notification,
        decision,
        user_id=signal.assigned_user_id,
        agent_id=agent.id if agent else None,
        signal_id=signal.id,
    )
    apply_suggested_actions(signal)
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="suggestion_created",
            actor_type="agent" if agent else "system",
            actor_id=str(agent.id) if agent else "",
            payload_json=json.dumps(
                {
                    "decision_id": str(decision.id),
                    "message_id": str(message.id),
                    "kind": "action_suggestion",
                    "reason": reason,
                    "run_id": str(run_id) if run_id else None,
                }
            ),
        )
    )
    await session.commit()
    # Deliberately no email notification: emailing a human about an automated
    # notification that needs no reply would just move the noise around.
    return {
        "suggestion": True,
        "kind": "action_suggestion",
        "reason": reason,
        "decision_id": str(decision.id),
        "message_id": str(message.id),
        "channel": signal.channel,
        "delivery": "no_reply_needed",
    }


async def create_human_attention_suggestion(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    agent: Agent | None,
    *,
    summary: str,
    run_id: UUID | None = None,
) -> dict:
    """Inline decision when the agent finished without a draft or choice card.

    Avoids a silent ``Done.`` that leaves the operator with no next step on
    urgent / ambiguous customer mail.
    """
    text = (summary or "").strip() or (
        "The agent finished without a draft. Choose how to continue."
    )
    options = [
        {
            "id": "escalate",
            "label": "I'll handle it myself",
            "action_type": "escalate",
            "payload": {},
        },
        {
            "id": "custom",
            "label": "Instruct the agent",
            "action_type": "acknowledge",
            "input_type": "text",
            "input_placeholder": "e.g. Draft a short confirmation that we will call today",
        },
    ]
    from app.services.notification_mail import decision_bell_status
    from app.services.signal_decisions import ingest_decision_request

    notification = Notification(
        tenant_id=tenant_id,
        user_id=signal.assigned_user_id,
        kind="decision_request",
        title="Needs your attention",
        body=text[:500],
        status=await decision_bell_status(session, tenant_id, signal.assigned_user_id),
        payload_json=json.dumps(
            {
                "kind": "needs_attention",
                "channel": signal.channel,
                "signal_id": str(signal.id),
                "run_id": str(run_id) if run_id else None,
            }
        ),
    )
    session.add(notification)
    await session.flush()

    decision = DecisionRequest(
        tenant_id=tenant_id,
        notification_id=notification.id,
        title="Needs your attention",
        summary=text,
        options_json=json.dumps(options),
        status="awaiting_human",
        project_id=signal.project_id,
    )
    session.add(decision)
    await session.flush()

    message = await ingest_decision_request(
        session,
        tenant_id,
        notification,
        decision,
        user_id=signal.assigned_user_id,
        agent_id=agent.id if agent else None,
        signal_id=signal.id,
    )
    apply_suggested_actions(signal)
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="suggestion_created",
            actor_type="agent" if agent else "system",
            actor_id=str(agent.id) if agent else "",
            payload_json=json.dumps(
                {
                    "decision_id": str(decision.id),
                    "message_id": str(message.id),
                    "kind": "needs_attention",
                    "run_id": str(run_id) if run_id else None,
                }
            ),
        )
    )
    await session.commit()
    return {
        "suggestion": True,
        "kind": "needs_attention",
        "decision_id": str(decision.id),
        "message_id": str(message.id),
        "channel": signal.channel,
        "delivery": "pending_decision",
    }


async def create_reply_suggestion(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    agent: Agent,
    *,
    reply_text: str,
    run_id: UUID | None = None,
) -> dict:
    """Persist an inline DecisionRequest for a drafted reply (suggest-only).

    Channel-agnostic: works for email, widget, chat, whatsapp, slack threads.
    Approving the `send` option executes the `send_reply` tool on the thread.
    """
    text = (reply_text or "").strip()
    if text in _SKIP_REPLIES:
        return {"skipped": True, "reason": "empty"}

    # The stored draft must be pure customer-facing text: strip research
    # preambles, internal note blocks, and model-written sign-offs (the
    # signature system appends exactly one signature at send time).
    parts = split_suggestion(text)
    text = parts.body
    internal_note = parts.internal_note
    if looks_like_meta_draft(text):
        return {"skipped": True, "reason": "meta_draft"}
    # Customer drafts may cite /docs/... as in-app markdown; rewrite to
    # absolute URLs so the card and outbound mail stay clickable outside Bokito.
    if signal.channel == "email":
        text, _html = format_customer_email_body(text)

    subject = f"Re: {signal.subject}" if signal.subject else "Reply"
    options = _suggestion_options(
        body_text=text,
        subject=subject,
        to_address=signal.contact_email or "",
        internal_note=internal_note,
    )
    for opt in options:
        if isinstance(opt.get("payload"), dict):
            opt["payload"]["signal_id"] = str(signal.id)

    from app.services.notification_mail import decision_bell_status
    from app.services.signal_threads import _defer_open_reply_suggestions

    # One open suggestion per thread: a newer draft replaces the leftover card.
    await _defer_open_reply_suggestions(session, tenant_id, signal.id)

    notification = Notification(
        tenant_id=tenant_id,
        user_id=signal.assigned_user_id,
        kind="decision_request",
        title="Suggested reply",
        body=text[:500],
        status=await decision_bell_status(session, tenant_id, signal.assigned_user_id),
        payload_json=json.dumps(
            {
                "kind": "reply_suggestion",
                "channel": signal.channel,
                "signal_id": str(signal.id),
                "run_id": str(run_id) if run_id else None,
            }
        ),
    )
    session.add(notification)
    await session.flush()

    decision = DecisionRequest(
        tenant_id=tenant_id,
        notification_id=notification.id,
        title="Suggested reply",
        summary=text,
        options_json=json.dumps(options),
        status="awaiting_human",
        project_id=signal.project_id,
    )
    session.add(decision)
    await session.flush()

    from app.services.signal_decisions import ingest_decision_request

    message = await ingest_decision_request(
        session,
        tenant_id,
        notification,
        decision,
        user_id=signal.assigned_user_id,
        agent_id=agent.id,
        signal_id=signal.id,
    )

    apply_suggested_actions(signal)
    # Team-facing remarks stay on the decision option payload (`internal_note`)
    # and render under the draft card — do not dual-write a timeline note that
    # would truncate and duplicate the same text.
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="suggestion_created",
            actor_type="agent",
            actor_id=str(agent.id),
            payload_json=json.dumps(
                {
                    "decision_id": str(decision.id),
                    "message_id": str(message.id),
                    "run_id": str(run_id) if run_id else None,
                }
            ),
        )
    )
    await session.commit()

    # Assigned owner opted into email for decisions: deliver a copy via SMTP.
    if signal.assigned_user_id:
        from app.services.notification_mail import (
            notification_channels,
            send_notification_mail,
            thread_link,
        )

        channels = await notification_channels(
            session, tenant_id, signal.assigned_user_id, "decisions"
        )
        if channels["email"]:
            await send_notification_mail(
                session,
                signal.assigned_user_id,
                subject=f"Decision needed: {signal.subject or 'a conversation'}",
                text=(
                    f"An agent drafted a reply on {signal.subject or 'a conversation'} "
                    "and needs your approval.\n\n"
                    f"{text[:500]}\n\n"
                    f"Review and decide:\n{thread_link(signal.id)}"
                ),
                tenant_id=tenant_id,
            )

    return {
        "suggestion": True,
        "decision_id": str(decision.id),
        "message_id": str(message.id),
        "channel": signal.channel,
        "delivery": "pending_approval",
    }


async def persist_inbound_agent_reply(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    agent: Agent,
    *,
    reply_text: str,
    run_id: UUID | None = None,
    tokens: dict | None = None,
    mode: str = "suggest",
) -> dict:
    """Persist agent output on an inbound thread according to the AI mode.

    ``suggest`` creates an inline DecisionRequest for human approval;
    ``auto`` appends the reply and delivers it externally where supported.
    """
    text = (reply_text or "").strip()
    if text in _SKIP_REPLIES or signal.ai_paused:
        return {"skipped": True, "reason": "empty_or_paused"}

    if mode == "suggest":
        outcome = await create_reply_suggestion(
            session,
            tenant_id,
            signal,
            agent,
            reply_text=text,
            run_id=run_id,
        )
        if outcome.get("reason") == "meta_draft":
            return await create_human_attention_suggestion(
                session,
                tenant_id,
                signal,
                agent,
                summary=(
                    "The agent produced platform meta-text instead of a customer "
                    "reply. Take over, or instruct the agent what to draft."
                ),
                run_id=run_id,
            )
        return outcome

    # Auto mode delivers straight to the customer: the same cleaning applies
    # (no research preamble, no internal notes, no model-written sign-off).
    parts = split_suggestion(text)
    text = parts.body
    if looks_like_meta_draft(text):
        return {"skipped": True, "reason": "meta_draft"}
    if signal.channel == "email":
        text, _html = format_customer_email_body(text)
    if parts.internal_note:
        note_message = SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant_id,
            kind="internal_note",
            direction="internal",
            role="assistant",
            author_agent_id=agent.id,
            body_text=parts.internal_note,
            body_preview=parts.internal_note[:200],
            received_at=datetime.utcnow(),
        )
        session.add(note_message)
        await session.flush()

    metadata: dict = {"inbound_auto_reply": True}
    if run_id:
        metadata["run_id"] = str(run_id)
    if tokens:
        metadata["usage"] = tokens

    message = await append_signal_chat_message(
        session,
        signal,
        role="assistant",
        content=text,
        author_agent_id=agent.id,
        metadata=metadata,
    )

    delivery_status = "skipped"
    if signal.channel in _DELIVERABLE_CHANNELS:
        from app.services.signatures import resolve_signature_html

        # Auto mode sends carry the agent identity: agent signature, with the
        # mailbox signature as fallback.
        signature_html = await resolve_signature_html(
            session, tenant_id, send_as="agent", agent_id=agent.id
        )
        delivery_status = await deliver_outbound(
            session,
            signal,
            body_text=text,
            subject=f"Re: {signal.subject}" if signal.subject else "Reply",
            signature_html=signature_html,
        )
        if delivery_status.startswith("sent"):
            message.auto_sent = True
            session.add(message)

    apply_suggested_actions(signal)
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="agent_replied",
            actor_type="agent",
            actor_id=str(agent.id),
            payload_json=json.dumps(
                {"run_id": str(run_id) if run_id else None, "delivery": delivery_status}
            ),
        )
    )
    await session.commit()
    return {
        "message_id": str(message.id),
        "delivery": delivery_status,
        "channel": signal.channel,
    }
