"""Tests for platform automation: MCP auth, orchestration resume, inbound replies."""

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.integration import McpServer
from app.models.orchestration import AgentTask
from app.services.agent.mcp_client import call_mcp_tool


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
async def test_workstream_run_stages_only_completes(session_override):
    """Manual runs complete immediately — step engine retired."""
    from app.models.orchestra import Workstream, WorkstreamRun
    from app.services.workstreams import start_run

    tenant = Tenant(slug="orch-resume", name="Orch Resume")
    session_override.add(tenant)
    await session_override.flush()

    workstream = Workstream(tenant_id=tenant.id, name="Gated")
    session_override.add(workstream)
    await session_override.commit()

    run = await start_run(
        session_override,
        tenant.id,
        workstream.id,
        input_kind="manual",
        input_text="Please review.",
        triggered_by_type="system",
    )
    assert run.status == "completed"
    assert run.current_step_id is None

    refreshed = (
        await session_override.execute(
            select(WorkstreamRun).where(WorkstreamRun.id == run.id)
        )
    ).scalar_one()
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


@pytest.mark.asyncio
async def test_create_task_on_conversation_creates_human_task(session_override):
    from app.models.signal import Signal
    from app.tools import execute_tool

    tenant = Tenant(slug="task-look", name="Task Look")
    session_override.add(tenant)
    await session_override.flush()
    agent = Agent(tenant_id=tenant.id, name="Worker", role="assistant", slug="look-worker")
    signal = Signal(tenant_id=tenant.id, channel="email", source="email", subject="Quote")
    session_override.add(agent)
    session_override.add(signal)
    await session_override.commit()

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_task",
        {"title": "Call them back"},
        agent=agent,
        signal_id=signal.id,
        approved=True,
    )
    assert result.get("kind") == "task"
    assert result.get("signal_id") == str(signal.id)
    assert result.get("task_id")
    await session_override.refresh(signal)
    assert signal.next_at is not None
    task = (
        await session_override.execute(select(AgentTask).where(AgentTask.signal_id == signal.id))
    ).scalars().one()
    assert task.title == "Call them back"
    assert task.assignee_kind == "human"
    assert task.scheduled_for is not None
