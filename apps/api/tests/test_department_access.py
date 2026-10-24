"""Department access for freelancers and the department overview."""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Membership, Tenant, User
from app.models.orchestra import Workstream
from app.models.signal import Signal, SignalTag
from app.services.channel_access import visible_channel_account_ids
from app.services.counts import conversation_scope
from app.services.signal_threads import get_thread
from app.services.teams import create_team, set_team_members
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


async def _setup(session):
    tenant = await _tenant(session)
    freelancer = User(email=f"free-{uuid4().hex[:6]}@example.com", display_name="Freelancer")
    session.add(freelancer)
    await session.flush()
    session.add(Membership(tenant_id=tenant.id, user_id=freelancer.id, role="member", scope="departments"))
    team = await create_team(session, tenant.id, name="Content", description="", pickup="people", members=[])
    await set_team_members(session, team, [{"kind": "user", "id": str(freelancer.id), "duty": "member"}])
    flow = Workstream(tenant_id=tenant.id, name="Maandcontent", department_id=team.id)
    other_flow = Workstream(tenant_id=tenant.id, name="Rapportage")
    session.add_all([flow, other_flow])
    await session.flush()
    label = SignalTag(tenant_id=tenant.id, name="maandcontent", workstream_id=flow.id)
    other = SignalTag(tenant_id=tenant.id, name="rapportage", workstream_id=other_flow.id)
    session.add_all([label, other])
    await session.flush()
    mine = Signal(tenant_id=tenant.id, channel="email", source="email", subject="Captions", ticket_tag_id=label.id, ticket_status="open")
    hidden = Signal(tenant_id=tenant.id, channel="email", source="email", subject="Report", ticket_tag_id=other.id, ticket_status="waiting")
    assigned = Signal(tenant_id=tenant.id, channel="email", source="email", subject="Ask", assignee_kind="user", assignee_id=freelancer.id)
    session.add_all([mine, hidden, assigned])
    await session.commit()
    return tenant, freelancer, team, mine, hidden, assigned


@pytest.mark.asyncio
async def test_freelancer_sees_only_department_work(client: AsyncClient, session_override):
    tenant, freelancer, _team, mine, hidden, assigned = await _setup(session_override)
    visible = await visible_channel_account_ids(session_override, tenant.id, user_id=freelancer.id, role="member")
    scope = conversation_scope(tenant.id, None, visible)
    ids = set(
        (
            await session_override.execute(
                select(Signal.id).where(*scope, Signal.id.in_([mine.id, hidden.id, assigned.id]))
            )
        ).scalars().all()
    )
    assert ids == {mine.id, assigned.id}
    assert await get_thread(session_override, tenant.id, freelancer.id, hidden.id, visible_account_ids=visible) is None


@pytest.mark.asyncio
async def test_workspace_member_is_not_limited(client: AsyncClient, session_override):
    tenant, freelancer, _team, mine, hidden, _assigned = await _setup(session_override)
    membership = (
        await session_override.execute(select(Membership).where(Membership.user_id == freelancer.id))
    ).scalar_one()
    membership.scope = "workspace"
    await session_override.commit()
    visible = await visible_channel_account_ids(session_override, tenant.id, user_id=freelancer.id, role="member")
    scope = conversation_scope(tenant.id, None, visible)
    ids = set(
        (await session_override.execute(select(Signal.id).where(*scope, Signal.id.in_([mine.id, hidden.id])))).scalars().all()
    )
    assert ids == {mine.id, hidden.id}


