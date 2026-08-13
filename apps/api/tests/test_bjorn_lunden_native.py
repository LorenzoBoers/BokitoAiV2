"""Native Björn Lundén (BLA) integration: credential parsing, install +
discovery, and agent tool calls against a faked BLA API."""

import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import Tenant
from app.models.integration import McpServer
from app.services import bjorn_lunden as bl
from app.services.agent.mcp_client import call_mcp_tool
from app.services.bjorn_lunden import (
    BL_NATIVE_TOOLS,
    BL_NATIVE_URL,
    MISSING_COMPANY_KEY_ERROR,
    call_bl_tool,
    parse_bl_credentials,
)
from app.services.integrations_platform import install_mcp
from app.services.integrations_platform import test_mcp_server as run_mcp_discovery


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = Tenant(slug=f"bl-{uuid4().hex[:8]}", name="BL Native")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


# --- Credential parsing ---------------------------------------------------------


def test_parse_credentials_explicit_fields():
    creds = parse_bl_credentials(
        {"client_id": "cid", "client_secret": "sec", "user_key": "guid-1"}
    )
    assert creds == {"client_id": "cid", "client_secret": "sec", "user_key": "guid-1"}


def test_parse_credentials_from_combined_api_key():
    creds = parse_bl_credentials({"api_key": "cid:sec"})
    assert creds["client_id"] == "cid"
    assert creds["client_secret"] == "sec"
    assert creds["user_key"] == ""

    creds3 = parse_bl_credentials({"api_key": "cid:sec:guid-9"})
    assert creds3["user_key"] == "guid-9"


def test_parse_credentials_plain_api_key_is_not_client_creds():
    creds = parse_bl_credentials({"api_key": "just-a-user-key"})
    assert creds["client_id"] == ""
    assert not bl.has_bl_credentials({"api_key": "just-a-user-key"})


# --- Install + discovery ----------------------------------------------------------


@pytest.mark.asyncio
async def test_prod_install_defaults_to_native_and_discovers_tools(
    session_override: AsyncSession, monkeypatch
):
    tenant = await _tenant(session_override)
    monkeypatch.setattr(get_settings(), "environment", "prod")

    installed = await install_mcp(
        session_override, tenant.id, provider="bjorn_lunden_mcp", api_key=""
    )
    assert installed["binding"]["config"]["server_url"] == BL_NATIVE_URL
    discovery = installed["discovery"]
    assert discovery is not None and discovery["ok"] is True
    assert discovery["note"] == "credentials_pending"
    tool_names = {t["name"] for t in discovery["tools"]}
    assert {"list_companies", "search_customers", "list_invoices"} <= tool_names
    assert discovery["tool_count"] == len(BL_NATIVE_TOOLS)


