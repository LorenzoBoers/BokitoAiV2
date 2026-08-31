"""Self-scheduling: schedule_wake / schedule_task tools + scheduled-task promotion."""

from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.notification import Notification
from app.models.trigger import Trigger
from app.tools.builtin import _schedule_task, _schedule_wake
from app.tools.registry import ToolContext, get_tool_spec


async def _tenant_and_agent(session: AsyncSession) -> tuple[Tenant, Agent]:
    tenant = Tenant(slug=f"sched-{uuid4().hex[:8]}", name="Schedule")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    agent = Agent(tenant_id=tenant.id, name="Planner", kind="company")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return tenant, agent


def _ctx(session: AsyncSession, tenant: Tenant, agent: Agent | None) -> ToolContext:
    return ToolContext(session=session, tenant_id=tenant.id, user_id=None, agent=agent)


def test_schedule_tools_are_governed():
    for name in ("schedule_wake", "schedule_task", "set_platform_watch"):
        spec = get_tool_spec(name)
        assert spec is not None, name
        assert spec.gated is True, f"{name} must be policy-gated"
        assert spec.mutating is True, f"{name} must be mutating"
    assert get_tool_spec("schedule_wake").category == "triggers"
    assert get_tool_spec("schedule_task").category == "agents"


@pytest.mark.asyncio
async def test_schedule_wake_creates_trigger(session_override: AsyncSession):
    tenant, agent = await _tenant_and_agent(session_override)
    ctx = _ctx(session_override, tenant, agent)

    # One-off wake for self.
    at = (datetime.utcnow() + timedelta(hours=2)).isoformat()
    result = await _schedule_wake(ctx, {"instructions": "Check the VAT thread again", "at": at})
    assert result["trigger"]["kind"] == "once"
    assert result["trigger"]["agent_id"] == str(agent.id)

    # Recurring cron wake for a peer.
    peer = Agent(tenant_id=tenant.id, name="Peer", kind="company")
    session_override.add(peer)
    await session_override.commit()
    await session_override.refresh(peer)
    result = await _schedule_wake(
        ctx,
        {"instructions": "Weekly outstanding check", "cron": "0 9 * * 1", "agent_id": str(peer.id)},
    )
    assert result["trigger"]["kind"] == "cron"
    assert result["trigger"]["agent_id"] == str(peer.id)

    rows = (
        await session_override.execute(select(Trigger).where(Trigger.tenant_id == tenant.id))
    ).scalars().all()
    assert len(rows) == 2

    # Validation: no schedule given.
    result = await _schedule_wake(ctx, {"instructions": "no schedule"})
    assert "error" in result
    # Validation: bad cron.
    result = await _schedule_wake(ctx, {"instructions": "bad", "cron": "not a cron"})
    assert "error" in result


@pytest.mark.asyncio
async def test_schedule_task_dormant_until_due(session_override: AsyncSession, monkeypatch):
    from app.models.orchestration import AgentTask
    from app.services.orchestration import dispatcher

    tenant, agent = await _tenant_and_agent(session_override)
    ctx = _ctx(session_override, tenant, agent)

    woken: list[str] = []

    async def fake_enqueue(tenant_id: str, task_id: str) -> bool:
        woken.append(task_id)
        return True

    import app.services.orchestration.queue as queue_mod

    monkeypatch.setattr(queue_mod, "enqueue_agent_task_segment", fake_enqueue)

    future = (datetime.utcnow() + timedelta(hours=1)).isoformat()
    result = await _schedule_task(
        ctx, {"title": "Follow up on invoice", "scheduled_for": future}
    )
    assert result["status"] == "queued"
    assert result["scheduled_for"] is not None
    assert woken == []  # dormant: nothing enqueued yet

    task = await session_override.get(AgentTask, UUID(result["task_id"]))
    assert task.assignee_kind == "agent"
    assert task.assignee_agent_id == agent.id

    # Not due yet: promotion does nothing.
    assert await dispatcher.process_due_scheduled_tasks(session_override, tenant.id) == 0

    # Make it due and promote.
    task.scheduled_for = datetime.utcnow() - timedelta(minutes=1)
    session_override.add(task)
    await session_override.commit()
    assert await dispatcher.process_due_scheduled_tasks(session_override, tenant.id) == 1
    assert woken == [str(task.id)]
    await session_override.refresh(task)
    assert task.scheduled_for is None  # never double-fires


@pytest.mark.asyncio
async def test_schedule_task_for_human(session_override: AsyncSession):
    from app.models.orchestration import AgentTask
    from app.services.orchestration import dispatcher

    tenant, agent = await _tenant_and_agent(session_override)
    ctx = _ctx(session_override, tenant, agent)

    # Due-now human task surfaces immediately as human work.
    result = await _schedule_task(
        ctx, {"title": "Review the VAT proposal", "assignee": "human"}
    )
    assert result["status"] == "awaiting_human"
    assert result["assignee_kind"] == "human"

    # Scheduled human task stays dormant, then flips + notifies at due time.
    future = (datetime.utcnow() + timedelta(days=1)).isoformat()
    result = await _schedule_task(
        ctx,
        {"title": "Check bank export Friday", "assignee": "human", "scheduled_for": future},
    )
    assert result["status"] == "queued"
    task = await session_override.get(AgentTask, UUID(result["task_id"]))
    task.scheduled_for = datetime.utcnow() - timedelta(minutes=1)
    session_override.add(task)
    await session_override.commit()

    assert await dispatcher.process_due_scheduled_tasks(session_override, tenant.id) == 1
    await session_override.refresh(task)
    assert task.status == "awaiting_human"

    notif = (
        await session_override.execute(
            select(Notification).where(
                Notification.tenant_id == tenant.id, Notification.kind == "task_due"
            )
        )
    ).scalar_one()
    assert notif.title == "Check bank export Friday"
