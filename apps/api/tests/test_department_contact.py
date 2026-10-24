"""Point of contact per department, the lead as the organization's contact, and placing an agent."""

from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.services import teams as teams_svc
from app.services.department_access import department_contact
from app.services.lead_agent import get_lead_agent, set_lead_agent
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _headers(client: AsyncClient) -> dict[str, str]:
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _tenant_id(session) -> UUID:
    return (await session.execute(select(Tenant.id))).scalar_one()


async def _agent(session, tenant_id, name: str, *, active: bool = True) -> UUID:
    agent = Agent(tenant_id=tenant_id, name=name, kind="company", is_active=active)
    session.add(agent)
    await session.flush()
    return agent.id


async def test_first_active_agent_is_the_implicit_contact_until_one_is_picked(client: AsyncClient, session_override):
    headers = await _headers(client)
    tenant_id = await _tenant_id(session_override)
    paused = await _agent(session_override, tenant_id, "Paused", active=False)
    first = await _agent(session_override, tenant_id, "First")
    second = await _agent(session_override, tenant_id, "Second")
    await session_override.commit()

    team = (await client.post("/api/departments", headers=headers, json={"name": "Support"})).json()
    crew = {"crew": [{"kind": "agent", "id": str(a)} for a in (paused, first, second)]}
    r = await client.put(f"/api/departments/{team['id']}/members", headers=headers, json=crew)
    assert r.status_code == 200, r.text
    assert r.json()["contact_implicit"] is True

    contact, implicit = await department_contact(session_override, tenant_id, UUID(team["id"]))
    assert (contact.id, implicit) == (first, True)

    crew["crew"] = [{"kind": "agent", "id": str(first)}, {"kind": "agent", "id": str(second), "role": "contact"}]
    r = await client.put(f"/api/departments/{team['id']}/members", headers=headers, json=crew)
    assert r.status_code == 200, r.text
    session_override.expire_all()
    contact, implicit = await department_contact(session_override, tenant_id, UUID(team["id"]))
    assert (contact.id, implicit) == (second, False)


async def test_lead_is_the_organization_contact(client: AsyncClient, session_override):
    tenant_id = await _tenant_id(session_override)
    one = await _agent(session_override, tenant_id, "One")
    two = await _agent(session_override, tenant_id, "Two")
    await session_override.commit()

    await set_lead_agent(session_override, tenant_id, one)
    assert (await get_lead_agent(session_override, tenant_id)).id == one

    await set_lead_agent(session_override, tenant_id, two)
    root = await teams_svc.ensure_org_root(session_override, tenant_id)
    crew = await teams_svc.crew_entries(session_override, root)
    assert [e["id"] for e in crew if e["role"] == "contact"] == [str(two)]
    assert any(e["id"] == str(one) and e["role"] == "member" for e in crew)
    assert (await get_lead_agent(session_override, tenant_id)).id == two


async def test_place_seats_an_unplaced_agent_once(client: AsyncClient, session_override):
    headers = await _headers(client)
    tenant_id = await _tenant_id(session_override)
    agent = await _agent(session_override, tenant_id, "Clerk")
    await session_override.commit()
    team = (await client.post("/api/departments", headers=headers, json={"name": "Finance"})).json()

    overview = (await client.get("/api/departments/overview", headers=headers)).json()
    assert next(a for a in overview["agents"] if a["id"] == str(agent))["unplaced"] is True

    url = f"/api/departments/{team['id']}/members/place"
    r = await client.post(url, headers=headers, json={"agent_id": str(agent)})
    assert r.status_code == 200, r.text
    assert [e["id"] for e in r.json()["crew"]] == [str(agent)]
    again = await client.post(url, headers=headers, json={"agent_id": str(agent)})
    assert len(again.json()["crew"]) == 1

    overview = (await client.get("/api/departments/overview", headers=headers)).json()
    assert next(a for a in overview["agents"] if a["id"] == str(agent))["unplaced"] is False
