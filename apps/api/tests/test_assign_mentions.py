"""Assign to people, agents and teams with a handover message; @agent and @team in notes."""

from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.notification import Notification
from app.models.signal import SignalMessage
from app.services.thread_dispatch import entity_mentions, plain_mentions
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient, email: str = TEST_EMAIL, password: str = TEST_PASSWORD) -> dict:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _add_teammate(client: AsyncClient, owner: dict, email: str) -> None:
    r = await client.post("/api/auth/invite", headers=owner, json={"email": email, "role": "member"})
    assert r.status_code == 200, r.text
    r = await client.post(
        "/api/auth/accept-invite",
        json={"token": r.json()["token"], "password": "teammate123", "display_name": "Teammate"},
    )
    assert r.status_code == 200, r.text


async def _thread(client: AsyncClient, headers: dict) -> str:
    r = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "test",
            "subject": "Invoice question",
            "body_text": "Why is my invoice higher this month?",
            "contact_email": "customer@example.com",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _agent(session) -> Agent:
    tenant = (await session.execute(select(Tenant))).scalar_one()
    agent = Agent(tenant_id=tenant.id, name="Billing", kind="company")
    session.add(agent)
    await session.commit()
    return agent


async def _notes(session, signal_id: str) -> list[SignalMessage]:
    session.expire_all()
    rows = await session.execute(
        select(SignalMessage)
        .where(SignalMessage.signal_id == UUID(signal_id), SignalMessage.kind == "internal_note")
        .order_by(SignalMessage.created_at)
    )
    return list(rows.scalars().all())


def test_entity_mention_parsing():
    agent_id = "11111111-1111-1111-1111-111111111111"
    team_id = "22222222-2222-2222-2222-222222222222"
    body = f"@[Billing](agent:{agent_id}) and @[Support](team:{team_id}) please, @[Billing](agent:{agent_id})"
    assert entity_mentions(body) == [("agent", UUID(agent_id)), ("team", UUID(team_id))]
    assert plain_mentions(body).startswith("@Billing and @Support")


async def test_assignees_lists_people_agents_and_teams(client: AsyncClient, session_override):
    headers = await _login(client)
    signal_id = await _thread(client, headers)
    agent = await _agent(session_override)

    r = await client.get(f"/api/signals/{signal_id}/assignees", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert any(p["email"] == TEST_EMAIL and p["can_handle"] for p in body["people"])
    assert any(a["id"] == str(agent.id) for a in body["agents"])
    assert [t["kind"] for t in body["teams"]][:2] == ["people", "agents"]


async def test_assign_to_agent_with_message_runs_the_agent(client: AsyncClient, session_override):
    headers = await _login(client)
    signal_id = await _thread(client, headers)
    agent_id = (await _agent(session_override)).id

    r = await client.patch(
        f"/api/signals/{signal_id}",
        headers=headers,
        json={"assignee": {"kind": "agent", "id": str(agent_id), "message": "Check the last invoice"}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["owner"]["kind"] == "agent"

    notes = await _notes(session_override, signal_id)
    handover = [n for n in notes if n.author_user_id is not None]
    assert handover and f"(agent:{agent_id})" in handover[0].body_text
    assert "Check the last invoice" in handover[0].body_text
    assert any(n.author_agent_id == agent_id for n in notes)


async def test_team_mention_notifies_the_people_in_the_team(client: AsyncClient, session_override):
    owner = await _login(client)
    await _add_teammate(client, owner, "support@example.com")
    teammate = (
        await session_override.execute(select(User).where(User.email == "support@example.com"))
    ).scalar_one()
    teammate_id = teammate.id
    r = await client.post(
        "/api/teams",
        headers=owner,
        json={"name": "Support", "members": [{"kind": "user", "id": str(teammate_id)}]},
    )
    assert r.status_code == 201, r.text
    team_id = r.json()["id"]
    signal_id = await _thread(client, owner)

    r = await client.post(
        f"/api/signals/{signal_id}/notes",
        headers=owner,
        json={"body_text": f"@[Support](team:{team_id}) can you take this?"},
    )
    assert r.status_code == 200, r.text

    session_override.expire_all()
    rows = (
        await session_override.execute(select(Notification).where(Notification.user_id == teammate_id))
    ).scalars().all()
    assert any(n.kind == "mention" and "Support" in n.title for n in rows)


async def test_agent_hands_conversation_to_a_team(client: AsyncClient, session_override):
    from app.models.signal import Signal
    from app.services.teams import people_team
    from app.tools.builtin import _assign_conversation
    from app.tools.registry import ToolContext

    headers = await _login(client)
    signal_id = UUID(await _thread(client, headers))
    agent = await _agent(session_override)
    agent_id, tenant_id = agent.id, agent.tenant_id
    user_id = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one().id
    team_id = (await people_team(session_override, tenant_id)).id
    await session_override.commit()

    ctx = ToolContext(
        session=session_override, tenant_id=tenant_id, user_id=user_id, agent=agent, signal_id=signal_id
    )
    result = await _assign_conversation(ctx, {"kind": "team", "id": str(team_id), "message": "Billing dispute"})
    assert result["assigned_to"] == {"kind": "team", "id": str(team_id)}

    session_override.expire_all()
    signal = await session_override.get(Signal, signal_id)
    assert signal.assignee_kind == "team" and signal.assignee_team_id == team_id
    notes = await _notes(session_override, str(signal_id))
    assert any(n.author_agent_id == agent_id and n.body_text == "Billing dispute" for n in notes)


async def test_agent_without_channel_access_is_refused(client: AsyncClient, session_override):
    headers = await _login(client)
    signal_id = await _thread(client, headers)
    r = await client.patch(
        f"/api/signals/{signal_id}",
        headers=headers,
        json={"assignee": {"kind": "agent", "id": "00000000-0000-0000-0000-000000000000"}},
    )
    assert r.status_code == 422
