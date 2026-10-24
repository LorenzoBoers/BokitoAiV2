"""Teams, the company team overview and availability."""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Membership, Tenant, User
from app.models.team import Team
from app.services import presence
from app.services import teams as teams_svc
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _headers(client: AsyncClient) -> dict[str, str]:
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def test_organization_root_exists_and_people_are_on_it_implicitly(client: AsyncClient, session_override):
    headers = await _headers(client)
    r = await client.get("/api/departments", headers=headers)
    assert r.status_code == 200
    assert all(row["kind"] == "custom" for row in r.json())
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    root = await teams_svc.ensure_org_root(session_override, tenant.id)
    assert root.name == "All"
    assert root.parent_id is None
    assert root.id in await teams_svc.user_team_ids(session_override, tenant.id, user.id)


async def test_new_company_agent_is_unplaced_but_in_everyone(client: AsyncClient, session_override):
    from app.services.access_list import agent_principals

    headers = await _headers(client)
    created = await client.post(
        "/api/workforce/agents",
        headers=headers,
        json={"name": "Floor clerk", "job_title": "Clerk"},
    )
    assert created.status_code == 200, created.text
    agent_id = UUID(created.json()["agent"]["id"])
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    root = await teams_svc.ensure_org_root(session_override, tenant.id)
    members = await teams_svc.team_members(session_override, root)
    assert not any(member.kind == "agent" and member.id == agent_id for member in members)
    principal = (await agent_principals(session_override, tenant.id, [agent_id]))[agent_id]
    assert str(root.id) in principal.team_ids


