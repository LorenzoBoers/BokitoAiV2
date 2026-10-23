"""Governed platform changes: agents, flows, posture, connections."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.exceptions import AppError
from app.models.auth import Tenant
from app.tools._common import (
    _get_tenant,
)
from app.tools.registry import ToolContext, ToolSpec, register_tool


async def _platform_change(
    ctx: ToolContext,
    *,
    resource_type: str,
    change_kind: str,
    summary: str,
    after: dict[str, Any],
    before: dict[str, Any] | None = None,
    tool_name: str,
) -> dict[str, Any]:
    from app.services.platform_changes import propose_platform_change

    tenant = await _get_tenant(ctx)
    change, meta = await propose_platform_change(
        ctx.session,
        tenant,
        resource_type=resource_type,
        change_kind=change_kind,
        after=after,
        before=before,
        summary=summary,
        agent=ctx.agent,
        run_id=ctx.run_id,
        user_id=ctx.user_id,
        tool_name=tool_name,
        mode=ctx.mode,
        signal_id=ctx.signal_id,
        bundle_id=ctx.bundle_id,
    )
    if meta.get("mode") == "apply":
        return meta.get("applied", {"status": "applied", "mode": "apply"})
    return {
        "change_id": str(change.id),
        # The card id lets the turn attach this ask to the agent's bubble.
        "decision_request_id": str(change.decision_id) if change.decision_id else None,
        "status": change.status,
        "mode": meta.get("mode"),
        "message": "Change submitted for review",
    }


async def _workstream_id(ctx: ToolContext) -> UUID | None:
    """The flow behind the current agent run, when there is one."""
    if not ctx.run_id:
        return None
    from app.models.agent import AgentRun

    return (
        await ctx.session.execute(
            select(AgentRun.workstream_id).where(AgentRun.id == ctx.run_id)
        )
    ).scalar_one_or_none()


# ── platform mutations (agents / graph / connections) ──────────


async def _snapshot_before(
    ctx: ToolContext, resource_type: str, change_kind: str, after: dict[str, Any]
) -> dict[str, Any] | None:
    if change_kind not in ("update", "delete"):
        return None
    if resource_type == "agent" and after.get("agent_id"):
        from app.models.agent import Agent as AgentModel

        row = (
            await ctx.session.execute(
                select(AgentModel).where(
                    AgentModel.id == UUID(str(after["agent_id"])),
                    AgentModel.tenant_id == ctx.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if row:
            return {
                "agent_id": str(row.id),
                "name": row.name,
                "role": row.role,
                "system_prompt": row.system_prompt,
            }
    if resource_type == "workstream" and after.get("workstream_id"):
        from app.models.orchestra import Workstream
        from app.services.workstreams import serialize_workstream

        row = (
            await ctx.session.execute(
                select(Workstream).where(
                    Workstream.id == UUID(str(after["workstream_id"])),
                    Workstream.tenant_id == ctx.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if row:
            return serialize_workstream(row)
    if resource_type == "category" and after.get("tag_id"):
        from app.models.signal import SignalTag
        from app.services.tickets import serialize_category

        try:
            row = await ctx.session.get(SignalTag, UUID(str(after["tag_id"])))
        except ValueError:
            row = None
        if row is not None and row.tenant_id == ctx.tenant_id:
            return serialize_category(row)
    return None


def _make_platform_handler(tool_name: str, resource_type: str, change_kind: str, summary_fn):
    async def handler(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
        before = await _snapshot_before(ctx, resource_type, change_kind, tool_input)
        return await _platform_change(
            ctx,
            resource_type=resource_type,
            change_kind=change_kind,
            summary=summary_fn(tool_input),
            after=tool_input,
            before=before,
            tool_name=tool_name,
        )

    return handler


async def _set_ai_handling(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Change Autonomy at one layer (shared by the two scoped tools).

    Same direction rule as the API: lowering is free, raising to autonomous
    needs an owner/admin session (agents act as members).
    """
    from fastapi import HTTPException

    from app.services.ai_handling import normalize_mode, set_ai_handling

    scope = str(tool_input.get("scope") or "conversation")
    target = str(tool_input.get("target_id") or "")
    if scope == "conversation" and not target and ctx.signal_id:
        target = str(ctx.signal_id)
    raw_mode = tool_input.get("mode")
    mode = None if raw_mode in (None, "", "inherit", "follow") else normalize_mode(raw_mode)
    if raw_mode not in (None, "", "inherit", "follow") and mode is None:
        return {"error": "mode must be autonomous, assisted, manual or inherit"}
    tenant = await ctx.session.get(Tenant, ctx.tenant_id)
    if tenant is None:
        return {"error": "Workspace not found"}
    if scope == "workspace":
        target = str(ctx.tenant_id)
    if not target:
        return {"error": "target_id required"}
    role = ctx.user_role if ctx.user_id and ctx.user_role else "member"
    try:
        result = await set_ai_handling(
            ctx.session,
            tenant,
            scope,
            target,
            mode,
            actor_type="user" if ctx.user_id and not ctx.agent else "agent",
            actor_id=str(ctx.user_id if ctx.user_id and not ctx.agent else (ctx.agent.id if ctx.agent else "")),
            role=role,
            reason=str(tool_input.get("reason") or "").strip() or None,
        )
    except (HTTPException, AppError) as exc:
        return {"error": str(exc.detail)}
    return {"ok": True, "scope": scope, "target_id": target, "ai_handling": result.to_payload()}


