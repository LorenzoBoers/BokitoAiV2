"""MCP tool client with mock and HTTP JSON transport."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import McpServer
from app.services.mcp_auth import mcp_auth_headers


def _mock_trading_tool(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Tenant-local mock responses for trading MCP tools (dev / staging without sidecar)."""
    mode = "shadow"
    if tool_name == "risk_status":
        return {
            "execution_mode": mode,
            "live_allowed": False,
            "max_daily_loss_pct": 2.0,
            "open_risk_pct": 0.5,
            "blockers": ["live_not_enabled"],
            "message": "Shadow mode — no live orders",
        }
    if tool_name == "kill_switch_status":
        return {"active": False, "reason": None}
    if tool_name == "execution_status":
        return {"mode": mode, "orders_today": 0, "last_order_at": None}
    if tool_name == "get_positions":
        return {"positions": [], "cash_eur": 10000.0}
    if tool_name in ("list_setups", "list_trade_plans"):
        return {"items": [{"id": "demo-setup-1", "symbol": "AAPL", "status": "watching"}]}
    if tool_name == "get_setup":
        setup_id = arguments.get("setup_id") or arguments.get("id") or "demo-setup-1"
        return {
            "id": setup_id,
            "symbol": "AAPL",
            "status": "ready",
            "direction": "long",
            "entry_zone": [180.0, 182.0],
            "stop": 177.0,
            "targets": [186.0, 190.0],
        }
    if tool_name == "get_trade_plan":
        return {
            "setup_id": arguments.get("setup_id", "demo-setup-1"),
            "size_pct": 1.0,
            "entry_type": "limit",
            "notes": "Mock plan for local dev",
        }
    if tool_name == "get_market_context":
        return {"session": "am", "volatility": "normal", "macro_events": []}
    if tool_name == "place_live_order":
        return {
            "status": "simulated",
            "order_id": "mock-order-1",
            "message": "Shadow mode — order recorded but not sent to broker",
            "setup_id": arguments.get("setup_id"),
        }
    if tool_name == "check_live_order":
        return {"order_id": arguments.get("order_id", "mock-order-1"), "status": "filled"}
    return {"ok": True, "tool": tool_name, "echo": arguments}


def _mock_mcp_response(server_name: str, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if "trading" in server_name.lower():
        return {
            "server": server_name,
            "tool": tool_name,
            "result": _mock_trading_tool(tool_name, arguments or {}),
        }
    return {
        "server": server_name,
        "tool": tool_name,
        "result": {"ok": True, "echo": arguments, "message": "Mock MCP tool executed"},
    }


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
        return _mock_mcp_response(server_name, tool_name, arguments)

    payload = {
        "jsonrpc": "2.0",
        "id": "1",
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments or {}},
    }
    auth = json.loads(server.auth_json or "{}")
    headers = mcp_auth_headers(auth if isinstance(auth, dict) else {})

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
