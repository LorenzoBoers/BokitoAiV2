"""Agenda = planning only: on-demand runs (email/chat) stay off the calendar,
and runs stuck on 'running' are closed by the startup data repair."""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.schema_patch import _close_stale_agent_runs
from app.models.agent import Agent, AgentRun
from app.models.auth import Tenant
from app.models.trigger import Trigger
from app.services.triggers import agenda_occurrences


async def _tenant_and_agent(session: AsyncSession) -> tuple[Tenant, Agent]:
    tenant = (await session.execute(select(Tenant))).scalars().first()
    if tenant is None:
        tenant = Tenant(name="Agenda Test", slug=f"agenda-test-{uuid4().hex[:8]}")
        session.add(tenant)
        await session.commit()
        await session.refresh(tenant)
    agent = (
        (await session.execute(select(Agent).where(Agent.tenant_id == tenant.id)))
        .scalars()
        .first()
    )
    if agent is None:
        agent = Agent(tenant_id=tenant.id, name="Test Agent", role="support")
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
    return tenant, agent


@pytest.mark.asyncio
async def test_agenda_excludes_on_demand_runs(session_override: AsyncSession):
    tenant, agent = await _tenant_and_agent(session_override)
    now = datetime.utcnow()

    trigger = Trigger(
        tenant_id=tenant.id,
        name="Daily digest",
        kind="interval",
        interval_minutes=1440,
        agent_id=agent.id,
    )
    session_override.add(trigger)
    await session_override.commit()
    await session_override.refresh(trigger)

    scheduled_run = AgentRun(
        tenant_id=tenant.id,
        agent_id=agent.id,
        trigger_type="trigger_interval",
        trigger_id=str(trigger.id),
        subject="Daily digest",
        status="completed",
        started_at=now - timedelta(hours=1),
        completed_at=now - timedelta(hours=1),
    )
    # On-demand email suggestion run: trigger_id points at a Signal, not a
    # Trigger. Must never appear on the agenda.
    email_run = AgentRun(
        tenant_id=tenant.id,
        agent_id=agent.id,
        trigger_type="email",
        trigger_id=str(uuid4()),
        subject="Email: Payment declined",
        status="completed",
        started_at=now - timedelta(hours=2),
        completed_at=now - timedelta(hours=2),
    )
    session_override.add_all([scheduled_run, email_run])
    await session_override.commit()

    items = await agenda_occurrences(
        session_override,
        tenant.id,
        start=now - timedelta(days=1),
        end=now + timedelta(days=1),
    )
    run_ids = {i["run_id"] for i in items if i["run_id"]}
    assert str(scheduled_run.id) in run_ids
    assert str(email_run.id) not in run_ids
    assert all("Email:" not in (i["name"] or "") for i in items)


@pytest.mark.asyncio
async def test_stale_running_runs_closed_by_repair(session_override: AsyncSession):
    tenant, agent = await _tenant_and_agent(session_override)
    now = datetime.utcnow()

    stale = AgentRun(
        tenant_id=tenant.id,
        agent_id=agent.id,
        trigger_type="email",
        subject="Email: stuck",
        status="running",
        started_at=now - timedelta(hours=8),
    )
    fresh = AgentRun(
        tenant_id=tenant.id,
        agent_id=agent.id,
        trigger_type="email",
        subject="Email: in progress",
        status="running",
        started_at=now - timedelta(minutes=5),
    )
    session_override.add_all([stale, fresh])
    await session_override.commit()
    stale_id, fresh_id = stale.id, fresh.id

    connection = await session_override.connection()
    await connection.run_sync(lambda sync_conn: _close_stale_agent_runs(sync_conn))
    await session_override.commit()

    session_override.expire_all()
    stale_after = (
        await session_override.execute(select(AgentRun).where(AgentRun.id == stale_id))
    ).scalar_one()
    fresh_after = (
        await session_override.execute(select(AgentRun).where(AgentRun.id == fresh_id))
    ).scalar_one()
    assert stale_after.status == "completed"
    assert stale_after.completed_at is not None
    assert fresh_after.status == "running"
