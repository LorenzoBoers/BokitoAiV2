"""Native Alpaca Trading API integration: credentials, install, discovery, tools."""

import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import Tenant
from app.models.integration import McpServer
from app.services.agent.mcp_client import call_mcp_tool
from app.services.alpaca import (
    ALPACA_NATIVE_TOOLS,
    ALPACA_NATIVE_URL,
    auth_payload_from_oauth_tokens,
    call_alpaca_tool,
    has_alpaca_credentials,
    parse_alpaca_auth,
    parse_alpaca_credentials,
)
from app.services.integrations_catalog import PROVIDER_BY_SLUG
from app.services.integrations_platform import install_mcp
from app.services.integrations_platform import test_mcp_server as run_mcp_discovery


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = Tenant(slug=f"alpaca-{uuid4().hex[:8]}", name="Alpaca Native")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


def test_provider_is_available_in_catalog():
    row = PROVIDER_BY_SLUG["alpaca_mcp"]
    assert row["status"] == "available"
    assert row["auth_type"] == "api_key"
    assert row["capabilities"].get("mcp_tools") is True
    assert row["capabilities"].get("alpaca_connect") is True
    assert "oauth2" in (row["capabilities"].get("auth_modes") or [])


def test_parse_credentials_explicit_fields():
    creds = parse_alpaca_credentials(
        {"api_key_id": "PKTEST", "api_secret_key": "secret", "paper": True}
    )
    assert creds["api_key_id"] == "PKTEST"
    assert creds["api_secret_key"] == "secret"
    assert creds["paper"] is True
    assert creds["mode"] == "api_key"


def test_parse_oauth_access_token():
    session = parse_alpaca_auth(
        {"access_token": "tok-abc", "paper": False, "auth_mode": "oauth"}
    )
    assert session["mode"] == "oauth"
    assert session["access_token"] == "tok-abc"
    assert session["paper"] is False
    assert has_alpaca_credentials({"access_token": "tok-abc"})
    payload = auth_payload_from_oauth_tokens({"access_token": "tok-xyz"}, paper=True)
    assert payload["auth_mode"] == "oauth"
    assert payload["access_token"] == "tok-xyz"


def test_oauth_provider_endpoints_wired():
    from app.services import oauth_providers
    from app.services.alpaca import ALPACA_OAUTH_AUTHORIZE, ALPACA_OAUTH_TOKEN

    assert oauth_providers.ALPACA == "alpaca_mcp"
    assert oauth_providers._authorize_endpoint("alpaca_mcp") == ALPACA_OAUTH_AUTHORIZE
    assert oauth_providers._token_endpoint("alpaca_mcp") == ALPACA_OAUTH_TOKEN
    assert "trading" in oauth_providers._scopes("alpaca_mcp")
    assert oauth_providers.is_configured("alpaca_mcp") is False


def test_parse_credentials_official_env_names():
    creds = parse_alpaca_credentials(
        {
            "ALPACA_API_KEY": "PKENV",
            "ALPACA_SECRET_KEY": "secenv",
            "ALPACA_PAPER_TRADE": "true",
        }
    )
    assert creds["api_key_id"] == "PKENV"
    assert creds["api_secret_key"] == "secenv"
    assert creds["paper"] is True


def test_parse_credentials_combined_api_key():
    creds = parse_alpaca_credentials({"api_key": "PK1:secret1"})
    assert creds["api_key_id"] == "PK1"
    assert creds["api_secret_key"] == "secret1"
    assert has_alpaca_credentials({"api_key": "PK1:secret1"})


def test_parse_live_flag():
    creds = parse_alpaca_credentials(
        {"api_key_id": "a", "api_secret_key": "b", "paper": False}
    )
    assert creds["paper"] is False
    creds2 = parse_alpaca_credentials(
        {"api_key_id": "a", "api_secret_key": "b", "ALPACA_PAPER_TRADE": "false"}
    )
    assert creds2["paper"] is False


