import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.blueprint import BlueprintPage
from app.models.notification import DecisionRequest, Notification
from app.services.agent.rag import build_blueprint_context, search_index, upsert_index_chunk
from app.services.audit import record_audit
from app.services.platform_changes import propose_platform_change
from app.services.policy import is_action_allowed

# Tools that never mutate state and are always permitted without policy gating.
READ_ONLY_TOOLS = ("search_index", "read_blueprint")
# Tools that use PlatformChange draft queue instead of direct policy whitelist.
DRAFT_FIRST_TOOLS = frozenset(
    {
        "write_blueprint",
        "create_agent",
        "update_agent",
        "create_workstream",
        "update_workstream",
        "register_mcp_server",
        "connect_integration",
        "add_graph_node",
        "connect_graph_nodes",
    }
)
# Tools exempt from policy gating (they only request human input).
POLICY_EXEMPT_TOOLS = ("create_decision_request", "search_index", "read_blueprint")


async def _draft_mode_bypasses_policy(
    session: AsyncSession,
    tenant_id: UUID,
    tool_name: str,
    agent: Agent | None,
) -> bool:
    if tool_name not in DRAFT_FIRST_TOOLS:
        return False
    from app.services.apply_mode import resolve_apply_mode

    tenant_result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        return False
    resource_type = "blueprint_block" if tool_name == "write_blueprint" else {
        "create_agent": "agent",
        "update_agent": "agent",
        "create_workstream": "workstream",
        "update_workstream": "workstream",
        "register_mcp_server": "mcp_server",
        "connect_integration": "integration",
        "propose_integration": "integration",
        "add_graph_node": "canvas_node",
        "connect_graph_nodes": "canvas_edge",
    }.get(tool_name, tool_name)
    mode = await resolve_apply_mode(session, tenant, agent, resource_type=resource_type, tool_name=tool_name)
    return mode == "draft"


async def _snapshot_before(
    session: AsyncSession,
    tenant_id: UUID,
    resource_type: str,
    change_kind: str,
    after: dict[str, Any],
) -> dict[str, Any] | None:
    """Capture the current state of a resource for update/delete diffs and rollback."""
    if change_kind not in ("update", "delete"):
        return None
    if resource_type == "agent" and after.get("agent_id"):
        from app.models.agent import Agent as AgentModel

        row = (
            await session.execute(
                select(AgentModel).where(
                    AgentModel.id == UUID(str(after["agent_id"])),
                    AgentModel.tenant_id == tenant_id,
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
            await session.execute(
                select(Workstream).where(
                    Workstream.id == UUID(str(after["workstream_id"])),
                    Workstream.tenant_id == tenant_id,
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


def agent_allowed_tools(agent: Agent | None) -> set[str] | None:
    """Return the set of tool names this agent may use, or None for no restriction."""
    if agent is None:
        return None
    try:
        names = json.loads(agent.tools_json or "[]")
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(names, list) or not names:
        return None
    return {str(n) for n in names}


def filter_tools_for_agent(tools: list[dict[str, Any]], agent: Agent | None) -> list[dict[str, Any]]:
    allowed = agent_allowed_tools(agent)
    if allowed is None:
        return tools
    return [t for t in tools if t["name"] in allowed]


def get_tool_definitions() -> list[dict[str, Any]]:
    return [
        {
            "name": "search_index",
            "description": "Search tenant knowledge base (blueprint, emails, docs).",
            "input_schema": {
                "type": "object",
                "properties": {"query": {"type": "string"}, "top_k": {"type": "integer"}},
                "required": ["query"],
            },
        },
        {
            "name": "read_blueprint",
            "description": "Read the full tenant blueprint document map.",
            "input_schema": {"type": "object", "properties": {}},
        },
        {
            "name": "write_blueprint",
            "description": "Update a blueprint block on a page.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "page_slug": {"type": "string"},
                    "block_type": {"type": "string"},
                    "text": {"type": "string"},
                },
                "required": ["page_slug", "text"],
            },
        },
        {
            "name": "create_decision_request",
            "description": "Ask the human to choose an action via multiple choice.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                    "conversation_id": {"type": "string"},
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
        },
        {
            "name": "suggest_integration",
            "description": "Proactively suggest setting up an integration or MCP.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "reason": {"type": "string"},
                    "conversation_id": {"type": "string"},
                },
                "required": ["provider", "reason"],
            },
        },
        {
            "name": "call_mcp_tool",
            "description": "Call a tool on a tenant MCP server (mock in dev).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "server_name": {"type": "string"},
                    "tool_name": {"type": "string"},
                    "arguments": {"type": "object"},
                },
                "required": ["server_name", "tool_name"],
            },
        },
        {
            "name": "create_task",
            "description": "Create an internal task/reminder for the user or agent.",
            "input_schema": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "due_at": {"type": "string"}},
                "required": ["title"],
            },
        },
        {
            "name": "create_agent",
            "description": "Propose creating a new AI agent in the tenant.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "role": {"type": "string"},
                    "system_prompt": {"type": "string"},
                    "tools": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name"],
            },
        },
        {
            "name": "create_workstream",
            "description": "Propose creating an orchestration workstream.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["name"],
            },
        },
        {
            "name": "update_agent",
            "description": "Propose updating an existing agent (name, prompt, role).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "name": {"type": "string"},
                    "system_prompt": {"type": "string"},
                    "role": {"type": "string"},
                },
                "required": ["agent_id"],
            },
        },
        {
            "name": "update_workstream",
            "description": "Propose updating a workstream (name, status, enabled).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "workstream_id": {"type": "string"},
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "enabled": {"type": "boolean"},
                },
                "required": ["workstream_id"],
            },
        },
        {
            "name": "propose_integration",
            "description": "Propose connecting an integration; always routes to human decision.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "reason": {"type": "string"},
                    "display_name": {"type": "string"},
                },
                "required": ["provider", "reason"],
            },
        },
        {
            "name": "register_mcp_server",
            "description": "Propose registering an MCP server for tool access.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "server_url": {"type": "string"},
                },
                "required": ["name", "server_url"],
            },
        },
        {
            "name": "connect_integration",
            "description": "Propose connecting an external integration provider.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "display_name": {"type": "string"},
                },
                "required": ["provider"],
            },
        },
        {
            "name": "add_graph_node",
            "description": "Add a canvas node for an existing domain entity.",
            "input_schema": {
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
        },
        {
            "name": "connect_graph_nodes",
            "description": "Connect two canvas nodes with a relation edge.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "source_node_id": {"type": "string"},
                    "target_node_id": {"type": "string"},
                    "relation": {"type": "string"},
                },
                "required": ["source_node_id", "target_node_id", "relation"],
            },
        },
    ]


