"""Workbench tools: hand coding work to Cursor cloud agents from a conversation."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from bokito.services import work as work_svc
from bokito.services import workbench as wb_svc
from bokito.tools.registry import ToolContext, tool


class DispatchWorkArgs(BaseModel):
    brief: str = Field(min_length=10, max_length=8000, description="What to build or fix.")
    repository: str = Field(
        min_length=8, max_length=300, description="Repository URL, e.g. https://github.com/org/repo"
    )
    ref: str = Field(default="", max_length=120, description="Base branch, tag or commit.")
    auto_pr: bool = Field(default=True, description="Open a pull request when the job finishes.")
    branch_name: str = Field(default="", max_length=120)
    model: str = Field(default="", max_length=80)
    connection_id: uuid.UUID | None = Field(
        default=None, description="Workbench connection; defaults to the first active one."
    )
    conversation_id: uuid.UUID | None = None


@tool(
    "dispatch_work",
    description="Hand a coding brief to the connected workbench (Cursor cloud agents). "
    "The result lands back in the conversation as a run message with the pull request.",
    category="external",
)
async def dispatch_work(ctx: ToolContext, args: DispatchWorkArgs) -> dict:
    conn = await wb_svc.resolve_connection(ctx.session, ctx.tenant_id, args.connection_id)
    run, handle = await wb_svc.dispatch(
        ctx.session,
        ctx.principal,
        conn=conn,
        brief=args.brief,
        repository=args.repository,
        ref=args.ref,
        auto_pr=args.auto_pr,
        branch_name=args.branch_name,
        model=args.model,
        conversation_id=args.conversation_id or ctx.conversation_id,
        parent_run_id=ctx.run_id,
    )
    return {"job_run_id": str(run.id), **handle.to_dict()}


class JobArgs(BaseModel):
    job_run_id: uuid.UUID


@tool(
    "workbench_status",
    description="Current status of a workbench job (branch, pull request, state).",
    category="read",
)
async def workbench_status(ctx: ToolContext, args: JobArgs) -> dict:
    run = await work_svc.get_run(ctx.session, ctx.tenant_id, args.job_run_id)
    conn = await wb_svc.resolve_connection(
        ctx.session,
        ctx.tenant_id,
        uuid.UUID(str((run.checkpoint or {}).get("connection_id"))),
    )
    handle = await wb_svc.refresh_status(ctx.session, conn, run)
    return {"job_run_id": str(run.id), "run_status": run.status.value, **handle.to_dict()}


class FollowupArgs(JobArgs):
    text: str = Field(min_length=3, max_length=8000)


@tool(
    "workbench_followup",
    description="Send follow-up instructions to a running workbench job.",
    category="external",
)
async def workbench_followup(ctx: ToolContext, args: FollowupArgs) -> dict:
    run = await work_svc.get_run(ctx.session, ctx.tenant_id, args.job_run_id)
    conn = await wb_svc.resolve_connection(
        ctx.session,
        ctx.tenant_id,
        uuid.UUID(str((run.checkpoint or {}).get("connection_id"))),
    )
    handle = await wb_svc.followup(ctx.session, conn, run, args.text)
    return {"job_run_id": str(run.id), **handle.to_dict()}
