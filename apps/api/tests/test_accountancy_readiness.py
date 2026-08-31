"""Cycle 27 accountancy-client readiness: grounded suggest mode, free-text
decisions, MCP tool discovery, and the Björn Lundén mock stack."""

import json
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.integration import McpServer
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalEvent, SignalMessage


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


# ── Phase 1: suggest mode toolset ────────────────────────────────


def test_suggest_mode_tools_are_read_only_research():
    from app.services.agent.tools import get_tool_definitions
    from app.workers.tasks import SUGGEST_MODE_TOOLS

    all_names = {t["name"] for t in get_tool_definitions()}
    # Every allowlisted tool must exist in the registry.
    assert SUGGEST_MODE_TOOLS <= all_names

    # Research + decision tools present.
    assert "search_index" in SUGGEST_MODE_TOOLS
    assert "call_mcp_tool" in SUGGEST_MODE_TOOLS
    assert "create_decision_request" in SUGGEST_MODE_TOOLS

    # No sending or mutating platform tools.
    forbidden = {
        "send_reply",
        "write_doc",
        "create_agent",
        "update_agent",
        "create_workstream",
        "register_mcp_server",
        "connect_integration",
        "add_graph_node",
    }
    assert not (SUGGEST_MODE_TOOLS & forbidden)


# ── Phase 2: free-text decision resolution ───────────────────────


@pytest.mark.asyncio
async def test_decision_free_text_answer_recorded(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Which invoice period?",
        contact_email="client@firm.example",
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()

    from app.tools import execute_tool

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_decision_request",
        {
            "title": "Which period should we report on?",
            "summary": "The client asked about their VAT position.",
            "signal_id": str(signal.id),
            "options": [
                {"id": "q2", "label": "2026-Q2"},
                {"id": "q3", "label": "2026-Q3"},
                {
                    "id": "other",
                    "label": "Other period",
                    "input_type": "text",
                    "input_placeholder": "e.g. 2025-Q4",
                },
            ],
        },
        signal_id=signal.id,
    )
    decision_id = result["decision_request_id"]

    msg = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.decision_id == UUID(decision_id),
            )
        )
    ).scalar_one()

    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{msg.id}/resolve",
        headers=headers,
        json={
            "action": "approved",
            "option_id": "other",
            "response_text": "Please report on 2025-Q4 instead.",
        },
    )
    assert resolve.status_code == 200

    decision = await session_override.get(DecisionRequest, UUID(decision_id))
    await session_override.refresh(decision)
    assert decision.status == "approved"
    assert decision.chosen_option_id == "other"

    # The free-text answer is kept as thread content.
    answers = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.body_text == "Please report on 2025-Q4 instead.",
            )
        )
    ).scalars().all()
    assert len(answers) == 1
    meta = json.loads(answers[0].metadata_json or "{}")
    assert meta.get("decision_response") is True
    assert meta.get("option_id") == "other"

    # And on the resolution event payload.
    events = (
        await session_override.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == signal.id,
                SignalEvent.event_type == "decision_approved",
            )
        )
    ).scalars().all()
    assert len(events) == 1
    payload = json.loads(events[0].payload_json or "{}")
    assert payload.get("response_text") == "Please report on 2025-Q4 instead."


@pytest.mark.asyncio
async def test_decision_resolution_without_text_adds_no_message(
    client: AsyncClient, session_override
):
    headers = await _auth_headers(client)
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Plain choice",
        contact_email="client@firm.example",
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()

    from app.tools import execute_tool

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_decision_request",
        {
            "title": "Approve?",
            "signal_id": str(signal.id),
            "options": [{"id": "yes", "label": "Yes"}, {"id": "no", "label": "No"}],
        },
        signal_id=signal.id,
    )
    msg = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.decision_id == UUID(result["decision_request_id"]),
            )
        )
    ).scalar_one()

    before = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.signal_id == signal.id)
        )
    ).scalars().all()

    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{msg.id}/resolve",
        headers=headers,
        json={"action": "approved", "option_id": "yes"},
    )
    assert resolve.status_code == 200

    after = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.signal_id == signal.id)
        )
    ).scalars().all()
    assert len(after) == len(before)


# ── Phase 3: MCP install, discovery, snapshot, mock accounting ───


