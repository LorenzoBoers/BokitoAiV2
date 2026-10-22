"""Complete inbound signal processing: agent reply persistence + external delivery."""

from __future__ import annotations

from app.core.time import utcnow

import json
import re
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.outbound import deliver_outbound
from app.models.agent import Agent
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.assistant_threads import append_signal_chat_message
from app.services.suggestion_format import (
    clean_chat_bubbles,
    format_customer_email_body,
    split_suggestion,
)


_SKIP_REPLIES = frozenset({"", "Done.", "HEARTBEAT_OK"})

# Meta / operator scaffolding that must never become a customer-facing draft.
_META_DRAFT_RE = re.compile(
    r"(?i)("
    r"conceptreactie staat klaar|nog niets verstuurd|via govern|"
    r"openstaande concepten|/decisions\b|beoordeel en verstuur|"
    r"do not repeat these instructions|teammate'?s request|"
    r"output only the customer-facing|"
    # The model analysing the mail instead of answering it.
    r"dit is een inkomende e-?mail|this is an (?:inbound|incoming) e-?mail|"
    r"\bis de afzender\b|\bis de klant\b|\bis the sender\b|\bis the customer\b|"
    r"\bNO_REPLY_NEEDED\b"
    r")"
)

# Channels where an approved/auto reply can be delivered to the external party
# (widget/chat visitors receive replies live via the gateway instead).
_DELIVERABLE_CHANNELS = ("email", "slack", "whatsapp")


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
    actions.append("look_at")
    return actions[:3]


def apply_suggested_actions(signal: Signal) -> None:
    signal.suggested_actions_json = json.dumps(compute_suggested_actions(signal))


