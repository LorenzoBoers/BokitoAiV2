"""Single execution path for every governed tool call."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.services.audit import record_audit
from app.tools.policy import resolve_tool_mode
from app.tools.registry import ToolContext, agent_allowed_tools, get_tool_spec


async def execute_tool(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
    tool_name: str,
    tool_input: dict[str, Any],
    *,
    signal_id: UUID | None = None,
    agent: Any | None = None,
    run_id: UUID | None = None,
    trust: str = "operator",
    approved: bool = False,
) -> dict[str, Any]:
    """Execute a registered tool under the allowance policy.

    ``approved=True`` skips the gate — used when a human just approved the
    exact action through a DecisionRequest.
    """
    spec = get_tool_spec(tool_name)
    if spec is None:
        return {"error": f"Unknown tool: {tool_name}"}

    actor_id = str(agent.id) if agent else (str(user_id) if user_id else "")
    actor_type = "agent" if agent else ("user" if user_id else "system")
    agent_id = agent.id if agent else None
    action = f"tool_call:{tool_name}"

    # Passport allowlist enforcement (per-agent).
    allowed_set = agent_allowed_tools(agent)
    if allowed_set is not None and tool_name not in allowed_set:
        await record_audit(
            session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
            agent_id=agent_id, run_id=run_id, outcome="denied",
            summary=f"Tool '{tool_name}' not permitted by agent passport", payload=tool_input,
        )
        return {"error": f"Tool '{tool_name}' not permitted for this agent", "status": "denied"}

    # Allowance policy resolution.
    mode, reason = "allow", "approved"
    if not approved:
        tenant_result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = tenant_result.scalar_one_or_none()
        if tenant is None:
            return {"error": "Tenant not found"}
        mode, reason = await resolve_tool_mode(session, tenant, agent, spec, trust=trust)

    if mode == "deny":
        await record_audit(
            session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
            agent_id=agent_id, run_id=run_id, outcome="denied",
            summary=f"Denied by policy ({reason})", payload=tool_input,
        )
        return {"error": f"Tool '{tool_name}' denied by policy", "status": "denied", "reason": reason}

    ctx = ToolContext(
        session=session,
        tenant_id=tenant_id,
        user_id=user_id,
        agent=agent,
        run_id=run_id,
        signal_id=signal_id,
        trust=trust,
        mode="ask" if mode == "ask" else "apply",
    )

    if mode == "ask":
        await record_audit(
            session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
            agent_id=agent_id, run_id=run_id, outcome="escalated",
            summary=f"Escalated to human ({reason})", payload=tool_input,
        )
        if spec.handles_ask:
            # Platform mutations create a pending PlatformChange + DecisionRequest.
            return await spec.handler(ctx, tool_input)
        return await _create_policy_decision(session, tenant_id, user_id, tool_name, tool_input, signal_id)

    result = await spec.handler(ctx, tool_input)
    if spec.mutating and not (isinstance(result, dict) and result.get("change_id")):
        outcome = "error" if isinstance(result, dict) and result.get("error") else "executed"
        await record_audit(
            session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
            agent_id=agent_id, run_id=run_id, outcome=outcome,
            summary=f"{tool_name} {outcome}", payload=tool_input,
            after=result if isinstance(result, dict) else None,
        )
    return result


async def _create_policy_decision(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
    tool_name: str,
    tool_input: dict[str, Any],
    signal_id: UUID | None,
) -> dict[str, Any]:
    options = [
        {
            "id": "approve",
            "label": "Approve",
            "action_type": tool_name,
            "payload": tool_input,
        },
        {
            "id": "always_auto",
            "label": "Voortaan automatisch oppakken",
            "action_type": tool_name,
            "payload": tool_input,
            "always_auto": True,
        },
        {"id": "reject", "label": "Reject", "action_type": "reject"},
    ]
    return await execute_tool(
        session,
        tenant_id,
        user_id,
        "create_decision_request",
        {
            "title": f"Approve action: {tool_name}",
            "summary": json.dumps(tool_input)[:500],
            "signal_id": str(signal_id) if signal_id else None,
            "options": options,
        },
        signal_id=signal_id,
    )