@pytest.mark.asyncio
async def test_bjorn_lunden_install_discovers_accounting_tools(
    client: AsyncClient, session_override
):
    headers = await _auth_headers(client)

    install = await client.post(
        "/api/integrations/mcp/install",
        headers=headers,
        json={"provider": "bjorn_lunden_mcp", "display_name": "Björn Lundén"},
    )
    assert install.status_code == 200
    body = install.json()
    discovery = body.get("discovery")
    assert discovery and discovery["ok"] is True
    tool_names = {t["name"] for t in discovery["tools"]}
    assert "list_invoices" in tool_names
    assert "search_customers" in tool_names

    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    server = (
        await session_override.execute(
            select(McpServer).where(McpServer.tenant_id == tenant.id)
        )
    ).scalars().first()
    assert server is not None
    cached = json.loads(server.tools_json or "[]")
    assert any(t.get("name") == "get_invoice" for t in cached)
    assert server.tools_synced_at is not None

    # Tenant snapshot surfaces the server as accounting-module capacity:
    # agents get accounting_* guidance, not vendor tool names.
    from app.services.tenant_introspection import (
        collect_tenant_snapshot,
        format_tenant_snapshot_prompt,
    )

    snapshot = await collect_tenant_snapshot(session_override, tenant.id)
    assert not any("Lund" in m["name"] for m in snapshot["mcp_servers"])
    acc_entry = next(
        c for c in snapshot["accounting_connections"] if "Lund" in c["name"]
    )
    assert acc_entry["server_url"].startswith("native://bjorn-lunden")
    prompt = format_tenant_snapshot_prompt(snapshot)
    assert "accounting_list_companies" in prompt
    assert "list_invoices" not in prompt

    # Servers listing includes cached tools.
    servers = await client.get("/api/integrations/mcp/servers", headers=headers)
    assert servers.status_code == 200
    row = servers.json()[0]
    assert row["tools_synced_at"] is not None
    # Native BLA toolset: ledger + company tools are exposed.
    listed = {t["name"] for t in row["tools"]}
    assert {"get_account_balance", "list_companies"} <= listed


@pytest.mark.asyncio
async def test_king_accountancy_install_discovers_read_tools(
    client: AsyncClient, monkeypatch
):
    # A developer's local env may hold a real partner key for live smokes;
    # this test must not hit the live Cloudswitch login.
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "king_finance_partner_key", "")
    headers = await _auth_headers(client)

    install = await client.post(
        "/api/integrations/mcp/install",
        headers=headers,
        json={
            "provider": "king_accountancy",
            "display_name": "KING Accountancy",
            "auth": {
                "administraties": [
                    {"id": "adm-1", "name": "Bakker BV", "omgevingscode": "ENV-1"}
                ]
            },
        },
    )
    assert install.status_code == 200, install.text
    body = install.json()
    assert body["binding"]["config"]["server_url"] == "native://king-accountancy"
    discovery = body.get("discovery")
    assert discovery and discovery["ok"] is True
    tool_names = {t["name"] for t in discovery["tools"]}
    assert {"list_companies", "search_customers", "list_recent_bookings"} <= tool_names


@pytest.mark.asyncio
async def test_mock_accounting_mcp_call_returns_invoices(session_override):
    tenant = Tenant(slug="acct", name="Accountancy")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    server = McpServer(
        tenant_id=tenant.id,
        name="Björn Lundén",
        server_url="mock://bjorn-lunden",
    )
    session_override.add(server)
    await session_override.commit()

    from app.services.agent.mcp_client import call_mcp_tool

    result = await call_mcp_tool(
        session_override,
        tenant.id,
        {
            "server_name": "Björn Lundén",
            "tool_name": "list_invoices",
            "arguments": {"customer_id": "cust-1001"},
        },
    )
    assert result["server"] == "Björn Lundén"
    invoices = result["result"]["invoices"]
    assert invoices and invoices[0]["currency"] == "SEK"

    balance = await call_mcp_tool(
        session_override,
        tenant.id,
        {"server_name": "Björn Lundén", "tool_name": "get_account_balance", "arguments": {}},
    )
    assert balance["result"]["balance"] > 0


# ── Phase 3/4: bearer auth headers ───────────────────────────────


def test_mcp_auth_headers_bearer_and_custom():
    from app.services.mcp_auth import mcp_auth_headers

    bearer = mcp_auth_headers({"bearer_token": "tok-123"})
    assert bearer["Authorization"] == "Bearer tok-123"

    custom = mcp_auth_headers(
        {"api_key": "key-1", "headers": {"X-Vendor-Auth": "abc", " Trim-Me ": 1}}
    )
    assert custom["X-API-Key"] == "key-1"
    assert custom["X-Vendor-Auth"] == "abc"
    assert custom["Trim-Me"] == "1"


# ── Phase 5: routing rules on the sync/ingest path ───────────────


@pytest.mark.asyncio
async def test_ingest_inbound_applies_routing_rules(client: AsyncClient, session_override):
    from app.channels.base import InboundMessage, ingest_inbound
    from app.models.channel import ChannelAccount
    from app.models.email_routing import EmailRoutingRule

    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    account = (
        await session_override.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant.id, ChannelAccount.channel == "email"
            )
        )
    ).scalars().first()

    session_override.add(
        EmailRoutingRule(
            tenant_id=tenant.id,
            channel_account_id=account.id,
            condition_type="sender_domain",
            condition_value="clientfirm.se",
            labels_json=json.dumps(["administratie"]),
            priority=1,
            is_active=True,
        )
    )
    await session_override.commit()

    signal, should_process = await ingest_inbound(
        session_override,
        tenant.id,
        InboundMessage(
            channel="email",
            source="outlook",
            sender_address="finance@clientfirm.se",
            sender_name="Client Finance",
            subject="VAT question",
            body_text="What is our VAT position for Q2?",
            external_id="msg-ext-1",
            thread_external_id="thread-ext-1",
            channel_account_id=account.id,
        ),
    )
    assert should_process is True
    tags = json.loads(signal.tags_json or "[]")
    assert "administratie" in tags
