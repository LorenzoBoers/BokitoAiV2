"""Policy decision copy + MCP discovery auto-allow."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.tools.decision_copy import (
    format_policy_decision,
    is_mcp_discovery_tool,
    mcp_override_key,
)
from app.tools.policy import resolve_tool_mode, set_tool_override
from app.tools.registry import get_tool_spec


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_format_mcp_decision_is_human_readable():
    title, summary = format_policy_decision(
        "call_mcp_tool",
        {
            "server_name": "mock-tools",
            "tool_name": "list_tools",
            "arguments": {},
        },
    )
    assert title == "Approve: List tools on mock-tools"
    assert "list_tools" in summary
    assert "mock-tools" in summary
    assert "{" not in summary


def test_format_mcp_decision_with_args():
    title, summary = format_policy_decision(
        "call_mcp_tool",
        {
            "server_name": "shopify",
            "tool_name": "get_order",
            "arguments": {"order_id": "99112"},
        },
    )
    assert "get_order" in title.lower() or "Get order" in title
    assert "Order id: 99112" in summary


def test_mcp_discovery_detection():
    assert is_mcp_discovery_tool({"tool_name": "list_tools"})
    assert is_mcp_discovery_tool({"tool_name": "List-Tools"})
    assert not is_mcp_discovery_tool({"tool_name": "create_order"})
    assert mcp_override_key({"server_name": "mock-tools", "tool_name": "ping"}) == (
        "mcp:mock-tools:ping"
    )


@pytest.mark.asyncio
async def test_list_tools_auto_allowed(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    spec = get_tool_spec("call_mcp_tool")
    mode, reason = await resolve_tool_mode(
        session_override,
        tenant,
        None,
        spec,
        tool_input={
            "server_name": "mock-tools",
            "tool_name": "list_tools",
            "arguments": {},
        },
    )
    assert mode == "allow"
    assert reason == "mcp_discovery"


@pytest.mark.asyncio
async def test_mutating_mcp_still_asks(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    spec = get_tool_spec("call_mcp_tool")
    mode, reason = await resolve_tool_mode(
        session_override,
        tenant,
        None,
        spec,
        tool_input={
            "server_name": "mock-tools",
            "tool_name": "create_order",
            "arguments": {"sku": "x"},
        },
    )
    assert mode == "ask"
    assert "integrations" in reason or reason.startswith("category:")


@pytest.mark.asyncio
async def test_mcp_override_is_per_tool(client: AsyncClient, session_override):
    await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    await set_tool_override(session_override, tenant.id, "mcp:mock-tools:create_order", "allow")
    await session_override.commit()
    session_override.expire_all()
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    spec = get_tool_spec("call_mcp_tool")

    allowed, reason = await resolve_tool_mode(
        session_override,
        tenant,
        None,
        spec,
        tool_input={"server_name": "mock-tools", "tool_name": "create_order", "arguments": {}},
    )
    assert allowed == "allow"
    assert reason == "tool_override"

    other, _ = await resolve_tool_mode(
        session_override,
        tenant,
        None,
        spec,
        tool_input={"server_name": "mock-tools", "tool_name": "refund_order", "arguments": {}},
    )
    assert other == "ask"
