"""Cycle 11: Ask-assistant conversations are grounded in the source thread."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.signal import Signal, SignalMessage
from app.services.assistant_threads import context_thread_transcript, signal_chat_history


async def _make_customer_thread(session: AsyncSession, tenant_id) -> Signal:
    thread = Signal(
        tenant_id=tenant_id,
        channel="email",
        source="test",
        subject="Broken charger",
        contact_name="Alice",
        contact_email="alice@example.com",
    )
    session.add(thread)
    await session.flush()
    session.add(
        SignalMessage(
            signal_id=thread.id,
            tenant_id=tenant_id,
            kind="user_message",
            direction="inbound",
            role="user",
            body_text="My charger stopped working after two days.",
        )
    )
    session.add(
        SignalMessage(
            signal_id=thread.id,
            tenant_id=tenant_id,
            kind="user_message",
            direction="outbound",
            role="user",
            body_text="Sorry to hear that! Could you share the order number?",
        )
    )
    session.add(
        SignalMessage(
            signal_id=thread.id,
            tenant_id=tenant_id,
            kind="internal_note",
            direction="internal",
            role="system",
            body_text="Known battery batch issue, replace immediately.",
        )
    )
    await session.commit()
    return thread


@pytest.mark.asyncio
async def test_context_transcript_includes_speakers(session_override: AsyncSession):
    tenant = Tenant(slug="ctx", name="Ctx")
    session_override.add(tenant)
    await session_override.commit()
    thread = await _make_customer_thread(session_override, tenant.id)

    transcript = await context_thread_transcript(session_override, thread.id)
    assert "Broken charger" in transcript
    assert "Alice: My charger stopped working" in transcript
    assert "Team: Sorry to hear that" in transcript
    assert "Internal note: Known battery batch issue" in transcript


@pytest.mark.asyncio
async def test_assistant_history_prepends_thread_context(session_override: AsyncSession):
    tenant = Tenant(slug="ctx2", name="Ctx2")
    session_override.add(tenant)
    await session_override.commit()
    thread = await _make_customer_thread(session_override, tenant.id)

    conversation = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        source="chat",
        subject="Assist: Broken charger",
        context_signal_id=thread.id,
    )
    session_override.add(conversation)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=conversation.id,
            tenant_id=tenant.id,
            kind="user_message",
            direction="internal",
            role="user",
            body_text="How should I respond?",
        )
    )
    await session_override.commit()

    history = await signal_chat_history(session_override, conversation.id)
    assert history[0]["role"] == "user"
    assert "[Context]" in history[0]["content"]
    assert "Alice: My charger stopped working" in history[0]["content"]
    assert history[-1] == {"role": "user", "content": "How should I respond?"}


@pytest.mark.asyncio
async def test_history_without_context_unchanged(session_override: AsyncSession):
    tenant = Tenant(slug="ctx3", name="Ctx3")
    session_override.add(tenant)
    await session_override.commit()

    conversation = Signal(
        tenant_id=tenant.id, channel="assistant", source="chat", subject="Plain chat"
    )
    session_override.add(conversation)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=conversation.id,
            tenant_id=tenant.id,
            kind="user_message",
            direction="internal",
            role="user",
            body_text="Hello",
        )
    )
    await session_override.commit()

    history = await signal_chat_history(session_override, conversation.id)
    assert history == [{"role": "user", "content": "Hello"}]
