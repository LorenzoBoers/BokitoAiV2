"""Helpers for chat-style messages on Signal threads (assistant + widget)."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_signal_message
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.compaction import KEEP_RECENT, maybe_compact

logger = logging.getLogger(__name__)


def serialize_decision_for_chat(decision: Any) -> dict[str, Any]:
    """Compact decision shape for chat clients (card rendering + resolved state)."""
    try:
        options = json.loads(decision.options_json or "[]")
    except json.JSONDecodeError:
        options = []
    return {
        "id": str(decision.id),
        "status": decision.status,
        "title": decision.title,
        "summary": decision.summary,
        "options": [
            {
                "id": o.get("id"),
                "label": o.get("label"),
                "action_type": o.get("action_type"),
                # Provider slug lets chat clients show the integration's brand
                # logo on connect suggestions and deep-link into setup.
                "provider": (
                    (o.get("payload") or {}).get("provider")
                    if isinstance(o.get("payload"), dict)
                    else None
                ),
                "module": (
                    (o.get("payload") or {}).get("module")
                    if isinstance(o.get("payload"), dict)
                    else None
                ),
                # Full option payload so chat clients can summarize structured
                # proposals (accounting writes, calendar events) on the card.
                "payload": o.get("payload") if isinstance(o.get("payload"), dict) else None,
            }
            for o in options
            if isinstance(o, dict)
        ],
        "chosen_option_id": decision.chosen_option_id,
        "resolved_at": decision.resolved_at.isoformat() if decision.resolved_at else None,
    }


def serialize_chat_message(
    message: SignalMessage, decision: Any | None = None
) -> dict[str, Any]:
    """Serialize a SignalMessage in the chat client shape."""
    try:
        meta = json.loads(message.metadata_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    out: dict[str, Any] = {
        "id": str(message.id),
        "role": message.role,
        "kind": message.kind,
        "content": message.body_text,
        "attachments": json.loads(message.attachments_json or "[]"),
        "certainty": message.certainty,
        "auto_sent": message.auto_sent,
        "decision_request_id": str(message.decision_id) if message.decision_id else None,
        "created_at": message.created_at.isoformat(),
    }
    if decision is not None:
        out["decision"] = serialize_decision_for_chat(decision)
    from app.services.agent.turn_persist import message_activity

    usage = meta.get("usage")
    if isinstance(usage, dict) and usage:
        out["usage"] = usage
    for key, items in message_activity(meta, detail=True).items():
        if items:
            out[key] = items
    if isinstance(meta.get("items"), list) and meta["items"]:
        out["items"] = meta["items"]
    if meta.get("turn_id"):
        out["turn_id"] = meta["turn_id"]
    if meta.get("segment_id"):
        out["segment_id"] = meta["segment_id"]
    return out


async def append_signal_chat_message(
    session: AsyncSession,
    signal: Signal,
    *,
    role: str,
    content: str,
    author_user_id: UUID | None = None,
    author_agent_id: UUID | None = None,
    attachments: list[dict] | None = None,
    metadata: dict[str, Any] | None = None,
    decision_id: UUID | None = None,
    seq: int | None = None,
) -> SignalMessage:
    now = datetime.utcnow()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        seq=seq,
        kind="user_message" if role == "user" else "agent_message",
        direction="inbound" if role == "user" else "outbound",
        role=role,
        author_user_id=author_user_id,
        author_agent_id=author_agent_id,
        body_text=content,
        body_preview=content[:200],
        attachments_json=json.dumps(attachments or []),
        metadata_json=json.dumps(metadata or {}),
        decision_id=decision_id,
        received_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.updated_at = now
    meta = metadata or {}
    # Operator answers on decision cards are role=user but not customer mail.
    # Approving "Close thread" must not reopen the signal we just closed.
    is_decision_response = bool(meta.get("decision_response"))
    if (
        role == "user"
        and signal.channel != "assistant"
        and signal.status in ("pending", "closed")
        and not is_decision_response
    ):
        # A customer reply reopens a pending or closed thread,
        # matching the email inbound path in services/signals.py. Personal
        # assistant threads are excluded: there the "user" is the operator.
        signal.status = "open"
        signal.has_unread = True
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="reopened",
                actor_type="system",
                actor_id="",
                payload_json=json.dumps({"reopened_by": "customer_reply"}),
            )
        )
    session.add(signal)
    await session.flush()
    await publish_signal_message(signal, message)
    return message


def _from_customer(m: SignalMessage) -> bool:
    return m.direction == "inbound" and m.author_user_id is None and m.author_agent_id is None


async def context_thread_transcript(
    session: AsyncSession, signal_id: UUID, *, max_chars: int = 6000
) -> str:
    """Readable transcript of a thread for grounding assistant conversations."""
    signal = await session.get(Signal, signal_id)
    if signal is None:
        return ""
    result = await session.execute(
        select(SignalMessage)
        .where(SignalMessage.signal_id == signal_id)
        .order_by(SignalMessage.seq, SignalMessage.id)
    )
    lines: list[str] = []
    from app.services.assistant_context import conversation_filing_brief

    filing = await conversation_filing_brief(session, signal)
    header = (
        f"Thread: {signal.subject or '(no subject)'} | channel: {signal.channel} | "
        f"contact: {signal.contact_name or signal.contact_email or 'unknown'} | "
        f"status: {signal.status}\n"
        f"{filing}"
    )
    from app.models.signal import is_internal_channel
    from app.services.prompt_guard import fence
    from app.services.signals import message_plain_text

    customer_channel = not is_internal_channel(signal.channel)
    for m in result.scalars().all():
        body = message_plain_text(m)
        if m.kind == "system_event" or not body:
            continue
        if m.kind == "internal_note":
            speaker = "Internal note"
        elif m.direction == "inbound":
            speaker = signal.contact_name or "Customer"
            if customer_channel and _from_customer(m):
                body = fence(body, signal.channel)
        elif m.author_agent_id:
            speaker = "AI agent"
        else:
            speaker = "Team"
        lines.append(f"{speaker}: {body}")
    transcript = "\n".join(lines)
    if len(transcript) > max_chars:
        transcript = "...\n" + transcript[-max_chars:]
    return f"{header}\n---\n{transcript}"


async def _speaker_names(session: AsyncSession, rows: list[SignalMessage]) -> dict[UUID, str]:
    from app.models.agent import Agent
    from app.models.auth import User

    agent_ids = {m.author_agent_id for m in rows if m.author_agent_id}
    user_ids = {m.author_user_id for m in rows if m.author_user_id and not m.author_agent_id}
    names: dict[UUID, str] = {}
    if agent_ids:
        for agent_id, name in (
            await session.execute(select(Agent.id, Agent.name).where(Agent.id.in_(agent_ids)))
        ).all():
            names[agent_id] = name or "Agent"
    if user_ids:
        for user_id, display, email in (
            await session.execute(
                select(User.id, User.display_name, User.email).where(User.id.in_(user_ids))
            )
        ).all():
            names[user_id] = display or (email or "").split("@")[0] or "Colleague"
    return names


_DECISION_STATUS_NOTE = {
    "awaiting_human": "[Decision card, still waiting for the operator.]",
    "pending": "[Decision card, still waiting for the operator.]",
    "approved": "[Decision card, approved by the operator. Its action already ran; do not run it again.]",
    "rejected": "[Decision card, declined by the operator. Do not propose it again unless asked.]",
    "deferred": "[Decision card, set aside.]",
}


async def _decision_statuses(session: AsyncSession, ids: list[UUID]) -> dict[UUID, str]:
    """The card row is the log: its status tells the agent what the operator chose."""
    if not ids:
        return {}
    from app.models.notification import DecisionRequest

    rows = (
        await session.execute(
            select(DecisionRequest.id, DecisionRequest.status).where(DecisionRequest.id.in_(ids))
        )
    ).all()
    return {row_id: status for row_id, status in rows}


async def signal_chat_history(
    session: AsyncSession,
    signal_id: UUID,
    *,
    compact: bool = True,
    for_agent_id: UUID | None = None,
) -> list[dict[str, Any]]:
    """Thread history in LLM message format, with old turns compacted to a summary.

    ``compact=False`` skips the LLM summarize step (operator chat drive). A hung
    compaction used to block the first token on long threads.

    ``for_agent_id`` reads the thread as that agent: only its own messages are
    ``assistant``; people and other agents are ``user`` lines that start with
    their name, so the agent never takes a colleague's words for its own.
    """
    from app.services.signals import message_plain_text

    stmt = (
        select(SignalMessage)
        .where(SignalMessage.signal_id == signal_id)
        .order_by(
            SignalMessage.seq.desc() if not compact else SignalMessage.seq,
            SignalMessage.id.desc() if not compact else SignalMessage.id,
        )
    )
    if not compact:
        stmt = stmt.limit(KEEP_RECENT)
    result = await session.execute(stmt)
    rows = list(result.scalars().all())
    if not compact:
        rows.reverse()
    names = await _speaker_names(session, rows) if for_agent_id is not None else {}
    from app.models.signal import is_internal_channel
    from app.services.prompt_guard import fence

    signal = await session.get(Signal, signal_id)
    customer_channel = signal is not None and not is_internal_channel(signal.channel)
    card_status = await _decision_statuses(session, [m.decision_id for m in rows if m.decision_id])

    history: list[dict[str, Any]] = []
    for m in rows:
        if m.kind in ("system_event", "internal_note"):
            continue
        role = m.role if m.role in ("user", "assistant") else "user"
        body = message_plain_text(m)
        if customer_channel and body and _from_customer(m):
            body = fence(body, signal.channel)
        if for_agent_id is not None and body:
            if m.author_agent_id == for_agent_id:
                role = "assistant"
            else:
                role = "user"
                speaker = names.get(m.author_agent_id or m.author_user_id) if (m.author_agent_id or m.author_user_id) else None
                if speaker:
                    body = f"{speaker}: {body}"
        try:
            parsed_attachments = json.loads(m.attachments_json or "[]")
        except (TypeError, ValueError, json.JSONDecodeError):
            parsed_attachments = []
        attachments = [a for a in parsed_attachments if isinstance(a, dict)] if isinstance(parsed_attachments, list) else []
        if not body and not attachments:
            continue
        if not body:
            body = "The operator attached an image."
        # Operator Ja/Nee bubbles: tell the model the choice already applied so
        # the continue-after-decision wake confirms instead of re-doing the work.
        try:
            meta = json.loads(m.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if for_agent_id is not None and m.author_agent_id == for_agent_id and isinstance(meta, dict):
            peer_tool = next(
                (
                    item.get("tool")
                    for item in meta.get("activity") or []
                    if isinstance(item, dict) and item.get("tool") in ("ask_agent", "handoff_to")
                ),
                None,
            )
            if peer_tool:
                body = f"{body}\n[Sent with {peer_tool}.]"
        if m.kind == "decision_request" and m.decision_id in card_status:
            body = f"{body}\n{_DECISION_STATUS_NOTE.get(card_status[m.decision_id], '')}".rstrip()
        if isinstance(meta, dict) and meta.get("decision_response"):
            act = str(meta.get("decision_action") or "approve").lower()
            if act in ("reject", "rejected"):
                body = (
                    f"{body}\n\n[System] The operator declined this proposal. "
                    "Acknowledge briefly. Do not re-propose the same action unless they ask."
                )
            else:
                body = (
                    f"{body}\n\n[System] The operator approved this choice. Any linked "
                    "tool already ran. Confirm the outcome in one short message — do not "
                    "re-run the tool or ask again which item to change."
                )
        history.append({"role": role, "content": body, **({"attachments": attachments} if role == "user" and attachments else {})})

    if signal is None:
        return history

    remaining = history if not compact else history[signal.compacted_count :]
    if compact and len(remaining) > KEEP_RECENT:
        try:
            if await asyncio.wait_for(maybe_compact(session, signal, remaining), timeout=8):
                remaining = history[signal.compacted_count :]
        except TimeoutError:
            logger.warning(
                "chat history compaction timed out for signal %s; trimming instead",
                signal_id,
            )
            remaining = remaining[-KEEP_RECENT:]
        except Exception:
            # Compaction uses the chat LLM; billing/provider outages must not
            # 500 the whole conversation. Fall back to a hard trim.
            logger.exception(
                "chat history compaction failed for signal %s; trimming instead",
                signal_id,
            )
            remaining = remaining[-KEEP_RECENT:]

    if signal.compact_summary and signal.compacted_count:
        remaining = [
            {"role": "user", "content": f"[Summary of earlier conversation]\n{signal.compact_summary}"},
            {"role": "assistant", "content": "Understood, continuing from that context."},
            *remaining,
        ]

    # Ask-assistant conversations opened from a customer thread: inject the
    # live transcript of that thread so every turn stays grounded, plus what
    # the agent may do on it (tool calls default to that thread).
    if signal.context_signal_id:
        transcript = await context_thread_transcript(session, signal.context_signal_id)
        if transcript:
            intro = (
                "[Context] The teammate brought you into this customer "
                "conversation. Answer their question first, briefly. Do not "
                "invent filing, no-reply, or close work unless they asked you "
                "to handle the inbound, tidy labels, or mark no reply. The "
                "filing block lists this conversation's own labels, labels "
                "inherited from the contact, the label that has a flow, and "
                "the folder those tags resolve to. Only correct filing when "
                "it is wrong for the message or when the teammate asked to "
                "tidy. The folder name is not proof of what the mail is. "
                "Look things up when needed; propose a customer reply with "
                "suggest_thread_reply only when a reply is the asked or "
                "obvious next step; leave one team note with "
                "post_internal_note when colleagues need context. Do not "
                "file a second no-reply card, and do not narrate the same "
                "message in a card, a note, and a chat line. Your chat here "
                "stays internal — do not use suggest_thread_reply for notes "
                "meant only for the team.\n"
            )
            if signal.session_state == "active":
                intro += (
                    "This is an inline session on that conversation. The "
                    "transcript above is already in front of you: do not "
                    "announce that you are going to read or check it, and do "
                    "not narrate a step unless a tool call actually follows. "
                    "Answer directly and briefly (one or two short messages). "
                    "For a lookup about the contact or thread, look it up and "
                    "reply — do not also call note_no_reply. When a reply to "
                    "the contact is the obvious next step for their ask, "
                    "draft it with suggest_thread_reply right away instead of "
                    "asking whether you should. When you only need to leave "
                    "context for colleagues, call post_internal_note with no "
                    "signal_id (never pass this session's id). Never narrate "
                    "tool errors; retry correctly in the same turn. When you "
                    "have answered (or finished the asked work), call "
                    "propose_session_checkout with a short summary of what "
                    "you found or did — that closes the session. Do not ask "
                    "the teammate to close it.\n"
                )
            remaining = [
                {"role": "user", "content": intro + transcript},
                {"role": "assistant", "content": "Got it, I have the thread context."},
                *remaining,
            ]
    return remaining
