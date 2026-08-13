"""Tests for platform automation: MCP auth, orchestration resume, inbound replies."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.integration import McpServer
from app.models.notification import DecisionRequest
from app.models.orchestration import AgentTask
from app.services.agent.mcp_client import call_mcp_tool
from app.services.notifications import resolve_decision


@pytest.mark.asyncio
async def test_mock_trading_mcp_risk_status(session_override):
    tenant = Tenant(slug="mcp-test", name="MCP Test")
    session_override.add(tenant)
    await session_override.flush()
    session_override.add(
        McpServer(
            tenant_id=tenant.id,
            name="Trading pipeline MCP",
            server_url="mock://trading",
            auth_json="{}",
        )
    )
    await session_override.commit()

    result = await call_mcp_tool(
        session_override,
        tenant.id,
        {
            "server_name": "Trading pipeline MCP",
            "tool_name": "risk_status",
            "arguments": {},
        },
    )
    assert result["tool"] == "risk_status"
    assert result["result"]["execution_mode"] == "shadow"


@pytest.mark.asyncio
async def test_orchestration_continue_resumes_task(session_override):
    from app.models.orchestra import Workstream, WorkstreamStep

    tenant = Tenant(slug="orch-resume", name="Orch Resume")
    session_override.add(tenant)
    await session_override.flush()

    workstream = Workstream(tenant_id=tenant.id, name="Gated")
    session_override.add(workstream)
    await session_override.flush()
    gate = WorkstreamStep(
        tenant_id=tenant.id,
        workstream_id=workstream.id,
        name="Review",
        order=0,
        step_kind="human_gate",
    )
    session_override.add(gate)
    await session_override.flush()

    task = AgentTask(
        tenant_id=tenant.id,
        workstream_id=workstream.id,
        current_step_id=gate.id,
        title="Paused workstream",
        status="awaiting_decision",
        pause_reason="human_gate",
    )
    session_override.add(task)
    await session_override.flush()

    decision = DecisionRequest(
        tenant_id=tenant.id,
        title="Continue?",
        summary="Approve to continue",
        status="awaiting_human",
        options_json=json.dumps(
            [
                {
                    "id": "approve",
                    "label": "Continue",
                    "action_type": "orchestration_continue",
                    "payload": {"task_id": str(task.id)},
                }
            ]
        ),
    )
    session_override.add(decision)
    await session_override.commit()

    await resolve_decision(
        session_override,
        tenant.id,
        decision.id,
        option_id="approve",
        action="approved",
        user_id=uuid4(),
    )

    refreshed = (
        await session_override.execute(select(AgentTask).where(AgentTask.id == task.id))
    ).scalar_one()
    # Resume executes inline (no queue in tests): the approved gate is skipped
    # and the gate-only workstream runs to completion.
    assert refreshed.pause_reason is None
    assert refreshed.status == "completed"


@pytest.mark.asyncio
async def test_create_task_tool_creates_agent_task(session_override):
    from app.tools import execute_tool

    tenant = Tenant(slug="task-tool", name="Task Tool")
    session_override.add(tenant)
    await session_override.flush()
    agent = Agent(tenant_id=tenant.id, name="Worker", role="assistant", slug="worker")
    session_override.add(agent)
    await session_override.commit()

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_task",
        {"title": "Follow up customer", "description": "Send quote"},
        agent=agent,
        approved=True,
    )
    assert "task_id" in result
    from uuid import UUID

    task = (
        await session_override.execute(
            select(AgentTask).where(AgentTask.id == UUID(result["task_id"]))
        )
    ).scalar_one_or_none()
    assert task is not None
    assert task.title == "Follow up customer"