async def execute_tool(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
    tool_name: str,
    tool_input: dict[str, Any],
    *,
    conversation_id: UUID | None = None,
    agent: Agent | None = None,
    run_id: UUID | None = None,
) -> dict[str, Any]:
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

    # Policy / autonomy gating for mutating tools.
    action_payload = tool_input if tool_name not in READ_ONLY_TOOLS else {}
    allowed, reason = await is_action_allowed(session, tenant_id, tool_name, action_payload, agent=agent)
    draft_bypass = await _draft_mode_bypasses_policy(session, tenant_id, tool_name, agent)
    if not allowed and not draft_bypass and tool_name not in POLICY_EXEMPT_TOOLS:
        await record_audit(
            session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
            agent_id=agent_id, run_id=run_id, outcome="escalated",
            summary=f"Escalated to human ({reason})", payload=tool_input,
        )
        return await _create_policy_decision(session, tenant_id, user_id, tool_name, tool_input, conversation_id)

    result = await _dispatch_tool(
        session, tenant_id, user_id, tool_name, tool_input,
        conversation_id=conversation_id, agent=agent, run_id=run_id,
    )
    if tool_name not in READ_ONLY_TOOLS and not (
        isinstance(result, dict) and result.get("change_id")
    ):
        outcome = "error" if isinstance(result, dict) and result.get("error") else "executed"
        await record_audit(
            session, tenant_id, action=action, actor_type=actor_type, actor_id=actor_id,
            agent_id=agent_id, run_id=run_id, outcome=outcome,
            summary=f"{tool_name} {outcome}", payload=tool_input,
            after=result if isinstance(result, dict) else None,
        )
    return result


