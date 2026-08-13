"""MCP tool client with mock and HTTP JSON transport."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
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


def _mock_accounting_tool(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Mock Björn Lundén / King responses so the accountancy flow works end to end
    before real client credentials exist."""
    if tool_name == "search_customers":
        query = str(arguments.get("query") or arguments.get("name") or "")
        return {
            "customers": [
                {
                    "id": "cust-1001",
                    "number": "1001",
                    "name": query.title() or "Andersson Bygg AB",
                    "email": "ekonomi@anderssonbygg.se",
                    "open_balance": 12450.0,
                    "currency": "SEK",
                }
            ]
        }
    if tool_name == "get_customer":
        return {
            "id": str(arguments.get("customer_id") or "cust-1001"),
            "number": "1001",
            "name": "Andersson Bygg AB",
            "email": "ekonomi@anderssonbygg.se",
            "phone": "+46 8 123 456",
            "open_balance": 12450.0,
            "currency": "SEK",
            "payment_terms_days": 30,
        }
    if tool_name == "list_invoices":
        return {
            "invoices": [
                {
                    "id": "inv-2024-081",
                    "number": "2024-081",
                    "customer_id": str(arguments.get("customer_id") or "cust-1001"),
                    "status": "open",
                    "total": 12450.0,
                    "currency": "SEK",
                    "due_date": "2026-08-15",
                },
                {
                    "id": "inv-2024-069",
                    "number": "2024-069",
                    "customer_id": str(arguments.get("customer_id") or "cust-1001"),
                    "status": "paid",
                    "total": 8300.0,
                    "currency": "SEK",
                    "due_date": "2026-06-30",
                },
            ]
        }
    if tool_name == "get_invoice":
        return {
            "id": str(arguments.get("invoice_id") or "inv-2024-081"),
            "number": "2024-081",
            "status": "open",
            "total": 12450.0,
            "currency": "SEK",
            "due_date": "2026-08-15",
            "lines": [
                {"description": "Consulting services July", "amount": 9960.0},
                {"description": "VAT 25%", "amount": 2490.0},
            ],
        }
    if tool_name == "list_ledger_entries":
        return {
            "entries": [
                {"account": "1930", "description": "Bank", "debit": 8300.0, "credit": 0.0},
                {"account": "1510", "description": "Accounts receivable", "debit": 0.0, "credit": 8300.0},
            ],
            "period": str(arguments.get("period") or "2026-07"),
        }
    if tool_name == "get_account_balance":
        return {
            "account": str(arguments.get("account") or "1930"),
            "balance": 145200.0,
            "currency": "SEK",
        }
    if tool_name == "list_vat_reports":
        return {
            "reports": [
                {"period": "2026-Q2", "status": "submitted", "amount": 31200.0},
                {"period": "2026-Q3", "status": "draft", "amount": 0.0},
            ]
        }
    return {"ok": True, "tool": tool_name, "echo": arguments}


def _is_accounting_server(server_name: str) -> bool:
    lowered = server_name.lower()
    return any(k in lowered for k in ("björn", "bjorn", "lunden", "lundén", "king", "account"))


def _mock_mcp_response(server_name: str, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if "trading" in server_name.lower():
        return {
            "server": server_name,
            "tool": tool_name,
            "result": _mock_trading_tool(tool_name, arguments or {}),
        }
    if _is_accounting_server(server_name):
        return {
            "server": server_name,
            "tool": tool_name,
            "result": _mock_accounting_tool(tool_name, arguments or {}),
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

    if server.server_url.startswith("native://"):
        from app.services.bjorn_lunden import call_bl_tool, has_bl_credentials

        try:
            auth_data = json.loads(server.auth_json or "{}")
        except (json.JSONDecodeError, TypeError):
            auth_data = {}
        if not isinstance(auth_data, dict):
            auth_data = {}
        if not has_bl_credentials(auth_data) and not get_settings().is_production:
            # Dev sandbox: keep the accountancy flow demo-able before the
            # client's real Björn Lundén credentials exist.
            return _mock_mcp_response(server_name, tool_name, arguments)
        outcome = await call_bl_tool(auth_data, tool_name, arguments or {})
        response: dict[str, Any] = {"server": server_name, "tool": tool_name}
        response.update(outcome)
        return response

    if server.server_url.startswith("mock://"):
        if get_settings().is_production:
            return {
                "error": (
                    f"MCP server {server_name} has a mock URL, which is not allowed "
                    "in production. Reinstall it with a real server URL."
                )
            }
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
