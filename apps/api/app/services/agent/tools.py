import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.blueprint import BlueprintBlock, BlueprintPage
from app.models.integration import McpServer
from app.models.notification import DecisionRequest, Notification
from app.services.agent.rag import build_blueprint_context, search_index, upsert_index_chunk


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
                    "options": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "label": {"type": "string"},
                                "action_type": {"type": "string"},
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
    ]


async def execute_tool(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
    tool_name: str,
    tool_input: dict[str, Any],
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
            select(BlueprintPage).where(
                BlueprintPage.tenant_id == tenant_id, BlueprintPage.slug == slug
            )
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
        await upsert_index_chunk(
            session,
            tenant_id,
            "blueprint_block",
            str(block.id),
            page.title,
            tool_input["text"],
        )
        return {"block_id": str(block.id), "status": "written"}

    if tool_name == "create_decision_request":
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
            title=tool_input["title"],
            summary=tool_input.get("summary", ""),
            options_json=json.dumps(tool_input.get("options", [])),
            status="awaiting_human",
        )
        session.add(decision)
        await session.commit()
        return {"decision_request_id": str(decision.id), "status": "awaiting_human"}

    if tool_name == "suggest_integration":
        notification = Notification(
            tenant_id=tenant_id,
            user_id=user_id,
            kind="proactive",
            title=f"Connect {tool_input['provider']}?",
            body=tool_input.get("reason", ""),
            payload_json=json.dumps({"provider": tool_input["provider"], "action": "setup_integration"}),
        )
        session.add(notification)
        await session.commit()
        return {"notification_id": str(notification.id), "status": "suggested"}

    if tool_name == "call_mcp_tool":
        from app.services.agent.mcp_client import call_mcp_tool

        return await call_mcp_tool(session, tenant_id, tool_input)

    return {"error": f"Unknown tool: {tool_name}"}
