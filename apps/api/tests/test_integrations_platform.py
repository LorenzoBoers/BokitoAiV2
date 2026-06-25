"""Tests for integrations marketplace, connections, MCP, and GitHub routes."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

API = "/api"


async def _login(client: AsyncClient) -> str:
    res = await client.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return res.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_list_providers(client: AsyncClient):
    token = await _login(client)
    res = await client.get(f"{API}/integrations/providers", headers=_auth(token))
    assert res.status_code == 200
    data = res.json()
    assert "providers" in data
    assert len(data["providers"]) >= 5
    assert "connection_counts" in data
    slugs = {p["slug"] for p in data["providers"]}
    assert "github" in slugs
    assert "gmail" in slugs
    assert "higgsfield_mcp" in slugs
    higgsfield = next(p for p in data["providers"] if p["slug"] == "higgsfield_mcp")
    assert higgsfield["mcp_remote_url"] == "https://mcp.higgsfield.ai/mcp"
    assert higgsfield["auth_type"] == "mcp_remote_oauth"
    assert higgsfield["host"]["slug"] == "higgsfield"


@pytest.mark.asyncio
async def test_github_oauth_and_connections(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    return_url = "http://test/integrations/connected"

    start = await client.get(
        f"{API}/github/oauth/start",
        params={"return_url": return_url},
        headers=headers,
    )
    assert start.status_code == 200
    assert "authorize_url" in start.json()
    assert "github=connected" in start.json()["authorize_url"]

    conns = await client.get(f"{API}/github/connections", headers=headers)
    assert conns.status_code == 200
    rows = conns.json()["connections"]
    assert len(rows) == 1
    assert rows[0]["github_login"]
    assert rows[0]["status"] == "active"

    repos = await client.get(f"{API}/github/repos", headers=headers)
    assert repos.status_code == 200
    assert len(repos.json()["items"]) >= 1


@pytest.mark.asyncio
async def test_mcp_install_and_bindings(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)

    install = await client.post(
        f"{API}/integrations/mcp/install",
        headers=headers,
        json={
            "provider": "custom_mcp",
            "api_key": "test-key",
            "display_name": "Test MCP",
            "server_url": "https://mcp.example.com",
        },
    )
    assert install.status_code == 200
    body = install.json()
    assert "connection" in body
    assert "binding" in body
    assert body["connection"]["provider_id"]
    assert body["binding"]["id"]

    bindings = await client.get(f"{API}/integrations/mcp/bindings", headers=headers)
    assert bindings.status_code == 200
    data = bindings.json()
    assert len(data["bindings"]) >= 1
    assert len(data["mcp_server_ids"]) >= 1

    mock_install = await client.post(
        f"{API}/integrations/mcp/install",
        headers=headers,
        json={
            "provider": "custom_mcp",
            "api_key": "mock-key",
            "display_name": "Mock MCP",
            "server_url": "mock://local/tools",
        },
    )
    assert mock_install.status_code == 200
    server_id = mock_install.json()["binding"]["config"]["mcp_server_id"]
    tested = await client.post(f"{API}/integrations/mcp/{server_id}/test", headers=headers)
    assert tested.status_code == 200
    body = tested.json()
    assert body["ok"] is True
    assert body["tool_count"] >= 1
    assert body["tools"][0]["name"]


@pytest.mark.asyncio
async def test_mcp_tenant_isolation(client: AsyncClient):
    signup_a = await client.post(
        f"{API}/auth/signup",
        json={
            "email": "mcp-a@example.com",
            "password": "test-password",
            "tenant_slug": "mcp-tenant-a",
            "tenant_name": "MCP Tenant A",
        },
    )
    assert signup_a.status_code == 200
    headers_a = _auth(signup_a.json()["access_token"])

    signup_b = await client.post(
        f"{API}/auth/signup",
        json={
            "email": "mcp-b@example.com",
            "password": "test-password",
            "tenant_slug": "mcp-tenant-b",
            "tenant_name": "MCP Tenant B",
        },
    )
    assert signup_b.status_code == 200
    headers_b = _auth(signup_b.json()["access_token"])

    install_a = await client.post(
        f"{API}/integrations/mcp/install",
        headers=headers_a,
        json={
            "provider": "higgsfield_mcp",
            "api_key": "tenant-a-key",
            "display_name": "Tenant A Higgsfield",
        },
    )
    assert install_a.status_code == 200
    conn_a_id = install_a.json()["connection"]["id"]

    bindings_b = await client.get(
        f"{API}/integrations/mcp/bindings",
        headers=headers_b,
    )
    assert bindings_b.status_code == 200
    binding_conn_ids_b = {b.get("connection_id") for b in bindings_b.json()["bindings"]}
    assert conn_a_id not in binding_conn_ids_b

    conns_b = await client.get(
        f"{API}/integrations/connections",
        headers=headers_b,
    )
    assert conns_b.status_code == 200
    conn_ids_b = {c["id"] for c in conns_b.json()["connections"]}
    assert conn_a_id not in conn_ids_b

    providers_b = await client.get(
        f"{API}/integrations/providers",
        headers=headers_b,
    )
    assert providers_b.status_code == 200
    higgsfield_b = next(
        p for p in providers_b.json()["providers"] if p["slug"] == "higgsfield_mcp"
    )
    assert higgsfield_b["mcp_remote_url"] == "https://mcp.higgsfield.ai/mcp"


@pytest.mark.asyncio
async def test_email_oauth_mock(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    return_url = "http://test/email/settings"

    res = await client.get(
        f"{API}/email/oauth/start",
        params={"provider": "gmail", "return_url": return_url},
        headers=headers,
    )
    assert res.status_code == 200
    url = res.json()["authorize_url"]
    assert "oauth_provider=gmail" in url
    assert "oauth_status=connected" in url

    email_conns = await client.get(f"{API}/email/accounts", headers=headers)
    assert email_conns.status_code == 200
    assert len(email_conns.json()) >= 1
