"""Helpers for chat-style messages on Signal threads (assistant + widget)."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_signal_message
from app.models.signal import Signal, SignalMessage


def serialize_chat_message(message: SignalMessage) -> dict[str, Any]:
    """Serialize a SignalMessage in the chat client shape."""
    return {
        "id": str(message.id),
        "role": message.role,
        "content": message.body_text,
        "attachments": json.loads(message.attachments_json or "[]"),
        "certainty": message.certainty,
        "auto_sent": message.auto_sent,
        "decision_request_id": str(message.decision_id) if message.decision_id else None,
        "created_at": message.created_at.isoformat(),
    }


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
) -> SignalMessage:
    now = datetime.utcnow()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
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
    "(names, preferences, commitments). Write 'none' if there are no durable facts.\n\n"
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
    existing = doc.content if doc else "# Long-term memory\n"
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
    llm = get_chat_provider(resolved.provider, resolved.api_key)
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


async def signal_chat_history(session: AsyncSession, signal_id: UUID) -> list[dict[str, Any]]:
    """Thread history in LLM message format, with old turns compacted to a summary."""
    result = await session.execute(
        select(SignalMessage)
        .where(SignalMessage.signal_id == signal_id)
        .order_by(SignalMessage.created_at)
    )
    history: list[dict[str, Any]] = []
    for m in result.scalars().all():
        if m.kind in ("system_event", "internal_note"):
            continue
        role = m.role if m.role in ("user", "assistant") else "user"
        if not m.body_text:
            continue
        history.append({"role": role, "content": m.body_text})

    signal = await session.get(Signal, signal_id)
    if signal is None:
        return history

    remaining = history[signal.compacted_count :]
    if len(remaining) > COMPACT_THRESHOLD:
        await _compact_signal_history(session, signal, remaining)
        remaining = history[signal.compacted_count :]

    if signal.compact_summary and signal.compacted_count:
        return [
            {"role": "user", "content": f"[Summary of earlier conversation]\n{signal.compact_summary}"},
            {"role": "assistant", "content": "Understood, continuing from that context."},
            *remaining,
        ]
    return remaining
