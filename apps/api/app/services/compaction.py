"""Shortening long conversations for the model.

Derived from xai-org/grok-build (Apache-2.0); changes listed in docs/third_party/grok-build/CHANGES.md.

Two mechanisms, both only change what the model sees. The thread itself stays
complete.

1. Auto-compaction: once the model-eligible history of a conversation
   reaches ``auto_compact_threshold_percent`` (default 85) of the model's
   context window, or grows past ``COMPACT_THRESHOLD`` messages, the older
   part is summarized into ``Signal.compact_summary``. The last
   ``KEEP_RECENT`` messages always stay verbatim. Every compaction writes a
   ``SignalCompaction`` row.

2. Tool-result pruning inside one turn (``PruningConfig``): tool results
   older than ``keep_last_n_turns`` model rounds are trimmed to head + tail
   above ``soft_trim_threshold`` characters, and cleared entirely once they
   are ``hard_clear_age_turns`` rounds old.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal

logger = logging.getLogger(__name__)

DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT = 85
FALLBACK_CONTEXT_WINDOW = 128_000
COMPACT_THRESHOLD = 40
KEEP_RECENT = 12
CHARS_PER_TOKEN = 4

TOO_OLD_PLACEHOLDER = "[Tool result omitted — too old]"
TRIM_MARKER = "\n\n[…trimmed…]\n\n"


@dataclass(frozen=True)
class PruningConfig:
    enabled: bool = True
    keep_last_n_turns: int = 3
    soft_trim_threshold: int = 4000
    soft_trim_head: int = 1500
    soft_trim_tail: int = 1500
    hard_clear_age_turns: int = 10


def estimate_tokens(messages: list[dict[str, Any]]) -> int:
    total = 0
    for m in messages:
        content = m.get("content")
        if isinstance(content, str):
            total += len(content)
        else:
            try:
                total += len(json.dumps(content, default=str))
            except (TypeError, ValueError):
                total += len(str(content))
    return total // CHARS_PER_TOKEN


def threshold_percent(tenant: Any | None) -> int:
    from app.dependencies import tenant_settings

    if tenant is None:
        return DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT
    session_cfg = tenant_settings(tenant).get("session")
    raw = session_cfg.get("auto_compact_threshold_percent") if isinstance(session_cfg, dict) else None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT
    return max(10, min(100, value))


async def context_window_for(session: AsyncSession, model_slug: str | None = None) -> int:
    from app.models.model_catalog import ModelCatalog

    stmt = select(ModelCatalog.context_window).where(ModelCatalog.kind == "chat")
    if model_slug:
        stmt = stmt.where(ModelCatalog.slug == model_slug)
    else:
        stmt = stmt.where(ModelCatalog.is_default_chat.is_(True))
    try:
        window = (await session.execute(stmt.limit(1))).scalar_one_or_none()
    except Exception:
        window = None
    return int(window or 0) or FALLBACK_CONTEXT_WINDOW


def needs_compaction(history: list[dict[str, Any]], *, window: int, percent: int) -> bool:
    if len(history) <= KEEP_RECENT:
        return False
    if len(history) > COMPACT_THRESHOLD:
        return True
    return estimate_tokens(history) >= window * percent // 100


_COMPACTION_PROMPT = (
    "Summarize the earlier part of this conversation so an assistant can continue it.\n"
    "Respond in two sections:\n"
    "SUMMARY: a compact paragraph covering goals, decisions, and open items.\n"
    "FACTS: bullet list of durable facts worth remembering long-term "
    "(names, preferences, commitments). Write 'none' if there are no durable facts.\n"
    "Plain text only. Never use emoji or emoticons.\n\n"
    "Conversation:\n{transcript}"
)


def split_compaction_output(text: str) -> tuple[str, list[str]]:
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


async def compact_signal_history(
    session: AsyncSession,
    signal: Signal,
    history: list[dict[str, Any]],
    *,
    trigger: str = "auto",
    context_window: int = 0,
) -> None:
    """Summarize all but the last KEEP_RECENT messages into signal.compact_summary."""
    from app.models.agent_context import SignalCompaction
    from app.services.agent.llm import get_chat_provider
    from app.services.model_resolution import record_usage, resolve_model_call

    cutoff = len(history) - KEEP_RECENT
    if cutoff <= 0:
        return
    old_messages = history[:cutoff]
    transcript_parts = []
    if signal.compact_summary:
        transcript_parts.append(f"[Previous summary]\n{signal.compact_summary}")
    transcript_parts.extend(f"{m['role']}: {str(m['content'])[:600]}" for m in old_messages)
    transcript = "\n".join(transcript_parts)[-24000:]

    resolved = await resolve_model_call(session, signal.tenant_id, kind="chat")
    llm = get_chat_provider(resolved.provider_type, resolved.api_key, resolved.base_url or None)
    response = await llm.chat(
        [{"role": "user", "content": _COMPACTION_PROMPT.format(transcript=transcript)}],
        model=resolved.model_id,
    )
    usage = response.get("usage", {})
    await record_usage(
        session, signal.tenant_id, resolved,
        tokens_in=usage.get("input_tokens", 0), tokens_out=usage.get("output_tokens", 0),
        scope="chat", scope_id=str(signal.id), call_type="compaction",
    )
    text = "\n".join(b["text"] for b in response["content"] if b.get("type") == "text").strip()
    if not text:
        return
    summary, facts = split_compaction_output(text)
    await _flush_facts_to_memory(session, signal.tenant_id, facts)
    start = signal.compacted_count
    signal.compact_summary = summary
    signal.compacted_count = start + len(old_messages)
    session.add(signal)
    session.add(
        SignalCompaction(
            tenant_id=signal.tenant_id,
            signal_id=signal.id,
            from_index=start,
            to_index=signal.compacted_count,
            summary=summary,
            trigger=trigger,
            tokens_before=estimate_tokens(history),
            context_window=context_window,
        )
    )
    await session.commit()


async def maybe_compact(
    session: AsyncSession, signal: Signal, remaining: list[dict[str, Any]]
) -> bool:
    """Compact when the history crosses the threshold. True when a summary was written."""
    from app.models.auth import Tenant

    tenant = await session.get(Tenant, signal.tenant_id)
    window = await context_window_for(session)
    if not needs_compaction(remaining, window=window, percent=threshold_percent(tenant)):
        return False
    before = signal.compacted_count
    await compact_signal_history(session, signal, remaining, context_window=window)
    return signal.compacted_count != before


# --- Tool-result pruning inside one turn -----------------------------------


def _trim(text: str, config: PruningConfig) -> str:
    if len(text) <= config.soft_trim_threshold or TRIM_MARKER in text:
        return text
    return text[: config.soft_trim_head] + TRIM_MARKER + text[-config.soft_trim_tail :]


def prune_tool_results(llm_messages: list[dict[str, Any]], config: PruningConfig = PruningConfig()) -> int:
    """Trim or clear old tool results in place. Returns how many blocks changed.

    A turn here is one model round: an assistant message followed by the user
    message that carries its tool results.
    """
    if not config.enabled:
        return 0
    rounds = [i for i, m in enumerate(llm_messages) if m.get("role") == "assistant"]
    total = len(rounds)
    changed = 0
    for round_no, idx in enumerate(rounds):
        age = total - round_no
        if age <= config.keep_last_n_turns:
            continue
        if idx + 1 >= len(llm_messages):
            continue
        carrier = llm_messages[idx + 1]
        content = carrier.get("content")
        if carrier.get("role") != "user" or not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_result":
                continue
            current = block.get("content")
            if not isinstance(current, str):
                continue
            if age >= config.hard_clear_age_turns:
                new = TOO_OLD_PLACEHOLDER
            else:
                new = _trim(current, config)
            if new != current:
                block["content"] = new
                changed += 1
    return changed
