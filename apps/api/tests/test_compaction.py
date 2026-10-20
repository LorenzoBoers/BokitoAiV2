"""Thread history compaction: old turns summarized, durable facts flushed to memory."""

import pytest
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.signal import Signal, SignalMessage
from app.models.agent_context import SignalCompaction
from app.services.assistant_threads import signal_chat_history
from app.services.compaction import (
    COMPACT_THRESHOLD,
    KEEP_RECENT,
    TOO_OLD_PLACEHOLDER,
    TRIM_MARKER,
    PruningConfig,
    needs_compaction,
    prune_tool_results,
    split_compaction_output as _split_compaction_output,
    threshold_percent,
)


def test_split_compaction_output_sections():
    text = (
        "SUMMARY: User is planning a product launch in June.\n"
        "FACTS:\n- Launch date is June 15\n- Prefers email updates\n"
    )
    summary, facts = _split_compaction_output(text)
    assert "product launch" in summary
    assert facts == ["Launch date is June 15", "Prefers email updates"]


def test_split_compaction_output_no_sections():
    summary, facts = _split_compaction_output("Just a plain summary text.")
    assert summary == "Just a plain summary text."
    assert facts == []


def test_split_compaction_output_facts_none():
    summary, facts = _split_compaction_output("SUMMARY: Short chat.\nFACTS:\n- none\n")
    assert summary == "Short chat."
    assert facts == []


@pytest.mark.asyncio
async def test_long_thread_is_compacted(client, session_override):
    result = await session_override.execute(select(Tenant))
    tenant = result.scalars().first()
    signal = Signal(tenant_id=tenant.id, channel="assistant", subject="Long chat")
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    total = COMPACT_THRESHOLD + 10
    for i in range(total):
        role = "user" if i % 2 == 0 else "assistant"
        session_override.add(
            SignalMessage(
                signal_id=signal.id,
                tenant_id=tenant.id,
                role=role,
                kind="user_message" if role == "user" else "agent_message",
                body_text=f"Message number {i} about the ongoing project.",
            )
        )
    await session_override.commit()

    history = await signal_chat_history(session_override, signal.id)

    await session_override.refresh(signal)
    assert signal.compacted_count == total - KEEP_RECENT
    assert signal.compact_summary

    # Summary preamble (2 messages) + recent verbatim turns.
    assert len(history) == 2 + KEEP_RECENT
    assert history[0]["content"].startswith("[Summary of earlier conversation]")
    assert history[-1]["content"] == f"Message number {total - 1} about the ongoing project."

    rows = (
        await session_override.execute(select(SignalCompaction).where(SignalCompaction.signal_id == signal.id))
    ).scalars().all()
    assert len(rows) == 1
    assert (rows[0].from_index, rows[0].to_index, rows[0].trigger) == (0, total - KEEP_RECENT, "auto")


def test_token_threshold_triggers_before_message_count():
    big = [{"role": "user", "content": "x" * 4000} for _ in range(KEEP_RECENT + 2)]
    assert needs_compaction(big, window=16_000, percent=85)
    assert not needs_compaction(big, window=128_000, percent=85)
    assert not needs_compaction(big[:KEEP_RECENT], window=10, percent=85)


def test_threshold_percent_from_settings():
    import json

    assert threshold_percent(None) == 85
    tenant = Tenant(name="T", slug="t", settings_json=json.dumps({"session": {"auto_compact_threshold_percent": 60}}))
    assert threshold_percent(tenant) == 60


def _round(result: str) -> list[dict]:
    return [
        {"role": "assistant", "content": [{"type": "tool_use", "id": "t", "name": "x", "input": {}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": result}]},
    ]


def test_prune_tool_results_trims_then_clears():
    long = "a" * 1500 + "b" * 3000 + "c" * 1500
    messages = [{"role": "system", "content": "s"}]
    for _ in range(12):
        messages += _round(long)
    changed = prune_tool_results(messages, PruningConfig())
    results = [m["content"][0]["content"] for m in messages if m["role"] == "user"]
    # Oldest rounds (age >= 10) cleared, middle trimmed, last 3 untouched.
    assert results[0] == TOO_OLD_PLACEHOLDER and results[2] == TOO_OLD_PLACEHOLDER
    assert TRIM_MARKER in results[3] and results[3].startswith("a" * 1500) and results[3].endswith("c" * 1500)
    assert results[-3:] == [long, long, long]
    assert changed == 9
    assert prune_tool_results(messages, PruningConfig(enabled=False)) == 0


@pytest.mark.asyncio
async def test_short_thread_not_compacted(client, session_override):
    result = await session_override.execute(select(Tenant))
    tenant = result.scalars().first()
    signal = Signal(tenant_id=tenant.id, channel="assistant", subject="Short chat")
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    for i in range(4):
        session_override.add(
            SignalMessage(
                signal_id=signal.id,
                tenant_id=tenant.id,
                role="user" if i % 2 == 0 else "assistant",
                body_text=f"Hello {i}",
            )
        )
    await session_override.commit()

    history = await signal_chat_history(session_override, signal.id)
    assert len(history) == 4
    await session_override.refresh(signal)
    assert signal.compacted_count == 0
    assert signal.compact_summary == ""
