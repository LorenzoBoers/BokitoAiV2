"""Decision addressee ("Ask questions to") and picking up team-owned conversations."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    r = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _tenant_and_user(session: AsyncSession):
    from app.models.auth import Tenant, User

    tenant = (await session.execute(select(Tenant))).scalars().first()
    user = (await session.execute(select(User).where(User.email == TEST_EMAIL))).scalars().first()
    return tenant, user


async def _thread(session: AsyncSession, tenant):
    from app.models.signal import Signal

    signal = Signal(tenant_id=tenant.id, channel="email", subject="Refund")
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal


async def _agent(session: AsyncSession, tenant, **settings):
    from app.models.agent import Agent

    agent = Agent(tenant_id=tenant.id, name="Support agent", kind="company", settings_json=json.dumps(settings))
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return agent


async def _decide(session: AsyncSession, tenant, signal, **kwargs):
    from app.services.signal_decisions import create_decision

    decision, _ = await create_decision(
        session,
        tenant.id,
        title="Refund 40 euro?",
        options=[{"id": "yes", "label": "Yes"}],
        signal_id=signal.id,
        **kwargs,
    )
    await session.commit()
    return decision


@pytest.mark.asyncio
async def test_auto_route_goes_to_owner_team(client: AsyncClient, session_override: AsyncSession):
    from app.models.notification import Notification

    tenant, _ = await _tenant_and_user(session_override)
    signal = await _thread(session_override, tenant)
    decision = await _decide(session_override, tenant, signal)
    assert (decision.addressee_kind, decision.addressee_team_id, decision.routed_by) == (
        "team",
        signal.assignee_team_id,
        "auto",
    )
    notification = await session_override.get(Notification, decision.notification_id)
    assert notification.user_id is None
    assert notification.signal_id == signal.id
    assert notification.tier == 1
    await session_override.refresh(signal)
    assert (signal.turn_kind, signal.turn_reason) == ("team", "question")


@pytest.mark.asyncio
async def test_person_owner_is_asked(client: AsyncClient, session_override: AsyncSession):
    from app.models.notification import Notification

    tenant, user = await _tenant_and_user(session_override)
    signal = await _thread(session_override, tenant)
    signal.assigned_user_id = user.id
    await session_override.commit()
    decision = await _decide(session_override, tenant, signal)
    assert (decision.addressee_kind, decision.addressee_user_id) == ("user", user.id)
    notification = await session_override.get(Notification, decision.notification_id)
    assert notification.user_id == user.id


@pytest.mark.asyncio
async def test_away_person_is_skipped(client: AsyncClient, session_override: AsyncSession):
    tenant, user = await _tenant_and_user(session_override)
    signal = await _thread(session_override, tenant)
    signal.assigned_user_id = user.id
    user.away = True
    await session_override.commit()
    decision = await _decide(session_override, tenant, signal)
    assert decision.addressee_kind == "team"


@pytest.mark.asyncio
async def test_agent_fixed_target_wins(client: AsyncClient, session_override: AsyncSession):
    from app.services.teams import create_team

    tenant, user = await _tenant_and_user(session_override)
    team = await create_team(session_override, tenant.id, name="Billing")
    await session_override.commit()
    agent = await _agent(session_override, tenant, ask_target={"kind": "team", "id": str(team.id)})
    signal = await _thread(session_override, tenant)
    signal.assigned_user_id = user.id
    await session_override.commit()
    decision = await _decide(session_override, tenant, signal, agent_id=agent.id)
    assert (decision.addressee_kind, decision.addressee_team_id, decision.routed_by) == (
        "team",
        team.id,
        "fixed",
    )


@pytest.mark.asyncio
async def test_explicit_to_by_team_name(client: AsyncClient, session_override: AsyncSession):
    from app.services.addressee import parse_target
    from app.services.teams import create_team

    tenant, _ = await _tenant_and_user(session_override)
    team = await create_team(session_override, tenant.id, name="Finance")
    await session_override.commit()
    target = await parse_target(session_override, tenant.id, "team:finance")
    assert target == {"kind": "team", "id": str(team.id)}
    signal = await _thread(session_override, tenant)
    decision = await _decide(session_override, tenant, signal, to=target)
    assert (decision.addressee_team_id, decision.routed_by) == (team.id, "fixed")


@pytest.mark.asyncio
async def test_agent_ask_target_via_api(client: AsyncClient, session_override: AsyncSession):
    from app.services.teams import create_team

    headers = await _login(client)
    tenant, _ = await _tenant_and_user(session_override)
    team = await create_team(session_override, tenant.id, name="Support")
    await session_override.commit()
    agent = await _agent(session_override, tenant)
    r = await client.patch(
        f"/api/workforce/agents/{agent.id}",
        headers=headers,
        json={"ask_target": {"kind": "team", "id": str(team.id)}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["agent"]["ask_target"] == {"kind": "team", "id": str(team.id)}
    r = await client.patch(
        f"/api/workforce/agents/{agent.id}", headers=headers, json={"ask_target": {"kind": "auto"}}
    )
    assert r.json()["agent"]["ask_target"] == {"kind": "auto", "id": None}


@pytest.mark.asyncio
async def test_self_assign_from_team_is_a_pick_up(client: AsyncClient, session_override: AsyncSession):
    from app.models.auth import user_numeric_id
    from app.models.signal import SignalEvent

    headers = await _login(client)
    tenant, user = await _tenant_and_user(session_override)
    signal = await _thread(session_override, tenant)
    team_id = signal.assignee_team_id
    r = await client.patch(
        f"/api/signals/{signal.id}",
        headers=headers,
        json={"assignee": {"kind": "user", "id": user_numeric_id(user.id)}},
    )
    assert r.status_code == 200, r.text
    events = (
        await session_override.execute(
            select(SignalEvent).where(SignalEvent.signal_id == signal.id, SignalEvent.event_type == "picked_up")
        )
    ).scalars().all()
    assert len(events) == 1
    assert json.loads(events[0].payload_json)["team_id"] == str(team_id)


@pytest.mark.asyncio
async def test_pick_up_only_from_team(client: AsyncClient, session_override: AsyncSession):
    from app.services.ownership import pick_up

    tenant, user = await _tenant_and_user(session_override)
    signal = await _thread(session_override, tenant)
    assert await pick_up(session_override, signal, user.id, via="reply") is True
    await session_override.commit()
    assert (signal.assignee_kind, signal.assigned_user_id) == ("user", user.id)
    assert await pick_up(session_override, signal, user.id, via="reply") is False
