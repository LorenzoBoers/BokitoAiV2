import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import McpServer


async def call_mcp_tool(
    session: AsyncSession,
    tenant_id: UUID,
    tool_input: dict[str, Any],
) -> dict[str, Any]:
    server_name = tool_input.get("server_name", "")
    tool_name = tool_input.get("tool_name", "")
    arguments = tool_input.get("arguments", {})

    result = await session.execute(
        select(McpServer).where(McpServer.tenant_id == tenant_id, McpServer.name == server_name)
    )
    server = result.scalar_one_or_none()
    if not server:
        return {"error": f"MCP server {server_name} not found", "mock": True}

    # Mock MCP response for local dev; real MCP SDK integration hook for production
    if server.server_url.startswith("mock://"):
        return {
            "server": server_name,
            "tool": tool_name,
            "result": {"ok": True, "echo": arguments, "message": "Mock MCP tool executed"},
        }

    try:
        # Placeholder for real MCP client - returns structured mock when unreachable
        return {
            "server": server_name,
            "tool": tool_name,
            "result": {"status": "delegated", "url": server.server_url},
            "note": "Wire mcp Python SDK transport here for live servers",
        }
    except Exception as exc:
        return {"error": str(exc)}
