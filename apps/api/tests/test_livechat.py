"""Livechat widget compatibility endpoints."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    login = await client.post(
        "/api/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_session_start_returns_theme(client: AsyncClient):
    r = await client.post(
        "/api/livechat/session/start",
        json={"agent_slug": "bokito-dashboard", "auth_mode": "optional", "tenant_subdomain": "test"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("session_token")
    assert body.get("identity_type") in ("anonymous", "authenticated")
    theme = body.get("agent_config", {}).get("theme", {})
    assert theme.get("main_color")
    assert body.get("tenant", {}).get("slug") == "test"


@pytest.mark.asyncio
async def test_session_start_with_host_auth(client: AsyncClient):
    headers = await _auth_headers(client)
    token = headers["Authorization"].removeprefix("Bearer ").strip()
    r = await client.post(
        "/api/livechat/session/start",
        json={
            "agent_slug": "bokito-dashboard",
            "auth_mode": "optional",
            "host_auth_token": token,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("identity_type") == "authenticated"
    assert body.get("user", {}).get("email") == TEST_EMAIL
