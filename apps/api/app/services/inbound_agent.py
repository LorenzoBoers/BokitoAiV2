"""Complete inbound signal processing: agent reply persistence + external delivery."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.outbound import deliver_outbound
from app.models.agent import Agent
from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalEvent
from app.services.assistant_threads import append_signal_chat_message


_SKIP_REPLIES = frozenset({"", "Done.", "HEARTBEAT_OK"})

# Channels where an approved/auto reply can be delivered to the external party
# (widget/chat visitors receive replies live via the gateway instead).
_DELIVERABLE_CHANNELS = ("email", "slack")


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
) -> list[dict]:
    payload = {
        "body_text": body_text,
        "body": body_text,
        "subject": subject,
        "to": to_address,
        "signal_id": None,  # filled by caller
    }
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

    subject = f"Re: {signal.subject}" if signal.subject else "Reply"
    options = _suggestion_options(
        body_text=text,
        subject=subject,
        to_address=signal.contact_email or "",
    )
    for opt in options:
        if isinstance(opt.get("payload"), dict):
            opt["payload"]["signal_id"] = str(signal.id)

    from app.services.notification_mail import decision_bell_status

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
        return await create_reply_suggestion(
            session,
            tenant_id,
            signal,
            agent,
            reply_text=text,
            run_id=run_id,
        )

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
        delivery_status = await deliver_outbound(
            session,
            signal,
            body_text=text,
            subject=f"Re: {signal.subject}" if signal.subject else "Reply",
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
