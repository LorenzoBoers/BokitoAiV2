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
    MAX_HANDOFF_DEPTH,
    choose_speaker,
    expand_invitees,
    get_handoff_session,
    interrupt_handoff_session,
    nest_handoff,
    pick_opener,
    start_handoff_session,
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
async def test_single_agent_mention_skips_handoff(client, session_override, monkeypatch):
    _ = client
    tenant = await _tenant(session_override)
    agent = await _agent(session_override, tenant.id, name="Solo")
    signal = await _signal(session_override, tenant.id, agent_id=agent.id)

    async def _boom(*_a, **_k):
        raise AssertionError("should not enqueue")

    monkeypatch.setattr(
        "app.services.participant_turns.request_participant_turn",
        _boom,
    )
    body = f"Hey @[Solo](agent:{agent.id})"
    started = await start_handoff_session(
        session_override,
        tenant.id,
        signal,
        body_text=body,
        author_user_id=uuid4(),
    )
    assert started is None


@pytest.mark.asyncio
async def test_two_agents_start_handoff_with_opener(client, session_override, monkeypatch):
    _ = client
    tenant = await _tenant(session_override)
    a = await _agent(session_override, tenant.id, name="Alpha", role="assistant")
    b = await _agent(session_override, tenant.id, name="Beta", role="orchestrator")
    signal = await _signal(session_override, tenant.id, agent_id=a.id)

    called: list[str] = []

    async def _fake_turn(session, signal, **kwargs):
        called.append(str(kwargs.get("member_ref_id")))
        return {"ok": True, "outcome": "queued"}

    monkeypatch.setattr(
        "app.services.participant_turns.request_participant_turn",
        _fake_turn,
    )
    # First mention is Beta even though the channel default is Alpha.
    body = f"@[Beta](agent:{b.id}) please tell @[Alpha](agent:{a.id}) thanks"
    started = await start_handoff_session(
        session_override,
        tenant.id,
        signal,
        body_text=body,
        author_user_id=uuid4(),
        channel_agent_id=a.id,
    )
    assert started is not None
    assert started["opener_id"] == str(b.id)
    assert called == [str(b.id)]
    state = get_handoff_session(signal)
    assert state is not None
    assert state["status"] == "open"
    assert set(state["agent_ids"]) == {str(a.id), str(b.id)}


@pytest.mark.asyncio
async def test_audience_without_mentions_opens_the_other_agent(client, session_override, monkeypatch):
    _ = client
    tenant = await _tenant(session_override)
    extra = await _agent(session_override, tenant.id, name="Extra test agent")
    bokito = await _agent(session_override, tenant.id, name="Bokito assistant")
    signal = await _signal(session_override, tenant.id, agent_id=extra.id)
    called: list[str] = []

    async def _fake_turn(session, signal, **kwargs):
        called.append(str(kwargs.get("member_ref_id")))
        prompt = str(kwargs.get("prompt") or "")
        assert "geen test agent" in prompt
        assert "Bokito assistant" in prompt
        return {"ok": True, "outcome": "queued"}

    monkeypatch.setattr(
        "app.services.participant_turns.request_participant_turn",
        _fake_turn,
    )
    started = await start_handoff_session(
        session_override,
        tenant.id,
        signal,
        body_text="Ik wil eigenlijk even geen test agent spreken, kan iemand anders mij helpen",
        author_user_id=uuid4(),
        channel_agent_id=extra.id,
        extra_agent_ids=[extra.id, bokito.id],
    )
    assert started is not None
    assert started["opener_id"] == str(bokito.id)
    assert called == [str(bokito.id)]


@pytest.mark.asyncio
async def test_humans_only_expand_has_no_agents(client, session_override):
    _ = client
    tenant = await _tenant(session_override)
    signal = await _signal(session_override, tenant.id)
    body = "@[Sam](user:42) @[Alex](user:99)"
    invitees = await expand_invitees(session_override, tenant.id, signal, body)
    assert invitees["agents"] == []
    assert invitees["total"] == 2
    started = await start_handoff_session(
        session_override,
        tenant.id,
        signal,
        body_text=body,
        author_user_id=uuid4(),
    )
    assert started is None


