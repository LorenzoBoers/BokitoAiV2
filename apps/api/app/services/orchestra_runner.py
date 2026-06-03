"""Orchestra workstream mock runner and task scheduling."""

import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestra import (
    Task,
    Workstream,
    WorkstreamRun,
    WorkstreamStep,
    WorkstreamStepRun,
)
from app.services.execution import get_execution_environment


async def run_workstream_mock(
    session: AsyncSession,
    tenant_id: UUID,
    workstream_id: UUID,
    trigger_type: str = "manual",
) -> WorkstreamRun:
    ws_result = await session.execute(
        select(Workstream).where(Workstream.id == workstream_id, Workstream.tenant_id == tenant_id)
    )
    workstream = ws_result.scalar_one_or_none()
    if not workstream:
        raise ValueError("Workstream not found")

    run = WorkstreamRun(
        tenant_id=tenant_id,
        workstream_id=workstream_id,
        trigger_type=trigger_type,
        status="running",
    )
    session.add(run)
    await session.flush()

    steps_result = await session.execute(
        select(WorkstreamStep)
        .where(WorkstreamStep.workstream_id == workstream_id)
        .order_by(WorkstreamStep.order)
    )
    steps = list(steps_result.scalars().all())
    env = get_execution_environment()
    current_step_id: UUID | None = steps[0].id if steps else None
    visited: set[UUID] = set()

    while current_step_id and current_step_id not in visited:
        visited.add(current_step_id)
        step = next((s for s in steps if s.id == current_step_id), None)
        if not step:
            break
        step_run = WorkstreamStepRun(
            run_id=run.id,
            step_id=step.id,
            tenant_id=tenant_id,
            status="running",
        )
        session.add(step_run)
        await session.flush()

        result = await env.run_step(
            session,
            tenant_id,
            step.name,
            f"Execute workstream step for {workstream.name}",
            json.loads(step.config_json or "{}"),
        )
        step_run.status = result.get("status", "success")
        step_run.log_text = result.get("output", "")
        step_run.output_json = json.dumps(result)
        step_run.tokens_in = result.get("tokens_in", 0)
        step_run.tokens_out = result.get("tokens_out", 0)

        if step_run.status == "success":
            current_step_id = step.on_success_step
        else:
            current_step_id = step.on_fail_step

    run.status = "completed"
    run.completed_at = datetime.utcnow()
    run.report_json = json.dumps({"steps_executed": len(visited), "status": "completed"})
    await session.commit()
    await session.refresh(run)
    return run


async def trigger_task(session: AsyncSession, task_id: UUID, tenant_id: UUID) -> None:
    result = await session.execute(
        select(Task).where(Task.id == task_id, Task.tenant_id == tenant_id, Task.enabled.is_(True))
    )
    task = result.scalar_one_or_none()
    if not task:
        return
    task.last_run_at = datetime.utcnow()
    await session.commit()
