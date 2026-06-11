"""Orchestra workstream runner — delegates to orchestration engine."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestra import WorkstreamRun
from app.services.orchestration.queue import enqueue_workstream_run
from app.services.orchestration.runner import run_agent_task_segment, start_workstream_as_task


async def _run_task_segments(session: AsyncSession, tenant_id: UUID, task_id: UUID, max_segments: int = 20) -> None:
    from app.models.orchestration import AgentTask

    for _ in range(max_segments):
        result = await run_agent_task_segment(session, tenant_id, task_id)
        task = (
            await session.execute(select(AgentTask).where(AgentTask.id == task_id))
        ).scalar_one_or_none()
        if not task or task.status in ("completed", "failed", "cancelled", "awaiting_decision"):
            break
        if result.get("completed") or result.get("failed") or result.get("paused"):
            break


async def run_workstream_mock(
    session: AsyncSession,
    tenant_id: UUID,
    workstream_id: UUID,
    trigger_type: str = "manual",
) -> WorkstreamRun:
    """Start workstream as background AgentTask."""
    if await enqueue_workstream_run(str(tenant_id), str(workstream_id), trigger_type):
        run = WorkstreamRun(
            tenant_id=tenant_id,
            workstream_id=workstream_id,
            trigger_type=trigger_type,
            status="running",
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)
        return run

    task = await start_workstream_as_task(session, tenant_id, workstream_id, trigger_type=trigger_type)
    await _run_task_segments(session, tenant_id, task.id)

    if task.workstream_run_id:
        result = await session.execute(select(WorkstreamRun).where(WorkstreamRun.id == task.workstream_run_id))
        run = result.scalar_one_or_none()
        if run:
            await session.refresh(run)
            return run

    run = WorkstreamRun(
        tenant_id=tenant_id,
        workstream_id=workstream_id,
        trigger_type=trigger_type,
        status="completed",
        completed_at=datetime.utcnow(),
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run
