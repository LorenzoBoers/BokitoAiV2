"""One stick after a group message: pass, owed queue, human-only, cap."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import Signal, SignalMessage
from app.services.participant_turns import MAX_CONSECUTIVE_TURNS
from app.services.pass_stick import decide_stick, pass_stick


def test_decide_passes_the_stick_and_keeps_the_queue():
    holder = uuid4()
    peer = uuid4()
    choice = decide_stick(
        author_kind="agent",
        mentioned_agent_ids=[peer],
        mentioned_human_ids=[],
        text="your turn",
        holder_id=holder,
        owed=[],
        streak=1,
        wake_default=False,
        channel_agent_id=None,
    )
    assert choice["action"] == "give"
    assert choice["agent_id"] == peer
    assert choice["reason"] == "passed"


def test_decide_reply_without_a_pass_puts_the_stick_down():
    choice = decide_stick(
        author_kind="agent",
        mentioned_agent_ids=[],
        mentioned_human_ids=[],
        text="done",
        holder_id=uuid4(),
        owed=[],
        streak=2,
        wake_default=False,
        channel_agent_id=None,
    )
    assert choice["action"] == "clear"
    assert choice["reason"] == "done"


def test_decide_plural_owes_each_named_agent_once():
    first, second = uuid4(), uuid4()
    choice = decide_stick(
        author_kind="user",
        mentioned_agent_ids=[first, second],
        mentioned_human_ids=[],
        text="allebei een afbeelding",
        holder_id=None,
        owed=[],
        streak=0,
        wake_default=False,
        channel_agent_id=None,
    )
    assert choice["action"] == "give"
    assert choice["agent_id"] == first
    assert choice["owed"] == [str(second)]
    assert choice["reason"] == "plural"


def test_decide_human_only_clears():
    person = uuid4()
    choice = decide_stick(
        author_kind="agent",
        mentioned_agent_ids=[],
        mentioned_human_ids=[person],
        text="over to you",
        holder_id=uuid4(),
        owed=["left-over"],
        streak=3,
        wake_default=False,
        channel_agent_id=None,
    )
    assert choice["action"] == "clear"
    assert choice["reason"] == "human_only"
    assert choice["notify_user_ids"] == [person]


def test_decide_cap_closes_before_another_pass():
    choice = decide_stick(
        author_kind="agent",
        mentioned_agent_ids=[uuid4()],
        mentioned_human_ids=[],
        text="and you",
        holder_id=uuid4(),
        owed=[],
        streak=MAX_CONSECUTIVE_TURNS,
        wake_default=False,
        channel_agent_id=None,
    )
    assert choice["action"] == "clear"
    assert choice["reason"] == "cap"


def test_decide_follow_up_keeps_the_holder():
    holder = uuid4()
    choice = decide_stick(
        author_kind="user",
        mentioned_agent_ids=[],
        mentioned_human_ids=[],
        text="go on",
        holder_id=holder,
        owed=[],
        streak=1,
        wake_default=False,
        channel_agent_id=None,
    )
    assert choice["action"] == "give"
    assert choice["agent_id"] == holder
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


@pytest.mark.asyncio
async def test_pass_stick_plural_queues_the_second_agent(client, session_override):
    _ = client
    signal, agents = await _seed(session_override, names=["Bokito", "Extra"])
    first, second = agents
    body = (
        f"allebei @[Bokito](agent:{first.id}) @[Extra](agent:{second.id})"
    )
    moved = await pass_stick(
        session_override,
        signal,
        body_text=body,
        author_kind="user",
        author_id=uuid4(),
        enqueue=False,
    )
    assert moved["action"] == "give"
    assert moved["holder_id"] == str(first.id)
    assert moved["owed"] == [str(second.id)]
    refreshed = await session_override.get(Signal, signal.id)
    assert str(second.id) in (refreshed.active_turn_json or "")


@pytest.mark.asyncio
async def test_pass_stick_cap_posts_one_line_and_clears(client, session_override):
    _ = client
    signal, agents = await _seed(session_override, names=["Extra"])
    holder = agents[0]
    signal.active_turn_json = (
        '{"kind":"agent","ref_id":"%s","nonce":"n","streak":%s}'
        % (holder.id, MAX_CONSECUTIVE_TURNS)
    )
    session_override.add(signal)
    await session_override.flush()
    peer = uuid4()
    moved = await pass_stick(
        session_override,
        signal,
        body_text=f"@[Peer](agent:{peer})",
        author_kind="agent",
        author_id=holder.id,
        author_name=holder.name,
        enqueue=False,
    )
    assert moved["action"] == "clear"
    assert moved["reason"] == "cap"
    refreshed = await session_override.get(Signal, signal.id)
    assert "nonce" not in (refreshed.active_turn_json or "")
    rows = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.signal_id == signal.id)
        )
    ).scalars().all()
    assert any("turn is back" in (row.body_text or "").lower() or "beurt" in (row.body_text or "").lower() for row in rows)
