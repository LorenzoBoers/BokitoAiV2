import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.blueprint import BlueprintBlock, BlueprintPage
from app.models.notification import DecisionRequest, Notification
from app.services.agent.rag import build_blueprint_context, search_index, upsert_index_chunk
from app.services.policy import is_action_allowed


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
    ]


async def execute_tool(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
    tool_name: str,
    tool_input: dict[str, Any],
    *,
    conversation_id: UUID | None = None,
) -> dict[str, Any]:
    action_payload = tool_input if tool_name not in ("search_index", "read_blueprint") else {}
    allowed, reason = await is_action_allowed(session, tenant_id, tool_name, action_payload)
    if not allowed and tool_name not in ("create_decision_request", "search_index", "read_blueprint"):
        return await _create_policy_decision(session, tenant_id, user_id, tool_name, tool_input, conversation_id)

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
        block = BlueprintBlock(
            page_id=page.id,
            tenant_id=tenant_id,
            block_type=tool_input.get("block_type", "paragraph"),
            content_json=json.dumps({"text": tool_input["text"]}),
            sort_order=999,
        )
        session.add(block)
        await session.commit()
        await session.refresh(block)
        await upsert_index_chunk(session, tenant_id, "blueprint_block", str(block.id), page.title, tool_input["text"])
        return {"block_id": str(block.id), "status": "written"}

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
        )

    if tool_name == "call_mcp_tool":
        from app.services.agent.mcp_client import call_mcp_tool

        return await call_mcp_tool(session, tenant_id, tool_input)

    if tool_name == "create_task":
        return {"task_id": "mock-task", "title": tool_input.get("title"), "status": "created"}

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