@pytest.mark.asyncio
async def test_prod_install_defaults_to_native_and_discovers_tools(
    session_override: AsyncSession, monkeypatch
):
    tenant = await _tenant(session_override)
    monkeypatch.setattr(get_settings(), "environment", "prod")

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as missing:
        await install_mcp(
            session_override, tenant.id, provider="alpaca_mcp", api_key=""
        )
    assert missing.value.status_code == 400

    monkeypatch.setattr(get_settings(), "environment", "dev")
    installed = await install_mcp(
        session_override,
        tenant.id,
        provider="alpaca_mcp",
        api_key="",
        use_mock=True,
    )
    assert installed["binding"]["config"]["server_url"] == ALPACA_NATIVE_URL
    discovery = installed["discovery"]
    assert discovery is not None and discovery["ok"] is True
    assert discovery["note"] == "credentials_pending"
    tool_names = {t["name"] for t in discovery["tools"]}
    assert {
        "get_account_info",
        "place_stock_order",
        "get_all_positions",
        "get_stock_snapshot",
    } <= tool_names
    assert discovery["tool_count"] == len(ALPACA_NATIVE_TOOLS)


@pytest.mark.asyncio
async def test_test_mcp_server_native_persists_tools(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    server = McpServer(
        tenant_id=tenant.id, name="Alpaca", server_url=ALPACA_NATIVE_URL, auth_json="{}"
    )
    session_override.add(server)
    await session_override.commit()
    await session_override.refresh(server)

    result = await run_mcp_discovery(session_override, tenant.id, server.id)
    assert result["ok"] is True
    assert result["tool_count"] == len(ALPACA_NATIVE_TOOLS)
    await session_override.refresh(server)
    stored = json.loads(server.tools_json or "[]")
    assert {t["name"] for t in stored} == {t["name"] for t in ALPACA_NATIVE_TOOLS}


@pytest.mark.asyncio
async def test_call_alpaca_tool_account_and_order(monkeypatch):
    calls: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, str(request.url)))
        if request.url.path == "/v2/account":
            return httpx.Response(
                200,
                json={"account_number": "PA123", "buying_power": "100000", "status": "ACTIVE"},
            )
        if request.url.path == "/v2/orders" and request.method == "POST":
            body = json.loads(request.content.decode())
            assert body["symbol"] == "AAPL"
            assert body["side"] == "buy"
            return httpx.Response(200, json={"id": "ord-1", "status": "accepted", **body})
        if request.url.path == "/v2/positions":
            return httpx.Response(200, json=[])
        return httpx.Response(404, json={"message": "not found"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr("app.services.alpaca._transport", transport)

    auth = {"api_key_id": "PKTEST", "api_secret_key": "secret", "paper": True}
    account = await call_alpaca_tool(auth, "get_account_info", {})
    assert account["result"]["account_number"] == "PA123"

    order = await call_alpaca_tool(
        auth,
        "place_stock_order",
        {"symbol": "AAPL", "qty": "1", "side": "buy", "type": "market"},
    )
    assert order["result"]["id"] == "ord-1"
    assert ("GET", "https://paper-api.alpaca.markets/v2/account") in [
        (m, u.split("?")[0]) for m, u in calls
    ] or any(m == "GET" and "/v2/account" in u for m, u in calls)


@pytest.mark.asyncio
async def test_call_alpaca_tool_oauth_bearer(monkeypatch):
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("authorization", "")
        seen["key_id"] = request.headers.get("apca-api-key-id", "")
        return httpx.Response(200, json={"account_number": "OA1", "status": "ACTIVE"})

    monkeypatch.setattr("app.services.alpaca._transport", httpx.MockTransport(handler))
    result = await call_alpaca_tool(
        {"access_token": "oauth-token", "auth_mode": "oauth", "paper": True},
        "get_account_info",
        {},
    )
    assert result["result"]["account_number"] == "OA1"
    assert seen["authorization"] == "Bearer oauth-token"
    assert seen["key_id"] == ""


@pytest.mark.asyncio
async def test_call_mcp_tool_routes_native_alpaca(
    session_override: AsyncSession, monkeypatch
):
    tenant = await _tenant(session_override)
    auth = {"api_key_id": "PKTEST", "api_secret_key": "secret", "paper": True}
    server = McpServer(
        tenant_id=tenant.id,
        name="Alpaca",
        server_url=ALPACA_NATIVE_URL,
        auth_json=json.dumps(auth),
    )
    session_override.add(server)
    await session_override.commit()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "clk", "is_open": True})

    monkeypatch.setattr("app.services.alpaca._transport", httpx.MockTransport(handler))

    outcome = await call_mcp_tool(
        session_override,
        tenant.id,
        {"server_name": "Alpaca", "tool_name": "get_clock", "arguments": {}},
    )
    assert outcome.get("error") is None
    assert outcome["result"]["is_open"] is True
