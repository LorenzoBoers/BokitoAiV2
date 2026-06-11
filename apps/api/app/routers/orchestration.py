"""Orchestration API routes."""

from __future__ import annotations

import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.agent import AgentRun, RunEvent
from app.models.orchestration import AgentTask, RuntimeProfile, TaskArtifact
from app.models.orchestra import Workstream, WorkstreamStep
from app.services.orchestration.dispatcher import (
    cancel_agent_task,
    create_agent_task,
    resume_agent_task,
    serialize_agent_task,
)
from app.services.orchestration.queue import enqueue_agent_task_segment
from app.services.orchestration.runner import run_agent_task_segment, start_workstream_as_task

router = APIRouter(prefix="/orchestration", tags=["orchestration"])


class RuntimeProfileCreate(BaseModel):
    name: str
    slug: str = ""
    role_tag: str = "executor"
    provider: str = "platform"
    model: str = "claude-sonnet-4-20250514"
    thinking_budget: int = 0
    max_tokens: int = 4096
    max_loops: int = 25
    tools_json: str = "[]"
    autonomy_level: str = "approval"
    cost_aware: bool = False
    max_cost_cents: int = 0


class AgentTaskCreate(BaseModel):
    title: str
    description: str = ""
    project_id: UUID | None = None
    workstream_id: UUID | None = None
    agent_id: UUID | None = None
    default_runtime_profile_id: UUID | None = None
    success_criteria_json: str = "{}"


class WorkstreamStepCreate(BaseModel):
    name: str
    order: int = 0
    agent_id: UUID | None = None
    runtime_profile_id: UUID | None = None
    agent_profile_id: UUID | None = None
    step_kind: str = "agent"
    prompt_template: str = ""
    handoff_template: str = ""
    success_criteria_json: str = "{}"
    eval_kind: str = "rubric"
    max_retries: int = 2


@router.get("/runtime-profiles")
async def list_runtime_profiles(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    rows = (
        await session.execute(
            select(RuntimeProfile).where(RuntimeProfile.tenant_id == auth.tenant.id).order_by(RuntimeProfile.name)
        )
    ).scalars().all()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "slug": r.slug,
            "role_tag": r.role_tag,
            "model": r.model,
            "provider": r.provider,
            "max_loops": r.max_loops,
            "max_cost_cents": r.max_cost_cents,
        }
        for r in rows
    ]


@router.post("/runtime-profiles")
async def create_runtime_profile(
    body: RuntimeProfileCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    row = RuntimeProfile(tenant_id=auth.tenant.id, **body.model_dump())
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {"id": str(row.id)}


@router.get("/tasks")
async def list_tasks(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    signal_id: UUID | None = None,
):
    query = select(AgentTask).where(AgentTask.tenant_id == auth.tenant.id)
    if signal_id is not None:
        query = query.where(AgentTask.signal_id == signal_id)
    rows = (
        await session.execute(query.order_by(AgentTask.created_at.desc()).limit(50))
    ).scalars().all()
    return [serialize_agent_task(t) for t in rows]


@router.post("/tasks")
async def create_task(
    body: AgentTaskCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    task = await create_agent_task(
        session,
        auth.tenant.id,
        title=body.title,
        description=body.description,
        project_id=body.project_id,
        workstream_id=body.workstream_id,
        agent_id=body.agent_id,
        default_runtime_profile_id=body.default_runtime_profile_id,
        success_criteria_json=body.success_criteria_json,
        created_by=auth.user.id,
        auto_start=True,
    )
    await session.refresh(task)
    return serialize_agent_task(task)


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    task = (
        await session.execute(
            select(AgentTask).where(AgentTask.id == task_id, AgentTask.tenant_id == auth.tenant.id)
        )
    ).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return serialize_agent_task(task)


@router.post("/tasks/{task_id}/run")
async def run_task(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    task = (
        await session.execute(
            select(AgentTask).where(AgentTask.id == task_id, AgentTask.tenant_id == auth.tenant.id)
        )
    ).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.status = "queued"
    session.add(task)
    await session.commit()
    if not await enqueue_agent_task_segment(str(auth.tenant.id), str(task.id)):
        await run_agent_task_segment(session, auth.tenant.id, task.id)
    return {"ok": True}


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    task = await cancel_agent_task(session, auth.tenant.id, task_id)
    return serialize_agent_task(task)


@router.post("/tasks/{task_id}/resume")
async def resume_task(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    task = await resume_agent_task(session, auth.tenant.id, task_id)
    if not await enqueue_agent_task_segment(str(auth.tenant.id), str(task.id)):
        await run_agent_task_segment(session, auth.tenant.id, task.id)
    return serialize_agent_task(task)


@router.get("/tasks/{task_id}/artifacts")
async def list_artifacts(
    task_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    rows = (
        await session.execute(
            select(TaskArtifact).where(
                TaskArtifact.agent_task_id == task_id, TaskArtifact.tenant_id == auth.tenant.id
            )
        )
    ).scalars().all()
    return [
        {
            "id": str(a.id),
            "name": a.name,
            "artifact_type": a.artifact_type,
            "content": json.loads(a.content_json or "{}"),
            "created_at": a.created_at.isoformat(),
        }
        for a in rows
    ]


@router.post("/workstreams/{workstream_id}/run")
async def run_workstream(
    workstream_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    task = await start_workstream_as_task(session, auth.tenant.id, workstream_id, trigger_type="manual")
    return serialize_agent_task(task)


@router.get("/workstreams/{workstream_id}/steps")
async def list_workstream_steps(
    workstream_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    rows = (
        await session.execute(
            select(WorkstreamStep)
            .where(WorkstreamStep.workstream_id == workstream_id, WorkstreamStep.tenant_id == auth.tenant.id)
            .order_by(WorkstreamStep.order)
        )
    ).scalars().all()
    return [
        {
            "id": str(s.id),
            "name": s.name,
            "order": s.order,
            "agent_id": str(s.agent_id) if s.agent_id else None,
            "runtime_profile_id": str(s.runtime_profile_id) if s.runtime_profile_id else None,
            "step_kind": s.step_kind,
            "prompt_template": s.prompt_template,
            "handoff_template": s.handoff_template,
            "eval_kind": s.eval_kind,
        }
        for s in rows
    ]


@router.post("/workstreams/{workstream_id}/steps")
async def create_workstream_step(
    workstream_id: UUID,
    body: WorkstreamStepCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    ws = (
        await session.execute(
            select(Workstream).where(Workstream.id == workstream_id, Workstream.tenant_id == auth.tenant.id)
        )
    ).scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Workstream not found")
    step = WorkstreamStep(tenant_id=auth.tenant.id, workstream_id=workstream_id, **body.model_dump())
    session.add(step)
    await session.commit()
    await session.refresh(step)
    return {"id": str(step.id)}


@router.get("/runs/{run_id}/events")
async def list_run_events(
    run_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    run = (
        await session.execute(
            select(AgentRun).where(AgentRun.id == run_id, AgentRun.tenant_id == auth.tenant.id)
        )
    ).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    events = (
        await session.execute(
            select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.sequence, RunEvent.created_at)
        )
    ).scalars().all()
    return {
        "run_id": str(run_id),
        "status": run.status,
        "runtime_snapshot": json.loads(run.runtime_snapshot_json or "{}"),
        "events": [
            {
                "type": e.event_type,
                "message": e.message,
                "payload": json.loads(e.payload_json or "{}"),
                "sequence": e.sequence,
                "detail_level": e.detail_level,
                "created_at": e.created_at.isoformat(),
            }
            for e in events
        ],
    }


