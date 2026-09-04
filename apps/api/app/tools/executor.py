"""Single execution path for every governed tool call."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.services.audit import record_audit
from app.tools.decision_copy import format_policy_decision
from app.tools.policy import resolve_tool_mode
from app.tools.registry import (
    ToolContext,
    agent_allowed_tools,
    audience_for_trust,
    get_tool_spec,
    tool_matches_audience,
)

_EXTERNAL_PASSPORT_BYPASS = frozenset(
    {"handoff_to_human", "request_callback", "request_customer_verify"}
)


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
    project_id: UUID | None = None,
    trust: str = "operator",
    approved: bool = False,
    user_role: str | None = None,
    surface: str = "",
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
    audience = audience_for_trust(trust)

    # Passport allowlist enforcement (per-agent). External conversations may
    # always escalate to a human or start a verify, even when the passport omits the tool.
    allowed_set = agent_allowed_tools(agent)
    if tool_name in _EXTERNAL_PASSPORT_BYPASS and trust == "external":
        allowed_set = None

    if allowed_set is not None and tool_name not in allowed_set:
        await record_audit(
            session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
            agent_id=agent_id, run_id=run_id, outcome="denied",
            summary=f"Tool '{tool_name}' not permitted by agent passport", payload=tool_input,
        )
        return {"error": f"Tool '{tool_name}' not permitted for this agent", "status": "denied"}

    # Resource-scope enforcement (per-agent allowlists for projects etc.).
    from app.services.agent_scopes import check_tool_scope

    scope_error = await check_tool_scope(
        session, tenant_id, agent, tool_input, project_id=project_id, write=spec.mutating
    )
    if scope_error:
        await record_audit(
            session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
            agent_id=agent_id, run_id=run_id, outcome="denied",
            summary="Denied by agent resource scope", payload=tool_input,
        )
        return {"error": scope_error, "status": "denied"}

    from app.models.signal import Signal
    from app.services.customer_verify import (
        NEEDS_VERIFICATION,
        customer_tool_enabled,
        thread_assurance_valid,
    )

    signal = None
    if signal_id is not None:
        signal = (
            await session.execute(
                select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()

    if not tool_matches_audience(spec, audience):
        await record_audit(
            session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
            agent_id=agent_id, run_id=run_id, outcome="denied",
            summary=f"Tool '{tool_name}' hidden from {audience} audience",
            payload=tool_input,
        )
        return {
            "error": f"Tool '{tool_name}' is not available in this conversation",
            "status": "denied",
            "reason": "audience",
        }

    if spec.audience == "customer" and not await customer_tool_enabled(
        session, tenant_id, tool_name
    ):
        await record_audit(
            session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
            agent_id=agent_id, run_id=run_id, outcome="denied",
            summary=f"Customer tool '{tool_name}' is switched off",
            payload=tool_input,
        )
        return {
            "error": f"Tool '{tool_name}' is not enabled for customers",
            "status": "denied",
            "reason": "customer_tools_off",
        }

    if (spec.min_assurance or "none") == "verified" and not thread_assurance_valid(signal):
        await record_audit(
            session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
            agent_id=agent_id, run_id=run_id, outcome="denied",
            summary=f"Tool '{tool_name}' needs thread verification",
            payload=tool_input,
        )
        return dict(NEEDS_VERIFICATION)

    if tool_name == "handoff_to_human" and trust == "external":
        from app.services.livechat_compat import team_is_reachable

        tenant_row = (
            await session.execute(select(Tenant).where(Tenant.id == tenant_id))
        ).scalar_one_or_none()
        if tenant_row is not None and not team_is_reachable(tenant_row):
            await record_audit(
                session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
                agent_id=agent_id, run_id=run_id, outcome="denied",
                summary="Live handoff is unavailable outside team hours",
                payload=tool_input,
            )
            return {
                "error": "The team is not reachable for a live handoff right now. Use request_callback.",
                "status": "denied",
                "reason": "team_away",
            }

    # Allowance policy resolution.
    mode, reason = "allow", "approved"
    if not approved:
        tenant_result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = tenant_result.scalar_one_or_none()
        if tenant is None:
            return {"error": "Tenant not found"}
        mode, reason = await resolve_tool_mode(
            session, tenant, agent, spec, trust=trust, tool_input=tool_input,
            user_role=user_role,
        )

    if mode == "deny":
        await record_audit(
            session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
            agent_id=agent_id, run_id=run_id, outcome="denied",
            summary=f"Denied by policy ({reason})", payload=tool_input,
        )
        return {"error": f"Tool '{tool_name}' denied by policy", "status": "denied", "reason": reason}

    if run_id is not None:
        from app.services.agent.run_cancel import is_run_cancelled

        if await is_run_cancelled(session, run_id):
            await record_audit(
                session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
                agent_id=agent_id, run_id=run_id, outcome="cancelled",
                summary=f"Skipped '{tool_name}' because the run was cancelled",
                payload=tool_input,
            )
            return {"error": "Run cancelled", "status": "cancelled"}

    ctx = ToolContext(
        session=session,
        tenant_id=tenant_id,
        user_id=user_id,
        agent=agent,
        run_id=run_id,
        signal_id=signal_id,
        project_id=project_id,
        trust=trust,
        mode="ask" if mode == "ask" else "apply",
        user_role=user_role,
        audience=audience,
        assurance_level=(signal.assurance_level or "none") if signal else "none",
        assurance_expires_at=signal.assurance_expires_at if signal else None,
        assurance_email=(signal.assurance_email or "") if signal else "",
        surface=surface,
    )

    if mode == "ask":
        # Never ask humans to approve MCP calls that cannot run here (e.g. mock://
        # servers in production). Return an error to the agent so it can continue
        # with a customer-facing draft instead of a dead-end decision card.
        if tool_name == "call_mcp_tool":
            blocked = await _mcp_unavailable_in_env(session, tenant_id, tool_input)
            if blocked:
                await record_audit(
                    session,
                    tenant_id,
                    action=action,
                    actor_type=actor_type,
                    actor_id=actor_id,
                    agent_id=agent_id,
                    run_id=run_id,
                    outcome="denied",
                    summary=blocked,
                    payload=tool_input,
                )
                return {"error": blocked, "status": "unavailable"}
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


async def _mcp_unavailable_in_env(
    session: AsyncSession,
    tenant_id: UUID,
    tool_input: dict[str, Any],
) -> str | None:
    """Return an error message when an MCP server cannot execute in this env."""
    from app.config import get_settings
    from app.models.integration import McpServer

    server_name = str(tool_input.get("server_name") or "").strip()
    if not server_name:
        return None
    row = (
        await session.execute(
            select(McpServer).where(
                McpServer.tenant_id == tenant_id,
                McpServer.name == server_name,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    url = str(row.server_url or "")
    if url.startswith("mock://") and get_settings().is_production:
        return (
            f"MCP server {server_name} has a mock URL, which is not allowed "
            "in production. Reinstall it with a real server URL."
        )
    return None


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
            "label": "Always allow",
            "action_type": tool_name,
            "payload": tool_input,
            "always_auto": True,
        },
        {"id": "reject", "label": "Reject", "action_type": "reject"},
    ]
    title, summary = format_policy_decision(tool_name, tool_input)
    return await execute_tool(
        session,
        tenant_id,
        user_id,
        "create_decision_request",
        {
            "title": title,
            "summary": summary,
            "signal_id": str(signal_id) if signal_id else None,
            "options": options,
        },
        signal_id=signal_id,
    )
