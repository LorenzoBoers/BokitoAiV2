"""Built-in tool implementations, registered into the unified registry."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.models.auth import Tenant
from app.models.notification import DecisionRequest, Notification
from app.tools.registry import ToolContext, ToolSpec, register_tool


async def _get_tenant(ctx: ToolContext) -> Tenant:
    result = await ctx.session.execute(select(Tenant).where(Tenant.id == ctx.tenant_id))
    return result.scalar_one()


# ── workspace / knowledge ────────────────────────────────────────


async def _search_index(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workspace import hybrid_search

    results = await hybrid_search(
        ctx.session, ctx.tenant_id, tool_input.get("query", ""), tool_input.get("top_k", 8)
    )
    return {"results": results}


async def _list_docs(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workspace import list_docs, serialize_doc

    docs = await list_docs(ctx.session, ctx.tenant_id, kind=tool_input.get("kind"))
    return {"docs": [serialize_doc(d, include_content=False) for d in docs]}


async def _read_doc(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workspace import get_doc_by_path, serialize_doc

    doc = await get_doc_by_path(ctx.session, ctx.tenant_id, tool_input["path"])
    if not doc:
        return {"error": f"Doc {tool_input['path']} not found"}
    return serialize_doc(doc)


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
    )
    if meta.get("mode") == "apply":
        return meta.get("applied", {"status": "applied", "mode": "apply"})
    return {
        "change_id": str(change.id),
        "status": change.status,
        "mode": meta.get("mode"),
        "message": "Change submitted for review",
    }


async def _write_doc(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workspace import get_doc_by_path

    path = tool_input["path"]
    mode = tool_input.get("mode", "append")
    existing = await get_doc_by_path(ctx.session, ctx.tenant_id, path)
    before = None
    if existing:
        before = {"path": existing.path, "content": existing.content, "kind": existing.kind}
    return await _platform_change(
        ctx,
        resource_type="workspace_doc",
        change_kind="update" if existing else "create",
        summary=f"{'Update' if existing else 'Create'} workspace doc {path}",
        after={
            "path": path,
            "content": tool_input["content"],
            "mode": mode if existing else "replace",
            "kind": tool_input.get("kind"),
        },
        before=before,
        tool_name="write_doc",
    )


# ── messaging / decisions ────────────────────────────────────────


async def _create_decision_request(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    raw_signal = tool_input.get("signal_id") or (str(ctx.signal_id) if ctx.signal_id else None)
    target_signal_id: UUID | None = None
    if raw_signal:
        try:
            target_signal_id = UUID(str(raw_signal))
        except ValueError:
            target_signal_id = None
    notification = Notification(
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
        kind="decision_request",
        title=tool_input["title"],
        body=tool_input.get("summary", ""),
        payload_json=json.dumps(tool_input),
    )
    ctx.session.add(notification)
    await ctx.session.flush()
    from app.gateway.publish import publish_notification

    await publish_notification(
        ctx.tenant_id,
        notification_id=notification.id,
        kind=notification.kind,
        title=notification.title,
    )
    project_uuid = None
    raw_project = tool_input.get("project_id")
    if raw_project:
        try:
            project_uuid = UUID(str(raw_project))
        except ValueError:
            project_uuid = None
    decision = DecisionRequest(
        tenant_id=ctx.tenant_id,
        notification_id=notification.id,
        title=tool_input["title"],
        summary=tool_input.get("summary", ""),
        options_json=json.dumps(tool_input.get("options", [])),
        status="awaiting_human",
        project_id=project_uuid,
    )
    ctx.session.add(decision)
    await ctx.session.flush()
    from app.services.signal_decisions import ingest_decision_request

    await ingest_decision_request(
        ctx.session,
        ctx.tenant_id,
        notification,
        decision,
        user_id=ctx.user_id,
        agent_id=ctx.agent.id if ctx.agent else None,
        signal_id=target_signal_id,
    )
    await ctx.session.commit()
    return {"decision_request_id": str(decision.id), "status": "awaiting_human"}


async def _suggest_integration(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    options = [
        {"id": "connect", "label": "Connect now", "action_type": "setup_integration", "payload": tool_input},
        {"id": "later", "label": "Later", "action_type": "defer"},
    ]
    return await _create_decision_request(
        ctx,
        {
            "title": f"Connect {tool_input['provider']}?",
            "summary": tool_input.get("reason", ""),
            "signal_id": tool_input.get("signal_id"),
            "options": options,
        },
    )


async def _propose_integration(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    return await _suggest_integration(
        ctx,
        {
            "provider": tool_input["provider"],
            "reason": tool_input.get("reason", ""),
            "signal_id": str(ctx.signal_id) if ctx.signal_id else None,
        },
    )


async def _create_task(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    return {"task_id": "mock-task", "title": tool_input.get("title"), "status": "created"}


# ── integrations ─────────────────────────────────────────────────


async def _call_mcp_tool(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.agent.mcp_client import call_mcp_tool

    return await call_mcp_tool(ctx.session, ctx.tenant_id, tool_input)


# ── platform mutations (agents / graph / integrations) ──────────


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

        row = (
            await ctx.session.execute(
                select(Workstream).where(
                    Workstream.id == UUID(str(after["workstream_id"])),
                    Workstream.tenant_id == ctx.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if row:
            return {
                "workstream_id": str(row.id),
                "name": row.name,
                "description": row.description,
                "enabled": row.enabled,
            }
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


# ── registrations ────────────────────────────────────────────────

register_tool(
    ToolSpec(
        name="search_index",
        description="Hybrid search (vector + keyword) over workspace docs, memory, and skills.",
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {"query": {"type": "string"}, "top_k": {"type": "integer"}},
            "required": ["query"],
        },
        handler=_search_index,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="list_docs",
        description="List workspace docs (path, kind, title). Filter by kind: doc, memory, persona, skill, daily_log, heartbeat.",
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {"kind": {"type": "string"}},
        },
        handler=_list_docs,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="read_doc",
        description="Read the full markdown content of a workspace doc by path (e.g. memory.md, skills/triage.md).",
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
        handler=_read_doc,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="write_doc",
        description="Create or update a workspace markdown doc. mode=append adds to the end; mode=replace overwrites.",
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
                "mode": {"type": "string", "enum": ["append", "replace"]},
                "kind": {"type": "string"},
            },
            "required": ["path", "content"],
        },
        handler=_write_doc,
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="create_decision_request",
        description="Ask the human to choose an action via multiple choice.",
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "signal_id": {"type": "string"},
                "options": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "label": {"type": "string"},
                            "action_type": {"type": "string"},
                            "payload": {"type": "object"},
                        },
                    },
                },
            },
            "required": ["title", "options"],
        },
        handler=_create_decision_request,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="suggest_integration",
        description="Proactively suggest setting up an integration or MCP.",
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "provider": {"type": "string"},
                "reason": {"type": "string"},
                "signal_id": {"type": "string"},
            },
            "required": ["provider", "reason"],
        },
        handler=_suggest_integration,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="call_mcp_tool",
        description="Call a tool on a registered external MCP server.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "server_name": {"type": "string"},
                "tool_name": {"type": "string"},
                "arguments": {"type": "object"},
            },
            "required": ["server_name", "tool_name"],
        },
        handler=_call_mcp_tool,
    )
)

register_tool(
    ToolSpec(
        name="create_task",
        description="Create an internal task/reminder for the user or agent.",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {"title": {"type": "string"}, "due_at": {"type": "string"}},
            "required": ["title"],
        },
        handler=_create_task,
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
                "role": {"type": "string"},
                "system_prompt": {"type": "string"},
                "tools": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["name"],
        },
        handler=_make_platform_handler("create_agent", "agent", "create", lambda i: f"Create agent {i.get('name')}"),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="update_agent",
        description="Update an existing agent (name, prompt, role).",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "name": {"type": "string"},
                "system_prompt": {"type": "string"},
                "role": {"type": "string"},
            },
            "required": ["agent_id"],
        },
        handler=_make_platform_handler("update_agent", "agent", "update", lambda i: f"Update agent {i.get('agent_id')}"),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="create_workstream",
        description="Create an orchestration workstream.",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {"name": {"type": "string"}, "description": {"type": "string"}},
            "required": ["name"],
        },
        handler=_make_platform_handler(
            "create_workstream", "workstream", "create", lambda i: f"Create workstream {i.get('name')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="update_workstream",
        description="Update a workstream (name, status, enabled).",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "workstream_id": {"type": "string"},
                "name": {"type": "string"},
                "description": {"type": "string"},
                "enabled": {"type": "boolean"},
            },
            "required": ["workstream_id"],
        },
        handler=_make_platform_handler(
            "update_workstream", "workstream", "update", lambda i: f"Update workstream {i.get('workstream_id')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="propose_integration",
        description="Propose connecting an integration; always routes to human decision.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "provider": {"type": "string"},
                "reason": {"type": "string"},
                "display_name": {"type": "string"},
            },
            "required": ["provider", "reason"],
        },
        handler=_propose_integration,
        gated=False,
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
        name="add_graph_node",
        description="Add a canvas node for an existing domain entity.",
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "node_type": {"type": "string"},
                "ref_id": {"type": "string"},
                "label": {"type": "string"},
                "x": {"type": "number"},
                "y": {"type": "number"},
            },
            "required": ["node_type", "ref_id"],
        },
        handler=_make_platform_handler(
            "add_graph_node", "canvas_node", "create", lambda i: f"Add canvas node {i.get('node_type')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="connect_graph_nodes",
        description="Connect two canvas nodes with a relation edge.",
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "source_node_id": {"type": "string"},
                "target_node_id": {"type": "string"},
                "relation": {"type": "string"},
            },
            "required": ["source_node_id", "target_node_id", "relation"],
        },
        handler=_make_platform_handler(
            "connect_graph_nodes", "canvas_edge", "connect", lambda i: "Connect canvas nodes"
        ),
        handles_ask=True,
    )
)
