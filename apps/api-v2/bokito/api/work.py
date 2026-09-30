"""Work: agents, playbooks, runs, triggers (+ public webhook hooks)."""

from __future__ import annotations

import hmac
import uuid
from typing import Any

from fastapi import APIRouter, Header, Query, Request
from pydantic import BaseModel

from bokito.api.schemas import (
    AgentOut,
    PlaybookOut,
    RunEventOut,
    RunOut,
    ToolOutcomeOut,
    TriggerOut,
)
from bokito.deps import DbSession, Operator
from bokito.domain.identity import Role
from bokito.domain.work import RunKind, RunStatus, Trigger
from bokito.errors import NotFound, Unauthorized
from bokito.services import decision as decision_svc
from bokito.services import govern as govern_svc
from bokito.services import work as work_svc
from bokito.tools import execute_tool
from bokito.tools.builtin.work import (
    CreateAgentArgs,
    CreatePlaybookArgs,
    CreateTriggerArgs,
    RunPlaybookArgs,
    UpdateAgentArgs,
)
from bokito.workers.queue import enqueue

router = APIRouter(tags=["work"])


# Agents ---------------------------------------------------------------------


@router.get("/agents", response_model=list[AgentOut], summary="Agents")
async def list_agents(session: DbSession, principal: Operator) -> list[AgentOut]:
    await work_svc.ensure_default_agent(session, principal.tenant_id)
    await session.commit()
    return [
        AgentOut.model_validate(a) for a in await work_svc.list_agents(session, principal.tenant_id)
    ]


@router.post(
    "/agents", response_model=ToolOutcomeOut, status_code=201, summary="Create (tool: create_agent)"
)
async def create_agent(
    body: CreateAgentArgs, session: DbSession, principal: Operator
) -> ToolOutcomeOut:
    principal.require_role(Role.admin)
    outcome = await execute_tool(session, principal, "create_agent", body.model_dump(mode="json"))
    await session.commit()
    return ToolOutcomeOut(**outcome.to_dict())


@router.get("/agents/{agent_id}", response_model=AgentOut, summary="Agent passport")
async def get_agent(agent_id: uuid.UUID, session: DbSession, principal: Operator) -> AgentOut:
    return AgentOut.model_validate(await work_svc.get_agent(session, principal.tenant_id, agent_id))


class AgentPatch(BaseModel):
    patch: dict[str, Any]


@router.patch("/agents/{agent_id}", response_model=AgentOut, summary="Update (tool: update_agent)")
async def update_agent(
    agent_id: uuid.UUID, body: AgentPatch, session: DbSession, principal: Operator
) -> AgentOut:
    principal.require_role(Role.admin)
    await execute_tool(
        session,
        principal,
        "update_agent",
        UpdateAgentArgs(agent_id=agent_id, patch=body.patch).model_dump(mode="json"),
    )
    await session.commit()
    return AgentOut.model_validate(await work_svc.get_agent(session, principal.tenant_id, agent_id))


@router.delete("/agents/{agent_id}", status_code=204, summary="Deactivate an agent")
async def delete_agent(agent_id: uuid.UUID, session: DbSession, principal: Operator) -> None:
    principal.require_role(Role.admin)
    agent = await work_svc.get_agent(session, principal.tenant_id, agent_id)
    before = work_svc.agent_snapshot(agent)
    agent.active = False
    agent.is_default = False
    await govern_svc.record_change(
        session,
        principal.tenant_id,
        target_kind="agent",
        target_id=agent.id,
        title=f"Deactivate agent {agent.name}",
        before=before,
        after=work_svc.agent_snapshot(agent),
        proposed_by=principal.actor,
        applied=True,
        applied_by_user_id=principal.user_id,
    )
    await session.commit()


# Playbooks ------------------------------------------------------------------


@router.get("/playbooks", response_model=list[PlaybookOut], summary="Playbooks")
async def list_playbooks(session: DbSession, principal: Operator) -> list[PlaybookOut]:
    return [
        PlaybookOut.model_validate(p)
        for p in await work_svc.list_playbooks(session, principal.tenant_id)
    ]


