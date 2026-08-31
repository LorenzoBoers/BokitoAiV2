"""Lazy Task promotion: real work lands on the ledger, chat Q&A stays Run-only."""

from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun
from app.models.auth import Tenant
from app.services.task_ledger import (
    is_work_tool,
    promote_run_to_task,
    settle_run_task,
)


async def _tenant_agent_run(
    session: AsyncSession, trigger_type: str = "chat"
) -> tuple[Tenant, Agent, AgentRun]:
    tenant = Tenant(slug=f"ledger-{uuid4().hex[:8]}", name="Ledger")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    agent = Agent(tenant_id=tenant.id, name="Worker", kind="company")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    run = AgentRun(
        tenant_id=tenant.id,
        agent_id=agent.id,
        trigger_type=trigger_type,
        subject="Boek de factuur in",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return tenant, agent, run


def test_is_work_tool_classification():
    # Pure reads and replying are not work.
    assert is_work_tool("search_knowledge") is False
    assert is_work_tool("send_reply") is False
    assert is_work_tool("create_decision_request") is False
    assert is_work_tool("handoff_to_human") is False
    assert is_work_tool("nonexistent_tool") is False
    # Mutating/gated tools are work.
    assert is_work_tool("schedule_wake") is True
    assert is_work_tool("schedule_task") is True
    # Any module tool is work, including reads and proposals.
    assert is_work_tool("accounting_list_documents") is True
    assert is_work_tool("accounting_propose_booking") is True
    assert is_work_tool("banking_list_accounts") is True


@pytest.mark.asyncio
async def test_promote_run_to_task_and_settle(session_override: AsyncSession):
    tenant, agent, run = await _tenant_agent_run(session_override)

    task = await promote_run_to_task(
        session_override, run, first_tool="accounting_propose_booking"
    )
    assert run.task_id == task.id
    assert task.status == "running"
    assert task.origin == "chat"
    assert task.assignee_agent_id == agent.id
    assert task.title == "Boek de factuur in"

    # Idempotent: promoting again returns the same task.
    again = await promote_run_to_task(session_override, run)
    assert again.id == task.id

    run.status = "completed"
    run.completed_at = datetime.utcnow()
    await settle_run_task(session_override, run)
    await session_override.refresh(task)
    assert task.status == "completed"
    assert task.completed_at is not None


@pytest.mark.asyncio
async def test_promotion_origin_follows_wake_path(session_override: AsyncSession):
    _, _, trigger_run = await _tenant_agent_run(session_override, trigger_type="trigger_cron")
    task = await promote_run_to_task(session_override, trigger_run)
    assert task.origin == "trigger"

    _, _, inbound_run = await _tenant_agent_run(session_override, trigger_type="inbound")
    task = await promote_run_to_task(session_override, inbound_run, trust="external")
    assert task.origin == "inbound"


@pytest.mark.asyncio
async def test_settle_skips_orchestration_owned_tasks(session_override: AsyncSession):
    from app.services.orchestration.dispatcher import create_agent_task

    tenant, agent, run = await _tenant_agent_run(session_override)
    # A task created through orchestration (not promotion) manages itself.
    task = await create_agent_task(
        session_override, tenant.id, title="Workstream job", agent_id=agent.id, auto_start=False
    )
    run.task_id = task.id
    run.status = "failed"
    run.completed_at = datetime.utcnow()
    await settle_run_task(session_override, run)
    await session_override.refresh(task)
    assert task.status == "queued"  # untouched


@pytest.mark.asyncio
async def test_loop_promotes_on_first_work_tool(session_override: AsyncSession):
    from app.services.agent.loop import AgentLoop

    tenant, agent, run = await _tenant_agent_run(session_override)
    loop = AgentLoop(session_override, tenant.id, None, agent=agent, run=run)

    # Q&A-style tool: no promotion.
    await loop._maybe_promote_to_task("search_knowledge")
    assert run.task_id is None

    # First work tool promotes exactly once.
    await loop._maybe_promote_to_task("banking_list_transactions")
    assert run.task_id is not None
    first_task_id = run.task_id
    await loop._maybe_promote_to_task("schedule_wake")
    assert run.task_id == first_task_id
