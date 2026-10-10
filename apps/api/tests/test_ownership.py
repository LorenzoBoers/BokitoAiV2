"""Owner and turn: every conversation has an owner; the turn follows the thread."""

import json
from datetime import datetime, timedelta

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


async def _email_thread(session: AsyncSession, tenant, *, inbound: bool = True):
    from app.models.signal import Signal, SignalMessage

    signal = Signal(tenant_id=tenant.id, channel="email", subject="Invoice question")
    session.add(signal)
    await session.flush()
    if inbound:
        session.add(
            SignalMessage(
                tenant_id=tenant.id,
                signal_id=signal.id,
                kind="user_message",
                direction="inbound",
                body="Where is my invoice?",
            )
        )
    await session.commit()
    await session.refresh(signal)
    return signal


@pytest.mark.asyncio
async def test_new_conversation_belongs_to_all_people(client: AsyncClient, session_override: AsyncSession):
    from app.models.team import Team

    tenant, _ = await _tenant_and_user(session_override)
    signal = await _email_thread(session_override, tenant)
    team = await session_override.get(Team, signal.assignee_team_id)
    assert signal.assignee_kind == "team"
    assert team is not None and team.kind == "people"
    assert (signal.turn_kind, signal.turn_team_id, signal.turn_reason) == (
        "team",
        team.id,
        "reply_needed",
    )


@pytest.mark.asyncio
async def test_channel_owner_team_is_default(client: AsyncClient, session_override: AsyncSession):
    from app.models.channel import ChannelAccount
    from app.models.signal import Signal
    from app.services.teams import create_team

    tenant, _ = await _tenant_and_user(session_override)
    team = await create_team(session_override, tenant.id, name="Billing")
    account = (await session_override.execute(select(ChannelAccount))).scalars().first()
    account.settings_json = json.dumps({"routing": {"team_id": str(team.id)}})
    await session_override.commit()

    signal = Signal(tenant_id=tenant.id, channel="email", channel_account_id=account.id, subject="Hi")
    session_override.add(signal)
    await session_override.commit()
    assert signal.assignee_kind == "team"
    assert signal.assignee_team_id == team.id


@pytest.mark.asyncio
async def test_turn_moves_with_messages_and_decisions(client: AsyncClient, session_override: AsyncSession):
    from app.models.notification import DecisionRequest
    from app.models.signal import SignalMessage

    tenant, user = await _tenant_and_user(session_override)
    signal = await _email_thread(session_override, tenant)

    signal.assigned_user_id = user.id
    await session_override.commit()
    assert signal.assignee_kind == "user"
    assert (signal.turn_kind, signal.turn_user_id) == ("user", user.id)

    session_override.add(
        SignalMessage(
            tenant_id=tenant.id,
            signal_id=signal.id,
            kind="agent_message",
            direction="outbound",
            body="Here it is.",
            created_at=datetime.utcnow() + timedelta(seconds=1),
        )
    )
    await session_override.commit()
    assert signal.turn_kind == "customer"

    decision = DecisionRequest(
        tenant_id=tenant.id, signal_id=signal.id, title="Suggested reply", summary="Draft"
    )
    session_override.add(decision)
    await session_override.commit()
    assert (signal.turn_kind, signal.turn_reason) == ("user", "draft_ready")

    decision.status = "approved"
    await session_override.commit()
    assert signal.turn_kind == "customer"

    signal.status = "closed"
    await session_override.commit()
    assert signal.turn_kind == ""


@pytest.mark.asyncio
async def test_unassign_falls_back_to_team(client: AsyncClient, session_override: AsyncSession):
    tenant, user = await _tenant_and_user(session_override)
    signal = await _email_thread(session_override, tenant)
    signal.assigned_user_id = user.id
    await session_override.commit()
    signal.assigned_user_id = None
    await session_override.commit()
    assert signal.assignee_kind == "team"
    assert signal.assignee_team_id is not None