def _suggestion_options(
    *,
    body_text: str,
    subject: str,
    to_address: str,
    internal_note: str = "",
    messages: list[str] | None = None,
) -> list[dict]:
    payload = {
        "body_text": body_text,
        "body": body_text,
        "subject": subject,
        "to": to_address,
        "signal_id": None,  # filled by caller
    }
    if messages and len(messages) > 1:
        # Chat channels: the card shows each bubble; approval sends them in order.
        payload["messages"] = list(messages)
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
    close the thread, plan a task, or keep it open.

    One outcome per read: a second call in the same run rewrites that card,
    and any other open outcome card on the thread is set aside. The card
    never notifies on its own; the conversation notice carries it.
    """
    text = (summary or "").strip() or "Automated notification; no reply needed."
    subject = signal.subject or "Automated message"

    same_run = await _open_run_card(session, tenant_id, signal.id, run_id, NO_REPLY_TITLE_SET)
    if same_run is not None:
        return await _rewrite_no_reply_card(session, signal, same_run, text, reason=reason)
    await supersede_open_outcomes(session, tenant_id, signal.id)

    options = [
        {
            "id": "close",
            "label": "Close thread",
            "action_type": "close_thread",
            "payload": {"signal_id": str(signal.id)},
        },
        {
            "id": "look_at",
            "label": "Plan task",
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

    from app.services.automated_mail import NO_REPLY_DECISION_TITLE
    from app.services.signal_decisions import create_decision

    decision, message = await create_decision(
        session,
        tenant_id,
        title=NO_REPLY_DECISION_TITLE,
        summary=text,
        options=options,
        user_id=signal.assigned_user_id,
        agent_id=agent.id if agent else None,
        signal_id=signal.id,
        project_id=signal.project_id,
        run_id=run_id,
        announce=False,
        notification_payload={
            "kind": "action_suggestion",
            "channel": signal.channel,
            "signal_id": str(signal.id),
            "reason": reason,
            "run_id": str(run_id) if run_id else None,
        },
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
    return {
        "suggestion": True,
        "kind": "action_suggestion",
        "reason": reason,
        "decision_id": str(decision.id),
        "message_id": str(message.id),
        "channel": signal.channel,
        "delivery": "no_reply_needed",
        "summary": text,
    }


NO_REPLY_TITLE_SET = ("No reply needed",)
# Why an open outcome card was set aside by a newer read of the thread.
SUPERSEDED_BY_NEWER_READ = "superseded_by_newer_read"


def _outcome_titles() -> tuple[str, ...]:
    from app.services.signal_threads import REPLY_SUGGESTION_TITLES

    return (*NO_REPLY_TITLE_SET, *REPLY_SUGGESTION_TITLES)


async def _open_run_card(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    run_id: UUID | None,
    titles: tuple[str, ...],
):
    """The open outcome card this run already raised on the thread, if any."""
    if run_id is None:
        return None
    from app.models.notification import DecisionRequest

    return (
        await session.execute(
            select(DecisionRequest)
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.signal_id == signal_id,
                DecisionRequest.run_id == run_id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.title.in_(titles),
            )
            .order_by(DecisionRequest.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def supersede_open_outcomes(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    titles: tuple[str, ...] | None = None,
) -> int:
    """Set aside open outcome cards (no reply needed, suggested reply) on a thread.

    A thread shows one live outcome: the newest read wins. The cards stay in
    the log as a muted line.
    """
    from app.gateway.publish import publish_decision
    from app.models.notification import DecisionRequest, Notification

    rows = (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.signal_id == signal_id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.platform_change_id.is_(None),
                DecisionRequest.title.in_(titles or _outcome_titles()),
            )
        )
    ).scalars().all()
    now = utcnow()
    for decision in rows:
        decision.status = "deferred"
        decision.resolved_at = now
        decision.chosen_option_id = SUPERSEDED_BY_NEWER_READ
        session.add(decision)
        if decision.notification_id:
            notif = await session.get(Notification, decision.notification_id)
            if notif is not None and notif.status == "unread":
                notif.status = "read"
                session.add(notif)
    if rows:
        await session.flush()
        for decision in rows:
            await publish_decision(
                tenant_id,
                decision_id=decision.id,
                status=decision.status,
                title=decision.title,
                signal_id=signal_id,
                payload={"chosen_option_id": SUPERSEDED_BY_NEWER_READ},
            )
    return len(rows)


async def run_outcome_card(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID, run_id: UUID
) -> tuple[SignalMessage | None, str]:
    """The live outcome card one inbound run left, and its delivery status."""
    from app.models.notification import DecisionRequest
    from app.services.signal_threads import REPLY_SUGGESTION_TITLES

    decision = (
        await session.execute(
            select(DecisionRequest)
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.signal_id == signal_id,
                DecisionRequest.run_id == run_id,
                DecisionRequest.status == "awaiting_human",
            )
            .order_by(DecisionRequest.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if decision is None:
        return None, ""
    if decision.title in NO_REPLY_TITLE_SET:
        status = "no_reply_needed"
    elif decision.title in REPLY_SUGGESTION_TITLES:
        status = "pending_approval"
    else:
        status = "pending_decision"
    card = await session.get(SignalMessage, decision.message_id) if decision.message_id else None
    return card, status


# Side actions of a read that render inside its outcome card, not as timeline lines.
FOLDABLE_EVENT_TYPES = ("thread_updated", "triaged")


async def fold_run_events(
    session: AsyncSession, signal_id: UUID, run_id: UUID, card_id: UUID
) -> int:
    """Mark this run's label and read events as part of its outcome card.

    The thread timeline skips folded events; the card's activity trail
    already lists the same steps.
    """
    rows = (
        await session.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == signal_id,
                SignalEvent.event_type.in_(FOLDABLE_EVENT_TYPES),
                SignalEvent.payload_json.like(f'%"run_id": "{run_id}"%'),
            )
        )
    ).scalars().all()
    for row in rows:
        try:
            payload = json.loads(row.payload_json or "{}")
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict) or payload.get("folded_into"):
            continue
        payload["folded_into"] = str(card_id)
        row.payload_json = json.dumps(payload)
        session.add(row)
    return len(rows)


async def _rewrite_no_reply_card(
    session: AsyncSession, signal: Signal, decision, text: str, *, reason: str
) -> dict:
    """Same run, same outcome: update the card in place instead of adding one."""
    from app.gateway.publish import publish_signal_message

    decision.summary = text
    session.add(decision)
    message = await session.get(SignalMessage, decision.message_id) if decision.message_id else None
    if message is not None:
        message.body_text = text
        message.body_preview = text[:200]
        session.add(message)
    await session.commit()
    if message is not None:
        await publish_signal_message(signal, message, decision=decision)
    return {
        "suggestion": True,
        "kind": "action_suggestion",
        "reason": reason,
        "decision_id": str(decision.id),
        "message_id": str(message.id) if message is not None else None,
        "channel": signal.channel,
        "delivery": "no_reply_needed",
        "summary": text,
        "updated": True,
    }


async def acknowledge_automated_mail(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    agent: Agent | None,
    *,
    summary: str,
    reason: str = "",
) -> dict:
    """Quietly note heuristic automated mail without blocking the attention queue.

    Newsletters, receipts, and no-reply senders used to create an awaiting
    "No reply needed" card for every message — that flooded Agents / Cockpit
    with hundreds of fake blockers. Operators still see a timeline note and
    can close or act from Open; learning rules remain the path to auto-close.
    """
    text = (summary or "").strip() or "Automated notification; no reply needed."
    apply_suggested_actions(signal)
    archived = await archive_automated_mail_if_enabled(session, tenant_id, signal)
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="no_reply_noted",
            actor_type="agent" if agent else "system",
            actor_id=str(agent.id) if agent else "",
            payload_json=json.dumps(
                {
                    "kind": "automated_mail",
                    "reason": reason,
                    "summary": text[:500],
                    "archived": archived,
                }
            ),
        )
    )
    await session.commit()
    if archived:
        from app.gateway.publish import publish_thread_update

        await publish_thread_update(signal)
    # The third automated thread from one sender earns a rule proposal on
    # this thread; before that, each message is just noted.
    from app.services.inbox_rules import maybe_suggest_bulk_sender_rule

    rule_suggestion = await maybe_suggest_bulk_sender_rule(
        session, tenant_id, signal, agent_id=agent.id if agent else None
    )
    if rule_suggestion:
        await session.commit()
    return {
        "suggestion": False,
        "kind": "automated_mail_ack",
        "reason": reason,
        "channel": signal.channel,
        "delivery": "archived" if archived else "no_reply_noted",
        "rule_suggested": bool(rule_suggestion),
    }


async def archive_automated_mail_if_enabled(
    session: AsyncSession, tenant_id: UUID, signal: Signal
) -> bool:
    """File an automated thread as closed + ``automated`` when the mailbox says so.

    The thread keeps its messages and stays searchable; it just leaves Open
    and lands under Closed with the tag, where a saved filter acts as the
    "Automated" folder. Returns True when the thread was archived.
    """
    if not signal.channel_account_id:
        return False
    from app.models.channel import ChannelAccount
    from app.services.email_sync import AUTOMATED_MAIL_TAG, account_archives_automated_mail

    account = await session.get(ChannelAccount, signal.channel_account_id)
    if account is None:
        return False
    try:
        settings = json.loads(account.settings_json or "{}")
    except (TypeError, json.JSONDecodeError):
        settings = {}
    if not account_archives_automated_mail(settings):
        return False
    from app.services.ai_handling import on_status_change
    from app.services.signal_tags import add_signal_tags

    if signal.status != "closed":
        signal.status = "closed"
        on_status_change(session, signal)
        from app.services.tickets import settle_ticket_on_close

        await settle_ticket_on_close(session, signal, actor_type="system", actor_id="automated_mail")
    signal.has_unread = False
    signal.updated_at = utcnow()
    await add_signal_tags(session, tenant_id, signal.id, [AUTOMATED_MAIL_TAG])
    return True


# The agent says this itself, in the workspace language. Not a system string.
_CHANNEL_NOT_READY_NOTE = {
    "nl": (
        "Ik heb geen antwoord voor de klant opgesteld, want dit kanaal kan nog niet versturen. "
        "Rond de setup af onder Instellingen → E-mail en berichten. "
        "Daarna kun je het overnemen of het gesprek weer aan mij geven."
    ),
    "en": (
        "I did not draft a reply for the customer, because this channel cannot send yet. "
        "Finish the setup under Settings → Email & messages. "
        "Then take over or hand the conversation back to me."
    ),
    "de": (
        "Ich habe keine Antwort für den Kunden entworfen, weil dieser Kanal noch nicht senden kann. "
        "Schließe die Einrichtung unter Einstellungen → E-Mail und Nachrichten ab. "
        "Danach kannst du übernehmen oder das Gespräch wieder an mich geben."
    ),
    "fr": (
        "Je n'ai pas rédigé de réponse pour le client, car ce canal ne peut pas encore envoyer. "
        "Termine la configuration sous Paramètres → E-mail et messages. "
        "Ensuite, tu peux reprendre ou me rendre la conversation."
    ),
    "es": (
        "No he redactado una respuesta para el cliente, porque este canal aún no puede enviar. "
        "Termina la configuración en Ajustes → Correo y mensajes. "
        "Después puedes retomarlo o devolverme la conversación."
    ),
}


async def _channel_not_ready_note(session: AsyncSession, tenant_id: UUID) -> str:
    from app.models.auth import Tenant
    from app.services.language import resolve_workspace_language

    lang = resolve_workspace_language(await session.get(Tenant, tenant_id))
    return _CHANNEL_NOT_READY_NOTE.get(lang, _CHANNEL_NOT_READY_NOTE["nl"])


async def acknowledge_channel_not_ready(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    agent: Agent | None,
    *,
    state: str = "",
    state_reason: str = "",
) -> dict:
    """Quiet exception when AI cannot reply because the channel cannot send.

    Matches the composer rule: no undeliverable drafts or auto-sends. Operators
    see an internal note plus a timeline event; no ``Send`` decision card.
    """
    reason = (state_reason or state or "cannot_send").strip()
    note = await _channel_not_ready_note(session, tenant_id)
    session.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant_id,
            kind="internal_note",
            direction="internal",
            role="assistant" if agent else "system",
            author_agent_id=agent.id if agent else None,
            body_text=note,
            body_preview=note[:200],
            received_at=utcnow(),
            metadata_json=json.dumps(
                {
                    "kind": "channel_not_ready",
                    "state": state,
                    "state_reason": state_reason,
                }
            ),
        )
    )
    apply_suggested_actions(signal)
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="channel_not_ready",
            actor_type="agent" if agent else "system",
            actor_id=str(agent.id) if agent else "",
            payload_json=json.dumps(
                {
                    "kind": "channel_not_ready",
                    "state": state,
                    "state_reason": state_reason,
                    "reason": reason,
                }
            ),
        )
    )
    await session.commit()
    from app.gateway.publish import publish_thread_update

    await publish_thread_update(signal)
    return {
        "suggestion": False,
        "kind": "channel_not_ready",
        "reason": reason,
        "channel": signal.channel,
        "delivery": "channel_not_ready",
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
    from app.services.signal_decisions import create_decision

    decision, message = await create_decision(
        session,
        tenant_id,
        title="Needs your attention",
        summary=text,
        options=options,
        user_id=signal.assigned_user_id,
        agent_id=agent.id if agent else None,
        signal_id=signal.id,
        project_id=signal.project_id,
        run_id=run_id,
        notification_payload={
            "kind": "needs_attention",
            "channel": signal.channel,
            "signal_id": str(signal.id),
            "run_id": str(run_id) if run_id else None,
        },
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


async def _defer_sibling_thread_suggestions(
    session: AsyncSession, tenant_id: UUID, signal: Signal
) -> None:
    """One live proposal per person.

    When the same contact also has an older conversation on another channel
    with an open reply suggestion, that card is set aside (``sibling_thread``)
    and points at this thread. Only threads whose last customer message is
    older than this thread's are touched: a newer sibling keeps its own card.
    """
    from app.services.related_conversations import sibling_signals
    from app.services.signal_threads import DEFER_SIBLING_THREAD, _defer_open_reply_suggestions

    async def last_inbound_at(target: Signal) -> datetime | None:
        # The customer's latest message, not last_message_at: cards and notes
        # bump that column without the person having said anything new.
        at = (
            await session.execute(
                select(func.max(SignalMessage.created_at)).where(
                    SignalMessage.signal_id == target.id,
                    SignalMessage.direction == "inbound",
                    SignalMessage.kind == "user_message",
                )
            )
        ).scalar_one_or_none()
        return at or target.created_at

    anchor = await last_inbound_at(signal)
    for other in await sibling_signals(session, signal):
        other_at = await last_inbound_at(other)
        if anchor is None or other_at is None or other_at > anchor:
            continue
        deferred = await _defer_open_reply_suggestions(
            session, tenant_id, other.id, reason=DEFER_SIBLING_THREAD, link_signal_id=signal.id
        )
        if deferred:
            session.add(
                SignalEvent(
                    signal_id=other.id,
                    tenant_id=tenant_id,
                    event_type="suggestion_deferred",
                    actor_type="system",
                    actor_id="",
                    payload_json=json.dumps(
                        {"reason": DEFER_SIBLING_THREAD, "superseded_by_signal_id": str(signal.id)}
                    ),
                )
            )


async def create_reply_suggestion(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    agent: Agent,
    *,
    reply_text: str,
    run_id: UUID | None = None,
    is_mock: bool = False,
    messages: list[str] | None = None,
    activity: list[dict] | None = None,
    announce: bool = True,
    reveal: bool = True,
) -> dict:
    """Persist an inline DecisionRequest for a drafted reply (suggest-only).

    ``announce=False`` on an inbound read: the conversation notice says the
    draft is ready, so the card does not notify on its own.

    Channel-agnostic: works for email, widget, chat, whatsapp, slack threads.
    Approving the `send` option executes the `send_reply` tool on the thread.
    Chat channels pass ``messages`` (the bubbles); the operator can edit or
    drop each one before approving. ``activity`` is the turn's tool/think trail
    so it stays above the proposal after the live stream ends.
    """
    text = (reply_text or "").strip()
    if text in _SKIP_REPLIES and not messages:
        return {"skipped": True, "reason": "empty"}

    bubbles: list[str] = []
    if messages and signal.channel != "email":
        bubbles, internal_note = clean_chat_bubbles(messages)
        bubbles = [b for b in bubbles if b not in _SKIP_REPLIES]
        if not bubbles:
            return {"skipped": True, "reason": "empty"}
        if any(looks_like_meta_draft(b) for b in bubbles):
            return {"skipped": True, "reason": "meta_draft"}
        text = "\n\n".join(bubbles)
    else:
        # The stored draft must be pure customer-facing text: strip research
        # preambles, internal note blocks, and model-written sign-offs (the
        # signature system appends exactly one signature at send time).
        parts = split_suggestion(text)
        text = parts.body
        internal_note = parts.internal_note
        if not text.strip():
            # Model returned only a team note (or empty). Persist the note so
            # operators still see the analysis; do not create a reply proposal
            # that would put INTERNAL_NOTE: into the composer.
            if internal_note:
                session.add(
                    SignalMessage(
                        signal_id=signal.id,
                        tenant_id=tenant_id,
                        kind="internal_note",
                        direction="internal",
                        role="assistant",
                        author_agent_id=agent.id,
                        body_text=internal_note,
                        body_preview=internal_note[:200],
                        received_at=utcnow(),
                    )
                )
                await session.commit()
                return {"skipped": True, "reason": "note_only", "internal_note": True}
            return {"skipped": True, "reason": "empty"}
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
        messages=bubbles,
    )
    for opt in options:
        if isinstance(opt.get("payload"), dict):
            opt["payload"]["signal_id"] = str(signal.id)

    from app.services.signal_threads import _defer_open_reply_suggestions

    # One open outcome per thread: a newer draft replaces the leftover card,
    # and a "no reply needed" card from an earlier read steps aside too.
    await _defer_open_reply_suggestions(session, tenant_id, signal.id)
    await supersede_open_outcomes(session, tenant_id, signal.id, titles=NO_REPLY_TITLE_SET)
    # One live proposal per person: older conversations with the same contact
    # on other channels drop their open draft in favour of this one.
    await _defer_sibling_thread_suggestions(session, tenant_id, signal)

    # Anchor the proposal to the inbound message it answers. When the contact
    # writes again, the composer can tell this draft is out of date. Only the
    # contact's own messages count: decision cards are stored as inbound rows
    # too, and anchoring on one of those made every fresh draft look stale.
    based_on = (
        await session.execute(
            select(SignalMessage.id)
            .where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.direction == "inbound",
                SignalMessage.kind == "user_message",
                SignalMessage.author_user_id.is_(None),
            )
            .order_by(SignalMessage.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    from app.services.signal_decisions import create_decision

    message_meta: dict = {}
    if based_on is not None:
        message_meta["based_on_message_id"] = str(based_on)
    if is_mock:
        message_meta["is_mock"] = True
        message_meta["llm_mode"] = "mock"
        message_meta["llm_configured"] = False
    if activity:
        message_meta["activity"] = activity

    decision, message = await create_decision(
        session,
        tenant_id,
        title="Suggested reply",
        summary=text,
        options=options,
        user_id=signal.assigned_user_id,
        agent_id=agent.id,
        signal_id=signal.id,
        project_id=signal.project_id,
        run_id=run_id,
        announce=announce,
        reveal=reveal,
        message_meta=message_meta or None,
        notification_payload={
            "kind": "reply_suggestion",
            "channel": signal.channel,
            "signal_id": str(signal.id),
            "run_id": str(run_id) if run_id else None,
            "is_mock": is_mock,
        },
    )
    if message is not None and message_meta:
        try:
            meta = json.loads(message.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if not isinstance(meta, dict):
            meta = {}
        meta.update(message_meta)
        if is_mock:
            message.auto_sent = False
        message.metadata_json = json.dumps(meta, default=str)
        session.add(message)

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
                    "message_id": str(message.id) if message is not None else None,
                    "run_id": str(run_id) if run_id else None,
                    "is_mock": is_mock,
                }
            ),
        )
    )
    await session.commit()

    return {
        "suggestion": True,
        "decision_id": str(decision.id),
        "message_id": str(message.id) if message is not None else None,
        "channel": signal.channel,
        "delivery": "pending_approval",
    }


async def _disclosure_line(session: AsyncSession, tenant_id: UUID, signal: Signal) -> str | None:
    """AI disclosure for an autonomous reply, in the customer-facing language."""
    from app.models.auth import Tenant
    from app.models.channel import ChannelAccount
    from app.services.ai_handling import disclosure_text
    from app.services.language import resolve_reply_language, resolve_workspace_language

    tenant = await session.get(Tenant, tenant_id)
    account = (
        await session.get(ChannelAccount, signal.channel_account_id)
        if signal.channel_account_id
        else None
    )
    language = resolve_reply_language(tenant, account)
    if language == "auto":
        language = resolve_workspace_language(tenant)
    return disclosure_text(tenant, language=language)


async def _deliver_chat_reply(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    agent: Agent,
    *,
    bubbles: list[dict],
    run_id: UUID | None,
    tokens: dict | None,
    is_mock_reply: bool,
) -> dict:
    """Autonomous chat-mode reply: each bubble is checked, saved and sent in
    order with a typing pause. A bubble that fails a check is dropped; a failed
    send stops the rest so the customer never gets a reply with a gap."""
    from app.services import ai_handling
    from app.services.agent.reply_mode import format_for_channel
    from app.services.agent.turn_persist import touch_agent_activity
    from app.services.chat_delivery import conversation_has_disclosure, pause_before

    texts, internal_note = clean_chat_bubbles([b["text"] for b in bubbles])
    texts = [t for t in texts if t not in _SKIP_REPLIES and not looks_like_meta_draft(t)]
    if not texts:
        return {"skipped": True, "reason": "meta_draft"}
    activity = [a for b in bubbles for a in (b.get("activity") or [])]

    if internal_note:
        session.add(
            SignalMessage(
                signal_id=signal.id,
                tenant_id=tenant_id,
                kind="internal_note",
                direction="internal",
                role="assistant",
                author_agent_id=agent.id,
                body_text=internal_note,
                body_preview=internal_note[:200],
                received_at=utcnow(),
            )
        )
        await session.flush()

    disclosure = None
    if not await conversation_has_disclosure(session, signal):
        disclosure = await _disclosure_line(session, tenant_id, signal)

    deliverable = signal.channel in _DELIVERABLE_CHANNELS and not is_mock_reply
    statuses: list[str] = []
    messages: list[SignalMessage] = []
    for index, text in enumerate(texts):
        if index:
            await pause_before(text)
        metadata: dict = {"inbound_auto_reply": True, "ai_handling": "autonomous"}
        if run_id:
            metadata["run_id"] = str(run_id)
        if len(texts) > 1:
            metadata["bubble_index"] = index
        if index == 0:
            if activity:
                metadata["activity"] = activity
            if disclosure:
                metadata["ai_disclosure"] = disclosure
        if index == len(texts) - 1 and tokens:
            metadata["usage"] = tokens
        if is_mock_reply:
            metadata.update({"is_mock": True, "llm_mode": "mock", "llm_configured": False})
        from app.services.chat_runtime import post_message

        message = await post_message(
            session,
            signal,
            content=text,
            role="assistant",
            trust="external",
            author_agent_id=agent.id,
            metadata=metadata,
        )
        messages.append(message)
        if is_mock_reply:
            statuses.append("not_delivered:mock")
            continue
        if not deliverable:
            # Widget / in-app: the visitor receives the bubble live via the gateway.
            statuses.append("skipped")
            continue
        delivery = await deliver_outbound(
            session,
            signal,
            body_text=format_for_channel(text, signal.channel),
            subject=f"Re: {signal.subject}" if signal.subject else "Reply",
        )
        message.send_status = delivery.status
        message.auto_sent = delivery.status.startswith("sent")
        session.add(message)
        statuses.append(delivery.status)
        if not message.auto_sent:
            break

    await touch_agent_activity(session, agent.id)
    apply_suggested_actions(signal)
    session.add(signal)
    final_status = statuses[-1] if statuses else "skipped"
    closed_by_policy = False
    if not is_mock_reply and statuses and all(s.startswith("sent") for s in statuses):
        closed_by_policy = await close_after_agent_reply(session, tenant_id, signal, agent)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="agent_replied",
            actor_type="agent",
            actor_id=str(agent.id),
            payload_json=json.dumps(
                {
                    "run_id": str(run_id) if run_id else None,
                    "delivery": final_status,
                    "messages": len(messages),
                    "is_mock": is_mock_reply,
                    "closed": closed_by_policy,
                }
            ),
        )
    )
    await session.commit()
    if closed_by_policy:
        from app.gateway.publish import publish_thread_update
        from app.services.webhooks import emit_webhook_event, signal_event_data

        await publish_thread_update(signal)
        await emit_webhook_event(session, tenant_id, "signal.closed", signal_event_data(signal))
    if not is_mock_reply:
        from app.models.auth import Tenant

        account, _contact = await ai_handling.load_layers(session, tenant_id, signal)
        await ai_handling.check_breaker(session, await session.get(Tenant, tenant_id), account)
    return {
        "message_id": str(messages[-1].id),
        "message_ids": [str(m.id) for m in messages],
        "delivery": final_status,
        "channel": signal.channel,
        "is_mock": is_mock_reply,
        "delivered_to_customer": not is_mock_reply
        and all(s.startswith("sent") for s in statuses),
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
    mode: str = "assisted",
    llm_live: bool | None = None,
    segments: list[dict] | None = None,
) -> dict:
    """Persist agent output on an inbound thread according to the AI handling.

    ``assisted`` creates an inline DecisionRequest for human approval;
    ``autonomous`` appends the reply and delivers it externally where supported.
    Email gets one message (mail mode); every other channel gets the final
    speech as several short bubbles (chat mode). ``segments`` is the turn
    (``AgentLoop.turn.segments``) so activity lands on the first bubble.

    When ``llm_live`` is False (mock / no key), never deliver externally and
    stamp the message so the timeline never labels it as sent to the customer.
    """
    from app.services import ai_handling
    from app.services.signal_threads import _is_placeholder_preview

    mode = ai_handling.normalize_mode(mode) or "assisted"
    text = (reply_text or "").strip()
    if text in _SKIP_REPLIES or ai_handling.is_held(signal):
        return {"skipped": True, "reason": "empty_or_manual"}

    if llm_live is None:
        # Infer from body when the caller did not pass the resolved model flag.
        is_mock_reply = _is_placeholder_preview(text)
    else:
        is_mock_reply = not llm_live or _is_placeholder_preview(text)

    # Defense in depth: never create a Send card or customer bubble when the
    # bound channel cannot deliver (composer already blocks the same way).
    if signal.channel in ("email", "slack", "whatsapp") and signal.channel_account_id:
        from app.models.channel import ChannelAccount
        from app.services.channel_registry import account_can_send, resolve_channel

        account = await session.get(ChannelAccount, signal.channel_account_id)
        if account is not None and not account_can_send(account):
            row = resolve_channel(account)
            return await acknowledge_channel_not_ready(
                session,
                tenant_id,
                signal,
                agent,
                state=str(row.get("state") or ""),
                state_reason=str(row.get("state_reason") or ""),
            )

    chat_bubbles: list[dict] = []
    if signal.channel != "email":
        from app.services.agent.turn_persist import plan_customer_bubbles

        chat_bubbles = plan_customer_bubbles(segments or [], fallback_text=text)

    if mode != "autonomous":
        from app.services.agent.turn_persist import activity_from_segments

        outcome = await create_reply_suggestion(
            session,
            tenant_id,
            signal,
            agent,
            reply_text=text,
            run_id=run_id,
            is_mock=is_mock_reply,
            messages=[b["text"] for b in chat_bubbles] or None,
            activity=activity_from_segments(segments) or None,
            announce=False,
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

    if chat_bubbles:
        return await _deliver_chat_reply(
            session,
            tenant_id,
            signal,
            agent,
            bubbles=chat_bubbles,
            run_id=run_id,
            tokens=tokens,
            is_mock_reply=is_mock_reply,
        )

    # Auto mode delivers straight to the customer: the same cleaning applies
    # (no research preamble, no internal notes, no model-written sign-off).
    parts = split_suggestion(text)
    text = parts.body
    if not text.strip():
        if parts.internal_note:
            session.add(
                SignalMessage(
                    signal_id=signal.id,
                    tenant_id=tenant_id,
                    kind="internal_note",
                    direction="internal",
                    role="assistant",
                    author_agent_id=agent.id,
                    body_text=parts.internal_note,
                    body_preview=parts.internal_note[:200],
                    received_at=utcnow(),
                )
            )
            await session.commit()
            return {"skipped": True, "reason": "note_only", "internal_note": True}
        return {"skipped": True, "reason": "empty"}
    if looks_like_meta_draft(text):
        return {"skipped": True, "reason": "meta_draft"}
    disclosure = await _disclosure_line(session, tenant_id, signal)
    if disclosure and signal.channel == "email":
        # One-line footer above the signature (the signature is appended at send).
        text = f"{text.rstrip()}\n\n{disclosure}"
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
            received_at=utcnow(),
        )
        session.add(note_message)
        await session.flush()

    metadata: dict = {"inbound_auto_reply": True, "ai_handling": "autonomous"}
    if segments:
        from app.services.agent.turn_persist import plan_turn_messages

        activity = plan_turn_messages(segments, "mail")[0]["activity"]
        if activity:
            metadata["activity"] = activity
    if disclosure:
        metadata["ai_disclosure"] = disclosure
    if run_id:
        metadata["run_id"] = str(run_id)
    if tokens:
        metadata["usage"] = tokens
    if is_mock_reply:
        metadata["is_mock"] = True
        metadata["llm_mode"] = "mock"
        metadata["llm_configured"] = False

    message = await append_signal_chat_message(
        session,
        signal,
        role="assistant",
        content=text,
        author_agent_id=agent.id,
        metadata=metadata,
    )

    delivery_status = "skipped"
    # Mock / placeholder replies must never leave the workspace as customer mail.
    if is_mock_reply:
        delivery_status = "not_delivered:mock"
        message.auto_sent = False
        session.add(message)
    elif signal.channel in _DELIVERABLE_CHANNELS:
        from app.services.signatures import resolve_from_display_name, resolve_signature_html

        # Auto mode sends carry the agent identity: agent signature, with the
        # mailbox signature as fallback.
        signature_html = await resolve_signature_html(
            session,
            tenant_id,
            send_as="agent",
            agent_id=agent.id,
            channel_account_id=signal.channel_account_id,
        )
        from_display_name = await resolve_from_display_name(
            session, tenant_id, send_as="agent", agent_id=agent.id
        )
        delivery = await deliver_outbound(
            session,
            signal,
            body_text=text,
            subject=f"Re: {signal.subject}" if signal.subject else "Reply",
            signature_html=signature_html,
            from_display_name=from_display_name,
        )
        delivery_status = delivery.status
        if delivery.body_html:
            message.body_html = delivery.body_html
            session.add(message)
        if delivery_status.startswith("sent"):
            message.auto_sent = True
            session.add(message)

    apply_suggested_actions(signal)
    session.add(signal)
    closed_by_policy = False
    if delivery_status.startswith("sent") and not is_mock_reply:
        closed_by_policy = await close_after_agent_reply(session, tenant_id, signal, agent)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="agent_replied",
            actor_type="agent",
            actor_id=str(agent.id),
            payload_json=json.dumps(
                {
                    "run_id": str(run_id) if run_id else None,
                    "delivery": delivery_status,
                    "is_mock": is_mock_reply,
                    "closed": closed_by_policy,
                }
            ),
        )
    )
    await session.commit()
    if closed_by_policy:
        from app.gateway.publish import publish_thread_update
        from app.services.webhooks import emit_webhook_event, signal_event_data

        await publish_thread_update(signal)
        await emit_webhook_event(session, tenant_id, "signal.closed", signal_event_data(signal))
    if not is_mock_reply:
        from app.models.auth import Tenant

        account, _contact = await ai_handling.load_layers(session, tenant_id, signal)
        await ai_handling.check_breaker(session, await session.get(Tenant, tenant_id), account)
    return {
        "message_id": str(message.id),
        "delivery": delivery_status,
        "channel": signal.channel,
        "is_mock": is_mock_reply,
        "closed": closed_by_policy,
        "delivered_to_customer": False if is_mock_reply else delivery_status.startswith("sent"),
    }


async def close_after_agent_reply(
    session: AsyncSession, tenant_id: UUID, signal: Signal, agent: Agent
) -> bool:
    """Close the conversation after a delivered autonomous reply when the
    channel's routing policy says so (``close_after_agent_reply``). A new
    customer message reopens it. Does not commit."""
    from app.models.auth import Tenant
    from app.services import ai_handling as handling_svc

    if signal.status == "closed":
        return False
    tenant = await session.get(Tenant, tenant_id)
    policy = await handling_svc.routing_for_signal(session, tenant, signal)
    if not policy.effective["close_after_agent_reply"]:
        return False
    signal.status = "closed"
    signal.has_unread = False
    signal.updated_at = utcnow()
    handling_svc.on_status_change(session, signal, actor_id=str(agent.id))
    from app.services.tickets import settle_ticket_on_close

    await settle_ticket_on_close(session, signal, actor_type="agent", actor_id=str(agent.id))
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="closed",
            actor_type="agent",
            actor_id=str(agent.id),
            payload_json=json.dumps({"via": "close_after_agent_reply"}),
        )
    )
    return True
