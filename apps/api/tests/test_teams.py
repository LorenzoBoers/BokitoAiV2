"""Teams, the company team overview and availability."""

from datetime import datetime, timedelta
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.team import Team
from app.services import presence
from app.services import teams as teams_svc
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _headers(client: AsyncClient) -> dict[str, str]:
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def test_system_teams_exist_and_compute_members(client: AsyncClient, session_override):
    headers = await _headers(client)
    r = await client.get("/api/teams", headers=headers)
    assert r.status_code == 200
    kinds = [t["kind"] for t in r.json()]
    assert kinds[:2] == ["people", "agents"]
    people = r.json()[0]
    assert people["system"] is True
    assert people["member_count"] >= 1
    assert all(m["kind"] == "user" for m in people["members"])


async def test_custom_team_crud(client: AsyncClient, session_override):
    headers = await _headers(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    agent = Agent(tenant_id=tenant.id, name="Support agent")
    session_override.add(agent)
    await session_override.commit()

    r = await client.post(
        "/api/teams",
        headers=headers,
        json={
            "name": "Support",
            "members": [{"kind": "user", "id": str(user.id)}, {"kind": "agent", "id": str(agent.id)}],
        },
    )
    assert r.status_code == 201, r.text
    team = r.json()
    assert team["member_count"] == 2
    assert team["system"] is False

    r = await client.patch(f"/api/teams/{team['id']}", headers=headers, json={"pickup": "round_robin"})
    assert r.json()["pickup"] == "round_robin"

    r = await client.put(f"/api/teams/{team['id']}/members", headers=headers, json={"members": []})
    assert r.json()["member_count"] == 0

    r = await client.delete(f"/api/teams/{team['id']}", headers=headers)
    assert r.status_code == 204
    session_override.expire_all()
    assert (await session_override.get(Team, UUID(team["id"]))) is None


async def test_system_team_is_protected(client: AsyncClient, session_override):
    headers = await _headers(client)
    teams = (await client.get("/api/teams", headers=headers)).json()
    people_id = teams[0]["id"]
    assert (await client.delete(f"/api/teams/{people_id}", headers=headers)).status_code == 400
    assert (
        await client.patch(f"/api/teams/{people_id}", headers=headers, json={"name": "Everyone"})
    ).status_code == 400
    assert (
        await client.put(f"/api/teams/{people_id}/members", headers=headers, json={"members": []})
    ).status_code == 400


async def test_overview_lists_people_agents_and_presence(client: AsyncClient, session_override):
    headers = await _headers(client)
    r = await client.get("/api/teams/overview", headers=headers)
    assert r.status_code == 200
    body = r.json()
    me = next(p for p in body["people"] if p["email"] == TEST_EMAIL)
    assert me["presence"]["status"] in ("available", "away", "offline")
    assert len(body["teams"]) >= 2

    r = await client.put("/api/teams/me/away", headers=headers, json={"away": True})
    assert r.json()["status"] == "away"
    r = await client.put("/api/teams/me/away", headers=headers, json={"away": False})
    assert r.json()["status"] in ("available", "offline")


async def test_presence_status_rules(session_override):
    now = datetime.utcnow()
    user = User(email="p@example.com")
    assert presence.user_status(user, now=now) == "offline"
    user.last_seen_at = now - timedelta(seconds=30)
    assert presence.user_status(user, now=now) == "available"
    user.away = True
    assert presence.user_status(user, now=now) == "away"
    user.away_until = now - timedelta(minutes=1)
    assert presence.user_status(user, now=now) == "available"


async def test_user_team_ids_includes_people_team(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    ids = await teams_svc.user_team_ids(session_override, tenant.id, user.id)
    people = await teams_svc.people_team(session_override, tenant.id)
    assert people.id in ids