async def _dispatch_tool(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
    tool_name: str,
    tool_input: dict[str, Any],
    *,
    conversation_id: UUID | None = None,
    agent: Agent | None = None,
    run_id: UUID | None = None,
) -> dict[str, Any]:
    if tool_name == "search_index":
        results = await search_index(session, tenant_id, tool_input.get("query", ""), tool_input.get("top_k", 8))
        return {"results": results}

    if tool_name == "read_blueprint":
        text = await build_blueprint_context(session, tenant_id)
        return {"blueprint": text}

    if tool_name == "write_blueprint":
        slug = tool_input["page_slug"]
        page_result = await session.execute(
            select(BlueprintPage).where(BlueprintPage.tenant_id == tenant_id, BlueprintPage.slug == slug)
        )
        page = page_result.scalar_one_or_none()
        if not page:
            return {"error": f"Page {slug} not found"}
        tenant_result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = tenant_result.scalar_one()
        change, meta = await propose_platform_change(
            session,
            tenant,
            resource_type="blueprint_block",
            change_kind="create",
            after={
                "page_slug": slug,
                "text": tool_input["text"],
                "block_type": tool_input.get("block_type", "paragraph"),
            },
            summary=f"Add blueprint block on {slug}",
            agent=agent,
            run_id=run_id,
            tool_name="write_blueprint",
        )
        if meta.get("mode") == "yolo":
            return meta.get("applied", {"status": "written", "mode": "yolo"})
        return {
            "change_id": str(change.id),
            "status": change.status,
            "mode": meta.get("mode"),
            "message": "Change submitted for review",
        }

    if tool_name == "create_decision_request":
        conv_id = tool_input.get("conversation_id") or (str(conversation_id) if conversation_id else None)
        notification = Notification(
            tenant_id=tenant_id,
            user_id=user_id,
            kind="decision_request",
            title=tool_input["title"],
            body=tool_input.get("summary", ""),
            payload_json=json.dumps(tool_input),
        )
        session.add(notification)
        await session.flush()
        decision = DecisionRequest(
            tenant_id=tenant_id,
            notification_id=notification.id,
            conversation_id=UUID(conv_id) if conv_id else None,
            title=tool_input["title"],
            summary=tool_input.get("summary", ""),
            options_json=json.dumps(tool_input.get("options", [])),
            status="awaiting_human",
        )
        session.add(decision)
        await session.flush()
        if conv_id:
            from app.models.chat import ConversationMessage

            msg = ConversationMessage(
                conversation_id=UUID(conv_id),
                tenant_id=tenant_id,
                role="assistant",
                content=tool_input.get("summary") or tool_input["title"],
                decision_request_id=decision.id,
                metadata_json=json.dumps({"decision_request_id": str(decision.id)}),
            )
            session.add(msg)
        await session.commit()
        return {"decision_request_id": str(decision.id), "status": "awaiting_human"}

    if tool_name == "suggest_integration":
        options = [
            {"id": "connect", "label": "Connect now", "action_type": "setup_integration", "payload": tool_input},
            {"id": "later", "label": "Later", "action_type": "defer"},
        ]
        return await execute_tool(
            session,
            tenant_id,
            user_id,
            "create_decision_request",
            {
                "title": f"Connect {tool_input['provider']}?",
                "summary": tool_input.get("reason", ""),
                "conversation_id": tool_input.get("conversation_id"),
                "options": options,
            },
            conversation_id=conversation_id,
            agent=agent,
            run_id=run_id,
        )

    if tool_name == "call_mcp_tool":
        from app.services.agent.mcp_client import call_mcp_tool

        return await call_mcp_tool(session, tenant_id, tool_input)

    if tool_name == "create_task":
        return {"task_id": "mock-task", "title": tool_input.get("title"), "status": "created"}

    platform_tool_map = {
        "create_agent": ("agent", "create", lambda i: (f"Create agent {i.get('name')}", i)),
        "update_agent": ("agent", "update", lambda i: (f"Update agent {i.get('agent_id')}", i)),
        "create_workstream": ("workstream", "create", lambda i: (f"Create workstream {i.get('name')}", i)),
        "update_workstream": ("workstream", "update", lambda i: (f"Update workstream {i.get('workstream_id')}", i)),
        "register_mcp_server": ("mcp_server", "create", lambda i: (f"Register MCP {i.get('name')}", i)),
        "connect_integration": ("integration", "create", lambda i: (f"Connect {i.get('provider')}", i)),
        "add_graph_node": ("canvas_node", "create", lambda i: (f"Add canvas node {i.get('node_type')}", i)),
        "connect_graph_nodes": ("canvas_edge", "connect", lambda i: ("Connect canvas nodes", i)),
    }
    if tool_name == "propose_integration":
        # Always human decision: route through decision request with draft connection spec.
        return await execute_tool(
            session,
            tenant_id,
            user_id,
            "suggest_integration",
            {
                "provider": tool_input["provider"],
                "reason": tool_input.get("reason", ""),
                "conversation_id": str(conversation_id) if conversation_id else None,
            },
            conversation_id=conversation_id,
            agent=agent,
            run_id=run_id,
        )
    if tool_name in platform_tool_map:
        resource_type, change_kind, payload_fn = platform_tool_map[tool_name]
        summary, after = payload_fn(tool_input)
        tenant_result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = tenant_result.scalar_one()
        before = await _snapshot_before(session, tenant_id, resource_type, change_kind, after)
        change, meta = await propose_platform_change(
            session,
            tenant,
            resource_type=resource_type,
            change_kind=change_kind,
            after=after,
            before=before,
            summary=summary,
            agent=agent,
            run_id=run_id,
            tool_name=tool_name,
        )
        if meta.get("mode") == "yolo":
            return meta.get("applied", {"status": "applied", "mode": "yolo"})
        return {
            "change_id": str(change.id),
            "status": change.status,
            "mode": meta.get("mode"),
            "message": "Change submitted for review",
        }

    return {"error": f"Unknown tool: {tool_name}"}


async def _create_policy_decision(
    session, tenant_id, user_id, tool_name, tool_input, conversation_id
):
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
            "conversation_id": str(conversation_id) if conversation_id else None,
            "options": options,
        },
        conversation_id=conversation_id,
    )
