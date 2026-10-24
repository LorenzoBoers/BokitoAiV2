"""Move and merge between conversations, intercom lanes, and dock seats."""

import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.conversation_moves import intercom_lane, merge_conversations, move_messages
from app.services.dock_agents import live_dock, read_dock, write_dock
from app.services.intercom import addressed_agent, spoken_text
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


async def _internal(session, tenant_id, subject: str, bodies: list[str]):
    signal = Signal(tenant_id=tenant_id, channel="internal", source="operator", subject=subject)
    session.add(signal)
    await session.flush()
    start = datetime.utcnow() - timedelta(hours=1)
    rows = []
    for offset, body in enumerate(bodies):
        row = SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant_id,
            direction="internal",
            kind="user_message",
            role="user",
            body_text=body,
            created_at=start + timedelta(minutes=offset),
        )
        session.add(row)
        rows.append(row)
    await session.commit()
    await session.refresh(signal)
    return signal, rows


@pytest.mark.asyncio
async def test_move_to_new_and_existing_keeps_order(client: AsyncClient, session_override):
    _ = client
    tenant = await _tenant(session_override)
    source, rows = await _internal(session_override, tenant.id, "Planning", ["a", "b", "c"])
    other, _ = await _internal(session_override, tenant.id, "Invoices", ["x"])

    new = await move_messages(session_override, tenant.id, source.id, message_ids=[rows[2].id], title="Branch")
    assert new.parent_signal_id == source.id
    assert new.subject == "Branch"

    await move_messages(session_override, tenant.id, source.id, from_message_id=rows[1].id, target_id=other.id)
    bodies = (
        await session_override.execute(
            select(SignalMessage.body_text).where(SignalMessage.signal_id == other.id).order_by(SignalMessage.seq)
        )
    ).scalars().all()
    assert bodies == ["x", "b"]
    events = (
        await session_override.execute(
            select(SignalEvent).where(SignalEvent.signal_id == other.id, SignalEvent.event_type == "moved")
        )
    ).scalars().all()
    assert json.loads(events[0].payload_json)["direction"] == "in"


@pytest.mark.asyncio
async def test_merge_closes_and_points_forward(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    source, _ = await _internal(session_override, tenant.id, "Dup", ["one", "two"])
    target, _ = await _internal(session_override, tenant.id, "Main", ["zero"])
    res = await client.post(
        f"/api/signals/{source.id}/merge", headers=headers, json={"target_signal_id": str(target.id)}
    )
    assert res.status_code == 200, res.text
    session_override.expunge_all()
    old = await session_override.get(Signal, source.id)
    assert old.superseded_by_id == target.id
    assert old.status == "closed"
    count = (
        await session_override.execute(select(SignalMessage.id).where(SignalMessage.signal_id == target.id))
    ).scalars().all()
    assert len(count) == 3


@pytest.mark.asyncio
async def test_merge_into_self_is_refused(client: AsyncClient, session_override):
    _ = client
    tenant = await _tenant(session_override)
    source, _ = await _internal(session_override, tenant.id, "Solo", ["one"])
    with pytest.raises(Exception):
        await merge_conversations(session_override, tenant.id, source.id, source.id)


@pytest.mark.asyncio
async def test_lane_and_dock(client: AsyncClient, session_override):
    _ = client
    tenant = await _tenant(session_override)
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id).limit(1))
    ).scalar_one()
    lane = await intercom_lane(session_override, tenant.id, user.id, agent)
    again = await intercom_lane(session_override, tenant.id, user.id, agent)
    assert lane.id == again.id

    rows = await write_dock(session_override, tenant.id, user, [{"agent_id": str(agent.id), "dial_key": "F4"}])
    assert rows == [{"agent_id": str(agent.id), "dial_key": "F4"}]
    assert read_dock(user) == rows
    with pytest.raises(Exception):
        await write_dock(session_override, tenant.id, user, [{"agent_id": str(agent.id), "dial_key": "F5"}])


@pytest.mark.asyncio
async def test_write_dock_drops_stale_pins(client: AsyncClient, session_override):
    """Pins from another tenant or an inactive agent must not block a new pin."""
    _ = client
    tenant = await _tenant(session_override)
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id).limit(1))
    ).scalar_one()
    stale_id = UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    rows = await write_dock(
        session_override,
        tenant.id,
        user,
        [
            {"agent_id": str(stale_id), "dial_key": "F1"},
            {"agent_id": str(agent.id), "dial_key": "F8"},
        ],
    )
    assert rows == [{"agent_id": str(agent.id), "dial_key": "F8"}]
    assert await live_dock(session_override, tenant.id, user) == rows
    with pytest.raises(Exception):
        await write_dock(
            session_override,
            tenant.id,
            user,
            [{"agent_id": str(stale_id), "dial_key": "F1"}],
        )


def test_addressed_agent_and_spoken_text():
    a = SimpleNamespace(name="Orchestrator", id=UUID(int=1))
    b = SimpleNamespace(name="Finance Bot", id=UUID(int=2))
    found, rest = addressed_agent("Orchestrator, plan de demo voor vrijdag", [a, b])
    assert found is a and rest == "plan de demo voor vrijdag"
    found, rest = addressed_agent("finance bot wat staat er open", [a, b])
    assert found is b and rest == "wat staat er open"
    assert addressed_agent("plan iets", [a, b])[0] is None
    assert spoken_text("**Klaar.** Zie [factuur](https://x)") == "Klaar. Zie factuur"
