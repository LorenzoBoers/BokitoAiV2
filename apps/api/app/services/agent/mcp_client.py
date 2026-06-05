"""MCP tool client with mock and HTTP JSON transport."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import httpx
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
        return {"error": f"MCP server {server_name} not found"}

    if server.server_url.startswith("mock://"):
        return {
            "server": server_name,
            "tool": tool_name,
            "result": {"ok": True, "echo": arguments, "message": "Mock MCP tool executed"},
        }

    payload = {
        "jsonrpc": "2.0",
        "id": "1",
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments or {}},
    }
    auth = json.loads(server.auth_json or "{}")
    headers = {"Content-Type": "application/json"}
    if auth.get("bearer_token"):
        headers["Authorization"] = f"Bearer {auth['bearer_token']}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(server.server_url, json=payload, headers=headers)
            response.raise_for_status()
            body = response.json()
            return {
                "server": server_name,
                "tool": tool_name,
                "result": body.get("result", body),
            }
    except Exception as exc:
        return {
            "server": server_name,
            "tool": tool_name,
            "error": str(exc),
            "fallback": {"status": "unreachable", "url": server.server_url},
        }
