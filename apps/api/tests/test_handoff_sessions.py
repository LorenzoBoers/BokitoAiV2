"""Nestable multi-agent handoff session helpers."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import Signal
from app.services.handoff_sessions import (
    choose_speaker,
    expand_invitees,
    get_handoff_session,
    interrupt_handoff_session,
    pick_opener,
)


async def _tenant(session):
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


async def _agent(session, tenant_id, *, name: str, role: str = "assistant", job_title: str = ""):
    agent = Agent(
        tenant_id=tenant_id,
        name=name,
        role=role,
        kind="company",
        is_active=True,
        slug=f"ho-{uuid4().hex[:8]}",
        job_title=job_title,
        tools_json="[]",
        settings_json="{}",
    )
    session.add(agent)
    await session.flush()
    return agent


async def _signal(session, tenant_id, *, agent_id=None):
    now = datetime.utcnow()
    signal = Signal(
        tenant_id=tenant_id,
        channel="internal",
        source="test",
        subject="Handoff",
        status="open",
        agent_id=agent_id,
        created_at=now,
        updated_at=now,
        last_message_at=now,
        active_turn_json="{}",
        handoff_session_json="{}",
    )
    session.add(signal)
    await session.flush()
    return signal


@pytest.mark.asyncio
async def test_pick_opener_prefers_channel_when_no_mentions(client, session_override):
    _ = client
    tenant = await _tenant(session_override)
    a = await _agent(session_override, tenant.id, name="A", role="assistant")
    b = await _agent(session_override, tenant.id, name="B", role="orchestrator")
    opener = pick_opener([a, b], channel_agent_id=a.id)
    assert opener is not None
    assert opener.id == a.id


@pytest.mark.asyncio
async def test_pick_opener_prefers_first_mention_over_channel(client, session_override):
    """@Extra … tell @Bokito must open as Extra, not the thread channel agent."""
    _ = client
    tenant = await _tenant(session_override)
    channel = await _agent(session_override, tenant.id, name="Bokito", role="assistant")
    extra = await _agent(session_override, tenant.id, name="Extra", role="assistant")
    opener = pick_opener(
        [channel, extra],
        channel_agent_id=channel.id,
        mention_order=[extra.id, channel.id],
    )
    assert opener is not None
    assert opener.id == extra.id


@pytest.mark.asyncio
async def test_pick_opener_uses_hierarchy(client, session_override):
    _ = client
    tenant = await _tenant(session_override)
    junior = await _agent(session_override, tenant.id, name="Junior", role="assistant")
    lead = await _agent(
        session_override, tenant.id, name="Lead", role="orchestrator", job_title="Lead"
    )
    opener = pick_opener([junior, lead], channel_agent_id=None)
    assert opener is not None
    assert opener.id == lead.id


def test_choose_speaker_drops_a_refused_name():
    extra = Agent(id=uuid4(), name="Extra test agent", role="assistant")
    bokito = Agent(id=uuid4(), name="Bokito assistant", role="assistant")
    text = "Ik wil eigenlijk even geen test agent spreken, kan iemand anders mij helpen"
    opener = choose_speaker([extra, bokito], text, mention_order=[extra.id, bokito.id])
    assert opener is not None
    assert opener.id == bokito.id


def test_choose_speaker_keeps_the_agent_who_was_asked_to_act():
    extra = Agent(id=uuid4(), name="Extra", role="assistant")
    bokito = Agent(id=uuid4(), name="Bokito", role="assistant")
    text = "Extra, tell Bokito thanks"
    opener = choose_speaker(
        [bokito, extra],
        text,
        mention_order=[extra.id, bokito.id],
        channel_agent_id=bokito.id,
    )
    assert opener is not None
    assert opener.id == extra.id


@pytest.mark.asyncio
async def test_ask_stream_untagged_follows_last_speaker(
    client, session_override, monkeypatch
):
    """Untagged Ask without agent_id continues with the last agent author."""
    import json
    from datetime import datetime

    from app.models.signal import SignalMessage
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    tenant = await _tenant(session_override)
    channel = await _agent(session_override, tenant.id, name="Orchestrator", role="orchestrator")
    peer = await _agent(session_override, tenant.id, name="Bokito", role="assistant")
    signal = await _signal(session_override, tenant.id, agent_id=channel.id)
    now = datetime.utcnow()
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            kind="agent_message",
            direction="outbound",
            body_text="peer said hi",
            body_preview="peer said hi",
            author_agent_id=peer.id,
            created_at=now,
            received_at=now,
        )
    )
    await session_override.commit()

    driven: list[str] = []

    async def _fake_drive(**kwargs):
        driven.append(str(kwargs.get("agent_id")))
        queue = kwargs["queue"]
        await queue.put(
            {"event": "done", "data": json.dumps({"text": "follow-ok", "llm_configured": True})}
        )
        await queue.put(None)

    monkeypatch.setattr(
        "app.routers.signal_chat._drive_operator_chat_turn",
        _fake_drive,
    )

    async def _noop_live(*_a, **_k):
        return None

    monkeypatch.setattr("app.routers.signal_chat._set_chat_agent_live", _noop_live)

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    async with client.stream(
        "POST",
        f"/api/signals/conversations/{signal.id}/stream",
        json={"content": "Maar hoe is het met jou?"},
        headers=headers,
    ) as resp:
        assert resp.status_code == 200, await resp.aread()
        async for _line in resp.aiter_lines():
            pass

    assert driven == [str(peer.id)]


@pytest.mark.asyncio
async def test_ask_stream_sole_mention_beats_stale_prefer(client, session_override, monkeypatch):
    """Solo @peer Ask must drive that peer even when agent_id is the channel default."""
    import json

    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    tenant = await _tenant(session_override)
    channel = await _agent(session_override, tenant.id, name="Orchestrator", role="orchestrator")
    peer = await _agent(session_override, tenant.id, name="Bokito", role="assistant")
    signal = await _signal(session_override, tenant.id, agent_id=channel.id)
    await session_override.commit()

    driven: list[str] = []

    async def _fake_drive(**kwargs):
        driven.append(str(kwargs.get("agent_id")))
        queue = kwargs["queue"]
        await queue.put({"event": "done", "data": json.dumps({"text": "peer-ok", "llm_configured": True})})
        await queue.put(None)

    monkeypatch.setattr(
        "app.routers.signal_chat._drive_operator_chat_turn",
        _fake_drive,
    )

    async def _noop_live(*_a, **_k):
        return None

    monkeypatch.setattr("app.routers.signal_chat._set_chat_agent_live", _noop_live)

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    body = f"@[Bokito](agent:{peer.id}) zeg alleen: peer-ok"

    async with client.stream(
        "POST",
        f"/api/signals/conversations/{signal.id}/stream",
        # Stale Ask-tab target = channel Orchestrator; body tags Bokito only.
        json={"content": body, "agent_id": str(channel.id)},
        headers=headers,
    ) as resp:
        assert resp.status_code == 200, await resp.aread()
        async for _line in resp.aiter_lines():
            pass

    assert driven == [str(peer.id)]


@pytest.mark.asyncio
async def test_humans_only_expand_has_no_agents(client, session_override):
    _ = client
    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id)
    invitees = await expand_invitees(session_override, tenant.id, signal, "@[Sam](user:42) @[Alex](user:99)")
    assert invitees["agents"] == []
    assert invitees["total"] == 2


@pytest.mark.asyncio
async def test_interrupt_marks_an_old_session(client, session_override):
    import json

    _ = client
    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id)
    signal.handoff_session_json = json.dumps({"id": "old", "status": "open", "depth": 1})
    interrupted = await interrupt_handoff_session(
        session_override, signal, by_message_id=uuid4(), reason="user_send"
    )
    assert interrupted is not None
    assert get_handoff_session(signal)["status"] == "interrupted"


@pytest.mark.asyncio
async def test_ask_stream_two_agents_queues_both_in_order(client, session_override):
    """Ask SSE with two @agents queues one turn each; the first holds the floor."""
    import json

    from app.models.agent_turn import AgentTurn
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    tenant = await _tenant(session_override)
    a = await _agent(session_override, tenant.id, name="Alpha", role="assistant")
    b = await _agent(session_override, tenant.id, name="Beta", role="orchestrator")
    signal = await _signal(session_override, tenant.id, agent_id=a.id)
    await session_override.commit()

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    body = f"@[Alpha](agent:{a.id}) @[Beta](agent:{b.id}) allebei hoi"
    async with client.stream(
        "POST",
        f"/api/signals/conversations/{signal.id}/stream",
        json={"content": body},
        headers=headers,
    ) as resp:
        assert resp.status_code == 200, await resp.aread()
        chunks = [json.loads(line[5:].strip()) async for line in resp.aiter_lines() if line.startswith("data:")]

    assert any(c.get("handoff") and c.get("opener_id") == str(a.id) for c in chunks)
    rows = (
        await session_override.execute(
            select(AgentTurn).where(AgentTurn.signal_id == signal.id).order_by(AgentTurn.created_at)
        )
    ).scalars().all()
    assert [row.agent_id for row in rows] == [a.id, b.id]
