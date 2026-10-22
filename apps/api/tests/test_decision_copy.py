"""Policy decision copy + MCP discovery auto-allow."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.tools.decision_copy import (
    describe_action,
    format_policy_decision,
    is_mcp_discovery_tool,
    mcp_override_key,
)
from app.tools.executor import resolve_tool_alias
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


def test_connect_and_module_decisions_name_the_target():
    title, _summary = format_policy_decision(
        "connect_integration",
        {"provider": "github"},
    )
    assert "github" in title.lower()
    described = describe_action("connect_integration", {"provider": "github"})
    assert described["args"]["provider"]
    assert "github" in described["args"]["provider"].lower() or "Git" in described["args"]["provider"]

    module_title, _ = format_policy_decision("recommend_module", {"slug": "accounting"})
    assert "accounting" in module_title.lower()
    module = describe_action("enable_module", {"module": "accounting"})
    assert module["args"]["slug"]
    assert "account" in module["args"]["slug"].lower()


def test_schedule_decision_names_the_cadence():
    from app.tools.decision_copy import schedule_intent_key

    payload = {
        "title": "Statuscheck klantenflows",
        "every_minutes": 10,
        "new_thread": True,
        "owner": "f669bfed-cc69-4476-9ef7-7c9bc1b206a6",
        "enabled": True,
    }
    title, summary = format_policy_decision("set_thread_schedule", payload)
    assert title == "Approve: Every 10 minutes: Statuscheck klantenflows"
    assert summary.startswith("Every 10 minutes: Statuscheck klantenflows")
    other = {**payload, "owner": "me"}
    assert schedule_intent_key("set_thread_schedule", payload) == schedule_intent_key(
        "set_thread_schedule", other
    )
    assert schedule_intent_key("set_thread_schedule", payload) != schedule_intent_key(
        "set_thread_schedule", {**payload, "every_minutes": 30}
    )


def test_open_internal_threads_alias_runs_list_threads():
    name, payload = resolve_tool_alias("list_open_internal_threads", {})
    assert name == "list_threads"
    assert payload["channel"] == "internal"
    assert payload["status"] == "open"
    named, explicit = resolve_tool_alias("list_open_internal_threads", {"channel": "email"})
    assert named == "list_threads"
    assert explicit["channel"] == "email"


def test_list_open_decisions_alias_runs_tenant_overview():
    name, payload = resolve_tool_alias("list_open_decisions", {})
    assert name == "get_tenant_overview"
    assert payload == {}
    pending, _ = resolve_tool_alias("list_pending_decisions", {"limit": 5})
    assert pending == "get_tenant_overview"


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
