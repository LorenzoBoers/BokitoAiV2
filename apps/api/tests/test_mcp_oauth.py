"""Tests for remote MCP OAuth start/callback."""

from unittest.mock import AsyncMock, patch
from uuid import UUID

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
async def test_mcp_oauth_start_returns_authorize_url(client: AsyncClient):
    token = await _login(client)
    discovery = AsyncMock(
        return_value=type(
            "D",
            (),
            {
                "mcp_url": "https://mcp.example.com/mcp",
                "resource": "https://mcp.example.com/mcp",
                "authorization_endpoint": "https://auth.example.com/authorize",
                "token_endpoint": "https://auth.example.com/token",
                "registration_endpoint": "https://auth.example.com/register",
                "issuer": "https://auth.example.com",
                "scopes_supported": ("read",),
            },
        )()
    )
    with patch("app.services.mcp_oauth.discover_mcp_oauth", discovery), patch(
        "app.services.mcp_oauth._register_oauth_client",
        AsyncMock(return_value=("client-1", None)),
    ):
        res = await client.get(
            f"{API}/integrations/mcp/oauth/start",
            params={
                "provider": "notion_mcp",
                "return_url": "http://test/connections/marketplace?connect=notion",
            },
            headers=_auth(token),
        )
    assert res.status_code == 200
    body = res.json()
    assert body["provider"] == "notion_mcp"
    assert "authorize_url" in body
    assert "auth.example.com/authorize" in body["authorize_url"]
    assert "code_challenge=" in body["authorize_url"]


@pytest.mark.asyncio
async def test_mcp_oauth_start_rejects_unknown_provider(client: AsyncClient):
    token = await _login(client)
    res = await client.get(
        f"{API}/integrations/mcp/oauth/start",
        params={"provider": "unknown_mcp", "return_url": "http://test/connections"},
        headers=_auth(token),
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_mcp_oauth_callback_redirects_on_success(client: AsyncClient, session_override):
    from app.models.oauth_state import OAuthState
    from app.services.mcp_oauth import _MCP_REMOTE_FLOW

    token = await _login(client)
    me = await client.get(f"{API}/auth/me", headers=_auth(token))
    tenant_id = UUID(me.json()["tenant"]["id"])
    user_id = UUID(me.json()["user"]["id"])

    session_override.add(
        OAuthState(
            state="test-state",
            tenant_id=tenant_id,
            user_id=user_id,
            provider="notion_mcp",
            flow=_MCP_REMOTE_FLOW,
            return_url="http://test/connections/marketplace?connect=notion",
            redirect_uri="http://test/api/integrations/mcp/oauth/callback",
            context_json='{"code_verifier":"v","client_id":"c","token_endpoint":"https://auth.example.com/token","resource":"https://mcp.notion.com/mcp","mcp_url":"https://mcp.notion.com/mcp","redirect_uri":"http://test/api/integrations/mcp/oauth/callback"}',
        )
    )
    await session_override.commit()

    with patch(
        "app.services.mcp_oauth._exchange_mcp_code",
        AsyncMock(return_value={"access_token": "tok", "token_type": "Bearer", "expires_in": 3600}),
    ), patch("app.services.mcp_oauth.test_mcp_server", AsyncMock(return_value={"ok": True})):
        res = await client.get(
            f"{API}/integrations/mcp/oauth/callback",
            params={"state": "test-state", "code": "abc"},
            follow_redirects=False,
        )
    assert res.status_code == 302
    assert "integration=connected" in res.headers["location"]
    assert "provider=notion_mcp" in res.headers["location"]
