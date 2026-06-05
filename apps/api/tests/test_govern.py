import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.services.agent.tools import execute_tool
from app.services.audit import search_audit


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
    agent.tools_json = json.dumps(["search_index", "read_blueprint"])
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
    assert result.get("status") == "created"

    events = await search_audit(session_override, tenant.id, action="tool_call:create_task")
    assert any(e.outcome == "executed" for e in events)


@pytest.mark.asyncio
async def test_approval_autonomy_escalates_and_audits(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = await _assistant(session_override)  # default autonomy "approval", tenant policy "whitelist"

    result = await execute_tool(
        session_override, tenant.id, None, "create_task", {"title": "Maybe"}, agent=agent
    )
    # Not whitelisted -> escalated to a human decision request.
    assert result.get("status") == "awaiting_human"

    events = await search_audit(session_override, tenant.id, action="tool_call:create_task")
    assert any(e.outcome == "escalated" for e in events)


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