async def _set_thread_ai_handling(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    if str(tool_input.get("scope") or "conversation") not in ("conversation", "contact"):
        return {"error": "Use set_channel_ai_handling for channel or workspace scope"}
    return await _set_ai_handling(ctx, tool_input)


async def _set_channel_ai_handling(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    if str(tool_input.get("scope") or "") not in ("channel", "workspace"):
        return {"error": "Use set_ai_handling for conversation or contact scope"}
    return await _set_ai_handling(ctx, tool_input)


register_tool(
    ToolSpec(
        name="set_ai_handling",
        description=(
            "Change how the AI handles a conversation or a contact: autonomous "
            "(replies on its own within Govern), assisted (drafts for approval) or "
            "manual (a person replies). Use mode inherit to follow the layer above. "
            "Conversation values last until the conversation closes. Raising to "
            "autonomous needs an owner or admin."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "scope": {"type": "string", "enum": ["conversation", "contact"]},
                "target_id": {
                    "type": "string",
                    "description": "Conversation (signal) id or contact id. Defaults to the current conversation.",
                },
                "mode": {"type": "string", "enum": ["autonomous", "assisted", "manual", "inherit"]},
                "reason": {"type": "string"},
            },
            "required": ["mode"],
        },
        handler=_set_thread_ai_handling,
    )
)

register_tool(
    ToolSpec(
        name="set_channel_ai_handling",
        description=(
            "Change Autonomy for a whole channel (mailbox, website chat, WhatsApp) "
            "or the workspace default: autonomous, assisted or manual (inherit clears "
            "a channel value). Raising to autonomous needs an owner or admin."
        ),
        category="channels",
        input_schema={
            "type": "object",
            "properties": {
                "scope": {"type": "string", "enum": ["channel", "workspace"]},
                "target_id": {"type": "string", "description": "Channel account id (channel scope)."},
                "mode": {"type": "string", "enum": ["autonomous", "assisted", "manual", "inherit"]},
                "reason": {"type": "string"},
            },
            "required": ["scope", "mode"],
        },
        handler=_set_channel_ai_handling,
    )
)

register_tool(
    ToolSpec(
        name="create_agent",
        description="Create a new AI agent in the tenant.",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "job_title": {
                    "type": "string",
                    "description": "Short job title under the name (max 32 characters, required)",
                    "maxLength": 32,
                },
                "role": {"type": "string"},
                "description": {
                    "type": "string",
                    "description": "Optional longer operator-facing blurb (not the system prompt)",
                },
                "system_prompt": {"type": "string"},
                "tools": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["name", "job_title"],
        },
        handler=_make_platform_handler("create_agent", "agent", "create", lambda i: f"Create agent {i.get('name')}"),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="update_agent",
        description="Update an existing agent (name, job title, description, prompt, role, default call voice).",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "name": {"type": "string"},
                "job_title": {
                    "type": "string",
                    "description": "Short job title under the name (max 32 characters)",
                    "maxLength": 32,
                },
                "description": {
                    "type": "string",
                    "description": "Optional longer operator-facing blurb (not the system prompt)",
                },
                "system_prompt": {"type": "string"},
                "role": {"type": "string"},
                "call_voice": {
                    "type": "string",
                    "description": "Default spoken voice on a call (marin, cedar, alloy, ash, ballad, coral, echo, sage, shimmer, verse). A person can still override this in call settings.",
                },
                "call_speed": {
                    "type": "number",
                    "description": "Default speaking speed on a call: 0.75, 1, 1.25 or 1.5.",
                },
                "call_language": {
                    "type": "string",
                    "description": "Default spoken language on a call: nl or en.",
                },
            },
            "required": ["agent_id"],
        },
        handler=_make_platform_handler("update_agent", "agent", "update", lambda i: f"Update agent {i.get('agent_id')}"),
        handles_ask=True,
    )
)

_FLOW_RECIPE_PROPERTIES: dict[str, Any] = {
    "instructions": {"type": "string", "description": "The working method the agent gets on this flow's conversations."},
    "capabilities": {
        "type": "array",
        "items": {"type": "string"},
        "description": "Tool names or connection:{id} this flow uses.",
    },
    "expected_outcome": {"type": "string", "description": "What done produces, in one sentence."},
}