@router.post(
    "/playbooks",
    response_model=ToolOutcomeOut,
    status_code=201,
    summary="Create (tool: create_playbook)",
)
async def create_playbook(
    body: CreatePlaybookArgs, session: DbSession, principal: Operator
) -> ToolOutcomeOut:
    principal.require_role(Role.admin)
    outcome = await execute_tool(
        session, principal, "create_playbook", body.model_dump(mode="json")
    )
    await session.commit()
    return ToolOutcomeOut(**outcome.to_dict())


@router.get("/playbooks/{playbook_id}", response_model=PlaybookOut, summary="Playbook detail")
async def get_playbook(
    playbook_id: uuid.UUID, session: DbSession, principal: Operator
) -> PlaybookOut:
    return PlaybookOut.model_validate(
        await work_svc.get_playbook(session, principal.tenant_id, playbook_id)
    )


class PlaybookPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    steps: list[dict[str, Any]] | None = None
    agent_id: uuid.UUID | None = None
    active: bool | None = None


@router.patch("/playbooks/{playbook_id}", response_model=PlaybookOut, summary="Update a playbook")
async def update_playbook(
    playbook_id: uuid.UUID, body: PlaybookPatch, session: DbSession, principal: Operator
) -> PlaybookOut:
    principal.require_role(Role.admin)
    pb = await work_svc.get_playbook(session, principal.tenant_id, playbook_id)
    before = {"name": pb.name, "description": pb.description, "steps": pb.steps}
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(pb, key, value)
    await govern_svc.record_change(
        session,
        principal.tenant_id,
        target_kind="playbook",
        target_id=pb.id,
        title=f"Update playbook {pb.name}",
        before=before,
        after={"name": pb.name, "description": pb.description, "steps": pb.steps},
        proposed_by=principal.actor,
        applied=True,
        applied_by_user_id=principal.user_id,
    )
    await session.commit()
    return PlaybookOut.model_validate(pb)


@router.post(
    "/playbooks/{playbook_id}/run",
    response_model=ToolOutcomeOut,
    summary="Run (tool: run_playbook)",
)
async def run_playbook(
    playbook_id: uuid.UUID,
    session: DbSession,
    principal: Operator,
    conversation_id: uuid.UUID | None = None,
) -> ToolOutcomeOut:
    outcome = await execute_tool(
        session,
        principal,
        "run_playbook",
        RunPlaybookArgs(playbook_id=playbook_id, conversation_id=conversation_id).model_dump(
            mode="json"
        ),
    )
    await session.commit()
    return ToolOutcomeOut(**outcome.to_dict())


# Runs -----------------------------------------------------------------------


@router.get("/runs", response_model=list[RunOut], summary="Runs (the ledger)")
async def list_runs(
    session: DbSession,
    principal: Operator,
    status: RunStatus | None = None,
    kind: RunKind | None = None,
    conversation_id: uuid.UUID | None = None,
    agent_id: uuid.UUID | None = None,
    limit: int = Query(default=50, le=200),
) -> list[RunOut]:
    rows = await work_svc.list_runs(
        session,
        principal.tenant_id,
        status=status,
        kind=kind,
        conversation_id=conversation_id,
        agent_id=agent_id,
        limit=limit,
    )
    return [RunOut.model_validate(r) for r in rows]


class RunDetailOut(RunOut):
    events: list[RunEventOut]


@router.get("/runs/{run_id}", response_model=RunDetailOut, summary="Run with events")
async def get_run(run_id: uuid.UUID, session: DbSession, principal: Operator) -> RunDetailOut:
    run = await work_svc.get_run(session, principal.tenant_id, run_id)
    events = await work_svc.list_run_events(session, run)
    return RunDetailOut(
        **RunOut.model_validate(run).model_dump(),
        events=[RunEventOut.model_validate(e) for e in events],
    )


