"""Participant turn floor (request without running the LLM)."""

from __future__ import annotations

import json
from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import Signal
from app.services.participant_turns import (
    flush_deferred_participant_turn,
    request_participant_turn,
    wake_requester_after_peer,
)


def test_sent_peer_reply_does_not_wake_the_requester():
    assert wake_requester_after_peer("sent") is False
    assert wake_requester_after_peer("pass") is True


async def _seed_agent_signal(session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = Agent(
        tenant_id=tenant.id,
        name=f"Turn Agent {uuid4().hex[:6]}",
        role="assistant",
        kind="company",
        is_active=True,
        slug=f"turn-{uuid4().hex[:8]}",
        tools_json="[]",
        settings_json="{}",
    )
    session_override.add(agent)
    now = datetime.utcnow()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="test",
        subject="Turn",
        status="open",
        created_at=now,
        updated_at=now,
        last_message_at=now,
        active_turn_json="{}",
    )
    session_override.add(signal)
    await session_override.flush()
    return agent, signal


@pytest.mark.asyncio
async def test_request_turn_sets_active_floor(client, session_override):
    _ = client
    agent, signal = await _seed_agent_signal(session_override)

    result = await request_participant_turn(
        session_override,
        signal,
        member_kind="agent",
        member_ref_id=agent.id,
        prompt="Please introduce yourself",
        run=False,
    )
    await session_override.commit()

    assert result.get("ok") is True
    assert result.get("outcome") == "requested"
    floor = result.get("active_turn") or {}
    assert floor.get("ref_id") == str(agent.id)
    assert floor.get("nonce")
    refreshed = await session_override.get(Signal, signal.id)
    assert refreshed is not None
    assert str(agent.id) in (refreshed.active_turn_json or "")


@pytest.mark.asyncio
async def test_agent_request_defers_peer_until_flush(client, session_override, monkeypatch):
    _ = client
    agent, signal = await _seed_agent_signal(session_override)
    caller_id = uuid4()
    enqueued: list[str] = []

    async def _fake_enqueue(**kwargs):
        enqueued.append(kwargs.get("nonce") or "")
        return True

    class _Settings:
        bokito_mock_execution = False

    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: _Settings(),
    )
    import app.workers.tasks as tasks_mod

    monkeypatch.setattr(tasks_mod, "enqueue_participant_turn", _fake_enqueue)

    result = await request_participant_turn(
        session_override,
        signal,
        member_kind="agent",
        member_ref_id=agent.id,
        prompt="Add a label",
        requested_by_kind="agent",
        requested_by_id=caller_id,
        run=True,
    )
    assert result.get("outcome") == "deferred"
    assert result.get("active_turn", {}).get("deferred") is True
    # Agent callers schedule a delayed enqueue so Ask/child sessions still wake peers.
    assert len(enqueued) == 1

    dup = await request_participant_turn(
        session_override,
        signal,
        member_kind="agent",
        member_ref_id=agent.id,
        prompt="Add a label again",
        requested_by_kind="agent",
        requested_by_id=caller_id,
        run=True,
    )
    assert dup.get("outcome") == "already_active"
    assert len(enqueued) == 1

    flushed = await flush_deferred_participant_turn(session_override, signal)
    assert flushed is not None
    assert flushed.get("outcome") == "queued"
    # Flush starts an immediate job; safety net already queued one — workers
    # use claim_active_turn so only one executes.
    assert len(enqueued) == 2
    assert enqueued[0] == enqueued[1]
    floor = json.loads(signal.active_turn_json or "{}")
    assert floor.get("deferred") is False
    assert floor.get("enqueued") is True


@pytest.mark.asyncio
async def test_claim_active_turn_is_single_winner(client, session_override):
    _ = client
    from app.services.participant_turns import claim_active_turn, clear_active_turn

    agent, signal = await _seed_agent_signal(session_override)
    result = await request_participant_turn(
        session_override,
        signal,
        member_kind="agent",
        member_ref_id=agent.id,
        prompt="claim race",
        requested_by_kind="user",
        requested_by_id=uuid4(),
        run=False,
    )
    nonce = str(result.get("active_turn", {}).get("nonce") or "")
    assert nonce
    first = claim_active_turn(signal, nonce=nonce)
    assert first is not None
    assert first.get("claimed_at")
    second = claim_active_turn(signal, nonce=nonce)
    assert second is None
    clear_active_turn(signal)
    assert claim_active_turn(signal, nonce=nonce) is None


