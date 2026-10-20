"""An untagged team message goes to the last speaker unless the router is sure."""

from __future__ import annotations

from datetime import datetime

import pytest

from app.models.signal import SignalMessage
from app.services import team_router
from app.services.participants import ensure_participant
from test_agent_turns import _human, _seed


async def _two_agents_last_spoke(session):
    signal, (first, second) = await _seed(session)
    for agent in (first, second):
        await ensure_participant(session, signal, kind="agent", ref_id=agent.id, role="member", joined_via="test")
    await _human(session, signal, "hoi")
    session.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            role="assistant",
            direction="outbound",
            kind="agent_message",
            author_agent_id=second.id,
            body_text="Ik ben er.",
            received_at=datetime.utcnow(),
        )
    )
    await session.commit()
    return signal, first, second


@pytest.mark.asyncio
async def test_last_speaker_is_the_default(client, session_override, monkeypatch):
    _ = client
    signal, _first, second = await _two_agents_last_spoke(session_override)

    async def unsure(*_args):
        return None, 0.0

    monkeypatch.setattr(team_router, "_ask_model", unsure)
    pick = await team_router.pick_responder(session_override, signal, "En nu?")
    assert (pick.agent_id, pick.reason) == (second.id, "last_speaker")


@pytest.mark.asyncio
async def test_router_wins_only_when_sure(client, session_override, monkeypatch):
    _ = client
    signal, first, second = await _two_agents_last_spoke(session_override)

    async def sure(*_args):
        return first.id, 0.9

    monkeypatch.setattr(team_router, "_ask_model", sure)
    pick = await team_router.pick_responder(session_override, signal, "Boek deze factuur")
    assert (pick.agent_id, pick.reason) == (first.id, "router")

    async def doubtful(*_args):
        return first.id, 0.4

    monkeypatch.setattr(team_router, "_ask_model", doubtful)
    pick = await team_router.pick_responder(session_override, signal, "Boek deze factuur")
    assert pick.agent_id == second.id


@pytest.mark.asyncio
async def test_router_error_keeps_the_default(client, session_override, monkeypatch):
    _ = client
    signal, _first, second = await _two_agents_last_spoke(session_override)

    async def broken(*_args):
        raise RuntimeError("provider down")

    monkeypatch.setattr(team_router, "_ask_model", broken)
    pick = await team_router.pick_responder(session_override, signal, "Hallo")
    assert pick.agent_id == second.id