register_tool(
    ToolSpec(
        name="create_flow",
        description=(
            "Propose a flow: the recipe for the work its label names (instructions, "
            "capabilities, expected outcome)."
        ),
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
                **_FLOW_RECIPE_PROPERTIES,
            },
            "required": ["name"],
        },
        handler=_make_platform_handler(
            "create_flow", "workstream", "create", lambda i: f"Create workstream {i.get('name')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="update_flow",
        description="Propose updating a flow's name, description or recipe (work kinds, instructions, capabilities, expected outcome).",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "workstream_id": {"type": "string"},
                "name": {"type": "string"},
                "description": {"type": "string"},
                **_FLOW_RECIPE_PROPERTIES,
            },
            "required": ["workstream_id"],
        },
        handler=_make_platform_handler(
            "update_flow", "workstream", "update", lambda i: f"Update workstream {i.get('workstream_id')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="register_mcp_server",
        description="Register an external MCP server for tool access.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {"name": {"type": "string"}, "server_url": {"type": "string"}},
            "required": ["name", "server_url"],
        },
        handler=_make_platform_handler(
            "register_mcp_server", "mcp_server", "create", lambda i: f"Register MCP {i.get('name')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="connect_integration",
        description="Connect an external integration provider.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {"provider": {"type": "string"}, "display_name": {"type": "string"}},
            "required": ["provider"],
        },
        handler=_make_platform_handler(
            "connect_integration", "integration", "create", lambda i: f"Connect {i.get('provider')}"
        ),
        handles_ask=True,
    )
)


register_tool(
    ToolSpec(
        name="create_category",
        description=(
            "Propose a new category: a label with a flow, so conversations filed "
            "under it become tickets. Pass workstream_id to reuse a flow, or leave "
            "it out to create one with the default stages. Structural - goes through Govern."
        ),
        category="govern",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Label name, without a leading #"},
                "description": {"type": "string", "description": "When agents should file it"},
                "workstream_id": {"type": "string"},
                "create_mode": {
                    "type": "string",
                    "enum": ["ask_customer", "ask_operator", "auto", "manual_only"],
                },
                "ask_threshold": {"type": "integer"},
                "auto_threshold": {"type": "integer"},
                "requires_verification": {"type": "boolean"},
            },
            "required": ["name"],
        },
        handler=_make_platform_handler(
            "create_category", "category", "create", lambda i: f"Create category #{i.get('name')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="update_category",
        description=(
            "Propose an update to a category: description, flow (workstream_id; "
            "null makes it a free tag), intake mode, thresholds or rail visibility."
        ),
        category="govern",
        input_schema={
            "type": "object",
            "properties": {
                "tag_id": {"type": "string"},
                "description": {"type": "string"},
                "workstream_id": {"type": ["string", "null"]},
                "create_mode": {"type": "string"},
                "ask_threshold": {"type": "integer"},
                "auto_threshold": {"type": "integer"},
                "requires_verification": {"type": "boolean"},
                "show_in_nav": {"type": "boolean"},
            },
            "required": ["tag_id"],
        },
        handler=_make_platform_handler(
            "update_category", "category", "update", lambda i: f"Update category {i.get('tag_id')}"
        ),
        handles_ask=True,
    )
)


async def _set_platform_watch(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.platform_watch import set_platform_watch

    enabled = tool_input.get("enabled")
    if not isinstance(enabled, bool):
        return {"error": "enabled must be true or false"}
    return await set_platform_watch(ctx.session, ctx.tenant_id, enabled)


register_tool(
    ToolSpec(
        name="set_platform_watch",
        description=(
            "Turn the workspace check-in on or off. This only toggles the "
            "seeded check-in (not other Agenda items). Use enabled true so you "
            "watch the workspace yourself; findings land in its own conversation."
        ),
        category="triggers",
        input_schema={
            "type": "object",
            "properties": {"enabled": {"type": "boolean"}},
            "required": ["enabled"],
        },
        handler=_set_platform_watch,
        mutating=True,
        gated=True,
    )
)


async def _set_posture(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Propose changing workspace autonomy posture. Always asks (Govern)."""
    from app.tools.policy import AUTONOMY_POSTURES, resolve_posture

    posture = str(tool_input.get("posture") or "").strip()
    if posture not in AUTONOMY_POSTURES:
        return {"error": f"Invalid posture: {posture}. Use manual, assisted, or autonomous."}
    tenant = await _get_tenant(ctx)
    previous = resolve_posture(tenant)
    # Force ask: propose without yolo so a person always confirms posture changes.
    return await _platform_change(
        ctx,
        resource_type="autonomy_posture",
        change_kind="update",
        summary=f"Change autonomy posture from {previous} to {posture}",
        after={"posture": posture},
        before={"posture": previous},
        tool_name="set_posture",
    )


register_tool(
    ToolSpec(
        name="set_posture",
        description=(
            "Propose changing the workspace autonomy posture (manual | assisted | autonomous). "
            "Always requires human confirmation in Govern — never applied silently."
        ),
        category="govern",
        input_schema={
            "type": "object",
            "properties": {
                "posture": {
                    "type": "string",
                    "enum": ["manual", "assisted", "autonomous"],
                },
            },
            "required": ["posture"],
        },
        handler=_set_posture,
        mutating=True,
        gated=True,
    )
)