@pytest.mark.asyncio
async def test_max_consecutive_turns_blocks_chain(client, session_override):
    _ = client
    from app.services.participant_turns import MAX_CONSECUTIVE_TURNS, clear_active_turn

    agent, signal = await _seed_agent_signal(session_override)
    peer = Agent(
        tenant_id=agent.tenant_id,
        name=f"Peer {uuid4().hex[:6]}",
        role="assistant",
        kind="company",
        is_active=True,
        slug=f"peer-{uuid4().hex[:8]}",
        tools_json="[]",
        settings_json="{}",
    )
    session_override.add(peer)
    await session_override.flush()

    for i in range(MAX_CONSECUTIVE_TURNS):
        target = agent if i % 2 == 0 else peer
        result = await request_participant_turn(
            session_override,
            signal,
            member_kind="agent",
            member_ref_id=target.id,
            prompt=f"round {i + 1}",
            requested_by_kind="agent",
            requested_by_id=peer.id if target.id == agent.id else agent.id,
            run=False,
        )
        assert result.get("ok") is True, result
        clear_active_turn(signal)
        await session_override.flush()

    blocked = await request_participant_turn(
        session_override,
        signal,
        member_kind="agent",
        member_ref_id=agent.id,
        prompt="one too many",
        requested_by_kind="agent",
        requested_by_id=peer.id,
        run=False,
    )
    assert blocked.get("ok") is False
    assert blocked.get("error") == "max_consecutive_turns"
    assert blocked.get("outcome") == "timeout"


@pytest.mark.asyncio
async def test_clear_ask_floor_chip_drops_unclaimed_ui_floor(client, session_override):
    _ = client
    from app.services.participant_turns import clear_ask_floor_chip

    agent, signal = await _seed_agent_signal(session_override)
    await request_participant_turn(
        session_override,
        signal,
        member_kind="agent",
        member_ref_id=agent.id,
        prompt="hi",
        run=False,
    )
    await session_override.commit()

    cleared = await clear_ask_floor_chip(session_override, signal, agent_id=agent.id)
    assert cleared is True
    remnant = json.loads(signal.active_turn_json or "{}")
    assert not remnant.get("nonce")
    assert not remnant.get("ref_id")

    # Second clear is a no-op.
    assert await clear_ask_floor_chip(session_override, signal, agent_id=agent.id) is False


@pytest.mark.asyncio
async def test_clear_ask_floor_chip_keeps_deferred_peer(client, session_override):
    _ = client
    from app.services.participant_turns import clear_ask_floor_chip

    agent, signal = await _seed_agent_signal(session_override)
    result = await request_participant_turn(
        session_override,
        signal,
        member_kind="agent",
        member_ref_id=agent.id,
        prompt="peer",
        run=False,
    )
    floor = dict(result.get("active_turn") or {})
    floor["deferred"] = True
    signal.active_turn_json = json.dumps(floor)
    await session_override.flush()

    assert await clear_ask_floor_chip(session_override, signal, agent_id=agent.id) is False
    assert "nonce" in json.loads(signal.active_turn_json or "{}")


@pytest.mark.asyncio
async def test_flush_expired_deferred_emits_timeout(client, session_override):
    _ = client
    from app.models.signal import SignalEvent
    from app.services.participant_turns import clear_active_turn

    agent, signal = await _seed_agent_signal(session_override)
    caller_id = uuid4()
    result = await request_participant_turn(
        session_override,
        signal,
        member_kind="agent",
        member_ref_id=agent.id,
        prompt="too late",
        deadline_s=15,
        requested_by_kind="agent",
        requested_by_id=caller_id,
        run=False,
    )
    assert result.get("ok") is True
    floor = json.loads(signal.active_turn_json or "{}")
    floor["deferred"] = True
    floor["deadline"] = "2000-01-01T00:00:00"
    signal.active_turn_json = json.dumps(floor)
    await session_override.flush()

    flushed = await flush_deferred_participant_turn(session_override, signal)
    assert flushed is not None
    assert flushed.get("outcome") == "expired"
    remnant = json.loads(signal.active_turn_json or "{}")
    assert not remnant.get("nonce")

    ev = (
        await session_override.execute(
            select(SignalEvent)
            .where(SignalEvent.signal_id == signal.id)
            .where(SignalEvent.event_type == "participant_turn_timeout")
            .order_by(SignalEvent.created_at.desc())
        )
    ).scalars().first()
    assert ev is not None
    payload = json.loads(ev.payload_json or "{}")
    assert payload.get("reason") == "deadline"
    assert payload.get("agent_name") == agent.name
    _ = clear_active_turn