@pytest.mark.asyncio
async def test_test_mcp_server_native_persists_tools(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    server = McpServer(
        tenant_id=tenant.id, name="Bjorn Lunden", server_url=BL_NATIVE_URL, auth_json="{}"
    )
    session_override.add(server)
    await session_override.commit()
    await session_override.refresh(server)

    result = await run_mcp_discovery(session_override, tenant.id, server.id)
    assert result["ok"] is True
    assert result["tool_count"] == len(BL_NATIVE_TOOLS)
    await session_override.refresh(server)
    stored = json.loads(server.tools_json or "[]")
    assert {t["name"] for t in stored} == {t["name"] for t in BL_NATIVE_TOOLS}


# --- Tool calls -------------------------------------------------------------------


async def _native_server(
    session: AsyncSession, tenant: Tenant, auth: dict | None = None
) -> McpServer:
    server = McpServer(
        tenant_id=tenant.id,
        name="Bjorn Lunden",
        server_url=BL_NATIVE_URL,
        auth_json=json.dumps(auth or {}),
    )
    session.add(server)
    await session.commit()
    await session.refresh(server)
    return server


@pytest.mark.asyncio
async def test_native_call_without_creds_errors_in_prod(
    session_override: AsyncSession, monkeypatch
):
    tenant = await _tenant(session_override)
    await _native_server(session_override, tenant)
    monkeypatch.setattr(get_settings(), "environment", "prod")

    result = await call_mcp_tool(
        session_override,
        tenant.id,
        {"server_name": "Bjorn Lunden", "tool_name": "search_customers", "arguments": {}},
    )
    assert "credentials are not configured" in result["error"]


@pytest.mark.asyncio
async def test_native_call_without_creds_uses_sandbox_in_dev(
    session_override: AsyncSession,
):
    tenant = await _tenant(session_override)
    await _native_server(session_override, tenant)
    assert not get_settings().is_production

    result = await call_mcp_tool(
        session_override,
        tenant.id,
        {
            "server_name": "Bjorn Lunden",
            "tool_name": "search_customers",
            "arguments": {"query": "andersson"},
        },
    )
    assert "error" not in result
    assert result["result"]["customers"], "dev sandbox should return demo customers"


def _fake_bla_transport(seen: list[httpx.Request]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/oauth-token"):
            return httpx.Response(
                200, json={"access_token": "tok-123", "expires_in": 3600}
            )
        if request.url.path.endswith("/sp/customer"):
            return httpx.Response(
                200,
                json=[
                    {"id": "c1", "name": "Andersson Bygg AB", "email": "a@b.se"},
                    {"id": "c2", "name": "Svensson Konsult", "email": "s@k.se"},
                ],
            )
        if request.url.path.endswith("/sp/common/client"):
            return httpx.Response(
                200, json=[{"name": "Demo AB", "publicKey": "guid-1"}]
            )
        return httpx.Response(404, json={"message": "not found"})

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_native_call_with_creds_hits_bla_api(monkeypatch):
    seen: list[httpx.Request] = []
    monkeypatch.setattr(bl, "_transport", _fake_bla_transport(seen))
    bl._token_cache.clear()

    auth = {"client_id": "cid", "client_secret": "sec", "user_key": "guid-1"}
    outcome = await call_bl_tool(auth, "search_customers", {"query": "andersson"})
    assert "error" not in outcome
    names = [c["name"] for c in outcome["result"]]
    assert names == ["Andersson Bygg AB"]

    token_req = next(r for r in seen if r.url.path.endswith("/oauth-token"))
    assert token_req.headers["Authorization"].startswith("Basic ")
    data_req = next(r for r in seen if r.url.path.endswith("/sp/customer"))
    assert data_req.headers["Authorization"] == "Bearer tok-123"
    assert data_req.headers["User-Key"] == "guid-1"


@pytest.mark.asyncio
async def test_native_list_companies_needs_no_company_key(monkeypatch):
    seen: list[httpx.Request] = []
    monkeypatch.setattr(bl, "_transport", _fake_bla_transport(seen))
    bl._token_cache.clear()

    auth = {"client_id": "cid", "client_secret": "sec"}
    outcome = await call_bl_tool(auth, "list_companies", {})
    assert outcome["result"][0]["publicKey"] == "guid-1"
    data_req = next(r for r in seen if r.url.path.endswith("/sp/common/client"))
    assert "User-Key" not in data_req.headers


@pytest.mark.asyncio
async def test_native_company_scoped_call_without_company_key(monkeypatch):
    seen: list[httpx.Request] = []
    monkeypatch.setattr(bl, "_transport", _fake_bla_transport(seen))
    bl._token_cache.clear()

    auth = {"client_id": "cid", "client_secret": "sec"}
    outcome = await call_bl_tool(auth, "search_customers", {})
    assert outcome["error"] == MISSING_COMPANY_KEY_ERROR


@pytest.mark.asyncio
async def test_native_call_per_call_company_override(monkeypatch):
    seen: list[httpx.Request] = []
    monkeypatch.setattr(bl, "_transport", _fake_bla_transport(seen))
    bl._token_cache.clear()

    auth = {"client_id": "cid", "client_secret": "sec"}
    outcome = await call_bl_tool(
        auth, "search_customers", {"company_id": "guid-override", "query": ""}
    )
    assert "error" not in outcome
    data_req = next(r for r in seen if r.url.path.endswith("/sp/customer"))
    assert data_req.headers["User-Key"] == "guid-override"
