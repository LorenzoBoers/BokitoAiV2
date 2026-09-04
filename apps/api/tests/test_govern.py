import json
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.services.audit import search_audit
from app.tools import execute_tool
from app.tools.policy import resolve_tool_mode, tenant_allowances
from app.tools.registry import get_tool_spec


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _assistant(session_override) -> Agent:
    return (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()


@pytest.mark.asyncio
async def test_passports_endpoint_lists_agents(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    res = await client.get("/api/govern/passports", headers=headers)
    assert res.status_code == 200
    items = res.json()["items"]
    roles = {a["role"] for a in items}
    assert "assistant" in roles
    assistant = next(a for a in items if a["role"] == "assistant")
    assert assistant["autonomy_level"] == "approval"
    assert assistant["allowed_tools"] == []  # empty = all default tools


@pytest.mark.asyncio
async def test_passport_allowlist_denies_disallowed_tool(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = await _assistant(session_override)
    agent.tools_json = json.dumps(["search_index", "read_doc"])
    await session_override.commit()

    result = await execute_tool(
        session_override, tenant.id, None, "create_task", {"title": "Nope"}, agent=agent
    )
    assert result.get("status") == "denied"

    events = await search_audit(session_override, tenant.id, action="tool_call:create_task")
    assert any(e.outcome == "denied" for e in events)


@pytest.mark.asyncio
async def test_autonomy_auto_executes_and_audits(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = await _assistant(session_override)
    agent.autonomy_level = "auto"
    await session_override.commit()

    result = await execute_tool(
        session_override, tenant.id, None, "create_task", {"title": "Do it"}, agent=agent
    )
    assert result.get("task_id")
    assert result.get("status") in ("created", "queued", "running", "completed")

    events = await search_audit(session_override, tenant.id, action="tool_call:create_task")
    assert any(e.outcome == "executed" for e in events)


@pytest.mark.asyncio
async def test_approval_autonomy_escalates_and_audits(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = await _assistant(session_override)  # default autonomy "approval"; projects category = ask

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "update_queue_item_status",
        {"queue_item_id": str(uuid4()), "status": "done"},
        agent=agent,
    )
    # projects category is "ask" under assisted posture -> escalated to a human
    # decision. The gate resolves before the handler runs, so the item does not
    # have to exist for this to hold.
    assert result.get("status") == "awaiting_human"

    events = await search_audit(
        session_override, tenant.id, action="tool_call:update_queue_item_status"
    )
    assert any(e.outcome == "escalated" for e in events)


@pytest.mark.asyncio
async def test_delegation_runs_without_a_human_gate(client: AsyncClient, session_override):
    """Handing work over is not a structural change, so it does not ask first.

    The delegated run is governed in its own right — every mutation the
    receiving agent makes passes through this same policy — so gating the
    handover as well would only put a gate in front of a gate.
    """
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = await _assistant(session_override)  # default autonomy "approval"

    result = await execute_tool(
        session_override, tenant.id, None, "create_task", {"title": "Hand over"}, agent=agent
    )
    assert result.get("status") != "awaiting_human"
    assert result.get("task_id")


@pytest.mark.asyncio
async def test_external_trust_never_auto_mutates(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = await _assistant(session_override)
    agent.autonomy_level = "auto"
    await session_override.commit()

    # delegation is denied entirely for external sessions: a site visitor
    # never queues internal work.
    result = await execute_tool(
        session_override, tenant.id, None, "create_task", {"title": "Hack"}, agent=agent,
        trust="external",
    )
    assert result.get("status") == "denied"


@pytest.mark.asyncio
async def test_audit_search_endpoint(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = await _assistant(session_override)
    agent.autonomy_level = "auto"
    await session_override.commit()
    await execute_tool(session_override, tenant.id, None, "create_task", {"title": "Audit me"}, agent=agent)

    res = await client.get("/api/govern/audit", headers=headers, params={"action": "tool_call:create_task"})
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) >= 1
    assert items[0]["action"] == "tool_call:create_task"


@pytest.mark.asyncio
async def test_get_posture_defaults_to_assisted(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    res = await client.get("/api/govern/posture", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["posture"] == "assisted"
    assert data["allowances"]["messaging"] == "allow"
    assert data["allowances"]["agents"] == "ask"
    assert len(data["presets"]) == 3


@pytest.mark.asyncio
async def test_set_posture_manual_asks_everywhere(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()

    res = await client.put("/api/govern/posture", headers=headers, json={"posture": "manual"})
    assert res.status_code == 200
    data = res.json()
    assert data["posture"] == "manual"
    assert all(mode == "ask" for mode in data["allowances"].values())

    events = await search_audit(session_override, tenant.id, action="govern:posture_update")
    assert any(e.outcome == "applied" for e in events)


@pytest.mark.asyncio
async def test_set_posture_autonomous_allows_agents(client: AsyncClient, session_override):
    headers = await _auth_headers(client)

    res = await client.put("/api/govern/posture", headers=headers, json={"posture": "autonomous"})
    assert res.status_code == 200
    data = res.json()
    assert data["posture"] == "autonomous"
    assert data["allowances"]["agents"] == "allow"
    assert data["allowances"]["integrations"] == "ask"

    session_override.expire_all()
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    spec = get_tool_spec("create_agent")
    mode, _ = await resolve_tool_mode(session_override, tenant, None, spec)
    assert mode == "allow"
    spec = get_tool_spec("connect_integration")
    mode, _ = await resolve_tool_mode(session_override, tenant, None, spec)
    assert mode == "ask"


@pytest.mark.asyncio
async def test_allowance_sliders_update(client: AsyncClient, session_override):
    headers = await _auth_headers(client)

    res = await client.put(
        "/api/govern/allowances", headers=headers, json={"allowances": {"agents": "allow"}}
    )
    assert res.status_code == 200
    assert res.json()["allowances"]["agents"] == "allow"

    session_override.expire_all()
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    assert tenant_allowances(tenant)["agents"] == "allow"

    bad = await client.put(
        "/api/govern/allowances", headers=headers, json={"allowances": {"agents": "yolo"}}
    )
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_allowances_endpoint_lists_tools(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    res = await client.get("/api/govern/allowances", headers=headers)
    assert res.status_code == 200
    data = res.json()
    names = {t["name"] for t in data["tools"]}
    assert "create_agent" in names
    assert "search_index" in names
    assert set(data["categories"]) >= {"messaging", "agents", "integrations"}


@pytest.mark.asyncio
async def test_tool_override_wins_over_slider(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    res = await client.put(
        "/api/govern/tool-overrides", headers=headers, json={"tool_name": "create_task", "mode": "allow"}
    )
    assert res.status_code == 200
    assert res.json()["tool_overrides"]["create_task"] == "allow"

    session_override.expire_all()
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    result = await execute_tool(session_override, tenant.id, None, "create_task", {"title": "Go"})
    assert result.get("task_id")
    assert result.get("status") in ("created", "queued", "running", "completed")


@pytest.mark.asyncio
async def test_member_role_clamps_restricted_categories(client: AsyncClient, session_override):
    """A member session never mutates owner/admin categories, regardless of
    allowances or agent passport; owners and safe categories are unaffected."""
    headers = await _auth_headers(client)
    res = await client.put(
        "/api/govern/allowances", headers=headers, json={"allowances": {"agents": "allow"}}
    )
    assert res.status_code == 200

    session_override.expire_all()
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()

    spec = get_tool_spec("create_agent")
    mode, reason = await resolve_tool_mode(
        session_override, tenant, None, spec, user_role="member"
    )
    assert (mode, reason) == ("deny", "user_role")

    mode, _ = await resolve_tool_mode(
        session_override, tenant, None, spec, user_role="owner"
    )
    assert mode == "allow"

    # Categories outside the clamp stay governed by the normal allowances.
    doc_spec = get_tool_spec("write_doc")
    mode, reason = await resolve_tool_mode(
        session_override, tenant, None, doc_spec, user_role="member"
    )
    assert reason != "user_role"


@pytest.mark.asyncio
async def test_api_token_lifecycle(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    res = await client.post(
        "/api/govern/tokens", headers=headers, json={"name": "cursor", "scopes": ["workspace"]}
    )
    assert res.status_code == 200
    created = res.json()
    assert created["token"].startswith("bok_")
    assert created["scopes"] == ["workspace"]

    listing = await client.get("/api/govern/tokens", headers=headers)
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert any(t["id"] == created["id"] for t in items)
    assert all("token" not in t or not t.get("token") for t in items)

    revoke = await client.delete(f"/api/govern/tokens/{created['id']}", headers=headers)
    assert revoke.status_code == 200
    assert revoke.json()["revoked_at"] is not None
