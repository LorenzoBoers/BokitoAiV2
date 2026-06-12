"""Orchestration task lifecycle: create, enqueue, cancel."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.orchestration import AgentTask, TaskArtifact
from app.models.orchestra import Workstream
from app.services.signal_decisions import get_or_create_internal_thread


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def create_agent_task(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    title: str,
    description: str = "",
    project_id: UUID | None = None,
    workstream_id: UUID | None = None,
    agent_id: UUID | None = None,
    default_runtime_profile_id: UUID | None = None,
    success_criteria_json: str = "{}",
    trigger_type: str = "manual",
    trigger_id: str | None = None,
    created_by: UUID | None = None,
    signal_id: UUID | None = None,
    auto_start: bool = True,
) -> AgentTask:
    if workstream_id:
        ws = (
            await session.execute(
                select(Workstream).where(Workstream.id == workstream_id, Workstream.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if not ws:
            raise HTTPException(status_code=404, detail="Workstream not found")

    if not signal_id:
        agent_name = "Agent"
        if agent_id:
            agent = (
                await session.execute(select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id))
            ).scalar_one_or_none()
            if agent:
                agent_name = agent.name
        signal = await get_or_create_internal_thread(
            session,
            tenant_id,
            project_id=project_id,
            subject=title,
            contact_name=agent_name,
            agent_id=agent_id,
            assigned_user_id=created_by,
        )
        signal_id = signal.id

    task = AgentTask(
        tenant_id=tenant_id,
        project_id=project_id,
        signal_id=signal_id,
        workstream_id=workstream_id,
        default_runtime_profile_id=default_runtime_profile_id,
        title=title,
        description=description,
        status="queued",
        context_json=json.dumps({"agent_id": str(agent_id) if agent_id else None}),
        success_criteria_json=success_criteria_json,
        trigger_type=trigger_type,
        trigger_id=trigger_id,
        created_by=created_by,
    )
    session.add(task)
    await session.flush()

    if description:
        from app.models.signal import SignalMessage

        session.add(
            SignalMessage(
                signal_id=signal_id,
                tenant_id=tenant_id,
                direction="internal",
                kind="system_note",
                body_text=description,
                author_name="System",
            )
        )

    await session.commit()
    await session.refresh(task)

    if auto_start:
        from app.services.orchestration.queue import enqueue_agent_task_segment

        enqueued = await enqueue_agent_task_segment(str(tenant_id), str(task.id))
        if not enqueued:
            from app.services.orchestration.runner import run_agent_task_segment

            await run_agent_task_segment(session, tenant_id, task.id)
            await session.refresh(task)

    return task


async def cancel_agent_task(session: AsyncSession, tenant_id: UUID, task_id: UUID) -> AgentTask:
    task = (
        await session.execute(select(AgentTask).where(AgentTask.id == task_id, AgentTask.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    from app.models.agent import AgentRun

    runs = (
        await session.execute(
            select(AgentRun).where(
                AgentRun.task_id == task_id,
                AgentRun.tenant_id == tenant_id,
                AgentRun.status == "running",
            )
        )
    ).scalars().all()
    for run in runs:
        run.status = "cancelled"
        run.completed_at = datetime.utcnow()
        run.pause_reason = "cancelled"
        session.add(run)
        child_runs = (
            await session.execute(
                select(AgentRun).where(AgentRun.parent_run_id == run.id, AgentRun.status == "running")
            )
        ).scalars().all()
        for child in child_runs:
            child.status = "cancelled"
            child.completed_at = datetime.utcnow()
            session.add(child)

    task.status = "cancelled"
    task.completed_at = datetime.utcnow()
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


async def resume_agent_task(session: AsyncSession, tenant_id: UUID, task_id: UUID) -> AgentTask:
    task = (
        await session.execute(select(AgentTask).where(AgentTask.id == task_id, AgentTask.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status not in ("paused", "awaiting_decision", "queued"):
        raise HTTPException(status_code=400, detail=f"Cannot resume task in status {task.status}")
    task.status = "running"
    task.pause_reason = None
    session.add(task)
    await session.commit()
    from app.services.orchestration.queue import enqueue_agent_task_segment

    await enqueue_agent_task_segment(str(tenant_id), str(task.id))
    await session.refresh(task)
    return task


async def add_task_artifact(
    session: AsyncSession,
    tenant_id: UUID,
    task_id: UUID,
    *,
    name: str,
    artifact_type: str,
    content: dict[str, Any],
    run_id: UUID | None = None,
) -> TaskArtifact:
    artifact = TaskArtifact(
        tenant_id=tenant_id,
        agent_task_id=task_id,
        run_id=run_id,
        name=name,
        artifact_type=artifact_type,
        content_json=json.dumps(content),
    )
    session.add(artifact)
    await session.flush()
    return artifact


def serialize_agent_task(task: AgentTask) -> dict[str, Any]:
    return {
        "id": str(task.id),
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "pause_reason": task.pause_reason,
        "project_id": str(task.project_id) if task.project_id else None,
        "signal_id": str(task.signal_id) if task.signal_id else None,
        "workstream_id": str(task.workstream_id) if task.workstream_id else None,
        "current_step_id": str(task.current_step_id) if task.current_step_id else None,
        "context": _parse_json(task.context_json),
        "success_criteria": _parse_json(task.success_criteria_json),
        "trigger_type": task.trigger_type,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
    }
