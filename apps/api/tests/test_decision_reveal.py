"""Deferred decision reveal: persist mid-turn, publish after speech."""

from __future__ import annotations

import json
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.notification import Notification
from app.models.signal import Signal, SignalMessage
from app.services.agent.turn_persist import persist_agent_turn
from app.services.signal_decisions import create_decision, reveal_decision


@pytest.mark.asyncio
async def test_create_decision_reveal_false_skips_thread_and_unread(
    client: AsyncClient, session_override
):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id).limit(1))
    ).scalar_one()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        subject="Reveal test",
        status="open",
        agent_id=agent.id,
    )
    session_override.add(signal)
    await session_override.flush()

    decision, message = await create_decision(
        session_override,
        tenant.id,
        title="Create calendar event: Standup",
        summary="Standup from 10:00 to 10:30 in Agenda",
        options=[
            {
                "id": "approve",
                "label": "Create event",
                "action_type": "calendar_create_event",
                "payload": {"title": "Standup", "start_at": "2026-10-14T10:00:00Z", "end_at": "2026-10-14T10:30:00Z"},
            },
            {"id": "reject", "label": "Reject", "action_type": "reject"},
        ],
        agent_id=agent.id,
        signal_id=signal.id,
        bundle_id="turn-reveal-1",
        reveal=False,
    )
    await session_override.commit()

    assert message is None
    assert decision.message_id is None
    assert decision.status == "awaiting_human"

    notification = (
        await session_override.execute(
            select(Notification).where(Notification.id == decision.notification_id)
        )
    ).scalar_one()
    assert notification.status == "pending"
    payload = json.loads(notification.payload_json)
    assert payload["decision_id"] == str(decision.id)
    assert "_pending_reveal" in payload

    cards = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.kind == "decision_request",
            )
        )
    ).scalars().all()
    assert cards == []


@pytest.mark.asyncio
async def test_reveal_decision_publishes_card_and_unread(client: AsyncClient, session_override):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id).limit(1))
    ).scalar_one()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        subject="Reveal publish",
        status="open",
        agent_id=agent.id,
    )
    session_override.add(signal)
    await session_override.flush()

    decision, _ = await create_decision(
        session_override,
        tenant.id,
        title="Create calendar event: Standup",
        summary="Standup from 10:00 to 10:30",
        agent_id=agent.id,
        signal_id=signal.id,
        reveal=False,
    )
    await session_override.flush()

    message = await reveal_decision(session_override, tenant.id, decision)
    await session_override.commit()

    assert message is not None
    assert message.kind == "decision_request"
    assert decision.message_id == message.id

    notification = (
        await session_override.execute(
            select(Notification).where(Notification.id == decision.notification_id)
        )
    ).scalar_one()
    assert notification.status == "unread"
    payload = json.loads(notification.payload_json)
    assert payload["message_id"] == str(message.id)
    assert "_pending_reveal" not in payload

    # Idempotent
    again = await reveal_decision(session_override, tenant.id, decision)
    assert again is not None
    assert again.id == message.id


@pytest.mark.asyncio
async def test_persist_turn_reveals_deferred_decisions(client: AsyncClient, session_override):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id).limit(1))
    ).scalar_one()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        subject="Persist reveal",
        status="open",
        agent_id=agent.id,
    )
    session_override.add(signal)
    await session_override.flush()

    turn_id = f"turn-{uuid4()}"
    d1, _ = await create_decision(
        session_override,
        tenant.id,
        title="Create calendar event: A",
        summary="A from 10:00 to 11:00",
        agent_id=agent.id,
        signal_id=signal.id,
        bundle_id=turn_id,
        reveal=False,
    )
    d2, _ = await create_decision(
        session_override,
        tenant.id,
        title="Create calendar event: B",
        summary="B from 15:00 to 16:00",
        agent_id=agent.id,
        signal_id=signal.id,
        bundle_id=turn_id,
        reveal=False,
    )
    await session_override.flush()

    segments = [
        {
            "id": "seg-1",
            "text": "Ik stel twee afspraken voor.",
            "activity": [
                {
                    "id": "t1",
                    "kind": "work",
                    "tool": "calendar_propose_event",
                    "proposes": True,
                    "result": {"decision_request_id": str(d1.id), "status": "awaiting_human"},
                },
                {
                    "id": "t2",
                    "kind": "work",
                    "tool": "calendar_propose_event",
                    "proposes": True,
                    "result": {"decision_request_id": str(d2.id), "status": "awaiting_human"},
                },
            ],
            "activity_after": [],
        }
    ]
    messages = await persist_agent_turn(
        session_override,
        signal,
        segments=segments,
        reply_mode="chat",
        author_agent_id=agent.id,
        turn_id=turn_id,
    )
    await session_override.commit()

    assert messages
    speech = messages[0]
    assert "twee afspraken" in (speech.body_text or "")

    await session_override.refresh(d1)
    await session_override.refresh(d2)
    assert d1.message_id is not None
    assert d2.message_id is not None

    cards = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.kind == "decision_request",
            )
        )
    ).scalars().all()
    assert len(cards) == 2
    # Cards should sort at/after speech (reveal stamps after the bubble).
    speech_t = speech.received_at or speech.created_at
    for card in cards:
        card_t = card.received_at or card.created_at
        assert card_t >= speech_t