@pytest.mark.asyncio
async def test_department_overview(client: AsyncClient, session_override):
    tenant, freelancer, team, _mine, _hidden, _assigned = await _setup(session_override)
    agent = (await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))).scalars().first()
    owner = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    await set_team_members(
        session_override,
        team,
        [
            {"kind": "agent", "id": str(agent.id), "duty": "primary"},
            {"kind": "user", "id": str(owner.id), "duty": "primary"},
            {"kind": "user", "id": str(freelancer.id), "duty": "member"},
        ],
    )
    await session_override.commit()
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    res = await client.get(f"/api/departments/{team.id}/overview", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert [p["is_org"] for p in body["path"]] == [True, False]
    assert body["path"][-1]["id"] == str(team.id)
    assert body["contact"]["id"] == str(agent.id)
    assert body["contact"]["implicit"] is False
    assert body["accountable"]["id"] == str(owner.id)
    roles = {row["id"]: row["role"] for row in body["crew"]}
    assert roles[str(agent.id)] == "contact"
    assert roles[str(owner.id)] == "accountable"
    assert roles[str(freelancer.id)] == "member"
    assert [(f["name"], f["open"], f["waiting"]) for f in body["flows"]] == [("Maandcontent", 1, 0)]
    assert body["totals"]["open"] == 1
    assert all(stage["kind"] in ("open", "waiting", "done", "closed") for stage in body["flows"][0]["stages"])
    assert body["folders"] == []

    members = (await client.get("/api/app/workspaces/test/members", headers=headers))
    if members.status_code == 200:
        row = next(m for m in members.json() if m["uuid"] == str(freelancer.id))
        assert row["scope"] == "departments"


@pytest.mark.asyncio
async def test_department_overview_per_folder(client: AsyncClient, session_override):
    from app.models.project import Project

    tenant, _freelancer, team, mine, _hidden, _assigned = await _setup(session_override)
    folder = Project(tenant_id=tenant.id, name="Studio Veluwe", slug=f"studio-{uuid4().hex[:4]}")
    session_override.add(folder)
    await session_override.flush()
    mine.project_id = folder.id
    await session_override.commit()
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    body = (await client.get(f"/api/departments/{team.id}/overview", headers=headers)).json()
    [scope] = body["folders"]
    assert scope["name"] == "Studio Veluwe"
    assert scope["totals"] == {"open": 1, "waiting": 0, "overdue": 0}
    assert [(f["name"], f["open"]) for f in scope["flows"]] == [("Maandcontent", 1)]
    assert {"key": "unassigned", "count": 1} in scope["bottlenecks"]


@pytest.mark.asyncio
async def test_department_nav_for_owner(client: AsyncClient, session_override):
    await _setup(session_override)
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    res = await client.get("/api/departments/nav", headers=headers)
    assert res.status_code == 200, res.text
    rows = {row["name"]: row for row in res.json()}
    assert "All" not in rows
    content = rows["Content"]
    assert content["open"] == 1
    assert content["icon"] == "building-2"
    assert content["href"] == f"/departments/{content['id']}"

    res = await client.patch(f"/api/departments/{content['id']}", json={"icon": "megaphone"}, headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["icon"] == "megaphone"
    rows = {row["name"]: row for row in (await client.get("/api/departments/nav", headers=headers)).json()}
    assert rows["Content"]["icon"] == "megaphone"
    bad = await client.patch(f"/api/departments/{content['id']}", json={"icon": "not-an-icon"}, headers=headers)
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_department_nav_for_scoped_member(client: AsyncClient, session_override):
    from app.services.department_overview import nav_departments

    tenant, freelancer, _team, _mine, _hidden, _assigned = await _setup(session_override)
    await create_team(session_override, tenant.id, name="Sales", description="", pickup="people", members=[])
    await session_override.commit()
    visible = await visible_channel_account_ids(session_override, tenant.id, user_id=freelancer.id, role="member")
    rows = await nav_departments(
        session_override, tenant.id, user_id=freelancer.id, role="member", visible_account_ids=visible
    )
    assert [(row["name"], row["open"]) for row in rows] == [("Content", 1)]
    owner_rows = await nav_departments(
        session_override, tenant.id, user_id=freelancer.id, role="owner", visible_account_ids=None
    )
    assert {"Content", "Sales"} <= {row["name"] for row in owner_rows}
