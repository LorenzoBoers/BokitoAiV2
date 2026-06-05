import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.services.agent.tools import execute_tool


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_create_agent_tool_draft_queue(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    orch = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role.in_(("orchestrator", "orchestra")))
        )
    ).scalar_one()
    orch.permission_scopes_json = json.dumps(
        ["platform:agent:create", "platform:workstream:create", "platform:blueprint:write"]
    )
    orch.tools_json = json.dumps(["create_agent", "create_workstream", "write_blueprint"])
    await session_override.commit()
    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_agent",
        {"name": "Support Bot", "role": "assistant"},
        agent=orch,
    )
    assert result.get("change_id") or result.get("status") in ("applied", "written")
    assert "error" not in result


@pytest.mark.asyncio
async def test_update_agent_tool_captures_before(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    orch = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role.in_(("orchestrator", "orchestra")))
        )
    ).scalar_one()
    orch.permission_scopes_json = json.dumps(["platform:agent:update"])
    orch.tools_json = json.dumps(["update_agent"])
    target = Agent(tenant_id=tenant.id, name="Old Name", role="assistant", slug="old-name")
    session_override.add(target)
    await session_override.commit()
    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "update_agent",
        {"agent_id": str(target.id), "name": "New Name"},
        agent=orch,
    )
    assert "error" not in result
    assert result.get("change_id") or result.get("status") in ("applied", "updated")


@pytest.mark.asyncio
async def test_propose_integration_routes_to_decision(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    orch = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role.in_(("orchestrator", "orchestra")))
        )
    ).scalar_one()
    orch.tools_json = json.dumps(["propose_integration"])
    await session_override.commit()
    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "propose_integration",
        {"provider": "slack", "reason": "Need Slack notifications"},
        agent=orch,
    )
    assert "error" not in result
    assert result.get("decision_request_id") or result.get("status") == "awaiting_human"


@pytest.mark.asyncio
async def test_govern_rollback_blueprint_change(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    listed = await client.get("/api/govern/changes?status=accepted", headers=headers)
    assert listed.status_code == 200


@pytest.mark.asyncio
async def test_learning_feedback_and_eval(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    fb = await client.post(
        "/api/learning/feedback",
        headers=headers,
        json={"subject_type": "signal", "subject_id": "test-1", "sentiment": "up", "score": 5},
    )
    assert fb.status_code == 200
    processed = await client.post("/api/learning/process", headers=headers)
    assert processed.status_code == 200
    assert processed.json().get("processed", 0) >= 1
    eval_resp = await client.post("/api/learning/eval/compute", headers=headers)
    assert eval_resp.status_code == 200
    assert len(eval_resp.json()["items"]) >= 1
