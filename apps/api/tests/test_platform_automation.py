"""Tests for platform automation: MCP auth, orchestration resume, inbound replies."""

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
async def test_workstream_gate_decision_resumes_run(session_override):
    """Approving the gate decision resumes the run past the gate step."""
    from app.models.orchestra import Workstream, WorkstreamRun, WorkstreamStep
    from app.services.workstreams import start_run

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
        position=0,
        kind="gate",
    )
    session_override.add(gate)
    await session_override.commit()

    run = await start_run(
        session_override,
        tenant.id,
        workstream.id,
        input_kind="manual",
        input_text="Please review.",
        triggered_by_type="system",
    )
    assert run.status == "awaiting_gate"

    # advance_run raised the gate decision; approving it resumes the run.
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.tenant_id == tenant.id)
        )
    ).scalars().first()
    assert decision is not None

    await resolve_decision(
        session_override,
        tenant.id,
        decision.id,
        option_id="approve",
        action="approved",
        user_id=uuid4(),
    )

    refreshed = (
        await session_override.execute(
            select(WorkstreamRun).where(WorkstreamRun.id == run.id)
        )
    ).scalar_one()
    # The gate was the only step, so the resumed run completes.
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
