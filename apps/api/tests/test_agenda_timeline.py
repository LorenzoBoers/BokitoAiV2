"""One time model: Agenda (scheduled_only) keeps on-demand runs off the
calendar, the activity timeline sees every session, and runs stuck on
'running' are closed by the startup data repair."""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.schema_patch import _close_stale_agent_runs
from app.models.agent import Agent, AgentRun
from app.models.auth import Tenant
from app.models.trigger import Trigger
from app.services.time_items import list_time_items


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

    items = await list_time_items(
        session_override,
        tenant.id,
        start=now - timedelta(days=1),
        end=now + timedelta(days=1),
        scheduled_only=True,
    )
    run_ids = {i["run_id"] for i in items if i["run_id"]}
    assert str(scheduled_run.id) in run_ids
    assert str(email_run.id) not in run_ids
    assert all("Email:" not in (i["title"] or "") for i in items)
    scheduled_item = next(i for i in items if i.get("run_id") == str(scheduled_run.id))
    assert scheduled_item["kind"] == "session"
    assert scheduled_item["trigger_kind"] == "interval"
    assert scheduled_item["actor_kind"] == "agent"
    assert scheduled_item["actor_id"] == str(agent.id)

    everything = await list_time_items(
        session_override,
        tenant.id,
        start=now - timedelta(days=1),
        end=now + timedelta(days=1),
    )
    email_item = next(i for i in everything if i.get("run_id") == str(email_run.id))
    assert email_item["signal_id"] == email_run.trigger_id
    assert email_item["trigger_kind"] is None


@pytest.mark.asyncio
async def test_time_items_sessions_and_wakes_for_one_agent(session_override: AsyncSession):
    tenant, agent = await _tenant_and_agent(session_override)
    now = datetime.utcnow().replace(microsecond=0)
    session_override.add(
        AgentRun(
            tenant_id=tenant.id,
            agent_id=agent.id,
            trigger_type="chat",
            subject="Reply to visitor",
            status="completed",
            started_at=now - timedelta(hours=3),
            completed_at=now - timedelta(hours=2, minutes=40),
        )
    )
    session_override.add(
        Trigger(
            tenant_id=tenant.id,
            name="Morning scan",
            kind="once",
            agent_id=agent.id,
            enabled=True,
            next_run_at=now + timedelta(hours=6),
            instructions="Scan the platform.",
        )
    )
    await session_override.commit()

    items = await list_time_items(
        session_override,
        tenant.id,
        start=now - timedelta(hours=24),
        end=now + timedelta(hours=24),
        agent_id=agent.id,
    )
    session_row = next(row for row in items if row["title"] == "Reply to visitor")
    wake_row = next(row for row in items if row["title"] == "Morning scan")
    assert session_row["kind"] == "session"
    assert session_row["end"]
    assert wake_row["kind"] == "wake"
    assert wake_row["end"] is None
    assert not any(row["kind"] == "follow_up" for row in items)


@pytest.mark.asyncio
async def test_create_agent_task_accepts_aware_scheduled_for(session_override: AsyncSession):
    from datetime import timezone

    from app.models.signal import Signal
    from app.services.orchestration.dispatcher import create_agent_task

    tenant, _agent = await _tenant_and_agent(session_override)
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="email",
        subject="Aware schedule",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    aware = datetime.now(timezone.utc) + timedelta(days=1)
    task = await create_agent_task(
        session_override,
        tenant.id,
        title="Tomorrow call",
        signal_id=signal.id,
        assignee_kind="human",
        scheduled_for=aware,
        auto_start=False,
        origin="conversation",
    )
    assert task.scheduled_for is not None
    assert task.scheduled_for.tzinfo is None
    # A planned look for a person is the thread's date; the task is a record.
    assert task.status == "completed"
    await session_override.refresh(signal)
    assert signal.next_at is not None
    assert signal.next_at.tzinfo is None


@pytest.mark.asyncio
async def test_complete_rejects_agent_tasks(session_override: AsyncSession):
    from app.models.signal import Signal
    from app.services.orchestration.dispatcher import complete_agent_task, create_agent_task
    from fastapi import HTTPException

    tenant, agent = await _tenant_and_agent(session_override)
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="agent",
        subject="Agent job",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    task = await create_agent_task(
        session_override,
        tenant.id,
        title="Agent work",
        signal_id=signal.id,
        agent_id=agent.id,
        assignee_kind="agent",
        auto_start=False,
    )
    try:
        await complete_agent_task(session_override, tenant.id, task.id)
        raise AssertionError("expected HTTPException")
    except HTTPException as exc:
        assert exc.status_code == 400