async def test_custom_team_crud(client: AsyncClient, session_override):
    headers = await _headers(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    agent = Agent(tenant_id=tenant.id, name="Support agent", kind="company", is_active=True)
    session_override.add(agent)
    await session_override.commit()

    r = await client.post("/api/departments", headers=headers, json={"name": "Support"})
    assert r.status_code == 201, r.text
    team = r.json()
    assert team["member_count"] == 0
    assert team["system"] is False
    assert team["pinned"] is True

    r = await client.put(
        f"/api/departments/{team['id']}/members",
        headers=headers,
        json={
            "crew": [
                {"kind": "agent", "id": str(agent.id), "role": "contact", "focus": "First line"},
                {"kind": "user", "id": str(user.id), "role": "accountable"},
            ]
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["contact_agent_id"] == str(agent.id)
    assert body["contact_implicit"] is False
    assert body["accountable_user_id"] == str(user.id)
    assert body["previous"] == []
    assert next(e for e in body["crew"] if e["kind"] == "agent")["focus"] == "First line"

    r = await client.patch(f"/api/departments/{team['id']}", headers=headers, json={"pickup": "round_robin"})
    body = r.json()
    assert body["pickup"] == "round_robin"
    assert body["pinned"] is True

    r = await client.put(f"/api/departments/{team['id']}/members", headers=headers, json={"crew": []})
    assert r.status_code == 200
    assert r.json()["crew"] == []
    assert len(r.json()["previous"]) == 2

    r = await client.delete(f"/api/departments/{team['id']}", headers=headers)
    assert r.status_code == 204
    session_override.expire_all()
    removed = await session_override.get(Team, UUID(team["id"]))
    assert removed is None or removed.deleted_at is not None


async def test_crew_refuses_two_contacts_and_a_person_as_contact(client: AsyncClient, session_override):
    headers = await _headers(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    a = Agent(tenant_id=tenant.id, name="A", kind="company", is_active=True)
    b = Agent(tenant_id=tenant.id, name="B", kind="company", is_active=True)
    paused = Agent(tenant_id=tenant.id, name="Paused", kind="company", is_active=False)
    session_override.add_all([a, b, paused])
    await session_override.commit()
    team_id = (await client.post("/api/departments", headers=headers, json={"name": "Desk two"})).json()["id"]
    url = f"/api/departments/{team_id}/members"
    two = {"crew": [{"kind": "agent", "id": str(a.id), "role": "contact"}, {"kind": "agent", "id": str(b.id), "role": "contact"}]}
    assert (await client.put(url, headers=headers, json=two)).status_code == 400
    person = {"crew": [{"kind": "user", "id": str(user.id), "role": "contact"}]}
    assert (await client.put(url, headers=headers, json=person)).status_code == 400
    r = await client.put(url, headers=headers, json={"crew": [{"kind": "agent", "id": str(paused.id)}]})
    assert r.status_code == 200
    assert r.json()["crew"] == []

    implicit = await client.put(
        url,
        headers=headers,
        json={"crew": [{"kind": "agent", "id": str(b.id)}, {"kind": "agent", "id": str(a.id)}]},
    )
    assert implicit.json()["contact_agent_id"] == str(b.id)
    assert implicit.json()["contact_implicit"] is True


async def test_department_tree_is_at_most_two_levels(client: AsyncClient, session_override):
    headers = await _headers(client)
    top = (await client.post("/api/departments", headers=headers, json={"name": "Ops"})).json()["id"]
    sub = await client.post("/api/departments", headers=headers, json={"name": "Ops desk", "parent_id": top})
    assert sub.status_code == 201, sub.text
    deeper = await client.post(
        "/api/departments", headers=headers, json={"name": "Too deep", "parent_id": sub.json()["id"]}
    )
    assert deeper.status_code == 400
    loop = await client.patch(f"/api/departments/{top}", headers=headers, json={"parent_id": sub.json()["id"]})
    assert loop.status_code == 400
    back = await client.patch(f"/api/departments/{sub.json()['id']}", headers=headers, json={"parent_id": None})
    assert back.status_code == 200
    assert back.json()["parent_id"] != top


async def test_organization_root_is_protected_but_has_a_crew(client: AsyncClient, session_override):
    headers = await _headers(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    all_id = str((await teams_svc.ensure_org_root(session_override, tenant.id)).id)
    assert (await client.delete(f"/api/departments/{all_id}", headers=headers)).status_code == 400
    assert (
        await client.patch(f"/api/departments/{all_id}", headers=headers, json={"name": "Everyone"})
    ).status_code == 400
    owner_as_member = {"crew": [{"kind": "user", "id": str(user.id), "role": "member"}]}
    assert (
        await client.put(f"/api/departments/{all_id}/members", headers=headers, json=owner_as_member)
    ).status_code == 400
    assert (
        await client.post(f"/api/departments/{all_id}/room", headers=headers)
    ).status_code == 400
    org = await client.get("/api/departments/organization", headers=headers)
    assert org.status_code == 200, org.text
    body = org.json()
    assert body["is_org"] is True
    assert body["name"] == tenant.name
    assert body["path"][0]["is_org"] is True
    assert body["contact"] is not None
    assert any(row["id"] == str(user.id) for row in body["admins"])


async def test_owner_switches_organization_rules(client: AsyncClient, session_override):
    from app.services.org_rules import org_rules_on

    headers = await _headers(client)
    tenant_id = (await session_override.execute(select(Tenant.id))).scalar_one()
    assert (await client.get("/api/departments/organization", headers=headers)).json()["org_rules"] == "off"
    r = await client.put("/api/departments/organization/rules", headers=headers, json={"mode": "on"})
    assert r.status_code == 200, r.text
    assert r.json() == {"org_rules": "on"}
    session_override.expire_all()
    assert await org_rules_on(session_override, tenant_id)
    assert (await client.get("/api/departments/organization", headers=headers)).json()["org_rules"] == "on"
    bad = await client.put("/api/departments/organization/rules", headers=headers, json={"mode": "maybe"})
    assert bad.status_code == 422


async def test_custom_team_room_is_reused(client: AsyncClient, session_override):
    headers = await _headers(client)
    created = await client.post("/api/departments", headers=headers, json={"name": "Desk"})
    assert created.status_code == 201, created.text
    team_id = created.json()["id"]
    first = await client.post(f"/api/departments/{team_id}/room", headers=headers)
    assert first.status_code == 200, first.text
    second = await client.post(f"/api/departments/{team_id}/room", headers=headers)
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["title"] == "Desk"


async def test_empty_team_room_is_not_in_for_you(client: AsyncClient, session_override):
    headers = await _headers(client)
    created = await client.post("/api/departments", headers=headers, json={"name": "Ops desk"})
    assert created.status_code == 201, created.text
    team_id = created.json()["id"]
    room = await client.post(f"/api/departments/{team_id}/room", headers=headers)
    assert room.status_code == 200, room.text
    room_id = room.json()["id"]
    for_you = await client.get(
        "/api/signals",
        headers=headers,
        params={"view": "for_you", "folder": "inbox"},
    )
    assert for_you.status_code == 200, for_you.text
    assert room_id not in [row["id"] for row in for_you.json()["items"]]
    open_list = await client.get(
        "/api/signals",
        headers=headers,
        params={"view": "all_open", "folder": "inbox", "team_id": team_id},
    )
    assert open_list.status_code == 200, open_list.text
    assert room_id in [row["id"] for row in open_list.json()["items"]]


async def test_overview_lists_people_agents_and_presence(client: AsyncClient, session_override):
    headers = await _headers(client)
    # NULL autonomy_level on an older agent must not 500 the overview.
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    agent = Agent(
        tenant_id=tenant.id,
        name="Null autonomy",
        slug="null-autonomy",
        kind="company",
        role="support",
        autonomy_level=None,
        is_active=True,
    )
    session_override.add(agent)
    await session_override.commit()

    r = await client.get("/api/departments/overview", headers=headers)
    assert r.status_code == 200
    body = r.json()
    me = next(p for p in body["people"] if p["email"] == TEST_EMAIL)
    assert me["presence"]["status"] in ("available", "away", "offline")
    roots = [row for row in body["teams"] if row["system"]]
    assert len(roots) == 1 and roots[0]["name"] == "All"
    assert all(not row["system"] for row in body["teams"] if row["name"] != "All")
    null_agent = next(a for a in body["agents"] if a["id"] == str(agent.id))
    assert null_agent["autonomy_level"] == "assisted"
    assert null_agent["status"] in ("standby", "working", "error")
    assert null_agent["avatar_kind"] in ("initials", "icon", "image", "orb")
    assert "avatar_icon" in null_agent
    assert "avatar_shape" in null_agent
    assert me["deactivated"] is False
    assert null_agent["deactivated"] is False
    assert null_agent["member_type"] == "ai_agent"
    assert me["member_type"] == "person"

    r = await client.put("/api/departments/me/away", headers=headers, json={"away": True})
    assert r.json()["status"] == "away"
    r = await client.put("/api/departments/me/away", headers=headers, json={"away": False})
    assert r.json()["status"] in ("available", "offline")


async def test_overview_includes_deactivated_people_and_agents(client: AsyncClient):
    headers = await _headers(client)
    created = await client.post(
        "/api/workforce/agents",
        headers=headers,
        json={"name": "Soon deactivated", "job_title": "Support", "role": "communication"},
    )
    assert created.status_code == 200, created.text
    agent_id = created.json()["agent"]["id"]
    archived = await client.delete(f"/api/workforce/agents/{agent_id}", headers=headers)
    assert archived.status_code == 200, archived.text
    r = await client.get("/api/departments/overview", headers=headers)
    assert r.status_code == 200
    row = next(a for a in r.json()["agents"] if a["id"] == agent_id)
    assert row["deactivated"] is True
    assert row["status"] == "standby"


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
    user.away = False
    user.last_seen_at = None
    assert presence.visible_user_status(user, connected=True, now=now) == "available"
    assert presence.visible_user_status(user, connected=False, now=now) == "offline"
    assert presence.serialize_presence(user, now=now, connected=True)["status"] == "available"
    aware = now.replace(tzinfo=timezone.utc)
    user.last_seen_at = aware
    user.away = False
    assert presence.user_status(user, now=now) == "available"


async def test_mark_offline_keeps_a_fresh_connection(session_override):
    user = User(email="live-presence@example.com", last_seen_at=datetime.utcnow())
    session_override.add(user)
    await session_override.commit()
    assert await presence.mark_offline(session_override, user.id) is False
    await session_override.refresh(user)
    assert presence.user_status(user) == "available"


async def test_mark_offline_expires_an_idle_connection(session_override):
    user = User(
        email="idle-presence@example.com",
        last_seen_at=datetime.utcnow() - timedelta(seconds=30),
    )
    session_override.add(user)
    await session_override.commit()
    assert await presence.mark_offline(session_override, user.id) is True
    await session_override.refresh(user)
    assert presence.user_status(user) == "offline"


async def test_presence_snapshot_includes_connected_people_and_agents(session_override):
    tenant = Tenant(slug="presence-snap", name="Presence")
    user = User(email="snap-presence@example.com")
    session_override.add(tenant)
    session_override.add(user)
    await session_override.commit()
    session_override.add(Membership(tenant_id=tenant.id, user_id=user.id, role="owner"))
    agent = Agent(
        tenant_id=tenant.id,
        name="Snap agent",
        kind="company",
        is_active=True,
        runtime_status="working",
    )
    session_override.add(agent)
    await session_override.commit()

    events = await presence.presence_snapshot(
        session_override,
        tenant.id,
        connected_user_ids={str(user.id)},
    )
    people = [data for kind, data in events if kind == "presence"]
    agents = [data for kind, data in events if kind == "agent.status"]
    assert people == [
        {
            "user_id": str(user.id),
            "device": "dashboard",
            "online": True,
            "status": "available",
        }
    ]
    assert agents[0]["agent_id"] == str(agent.id)
    assert agents[0]["status"] == "working"


async def test_list_members_counts_a_live_socket(session_override):
    from app.gateway.manager import GatewayConnection, manager
    from app.services.signal_threads import list_members

    tenant = Tenant(slug="live-presence-list", name="Live")
    user = User(email="live-list@example.com")
    session_override.add(tenant)
    session_override.add(user)
    await session_override.commit()
    session_override.add(Membership(tenant_id=tenant.id, user_id=user.id, role="owner"))
    await session_override.commit()

    conn = GatewayConnection(
        object(),
        tenant_id=str(tenant.id),
        kind="user",
        user_id=str(user.id),
    )
    manager.register(conn)
    try:
        rows = await list_members(session_override, tenant.id)
        me = next(row for row in rows if row["uuid"] == str(user.id))
        assert me["presence"] == "available"
    finally:
        manager.unregister(conn)


async def test_user_team_ids_includes_all_root(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    root = await teams_svc.ensure_org_root(session_override, tenant.id)
    await session_override.commit()
    ids = await teams_svc.user_team_ids(session_override, tenant.id, user.id)
    assert root.id in ids
