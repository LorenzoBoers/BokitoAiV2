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
    if meta.get("in_progress"):
        out["in_progress"] = True
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


# Compact once a thread grows past this many LLM-eligible messages; the most
# recent KEEP_RECENT turns always stay verbatim.
COMPACT_THRESHOLD = 40
KEEP_RECENT = 12

_COMPACTION_PROMPT = (
    "Summarize the earlier part of this conversation so an assistant can continue it.\n"
    "Respond in two sections:\n"
    "SUMMARY: a compact paragraph covering goals, decisions, and open items.\n"
    "FACTS: bullet list of durable facts worth remembering long-term "
    "(names, preferences, commitments). Write 'none' if there are no durable facts.\n"
    "Plain text only. Never use emoji or emoticons.\n\n"
    "Conversation:\n{transcript}"
)


def _split_compaction_output(text: str) -> tuple[str, list[str]]:
    summary = text.strip()
    facts: list[str] = []
    upper = text.upper()
    if "FACTS:" in upper:
        idx = upper.index("FACTS:")
        summary = text[:idx].replace("SUMMARY:", "").strip()
        for line in text[idx + len("FACTS:") :].splitlines():
            item = line.strip().lstrip("-*").strip()
            if item and item.lower() != "none":
                facts.append(item)
    elif "SUMMARY:" in upper:
        summary = text[upper.index("SUMMARY:") + len("SUMMARY:") :].strip()
    return summary, facts


async def _flush_facts_to_memory(session: AsyncSession, tenant_id: UUID, facts: list[str]) -> None:
    from app.services.workspace import get_doc_by_path, upsert_doc

    if not facts:
        return
    doc = await get_doc_by_path(session, tenant_id, "memory.md")
    existing = doc.content if doc else "# What we remember\n"
    new_lines = [f"- {fact}" for fact in facts if fact not in existing]
    if not new_lines:
        return
    stamp = datetime.utcnow().strftime("%Y-%m-%d")
    content = existing.rstrip() + f"\n\n## Conversation notes ({stamp})\n" + "\n".join(new_lines) + "\n"
    await upsert_doc(
        session,
        tenant_id,
        path="memory.md",
        content=content,
        kind="memory",
        created_by_type="system",
        commit=False,
    )


async def _compact_signal_history(
    session: AsyncSession, signal: Signal, history: list[dict[str, Any]]
) -> None:
    """Summarize old turns into signal.compact_summary, flushing durable facts first."""
    from app.services.agent.llm import get_chat_provider
    from app.services.model_resolution import record_usage, resolve_model_call

    cutoff = len(history) - KEEP_RECENT
    old_messages = history[:cutoff]
    transcript_parts = []
    if signal.compact_summary:
        transcript_parts.append(f"[Previous summary]\n{signal.compact_summary}")
    transcript_parts.extend(f"{m['role']}: {m['content'][:600]}" for m in old_messages)
    transcript = "\n".join(transcript_parts)[-24000:]

    resolved = await resolve_model_call(session, signal.tenant_id, kind="chat")
    llm = get_chat_provider(
        resolved.provider_type, resolved.api_key, resolved.base_url or None
    )
    response = await llm.chat(
        [{"role": "user", "content": _COMPACTION_PROMPT.format(transcript=transcript)}],
        model=resolved.model_id,
    )
    _usage = response.get("usage", {})
    await record_usage(
        session, signal.tenant_id, resolved,
        tokens_in=_usage.get("input_tokens", 0), tokens_out=_usage.get("output_tokens", 0),
        scope="chat", scope_id=str(signal.id), call_type="compaction",
    )
    text = "\n".join(b["text"] for b in response["content"] if b.get("type") == "text").strip()
    if not text:
        return
    summary, facts = _split_compaction_output(text)
    await _flush_facts_to_memory(session, signal.tenant_id, facts)
    signal.compact_summary = summary
    signal.compacted_count = signal.compacted_count + len(old_messages)
    session.add(signal)
    await session.commit()


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
    from app.services.signals import message_plain_text

    for m in result.scalars().all():
        body = message_plain_text(m)
        if m.kind == "system_event" or not body:
            continue
        if m.kind == "internal_note":
            speaker = "Internal note"
        elif m.direction == "inbound":
            speaker = signal.contact_name or "Customer"
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

    history: list[dict[str, Any]] = []
    for m in rows:
        if m.kind in ("system_event", "internal_note"):
            continue
        role = m.role if m.role in ("user", "assistant") else "user"
        body = message_plain_text(m)
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
        if isinstance(meta, dict) and meta.get("decision_outcome_hint"):
            # Already a full [System] hint written at resolve time.
            history.append({"role": "user", "content": body})
            continue
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

    signal = await session.get(Signal, signal_id)
    if signal is None:
        return history

    remaining = history if not compact else history[signal.compacted_count :]
    if compact and len(remaining) > COMPACT_THRESHOLD:
        try:
            await asyncio.wait_for(
                _compact_signal_history(session, signal, remaining),
                timeout=8,
            )
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