@pytest.mark.asyncio
async def test_nest_handoff_requests_peer_as_agent_not_user(
    client, session_override, monkeypatch
):
    """Nested baton must not pass the opener agent id as usage user_id."""
    _ = client
    tenant = await _tenant(session_override)
    a = await _agent(session_override, tenant.id, name="Extra")
    b = await _agent(session_override, tenant.id, name="Bokito")
    signal = await _signal(session_override, tenant.id)

    captured: list[dict] = []

    async def _fake_turn(*_a, **kwargs):
        captured.append(kwargs)
        return {"ok": True, "outcome": "queued"}

    monkeypatch.setattr(
        "app.services.participant_turns.request_participant_turn",
        _fake_turn,
    )
    body = f"@[Extra](agent:{a.id}) @[Bokito](agent:{b.id})"
    await start_handoff_session(
        session_override,
        tenant.id,
        signal,
        body_text=body,
        author_user_id=uuid4(),
    )
    nested = await nest_handoff(
        session_override,
        tenant.id,
        signal,
        body_text=f"@[Bokito](agent:{b.id}) how are you?",
        from_agent_id=a.id,
    )
    assert nested.get("ok") is True
    assert len(captured) >= 2
    baton = captured[-1]
    assert baton.get("requested_by_kind") == "agent"
    assert baton.get("requested_by_id") == a.id
    assert baton.get("defer_peer") is False
    assert baton.get("member_ref_id") == b.id


@pytest.mark.asyncio
async def test_nest_depth_exceeded(client, session_override, monkeypatch):
    _ = client
    tenant = await _tenant(session_override)
    a = await _agent(session_override, tenant.id, name="A")
    b = await _agent(session_override, tenant.id, name="B")
    signal = await _signal(session_override, tenant.id)

    async def _fake_turn(*_a, **_k):
        return {"ok": True, "outcome": "queued"}

    monkeypatch.setattr(
        "app.services.participant_turns.request_participant_turn",
        _fake_turn,
    )
    body = f"@[A](agent:{a.id}) @[B](agent:{b.id})"
    await start_handoff_session(
        session_override,
        tenant.id,
        signal,
        body_text=body,
        author_user_id=uuid4(),
        depth=MAX_HANDOFF_DEPTH,
    )
    state = get_handoff_session(signal)
    assert state is not None
    state["depth"] = MAX_HANDOFF_DEPTH
    signal.handoff_session_json = __import__("json").dumps(state)

    nested = await nest_handoff(
        session_override,
        tenant.id,
        signal,
        body_text=body,
        from_agent_id=a.id,
    )
    assert nested.get("ok") is False
    assert nested.get("error") == "handoff_depth_exceeded"


@pytest.mark.asyncio
async def test_interrupt_clears_session(client, session_override, monkeypatch):
    _ = client
    tenant = await _tenant(session_override)
    a = await _agent(session_override, tenant.id, name="A")
    b = await _agent(session_override, tenant.id, name="B")
    signal = await _signal(session_override, tenant.id)

    async def _fake_turn(*_a, **_k):
        return {"ok": True, "outcome": "queued"}

    monkeypatch.setattr(
        "app.services.participant_turns.request_participant_turn",
        _fake_turn,
    )
    body = f"@[A](agent:{a.id}) @[B](agent:{b.id})"
    await start_handoff_session(
        session_override,
        tenant.id,
        signal,
        body_text=body,
        author_user_id=uuid4(),
    )
    interrupted = await interrupt_handoff_session(
        session_override, signal, by_message_id=uuid4(), reason="user_send"
    )
    assert interrupted is not None
    assert interrupted["status"] == "interrupted"
    assert get_handoff_session(signal)["status"] == "interrupted"


@pytest.mark.asyncio
async def test_ask_stream_two_agents_starts_handoff(client, session_override, monkeypatch):
    """Ask SSE with ≥2 @agents starts a handoff instead of a solo drive."""
    import json

    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    tenant = await _tenant(session_override)
    a = await _agent(session_override, tenant.id, name="Alpha", role="assistant")
    b = await _agent(session_override, tenant.id, name="Beta", role="orchestrator")
    signal = await _signal(session_override, tenant.id, agent_id=a.id)
    await session_override.commit()

    called: list[str] = []

    async def _fake_turn(session, signal_row, **kwargs):
        called.append(str(kwargs.get("member_ref_id")))
        return {"ok": True, "outcome": "queued"}

    monkeypatch.setattr(
        "app.services.participant_turns.request_participant_turn",
        _fake_turn,
    )

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    body = f"@[Alpha](agent:{a.id}) @[Beta](agent:{b.id}) both say hi"

    async with client.stream(
        "POST",
        f"/api/signals/conversations/{signal.id}/stream",
        json={"content": body},
        headers=headers,
    ) as resp:
        assert resp.status_code == 200, await resp.aread()
        chunks = []
        async for line in resp.aiter_lines():
            if line.startswith("data:"):
                chunks.append(json.loads(line[5:].strip()))

    assert any(c.get("handoff") for c in chunks)
    assert called == [str(a.id)]
    await session_override.refresh(signal)
    state = get_handoff_session(signal)
    assert state is not None
    assert state["status"] == "open"
    assert set(state["agent_ids"]) == {str(a.id), str(b.id)}


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
