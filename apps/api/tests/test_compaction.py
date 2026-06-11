"""Thread history compaction: old turns summarized, durable facts flushed to memory."""

import pytest
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.signal import Signal, SignalMessage
from app.services.assistant_threads import (
    COMPACT_THRESHOLD,
    KEEP_RECENT,
    _split_compaction_output,
    signal_chat_history,
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
