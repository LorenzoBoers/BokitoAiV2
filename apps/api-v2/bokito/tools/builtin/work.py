"""Work tools: agents, playbooks, triggers. Structural changes go through `changes`."""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, Field

from bokito.domain.identity import Posture
from bokito.domain.work import RunKind, TriggerKind
from bokito.services import govern as govern_svc
from bokito.services import work as work_svc
from bokito.tools.registry import ToolContext, tool


class CreateAgentArgs(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str = ""
    instructions: str = ""
    model: str = ""
    tools: list[str] = Field(default_factory=list)
    autonomy_cap: Posture | None = None
    channels: list[str] = Field(default_factory=list)
    language: str = ""


@tool("create_agent", description="Create a new AI colleague.", category="write")
async def create_agent(ctx: ToolContext, args: CreateAgentArgs) -> dict:
    agent = await work_svc.create_agent(ctx.session, ctx.tenant_id, **args.model_dump())
    await govern_svc.record_change(
        ctx.session,
        ctx.tenant_id,
        target_kind="agent",
        target_id=agent.id,
        title=f"Create agent {agent.name}",
        before=None,
        after=work_svc.agent_snapshot(agent),
        proposed_by=ctx.principal.actor,
        conversation_id=ctx.conversation_id,
        applied=True,
        applied_by_user_id=ctx.principal.user_id,
    )
    return {"agent_id": str(agent.id), "slug": agent.slug}


class UpdateAgentArgs(BaseModel):
    agent_id: uuid.UUID
    patch: dict[str, Any]


@tool(
    "update_agent",
    description="Change an agent's passport (instructions, model, tools, autonomy cap).",
    category="write",
)
async def update_agent(ctx: ToolContext, args: UpdateAgentArgs) -> dict:
    agent = await work_svc.get_agent(ctx.session, ctx.tenant_id, args.agent_id)
    before = work_svc.agent_snapshot(agent)
    work_svc.apply_agent_patch(agent, args.patch)
    await ctx.session.flush()
    await govern_svc.record_change(
        ctx.session,
        ctx.tenant_id,
        target_kind="agent",
        target_id=agent.id,
        title=f"Update agent {agent.name}",
        before=before,
        after=work_svc.agent_snapshot(agent),
        proposed_by=ctx.principal.actor,
        conversation_id=ctx.conversation_id,
        applied=True,
        applied_by_user_id=ctx.principal.user_id,
    )
    return {"agent_id": str(agent.id)}


class CreatePlaybookArgs(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = ""
    steps: list[dict[str, Any]] = Field(default_factory=list)
    agent_id: uuid.UUID | None = None
    autonomy_cap: Posture | None = None


@tool(
    "create_playbook",
    description="Create a playbook: an ordered, repeatable way of working.",
    category="write",
)
async def create_playbook(ctx: ToolContext, args: CreatePlaybookArgs) -> dict:
    pb = await work_svc.create_playbook(ctx.session, ctx.tenant_id, **args.model_dump())
    await govern_svc.record_change(
        ctx.session,
        ctx.tenant_id,
        target_kind="playbook",
        target_id=pb.id,
        title=f"Create playbook {pb.name}",
        before=None,
        after={"name": pb.name, "steps": pb.steps},
        proposed_by=ctx.principal.actor,
        conversation_id=ctx.conversation_id,
        applied=True,
        applied_by_user_id=ctx.principal.user_id,
    )
    return {"playbook_id": str(pb.id), "slug": pb.slug}


class RunPlaybookArgs(BaseModel):
    playbook_id: uuid.UUID
    conversation_id: uuid.UUID | None = None
    input: dict[str, Any] = Field(default_factory=dict)


@tool(
    "run_playbook",
    description="Start a playbook run, optionally on a conversation.",
    category="write",
)
async def run_playbook(ctx: ToolContext, args: RunPlaybookArgs) -> dict:
    pb = await work_svc.get_playbook(ctx.session, ctx.tenant_id, args.playbook_id)
    run = await work_svc.create_run(
        ctx.session,
        ctx.tenant_id,
        kind=RunKind.playbook,
        title=pb.name,
        actor=ctx.principal.actor,
        trust=ctx.principal.trust,
        conversation_id=args.conversation_id or ctx.conversation_id,
        agent_id=pb.agent_id,
        playbook_id=pb.id,
        parent_run_id=ctx.run_id,
        input=args.input,
    )
    from bokito.workers.queue import enqueue

    await enqueue("run_playbook_job", str(run.id))
    return {"run_id": str(run.id)}


class CreateTriggerArgs(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    kind: TriggerKind
    spec: dict[str, Any] = Field(default_factory=dict)
    agent_id: uuid.UUID | None = None
    playbook_id: uuid.UUID | None = None
    instructions: str = ""


@tool(
    "create_trigger",
    description="Schedule an agent or playbook: cron, interval, webhook or event.",
    category="write",
)
async def create_trigger(ctx: ToolContext, args: CreateTriggerArgs) -> dict:
    trigger = await work_svc.create_trigger(ctx.session, ctx.tenant_id, **args.model_dump())
    return {"trigger_id": str(trigger.id), "webhook_secret": trigger.webhook_secret or None}
