"""Livechat SSE stream-chat after session start."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


@pytest.mark.asyncio
async def test_stream_chat_returns_sse_done(client: AsyncClient):
    start = await client.post(
        "/api/livechat/session/start",
        json={"agent_slug": "assistant", "auth_mode": "optional", "tenant_subdomain": "test"},
    )
    assert start.status_code == 200
    session_token = start.json()["session_token"]

    async with client.stream(
        "POST",
        "/api/livechat/stream-chat",
        headers={"Authorization": f"Bearer {session_token}"},
        json={"message_content": "Hello", "conversation_id": "conv_test"},
    ) as response:
        assert response.status_code == 200
        assert "text/event-stream" in (response.headers.get("content-type") or "")
        body = ""
        async for chunk in response.aiter_text():
            body += chunk
        assert "data:" in body
        assert '"type": "done"' in body or '"type":"done"' in body


@pytest.mark.asyncio
async def test_stream_chat_with_dashboard_login(client: AsyncClient):
    login = await client.post(
        "/api/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    assert login.status_code == 200
    access = login.json()["access_token"]

    start = await client.post(
        "/api/livechat/session/start",
        json={
            "agent_slug": "assistant",
            "auth_mode": "optional",
            "host_auth_token": access,
        },
    )
    assert start.status_code == 200
    session_token = start.json()["session_token"]

    response = await client.post(
        "/api/livechat/stream-chat",
        headers={"Authorization": f"Bearer {session_token}"},
        json={"message_content": "Ping"},
    )
    assert response.status_code == 200
    text = response.text
    assert "done" in text