@router.post("/runs/{run_id}/cancel", response_model=RunOut, summary="Cancel a run")
async def cancel_run(run_id: uuid.UUID, session: DbSession, principal: Operator) -> RunOut:
    run = await work_svc.get_run(session, principal.tenant_id, run_id)
    await work_svc.cancel_run(session, run)
    await session.commit()
    return RunOut.model_validate(run)


# Triggers -------------------------------------------------------------------


@router.get("/triggers", response_model=list[TriggerOut], summary="Triggers")
async def list_triggers(session: DbSession, principal: Operator) -> list[TriggerOut]:
    return [
        TriggerOut.model_validate(t)
        for t in await work_svc.list_triggers(session, principal.tenant_id)
    ]


@router.post(
    "/triggers",
    response_model=ToolOutcomeOut,
    status_code=201,
    summary="Create (tool: create_trigger)",
)
async def create_trigger(
    body: CreateTriggerArgs, session: DbSession, principal: Operator
) -> ToolOutcomeOut:
    principal.require_role(Role.admin)
    outcome = await execute_tool(session, principal, "create_trigger", body.model_dump(mode="json"))
    await session.commit()
    return ToolOutcomeOut(**outcome.to_dict())


class TriggerPatch(BaseModel):
    name: str | None = None
    spec: dict[str, Any] | None = None
    instructions: str | None = None
    active: bool | None = None
    agent_id: uuid.UUID | None = None
    playbook_id: uuid.UUID | None = None


@router.patch("/triggers/{trigger_id}", response_model=TriggerOut, summary="Update a trigger")
async def update_trigger(
    trigger_id: uuid.UUID, body: TriggerPatch, session: DbSession, principal: Operator
) -> TriggerOut:
    principal.require_role(Role.admin)
    trigger = await work_svc.get_trigger(session, principal.tenant_id, trigger_id)
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(trigger, key, value)
    if body.spec is not None:
        trigger.next_fire_at = work_svc.compute_next_fire(trigger.kind, trigger.spec)
    await session.commit()
    return TriggerOut.model_validate(trigger)


@router.delete("/triggers/{trigger_id}", status_code=204, summary="Delete a trigger")
async def delete_trigger(trigger_id: uuid.UUID, session: DbSession, principal: Operator) -> None:
    principal.require_role(Role.admin)
    trigger = await work_svc.get_trigger(session, principal.tenant_id, trigger_id)
    await session.delete(trigger)
    await session.commit()


hooks = APIRouter(prefix="/hooks", tags=["work"])


@hooks.post("/{trigger_id}", summary="Public webhook for a trigger", response_model=dict)
async def fire_webhook(
    trigger_id: uuid.UUID,
    request: Request,
    session: DbSession,
    x_bokito_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    trigger = await session.get(Trigger, trigger_id)
    if not trigger or not trigger.active or trigger.kind.value != "webhook":
        raise NotFound("trigger not found", code="trigger_not_found")
    secret = x_bokito_secret or request.query_params.get("secret", "")
    if not trigger.webhook_secret or not hmac.compare_digest(secret, trigger.webhook_secret):
        raise Unauthorized("invalid webhook secret", code="invalid_secret")
    try:
        payload = await request.json()
    except Exception:
        payload = {"raw": (await request.body()).decode(errors="replace")[:10000]}
    conv = await decision_svc.govern_conversation(session, trigger.tenant_id)
    run = await work_svc.create_run(
        session,
        trigger.tenant_id,
        kind=RunKind.playbook if trigger.playbook_id else RunKind.trigger,
        title=trigger.name,
        actor=f"trigger:{trigger.id}",
        trust="external",
        conversation_id=conv.id,
        agent_id=trigger.agent_id,
        playbook_id=trigger.playbook_id,
        trigger_id=trigger.id,
        input={"instructions": trigger.instructions, "payload": payload},
    )
    trigger.last_fired_at = run.created_at
    await session.commit()
    await enqueue(
        "run_playbook_job" if trigger.playbook_id else "run_trigger_agent_job", str(run.id)
    )
    return {"run_id": str(run.id)}