@pytest.mark.asyncio
async def test_human_follow_up_skips_system_note(session_override: AsyncSession):
    from app.models.signal import Signal, SignalMessage
    from app.services.orchestration.dispatcher import create_agent_task

    tenant, _agent = await _tenant_and_agent(session_override)
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="email",
        subject="Quiet follow-up",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    await create_agent_task(
        session_override,
        tenant.id,
        title="Call back",
        description="Should not post as system note",
        signal_id=signal.id,
        assignee_kind="human",
        origin="conversation",
        auto_start=False,
    )
    notes = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.kind == "system_note",
            )
        )
    ).scalars().all()
    assert notes == []


@pytest.mark.asyncio
async def test_create_task_rejects_foreign_signal(session_override: AsyncSession):
    from uuid import uuid4

    from app.services.orchestration.dispatcher import create_agent_task
    from fastapi import HTTPException

    tenant, _agent = await _tenant_and_agent(session_override)
    try:
        await create_agent_task(
            session_override,
            tenant.id,
            title="Nope",
            signal_id=uuid4(),
            assignee_kind="human",
            auto_start=False,
        )
        raise AssertionError("expected HTTPException")
    except HTTPException as exc:
        assert exc.status_code == 404


@pytest.mark.asyncio
async def test_agenda_includes_scheduled_human_tasks_only(session_override: AsyncSession):
    from app.models.signal import Signal
    from app.services.orchestration.dispatcher import create_agent_task
    from app.services.thread_schedule import clear_thread_schedule

    tenant, _agent = await _tenant_and_agent(session_override)
    now = datetime.utcnow()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="email",
        subject="Follow up thread",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    await create_agent_task(
        session_override,
        tenant.id,
        title="Call customer Friday",
        signal_id=signal.id,
        assignee_kind="human",
        scheduled_for=now + timedelta(hours=2),
        auto_start=False,
        origin="conversation",
    )
    unscheduled = await create_agent_task(
        session_override,
        tenant.id,
        title="Reply to invoice question",
        signal_id=signal.id,
        assignee_kind="human",
        auto_start=False,
        origin="conversation",
    )
    assert unscheduled.status == "awaiting_human"

    items = await list_time_items(
        session_override,
        tenant.id,
        start=now - timedelta(hours=1),
        end=now + timedelta(days=1),
    )
    tasks = [i for i in items if i.get("source") in ("task", "thread")]
    assert len(tasks) == 1
    assert tasks[0]["source"] == "thread"
    assert tasks[0]["instructions"] == "Call customer Friday"
    assert tasks[0]["signal_id"] == str(signal.id)

    await session_override.refresh(signal)
    await clear_thread_schedule(session_override, signal)
    await session_override.commit()
    items_after = await list_time_items(
        session_override,
        tenant.id,
        start=now - timedelta(hours=1),
        end=now + timedelta(days=1),
    )
    assert not [i for i in items_after if i.get("source") in ("task", "thread")]


@pytest.mark.asyncio
async def test_agenda_includes_conversation_tasks(session_override: AsyncSession):
    from app.models.signal import Signal
    from app.services.orchestration.dispatcher import create_agent_task

    tenant, _agent = await _tenant_and_agent(session_override)
    now = datetime.utcnow()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="email",
        subject="IB application",
        contact_name="Interactive Brokers",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    await create_agent_task(
        session_override,
        tenant.id,
        title="Complete trading account",
        signal_id=signal.id,
        assignee_kind="human",
        scheduled_for=now + timedelta(hours=3),
        auto_start=False,
        origin="conversation",
    )

    items = await list_time_items(
        session_override,
        tenant.id,
        start=now - timedelta(hours=1),
        end=now + timedelta(days=1),
    )
    tasks = [i for i in items if i.get("source") == "thread"]
    assert len(tasks) == 1
    assert tasks[0]["kind"] == "task"
    assert tasks[0]["title"] == "IB application"
    assert tasks[0]["instructions"] == "Complete trading account"
    assert tasks[0]["signal_id"] == str(signal.id)
    assert tasks[0]["actor_kind"] == "person"


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


@pytest.mark.asyncio
async def test_wake_who_is_a_real_agent_not_a_role_slug(session_override: AsyncSession):
    tenant, _agent = await _tenant_and_agent(session_override)
    session_override.add(
        Trigger(
            tenant_id=tenant.id,
            name="Role-only scan",
            kind="interval",
            interval_minutes=1440,
            agent_role="orchestrator",
            enabled=True,
            next_run_at=datetime.utcnow() + timedelta(hours=1),
        )
    )
    await session_override.commit()

    now = datetime.utcnow()
    items = await list_time_items(
        session_override,
        tenant.id,
        start=now,
        end=now + timedelta(days=2),
        sources=["wake"],
    )
    scan = next(i for i in items if i.get("title") == "Role-only scan")
    shown = (scan.get("agent_name") or scan.get("owner_name") or "").lower()
    assert shown not in {"orchestrator", "orchestra", "po"}
    assert scan.get("agent_id")
    assert scan.get("agent_name")