@pytest.mark.asyncio
async def test_patch_assignee_agent_and_team(client: AsyncClient, session_override: AsyncSession):
    from app.models.agent import Agent
    from app.services.teams import create_team

    headers = await _login(client)
    tenant, _ = await _tenant_and_user(session_override)
    signal = await _email_thread(session_override, tenant)
    agent = (await session_override.execute(select(Agent).where(Agent.slug == "assistant"))).scalars().first()
    team = await create_team(session_override, tenant.id, name="Support")
    await session_override.commit()

    r = await client.patch(
        f"/api/signals/{signal.id}",
        headers=headers,
        json={"assignee": {"kind": "agent", "id": str(agent.id)}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["owner"]["kind"] == "agent"
    assert body["owner"]["agent_id"] == str(agent.id)
    assert body["turn"]["kind"] == "agent"

    r = await client.patch(
        f"/api/signals/{signal.id}",
        headers=headers,
        json={"assignee": {"kind": "team", "id": str(team.id)}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["owner"] == {
        "kind": "team",
        "user_id": None,
        "agent_id": None,
        "team_id": str(team.id),
    }
    assert r.json()["turn"]["team_id"] == str(team.id)

    r = await client.patch(
        f"/api/signals/{signal.id}",
        headers=headers,
        json={"assignee": {"kind": "team", "id": "00000000-0000-0000-0000-000000000000"}},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_unassign_clears_person(client: AsyncClient, session_override: AsyncSession):
    from app.models.auth import user_numeric_id

    headers = await _login(client)
    tenant, user = await _tenant_and_user(session_override)
    signal = await _email_thread(session_override, tenant)
    num = user_numeric_id(user.id)

    r = await client.patch(
        f"/api/signals/{signal.id}",
        headers=headers,
        json={"assignee": {"kind": "user", "id": num}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["owner"]["kind"] == "user"
    assert r.json()["assigned_to_user_id"] == num

    r = await client.patch(
        f"/api/signals/{signal.id}",
        headers=headers,
        json={"assignee": {"kind": "team", "id": None}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["owner"]["kind"] == "team"
    assert body["assigned_to_user_id"] is None
    assert body["owner"]["user_id"] is None

    r = await client.patch(
        f"/api/signals/{signal.id}",
        headers=headers,
        json={"assignee": {"kind": "user", "id": num}},
    )
    assert r.status_code == 200, r.text
    r = await client.patch(
        f"/api/signals/{signal.id}",
        headers=headers,
        json={"assigned_to_user_id": 0},
    )
    assert r.status_code == 200, r.text
    assert r.json()["owner"]["kind"] == "team"
    assert r.json()["assigned_to_user_id"] is None


@pytest.mark.asyncio
async def test_for_you_predicate(client: AsyncClient, session_override: AsyncSession):
    from app.models.signal import Signal
    from app.services.ownership import for_you_predicate, unassigned_predicate

    tenant, user = await _tenant_and_user(session_override)
    mine = await _email_thread(session_override, tenant)
    mine.assigned_user_id = user.id
    other = await _email_thread(session_override, tenant)
    await session_override.commit()

    ids = set(
        (
            await session_override.execute(
                select(Signal.id).where(for_you_predicate(user.id, set()))
            )
        ).scalars().all()
    )
    assert mine.id in ids and other.id not in ids
    unassigned = set(
        (await session_override.execute(select(Signal.id).where(unassigned_predicate()))).scalars().all()
    )
    assert other.id in unassigned and mine.id not in unassigned


@pytest.mark.asyncio
async def test_for_you_includes_all_people_team_turn(
    client: AsyncClient, session_override: AsyncSession
):
    """When All people must reply, every member sees it in For you — not only personal assignees."""
    from app.models.signal import Signal
    from app.models.team import TEAM_KIND_PEOPLE, Team
    from app.services.ownership import for_you_predicate, turn_is_mine_predicate

    tenant, user = await _tenant_and_user(session_override)
    people = (
        await session_override.execute(
            select(Team).where(Team.tenant_id == tenant.id, Team.kind == TEAM_KIND_PEOPLE)
        )
    ).scalar_one()
    waiting = await _email_thread(session_override, tenant)
    assert waiting.assignee_kind == "team" and waiting.turn_reason == "reply_needed"

    for_you = set(
        (
            await session_override.execute(
                select(Signal.id).where(for_you_predicate(user.id, set(), people.id))
            )
        ).scalars().all()
    )
    mine_now = set(
        (
            await session_override.execute(
                select(Signal.id).where(turn_is_mine_predicate(user.id, set(), people.id))
            )
        ).scalars().all()
    )
    assert waiting.id in for_you
    assert waiting.id in mine_now