@pytest.mark.asyncio
async def test_create_decision_reveal_true_still_immediate(client: AsyncClient, session_override):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id).limit(1))
    ).scalar_one()
    decision, message = await create_decision(
        session_override,
        tenant.id,
        title="Ship it?",
        summary="Needs a call",
        agent_id=agent.id,
        reveal=True,
    )
    await session_override.commit()
    assert message is not None
    assert decision.message_id == message.id
    notification = (
        await session_override.execute(
            select(Notification).where(Notification.id == decision.notification_id)
        )
    ).scalar_one()
    assert notification.status == "unread"
    payload = json.loads(notification.payload_json)
    assert "_pending_reveal" not in payload
    assert payload.get("from", {}).get("kind") == "agent"
    assert payload["from"].get("id") == str(agent.id)


@pytest.mark.asyncio
async def test_identical_ack_decision_blocks_second_create(
    client: AsyncClient, session_override
):
    """Ja/Nee cards without action_type must not stack in one turn."""
    _ = client
    from app.tools.builtin import _create_decision_request
    from app.tools.registry import ToolContext

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id).limit(1))
    ).scalar_one()
    signal = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        subject="Ack identical",
        status="open",
        agent_id=agent.id,
    )
    session_override.add(signal)
    await session_override.flush()
    ctx = ToolContext(
        session=session_override,
        tenant_id=tenant.id,
        user_id=None,
        agent=agent,
        signal_id=signal.id,
        trust="operator",
        turn_id="turn-ack-1",
    )
    payload = {
        "title": "U10c klaar?",
        "question": "Mag ik U10c afronden?",
        "options": [{"id": "ja", "label": "Ja"}, {"id": "nee", "label": "Nee"}],
    }
    first = await _create_decision_request(ctx, dict(payload))
    second = await _create_decision_request(ctx, dict(payload))
    assert first.get("status") == "awaiting_human"
    assert second.get("status") == "already_open"
    assert second.get("decision_request_id") == first.get("decision_request_id")


@pytest.mark.asyncio
async def test_same_bundle_ack_blocks_different_title(
    client: AsyncClient, session_override
):
    """U75: one turn must not stack Ja/Nee cards under different titles."""
    _ = client
    from app.tools.builtin import _create_decision_request
    from app.tools.registry import ToolContext

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id).limit(1))
    ).scalar_one()
    signal = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        subject="Ack flood",
        status="open",
        agent_id=agent.id,
    )
    session_override.add(signal)
    await session_override.flush()
    ctx = ToolContext(
        session=session_override,
        tenant_id=tenant.id,
        user_id=None,
        agent=agent,
        signal_id=signal.id,
        trust="operator",
        turn_id="turn-ack-flood",
    )
    first = await _create_decision_request(
        ctx,
        {
            "title": "Mag ik doorgaan met s45?",
            "options": [{"id": "ja", "label": "Ja"}, {"id": "nee", "label": "Nee"}],
        },
    )
    second = await _create_decision_request(
        ctx,
        {
            "title": "QA S45 bevestigen?",
            "options": [{"id": "ja", "label": "Ja"}, {"id": "nee", "label": "Nee"}],
        },
    )
    assert first.get("status") == "awaiting_human"
    assert second.get("status") == "already_open"
    assert second.get("decision_request_id") == first.get("decision_request_id")


@pytest.mark.asyncio
async def test_persist_turn_reveals_decision_on_context_host_mismatch(
    client: AsyncClient, session_override
):
    """Ask session speech on assistant thread; tool attached card to context mail."""
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id).limit(1))
    ).scalar_one()
    host = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Invoice",
        status="open",
        agent_id=agent.id,
    )
    session = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        subject="Ask about invoice",
        status="open",
        agent_id=agent.id,
    )
    session_override.add(host)
    session_override.add(session)
    await session_override.flush()
    session.context_signal_id = host.id
    await session_override.flush()

    turn_id = f"turn-{uuid4()}"
    decision, _ = await create_decision(
        session_override,
        tenant.id,
        title="QA U10 afronden",
        summary="Mag ik U10 afronden?",
        options=[{"id": "ja", "label": "Ja"}, {"id": "nee", "label": "Nee"}],
        agent_id=agent.id,
        signal_id=host.id,  # wrongly attached to context host
        bundle_id=turn_id,
        reveal=False,
    )
    await session_override.flush()

    messages = await persist_agent_turn(
        session_override,
        session,
        segments=[
            {
                "id": "seg-1",
                "text": "Mag ik U10 afronden?",
                "activity": [
                    {
                        "id": "t1",
                        "kind": "other",
                        "tool": "create_decision_request",
                        "proposes": True,
                        "result": {
                            "decision_request_id": str(decision.id),
                            "status": "awaiting_human",
                        },
                    }
                ],
                "activity_after": [],
            }
        ],
        reply_mode="chat",
        author_agent_id=agent.id,
        turn_id=turn_id,
    )
    await session_override.commit()
    await session_override.refresh(decision)

    assert messages
    assert decision.message_id is not None
    assert decision.signal_id == session.id
    card = await session_override.get(SignalMessage, decision.message_id)
    assert card is not None
    assert card.signal_id == session.id
    assert card.kind == "decision_request"
