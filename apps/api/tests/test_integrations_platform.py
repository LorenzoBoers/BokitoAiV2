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
    res = await client.get(f"{API}/integrations/integrations/providers", headers=_auth(token))
    assert res.status_code == 200
    data = res.json()
    assert "providers" in data
    assert len(data["providers"]) >= 5
    assert "connection_counts" in data
    slugs = {p["slug"] for p in data["providers"]}
    assert "github" in slugs
    assert "gmail" in slugs


@pytest.mark.asyncio
async def test_github_oauth_and_connections(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    return_url = "http://test/integrations/connected"

    start = await client.get(
        f"{API}/integrations/github/oauth/start",
        params={"return_url": return_url},
        headers=headers,
    )
    assert start.status_code == 200
    assert "authorize_url" in start.json()
    assert "github=connected" in start.json()["authorize_url"]

    conns = await client.get(f"{API}/integrations/github/connections", headers=headers)
    assert conns.status_code == 200
    rows = conns.json()["connections"]
    assert len(rows) == 1
    assert rows[0]["github_login"]
    assert rows[0]["status"] == "active"

    repos = await client.get(f"{API}/integrations/github/repos", headers=headers)
    assert repos.status_code == 200
    assert len(repos.json()["items"]) >= 1


@pytest.mark.asyncio
async def test_mcp_install_and_bindings(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)

    install = await client.post(
        f"{API}/integrations/integrations/mcp/install",
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

    bindings = await client.get(f"{API}/integrations/integrations/mcp/bindings", headers=headers)
    assert bindings.status_code == 200
    data = bindings.json()
    assert len(data["bindings"]) >= 1
    assert len(data["mcp_server_ids"]) >= 1


@pytest.mark.asyncio
async def test_email_oauth_mock(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    return_url = "http://test/email/settings"

    res = await client.get(
        f"{API}/integrations/email/oauth/start",
        params={"provider": "gmail", "return_url": return_url},
        headers=headers,
    )
    assert res.status_code == 200
    url = res.json()["authorize_url"]
    assert "oauth_provider=gmail" in url
    assert "oauth_status=connected" in url

    email_conns = await client.get(f"{API}/integrations/email/connections", headers=headers)
    assert email_conns.status_code == 200
    assert len(email_conns.json()) >= 1
