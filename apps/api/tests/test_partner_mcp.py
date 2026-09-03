"""Partner MCP host (KING) and attached MCP tools on modules."""

from __future__ import annotations

import json
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.models.integration import IntegrationBinding, IntegrationConnection, McpServer
from app.modules.catalog import serialize_modules_for_tenant
from app.services.integrations_catalog import PROVIDER_BY_SLUG
from app.services.king_finance import KING_NATIVE_TOOLS
from app.services.partner_mcp import (
    is_king_mcp_url,
    is_partner_mcp_url,
    mint_partner_access_token,
    partner_mcp_url,
    partner_tools,
)

API = "/api"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login(client: AsyncClient) -> str:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    res = await client.post(
        f"{API}/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    assert res.status_code == 200
    return res.json()["access_token"]


def test_king_catalog_points_at_partner_mcp_url():
    row = PROVIDER_BY_SLUG["king_accountancy"]
    url = row.get("mcp_remote_url") or ""
    assert is_partner_mcp_url(url) == "king"
    assert is_king_mcp_url(url)
    assert partner_mcp_url("king").endswith("/api/mcp/partners/king")


def test_partner_tools_match_king_native_list():
    tools = partner_tools("king")
    names = {t["name"] for t in tools}
    assert "list_companies" in names
    assert names == {t["name"] for t in KING_NATIVE_TOOLS}


@pytest.mark.asyncio
async def test_partner_mcp_tools_list_and_call(client: AsyncClient, session_override):
    token = mint_partner_access_token()
    me = await client.get(f"{API}/auth/me", headers=_auth(await _login(client)))
    assert me.status_code == 200
    tenant_id = UUID(me.json()["tenant"]["id"])

    server = McpServer(
        tenant_id=tenant_id,
        name="KING Accountancy",
        server_url=partner_mcp_url("king"),
        auth_json=json.dumps(
            {
                "auth_type": "bearer",
                "partner_access_token": token,
                "bearer_token": token,
                "administraties": [{"name": "Demo", "omgevingscode": "DEMO1"}],
            }
        ),
        is_active=True,
        tools_json=json.dumps(partner_tools("king")),
    )
    session_override.add(server)
    await session_override.commit()

    listed = await client.post(
        f"{API}/mcp/partners/king",
        headers={"Authorization": f"Bearer {token}"},
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
    )
    assert listed.status_code == 200
    body = listed.json()
    tool_names = {t["name"] for t in body["result"]["tools"]}
    assert "list_companies" in tool_names

    called = await client.post(
        f"{API}/mcp/partners/king",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "list_companies", "arguments": {}},
        },
    )
    assert called.status_code == 200
    assert "result" in called.json()


@pytest.mark.asyncio
async def test_serialize_modules_includes_attached_mcp_tools(client: AsyncClient, session_override):
    me = await client.get(f"{API}/auth/me", headers=_auth(await _login(client)))
    assert me.status_code == 200
    tenant_id = UUID(me.json()["tenant"]["id"])

    server = McpServer(
        tenant_id=tenant_id,
        name="KING Accountancy",
        server_url=partner_mcp_url("king"),
        auth_json=json.dumps({"partner_access_token": mint_partner_access_token()}),
        is_active=True,
        tools_json=json.dumps(
            [{"name": "list_companies", "description": "List KING administraties"}]
        ),
    )
    session_override.add(server)
    await session_override.flush()
    conn = IntegrationConnection(
        tenant_id=tenant_id,
        provider="king_accountancy",
        display_name="KING Accountancy",
        status="active",
        metadata_json=json.dumps({"mcp_server_id": str(server.id)}),
    )
    session_override.add(conn)
    await session_override.flush()
    session_override.add(
        IntegrationBinding(
            tenant_id=tenant_id,
            connection_id=conn.id,
            binding_type="mcp_server",
            config_json=json.dumps(
                {"mcp_server_id": str(server.id), "provider": "king_accountancy"}
            ),
        )
    )
    session_override.add(
        IntegrationBinding(
            tenant_id=tenant_id,
            connection_id=conn.id,
            binding_type="module",
            config_json=json.dumps({"module_slug": "accounting"}),
        )
    )
    await session_override.commit()

    rows = await serialize_modules_for_tenant(session_override, tenant_id)
    accounting = next(r for r in rows if r["slug"] == "accounting")
    attached = accounting.get("attached_mcp_tools") or []
    assert attached
    assert attached[0]["server_name"] == "KING Accountancy"
    assert any(t["name"] == "list_companies" for t in attached[0]["tools"])


@pytest.mark.asyncio
async def test_king_install_uses_partner_mcp_url(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    install = await client.post(
        f"{API}/integrations/mcp/install",
        headers=headers,
        json={
            "provider": "king_accountancy",
            "api_key": "",
            "display_name": "KING Accountancy",
            "auth": {
                "administraties": [{"name": "Demo BV", "omgevingscode": "DEMO99"}],
            },
            "use_mock": True,
        },
    )
    assert install.status_code == 200, install.text
    body = install.json()
    server_id = body.get("mcp_server_id") or body["binding"]["config"]["mcp_server_id"]
    servers = await client.get(f"{API}/integrations/mcp/servers", headers=headers)
    assert servers.status_code == 200
    row = next(s for s in servers.json() if s["id"] == server_id)
    assert is_partner_mcp_url(row["server_url"]) == "king"
    assert row.get("provider") == "king_accountancy"
    assert any(t.get("name") == "list_companies" for t in (row.get("tools") or []))
