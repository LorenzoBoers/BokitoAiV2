"""Workstream API: definitions, steps, and runs with worklog."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.orchestra import Workstream
from app.services import workstreams as svc

router = APIRouter(prefix="/workstreams", tags=["workstreams"])


class WorkstreamCreateBody(BaseModel):
    name: str
    description: str = ""
    project_id: UUID | None = None
    is_default: bool = False


class WorkstreamPatchBody(BaseModel):
    name: str | None = None
    description: str | None = None
    enabled: bool | None = None
    is_default: bool | None = None
    project_id: UUID | None = None


class StepBody(BaseModel):
    id: UUID | None = None
    name: str
    kind: str = "agent"
    goal: str = ""
    agent_id: UUID | None = None
    agent_role: str = ""
    wait_kind: str = "input"
    deadline_hours: int = 0
    on_deadline: str = "continue"
    knowledge_section_ids: list[UUID] = []
    config: dict[str, Any] = {}


class StepsReplaceBody(BaseModel):
    steps: list[StepBody]


class RunStartBody(BaseModel):
    input_kind: str = "manual"
    input_text: str = ""
    input_ref: str = ""


class RunResumeBody(BaseModel):
    input_text: str = ""


@router.get("")
async def list_workstreams(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    project_id: UUID | None = None,
):
    return {"items": await svc.list_workstreams(session, auth.tenant.id, project_id=project_id)}


@router.post("")
async def create_workstream(
    body: WorkstreamCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    ws = Workstream(
        tenant_id=auth.tenant.id,
        name=body.name.strip() or "Workstream",
        description=body.description,
        project_id=body.project_id,
        is_default=body.is_default,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return svc.serialize_workstream(ws, steps_count=0)


@router.get("/runs")
async def list_all_runs(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    workstream_id: UUID | None = None,
    project_id: UUID | None = None,
    limit: int = 50,
):
    return {
        "items": await svc.list_runs(
            session,
            auth.tenant.id,
            workstream_id=workstream_id,
            project_id=project_id,
            limit=limit,
        )
    }


@router.get("/runs/{run_id}")
async def get_run_detail(
    run_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.run_detail(session, auth.tenant.id, run_id)


@router.post("/runs/{run_id}/resume")
async def resume_run(
    run_id: UUID,
    body: RunResumeBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    run = await svc.resume_run(session, auth.tenant.id, run_id, input_text=body.input_text)
    return svc.serialize_run(run)


@router.post("/runs/{run_id}/cancel")
async def cancel_run(
    run_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    run = await svc.cancel_run(session, auth.tenant.id, run_id)
    return svc.serialize_run(run)


@router.post("/runs/{run_id}/promote")
async def promote_run(
    run_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Distill a completed run into a knowledge section via an agent job."""
    return await svc.promote_run_to_knowledge(session, auth.tenant.id, run_id)


@router.get("/{workstream_id}")
async def get_workstream(
    workstream_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    ws = await svc.get_workstream(session, auth.tenant.id, workstream_id)
    steps = await svc.list_steps(session, auth.tenant.id, workstream_id)
    out = svc.serialize_workstream(ws, steps_count=len(steps))
    out["steps"] = [svc.serialize_step(s) for s in steps]
    return out


@router.patch("/{workstream_id}")
async def patch_workstream(
    workstream_id: UUID,
    body: WorkstreamPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    ws = await svc.get_workstream(session, auth.tenant.id, workstream_id)
    patch = body.model_dump(exclude_unset=True)
    if "name" in patch and str(patch["name"]).strip():
        ws.name = str(patch["name"]).strip()
    if "description" in patch and patch["description"] is not None:
        ws.description = str(patch["description"])
    if "enabled" in patch and patch["enabled"] is not None:
        ws.enabled = bool(patch["enabled"])
    if "is_default" in patch and patch["is_default"] is not None:
        ws.is_default = bool(patch["is_default"])
    if "project_id" in patch:
        ws.project_id = patch["project_id"]
    from datetime import datetime

    ws.updated_at = datetime.utcnow()
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return svc.serialize_workstream(ws)


@router.delete("/{workstream_id}")
async def delete_workstream(
    workstream_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    await svc.delete_workstream(session, auth.tenant.id, workstream_id)
    await session.commit()
    return {"ok": True}


@router.put("/{workstream_id}/steps")
async def replace_steps(
    workstream_id: UUID,
    body: StepsReplaceBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    steps = await svc.replace_steps(
        session,
        auth.tenant.id,
        workstream_id,
        [
            {
                **s.model_dump(),
                "id": str(s.id) if s.id else None,
                "agent_id": str(s.agent_id) if s.agent_id else None,
                "knowledge_section_ids": [str(v) for v in s.knowledge_section_ids],
            }
            for s in body.steps
        ],
    )
    await session.commit()
    return {"steps": [svc.serialize_step(s) for s in steps]}


@router.post("/{workstream_id}/runs")
async def start_run(
    workstream_id: UUID,
    body: RunStartBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    run = await svc.start_run(
        session,
        auth.tenant.id,
        workstream_id,
        input_kind=body.input_kind,
        input_text=body.input_text,
        input_ref=body.input_ref,
        triggered_by_type="user",
        triggered_by_id=str(auth.user.id),
    )
    return svc.serialize_run(run)


@router.get("/{workstream_id}/runs")
async def list_runs(
    workstream_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = 50,
):
    return {
        "items": await svc.list_runs(
            session, auth.tenant.id, workstream_id=workstream_id, limit=limit
        )
    }
