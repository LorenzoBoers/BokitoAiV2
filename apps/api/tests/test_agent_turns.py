"""The agent turn queue: order, one runner, leases, budget, ask and answer."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.agent_turn import AgentAsk, AgentTurn
from app.models.auth import Tenant
from app.models.signal import Signal, SignalMessage
from app.services import agent_turns
from app.services.agent_turns import (
    MAX_EPISODE_TURNS,
    MAX_PAIR_REPEATS,
    _answer_ask,
    _turn_brief,
    claim_next,
    enqueue_turn,
    stop_conversation,
    sweep,
)


async def _seed(session, names=("Extra", "Boekito")):
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    now = datetime.utcnow()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="test",
        subject="Turns",
        status="open",
        created_at=now,
        updated_at=now,
        last_message_at=now,
        active_turn_json="{}",
    )
    session.add(signal)
    agents = []
    for name in names:
        agent = Agent(
            tenant_id=tenant.id,
            name=name,
            role="assistant",
            kind="company",
            is_active=True,
            slug=f"turn-{uuid4().hex[:8]}",
            tools_json="[]",
            settings_json="{}",
        )
        session.add(agent)
        agents.append(agent)
    await session.flush()
    return signal, agents


async def _human(session, signal, body="hoi") -> SignalMessage:
    row = SignalMessage(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        role="user",
        direction="inbound",
        kind="user_message",
        body_text=body,
        received_at=datetime.utcnow(),
    )
    session.add(row)
    await session.flush()
    return row


@pytest.mark.asyncio
async def test_messages_get_a_gapless_seq_per_conversation(client, session_override):
    _ = client
    signal, _agents = await _seed(session_override)
    rows = [await _human(session_override, signal, f"m{i}") for i in range(3)]
    assert [row.seq for row in rows] == [1, 2, 3]
    await session_override.refresh(signal)
    assert signal.last_seq == 3


@pytest.mark.asyncio
async def test_one_turn_runs_at_a_time_in_queue_order(client, session_override):
    _ = client
    signal, (first, second) = await _seed(session_override)
    message = await _human(session_override, signal)
    for agent in (first, second):
        await enqueue_turn(
            session_override,
            signal,
            agent_id=agent.id,
            cause_kind="human",
            requested_by_kind="user",
            cause_message_id=message.id,
            idempotency_key=f"msg:{message.id}:{agent.id}",
        )
    await session_override.commit()

    claimed = await claim_next(session_override, signal.id)
    assert claimed is not None and claimed.agent_id == first.id
    assert await claim_next(session_override, signal.id) is None
    floor = json.loads((await session_override.get(Signal, signal.id)).active_turn_json)
    assert floor["ref_id"] == str(first.id) and floor["status"] == "running"

    claimed.status = "done"
    session_override.add(claimed)
    await session_override.commit()
    nxt = await claim_next(session_override, signal.id)
    assert nxt is not None and nxt.agent_id == second.id


@pytest.mark.asyncio
async def test_expired_lease_goes_back_to_the_queue_once(client, session_override):
    _ = client
    signal, (agent, _peer) = await _seed(session_override)
    await enqueue_turn(
        session_override, signal, agent_id=agent.id, cause_kind="human", requested_by_kind="user"
    )
    await session_override.commit()
    row = await claim_next(session_override, signal.id)
    row.lease_until = datetime.utcnow() - timedelta(seconds=1)
    session_override.add(row)
    await session_override.commit()

    stats = await sweep(session_override)
    assert stats["requeued"] == 1
    again = await claim_next(session_override, signal.id)
    assert again is not None and again.attempt == 2
    again.lease_until = datetime.utcnow() - timedelta(seconds=1)
    session_override.add(again)
    await session_override.commit()
    stats = await sweep(session_override)
    assert stats["failed"] == 1


@pytest.mark.asyncio
async def test_episode_budget_stops_agents_and_says_so_once(client, session_override):
    _ = client
    signal, (asker, peer) = await _seed(session_override)
    message = await _human(session_override, signal)
    for i in range(MAX_EPISODE_TURNS):
        session_override.add(
            AgentTurn(
                tenant_id=signal.tenant_id,
                signal_id=signal.id,
                agent_id=peer.id if i % 2 else asker.id,
                status="done",
                episode_id=message.id,
                idempotency_key=f"spent:{i}:{uuid4()}",
            )
        )
    await session_override.flush()
    for _ in range(2):
        refused = await enqueue_turn(
            session_override,
            signal,
            agent_id=peer.id,
            cause_kind="ask",
            requested_by_kind="agent",
            requested_by_id=asker.id,
            episode_id=message.id,
        )
        assert refused["ok"] is False and refused["outcome"] == "budget"
    stops = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id, SignalMessage.kind == "system_event"
            )
        )
    ).scalars().all()
    assert len(stops) == 1


@pytest.mark.asyncio
async def test_same_pair_cannot_ping_pong(client, session_override):
    _ = client
    signal, (asker, peer) = await _seed(session_override)
    message = await _human(session_override, signal)
    results = []
    for _ in range(MAX_PAIR_REPEATS + 1):
        results.append(
            await enqueue_turn(
                session_override,
                signal,
                agent_id=peer.id,
                cause_kind="ask",
                requested_by_kind="agent",
                requested_by_id=asker.id,
                episode_id=message.id,
            )
        )
    assert [r["ok"] for r in results] == [True] * MAX_PAIR_REPEATS + [False]
    assert results[-1]["error"] == "episode_budget_repeat"


@pytest.mark.asyncio
async def test_answer_with_a_picture_goes_back_to_the_asker(client, session_override):
    _ = client
    signal, (asker, peer) = await _seed(session_override)
    message = await _human(session_override, signal, "maak een zelfportret van Boekito")
    ask = AgentAsk(
        tenant_id=signal.tenant_id,
        signal_id=signal.id,
        from_agent_id=asker.id,
        to_agent_id=peer.id,
        question="Kun je een zelfportret maken?",
        episode_id=message.id,
    )
    session_override.add(ask)
    await session_override.flush()
    turn = AgentTurn(
        tenant_id=signal.tenant_id,
        signal_id=signal.id,
        agent_id=peer.id,
        cause_kind="ask",
        requested_by_kind="agent",
        requested_by_id=asker.id,
        ask_id=ask.id,
        episode_id=message.id,
        status="running",
        idempotency_key=f"ask:{ask.id}",
    )
    session_override.add(turn)
    await session_override.flush()
    loop = SimpleNamespace(turn=SimpleNamespace(image_urls=lambda: ["https://cdn.example/p.png"]))

    await _answer_ask(session_override, signal, turn, loop, ["Hier is mijn zelfportret."], "spoke")

    stored = await session_override.get(AgentAsk, ask.id)
    assert stored.status == "answered"
    parts = json.loads(stored.answer_json)
    assert {"type": "image", "url": "https://cdn.example/p.png", "mime": "image/png"} in parts
    answer = (
        await session_override.execute(
            select(AgentTurn).where(AgentTurn.idempotency_key == f"answer:{ask.id}")
        )
    ).scalar_one()
    assert answer.agent_id == asker.id and answer.cause_kind == "answer"
    brief, attachments = await _turn_brief(session_override, answer, asker)
    assert "zelfportret" in brief
    assert attachments == [{"url": "https://cdn.example/p.png", "mime": "image/png", "name": "answer"}]


@pytest.mark.asyncio
async def test_a_second_question_to_the_same_peer_reuses_the_open_ask(client, session_override):
    from app.tools.builtin import _ask_agent
    from app.tools.registry import ToolContext

    _ = client
    signal, (asker, peer) = await _seed(session_override)
    await _human(session_override, signal, "vraag Boekito om een zelfportret")
    await session_override.commit()
    ctx = ToolContext(
        session=session_override,
        tenant_id=signal.tenant_id,
        user_id=None,
        agent=asker,
        signal_id=signal.id,
    )

    first = await _ask_agent(ctx, {"agent_id": str(peer.id), "question": "Stuur je een zelfportret?"})
    second = await _ask_agent(ctx, {"agent_id": str(peer.id), "question": "Kun je alsnog een plaatje maken?"})

    assert first["ok"] and first["said"]
    assert second["ok"] and second["already_asked"] and "said" not in second
    assert second["ask_id"] == first["ask_id"]
    asks = (await session_override.execute(select(AgentAsk).where(AgentAsk.signal_id == signal.id))).scalars().all()
    turns = (
        await session_override.execute(
            select(AgentTurn).where(AgentTurn.signal_id == signal.id, AgentTurn.cause_kind == "ask")
        )
    ).scalars().all()
    assert len(asks) == 1 and len(turns) == 1


@pytest.mark.asyncio
async def test_stop_cancels_queued_and_running_turns(client, session_override):
    _ = client
    signal, (first, second) = await _seed(session_override)
    for agent in (first, second):
        await enqueue_turn(
            session_override, signal, agent_id=agent.id, cause_kind="human", requested_by_kind="user"
        )
    await session_override.commit()
    running = await claim_next(session_override, signal.id)
    running.run_id = uuid4()
    session_override.add(running)
    await session_override.commit()

    run_ids = await stop_conversation(session_override, signal)
    await session_override.commit()
    assert run_ids == [running.run_id]
    statuses = (
        await session_override.execute(select(AgentTurn.status).where(AgentTurn.signal_id == signal.id))
    ).scalars().all()
    assert set(statuses) == {"cancelled"}
    assert json.loads((await session_override.get(Signal, signal.id)).active_turn_json or "{}") == {}


@pytest.mark.asyncio
async def test_shutdown_hands_a_running_turn_back_without_spending_an_attempt(
    client, session_override, monkeypatch
):
    from contextlib import asynccontextmanager

    from app.services import thread_log

    _ = client
    signal, (agent, _peer) = await _seed(session_override)
    await enqueue_turn(
        session_override, signal, agent_id=agent.id, cause_kind="human", requested_by_kind="user"
    )
    await session_override.commit()
    running = await claim_next(session_override, signal.id)
    agent_turns._HELD[running.id] = "queue"
    await thread_log.append(
        signal.tenant_id,
        signal.id,
        "agent.turn",
        {"stream_id": "s-restart", "phase": "start", "audience": "operator"},
    )

    @asynccontextmanager
    async def _factory():
        yield session_override

    rung: list = []

    async def _ring(signal_id):
        rung.append(signal_id)

    monkeypatch.setattr("app.db.session.async_session_factory", _factory)
    monkeypatch.setattr(agent_turns, "ring", _ring)

    stats = await agent_turns.release_held()

    assert stats == {"requeued": 1, "ended": 0}
    assert rung == [signal.id]
    assert agent_turns._HELD == {}
    await session_override.refresh(running)
    assert running.status == "queued" and running.attempt == 0
    assert [r for r in await thread_log.live(signal.id) if r["event"] != "floor"] == []
    again = await claim_next(session_override, signal.id)
    assert again is not None and again.id == running.id and again.attempt == 1


@pytest.mark.asyncio
async def test_shutdown_requeues_an_inline_chat_so_the_reply_still_happens(
    client, session_override, monkeypatch
):
    from contextlib import asynccontextmanager

    _ = client
    signal, (agent, _peer) = await _seed(session_override)
    human = await _human(session_override, signal, "Duidelijk zie je kansen?")
    row = AgentTurn(
        tenant_id=signal.tenant_id,
        signal_id=signal.id,
        agent_id=agent.id,
        cause_kind="inline",
        requested_by_kind="user",
        episode_id=human.id,
        status="running",
        started_at=datetime.utcnow(),
        lease_until=datetime.utcnow() + timedelta(seconds=600),
        attempt=1,
        idempotency_key=f"inline:{uuid4()}",
    )
    session_override.add(row)
    await session_override.commit()
    agent_turns._HELD[row.id] = "inline"

    @asynccontextmanager
    async def _factory():
        yield session_override

    rung: list = []

    async def _ring(signal_id):
        rung.append(signal_id)

    monkeypatch.setattr("app.db.session.async_session_factory", _factory)
    monkeypatch.setattr(agent_turns, "ring", _ring)

    stats = await agent_turns.release_held()

    assert stats["requeued"] == 1 and stats["ended"] == 0
    assert rung == [signal.id]
    await session_override.refresh(row)
    assert row.status == "queued" and row.outcome == "requeued"
    assert row.cause_kind == "human" and row.cause_message_id == human.id
    assert row.attempt == 0


@pytest.mark.asyncio
async def test_history_marks_an_ask_and_reads_peers_as_users(client, session_override):
    """The asker sees its question was a tool call, so it asks with the tool again."""
    _ = client
    from app.services.assistant_threads import signal_chat_history

    signal, (asker, peer) = await _seed(session_override)
    await _human(session_override, signal, "Vraag Boekito iets")
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            role="assistant",
            direction="outbound",
            kind="agent_message",
            author_agent_id=asker.id,
            body_text="@Boekito Zelfportret?",
            metadata_json=json.dumps({"activity": [{"tool": "ask_agent", "kind": "other"}]}),
            received_at=datetime.utcnow(),
        )
    )
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            role="assistant",
            direction="outbound",
            kind="agent_message",
            author_agent_id=peer.id,
            body_text="Nee.",
            received_at=datetime.utcnow(),
        )
    )
    await session_override.commit()

    history = await signal_chat_history(
        session_override, signal.id, compact=False, for_agent_id=asker.id
    )
    assert history[-2] == {
        "role": "assistant",
        "content": "@Boekito Zelfportret?\n[Sent with ask_agent.]\n"
        "[Tools already ran: ask_agent. Do not repeat them unless this turn asks.]",
    }
    assert history[-1] == {"role": "user", "content": "Boekito: Nee."}


@pytest.mark.asyncio
async def test_an_agent_bubble_that_starts_with_a_chip_asks_nobody(client, session_override):
    from app.services.agent.loop import AgentLoop

    _ = client
    signal, (asker, peer) = await _seed(session_override)
    await _human(session_override, signal)
    loop = AgentLoop(session_override, signal.tenant_id, None, agent=asker, signal_id=signal.id)
    loop._new_turn()
    await loop.turn.speech(f"@[{peer.name}](agent:{peer.id}) is de juiste agent hiervoor.")
    await loop.turn.finish()
    await loop.persist_turn(signal)
    await session_override.commit()

    asks = (await session_override.execute(select(AgentAsk).where(AgentAsk.signal_id == signal.id))).scalars().all()
    assert asks == []
    turns = (
        await session_override.execute(
            select(AgentTurn).where(AgentTurn.signal_id == signal.id, AgentTurn.cause_kind == "ask")
        )
    ).scalars().all()
    assert turns == []


def test_ring_is_patched_in_tests():
    assert agent_turns.ring.__class__.__name__ == "AsyncMock"
