"""Govern tools: posture, allowances, decisions."""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field

from bokito.domain.identity import Posture, Tenant
from bokito.services import decision as decision_svc
from bokito.services import govern as govern_svc
from bokito.services import policy as policy_svc
from bokito.tools.registry import ToolContext, tool

Verdict = Literal["allow", "ask", "deny"]


class SetPostureArgs(BaseModel):
    posture: Posture


@tool(
    "set_posture",
    description="Set the workspace autonomy posture: manual, assisted or autonomous.",
    category="write",
    consequential=True,
)
async def set_posture(ctx: ToolContext, args: SetPostureArgs) -> dict:
    policy = await policy_svc.get_policy(ctx.session, ctx.tenant_id)
    before = govern_svc.policy_snapshot(policy)
    policy.posture = args.posture
    tenant = await ctx.session.get(Tenant, ctx.tenant_id)
    if tenant:
        tenant.posture = args.posture
    await ctx.session.flush()
    await govern_svc.record_change(
        ctx.session,
        ctx.tenant_id,
        target_kind="policy",
        target_id=policy.id,
        title=f"Posture set to {args.posture.value}",
        before=before,
        after=govern_svc.policy_snapshot(policy),
        proposed_by=ctx.principal.actor,
        conversation_id=ctx.conversation_id,
        applied=True,
        applied_by_user_id=ctx.principal.user_id,
    )
    return {"posture": args.posture.value}


class SetAllowanceArgs(BaseModel):
    category: Literal["read", "write", "communicate", "external", "destructive"] | None = None
    tool_name: str | None = None
    verdict: Verdict | None = Field(default=None, description="None removes the override")


@tool(
    "set_allowance",
    description="Set what agents may do for a category or a specific tool: allow, ask or deny.",
    category="write",
)
async def set_allowance(ctx: ToolContext, args: SetAllowanceArgs) -> dict:
    policy = await policy_svc.get_policy(ctx.session, ctx.tenant_id)
    before = govern_svc.policy_snapshot(policy)
    if args.category:
        allowances = dict(policy.allowances or {})
        if args.verdict is None:
            allowances.pop(args.category, None)
        else:
            allowances[args.category] = args.verdict
        policy.allowances = allowances
    if args.tool_name:
        overrides = dict(policy.tool_overrides or {})
        if args.verdict is None:
            overrides.pop(args.tool_name, None)
        else:
            overrides[args.tool_name] = args.verdict
        policy.tool_overrides = overrides
    await ctx.session.flush()
    await govern_svc.record_change(
        ctx.session,
        ctx.tenant_id,
        target_kind="policy",
        target_id=policy.id,
        title="Allowances changed",
        before=before,
        after=govern_svc.policy_snapshot(policy),
        proposed_by=ctx.principal.actor,
        conversation_id=ctx.conversation_id,
        applied=True,
        applied_by_user_id=ctx.principal.user_id,
    )
    return {"allowances": policy.allowances, "tool_overrides": policy.tool_overrides}


class AskDecisionArgs(BaseModel):
    conversation_id: uuid.UUID
    title: str = Field(min_length=1, max_length=300)
    summary: str = ""
    options: list[dict] = Field(default_factory=list)


@tool(
    "ask_decision",
    description="Ask a colleague to decide something inside the conversation.",
    category="write",
)
async def ask_decision(ctx: ToolContext, args: AskDecisionArgs) -> dict:
    from bokito.services import conversation as conv_svc

    conv = await conv_svc.get(ctx.session, ctx.tenant_id, args.conversation_id)
    decision = await decision_svc.create(
        ctx.session,
        conv,
        title=args.title,
        summary=args.summary,
        options=args.options or None,
        requested_by=ctx.principal.actor,
        run_id=ctx.run_id,
    )
    return {"decision_id": str(decision.id)}
