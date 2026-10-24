"""What a saved message queues: people move turns, agents do not."""

from __future__ import annotations

import json
from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.agent_turn import AgentTurn
from app.models.auth import Tenant
from app.models.signal import Signal, SignalMessage
from app.services.pass_stick import decide_stick, pass_stick


def test_decide_agent_message_queues_nobody():
    choice = decide_stick(
        author_kind="agent",
        mentioned_agent_ids=[uuid4()],
        mentioned_human_ids=[],
        text="your turn",
        holder_id=uuid4(),
        wake_default=False,
        channel_agent_id=None,
    )
    assert choice["action"] == "none"
    assert choice["reason"] == "agent_message"


def test_decide_plural_names_every_agent_in_order():
    first, second = uuid4(), uuid4()
    choice = decide_stick(
        author_kind="user",
        mentioned_agent_ids=[first, second],
        mentioned_human_ids=[],
        text="allebei een afbeelding",
        holder_id=None,
        wake_default=False,
        channel_agent_id=None,
    )
    assert choice["action"] == "give"
    assert choice["agent_ids"] == [first, second]
    assert choice["reason"] == "plural"


def test_decide_human_only_clears():
    person = uuid4()
    choice = decide_stick(
        author_kind="user",
        mentioned_agent_ids=[],
        mentioned_human_ids=[person],
        text="over to you",
        holder_id=uuid4(),
        wake_default=False,
        channel_agent_id=None,
    )
    assert choice["action"] == "clear"
    assert choice["reason"] == "human_only"
    assert choice["notify_user_ids"] == [person]


def test_decide_follow_up_keeps_the_holder():
    holder = uuid4()
    choice = decide_stick(
        author_kind="user",
        mentioned_agent_ids=[],
        mentioned_human_ids=[],
        text="go on",
        holder_id=holder,
        wake_default=False,
        channel_agent_id=None,
    )
    assert choice["action"] == "give"
    assert choice["agent_ids"] == [holder]
    assert choice["reason"] == "follow_up"


async def _seed(session_override, *, names: list[str]):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    now = datetime.utcnow()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="test",
        subject="Stick",
        status="open",
        created_at=now,
        updated_at=now,
        last_message_at=now,
        active_turn_json="{}",
    )
    session_override.add(signal)
    agents = []
    for name in names:
        agent = Agent(
            tenant_id=tenant.id,
            name=name,
            role="assistant",
            kind="company",
            is_active=True,
            slug=f"stick-{uuid4().hex[:8]}",
            tools_json="[]",
            settings_json="{}",
        )
        session_override.add(agent)
        agents.append(agent)
    await session_override.flush()
    return signal, agents


async def _say(session, signal, body: str) -> SignalMessage:
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


async def _turns(session, signal) -> list[AgentTurn]:
    return list(
        (
            await session.execute(
                select(AgentTurn).where(AgentTurn.signal_id == signal.id).order_by(AgentTurn.created_at)
            )
        ).scalars()
    )


@pytest.mark.asyncio
async def test_note_does_not_follow_the_holder(client, session_override):
    _ = client
    signal, (agent,) = await _seed(session_override, names=["Sjaakie"])
    signal.channel = "assistant"
    signal.agent_id = agent.id
    signal.active_turn_json = json.dumps({"ref_id": str(agent.id), "nonce": "floor"})
    message = await _say(session_override, signal, "Test notitie")
    moved = await pass_stick(
        session_override,
        signal,
        body_text=message.body_text,
        author_kind="user",
        author_id=uuid4(),
        message_id=message.id,
        follow_holder=False,
    )
    assert moved["action"] == "none"
    assert await _turns(session_override, signal) == []


@pytest.mark.asyncio
async def test_note_mention_still_queues(client, session_override):
    _ = client
    signal, (agent,) = await _seed(session_override, names=["Sjaakie"])
    signal.channel = "assistant"
    body = f"@[Sjaakie](agent:{agent.id}) kijk even"
    message = await _say(session_override, signal, body)
    moved = await pass_stick(
        session_override,
        signal,
        body_text=body,
        author_kind="user",
        author_id=uuid4(),
        message_id=message.id,
        follow_holder=False,
    )
    assert moved["action"] == "give"
    assert moved["holder_id"] == str(agent.id)
    assert [row.agent_id for row in await _turns(session_override, signal)] == [agent.id]


@pytest.mark.asyncio
async def test_plural_message_queues_one_turn_per_agent_in_order(client, session_override):
    _ = client
    signal, (first, second) = await _seed(session_override, names=["Bokito", "Extra"])
    body = f"allebei @[Bokito](agent:{first.id}) @[Extra](agent:{second.id})"
    message = await _say(session_override, signal, body)
    moved = await pass_stick(
        session_override, signal, body_text=body, author_kind="user", author_id=uuid4(), message_id=message.id
    )
    assert moved["action"] == "give"
    assert moved["holder_id"] == str(first.id)
    rows = await _turns(session_override, signal)
    assert [row.agent_id for row in rows] == [first.id, second.id]
    assert all(row.status == "queued" and row.episode_id == message.id for row in rows)
    refreshed = await session_override.get(Signal, signal.id)
    assert str(first.id) in (refreshed.active_turn_json or "")


@pytest.mark.asyncio
async def test_same_message_twice_queues_once(client, session_override):
    _ = client
    signal, (agent,) = await _seed(session_override, names=["Extra"])
    body = f"@[Extra](agent:{agent.id}) hoi"
    message = await _say(session_override, signal, body)
    for _ in range(2):
        await pass_stick(
            session_override, signal, body_text=body, author_kind="user", author_id=uuid4(), message_id=message.id
        )
    assert len(await _turns(session_override, signal)) == 1


@pytest.mark.asyncio
async def test_agent_mention_does_not_queue_a_turn(client, session_override):
    _ = client
    signal, (opener, peer) = await _seed(session_override, names=["Extra", "Boekito"])
    moved = await pass_stick(
        session_override,
        signal,
        body_text=f"Ik vraag @[Boekito](agent:{peer.id}) om een zelfportret.",
        author_kind="agent",
        author_id=opener.id,
        author_name=opener.name,
    )
    assert moved["action"] == "none"
    assert await _turns(session_override, signal) == []


@pytest.mark.asyncio
async def test_new_human_message_supersedes_queued_turns_of_the_last_one(client, session_override):
    _ = client
    signal, (first, second) = await _seed(session_override, names=["Bokito", "Extra"])
    old_body = f"allebei @[Bokito](agent:{first.id}) @[Extra](agent:{second.id})"
    old = await _say(session_override, signal, old_body)
    await pass_stick(
        session_override, signal, body_text=old_body, author_kind="user", author_id=uuid4(), message_id=old.id
    )
    new_body = f"@[Extra](agent:{second.id}) laat maar, alleen jij"
    new = await _say(session_override, signal, new_body)
    await pass_stick(
        session_override, signal, body_text=new_body, author_kind="user", author_id=uuid4(), message_id=new.id
    )
    rows = await _turns(session_override, signal)
    old_rows = [row for row in rows if row.episode_id == old.id]
    assert old_rows and all(row.status == "cancelled" for row in old_rows)
    live = [row for row in rows if row.status == "queued"]
    assert [row.agent_id for row in live] == [second.id]
