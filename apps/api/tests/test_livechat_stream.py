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
async def test_customer_reply_wakes_snoozed_widget_thread(session_override):
    """Snoozed-until-reply threads must reopen when the visitor writes again."""
    from datetime import datetime, timedelta

    from app.models.auth import Tenant
    from app.models.signal import Signal
    from app.services.assistant_threads import append_signal_chat_message

    tenant = Tenant(slug="wake-test", name="Wake Test")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    snoozed = Signal(
        tenant_id=tenant.id,
        channel="widget",
        source="widget",
        subject="Website chat",
        status="pending",
        snoozed_until=datetime.utcnow() + timedelta(hours=4),
        has_unread=False,
    )
    session_override.add(snoozed)
    await session_override.commit()
    await session_override.refresh(snoozed)

    await append_signal_chat_message(
        session_override, snoozed, role="user", content="Are you there?"
    )
    assert snoozed.status == "open"
    assert snoozed.snoozed_until is None
    assert snoozed.has_unread is True

    # Personal assistant threads stay untouched: there the "user" is the operator.
    assistant_thread = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        source="widget",
        subject="New conversation",
        status="pending",
        has_unread=False,
    )
    session_override.add(assistant_thread)
    await session_override.commit()
    await session_override.refresh(assistant_thread)

    await append_signal_chat_message(
        session_override, assistant_thread, role="user", content="Hello assistant"
    )
    assert assistant_thread.status == "pending"
    assert assistant_thread.has_unread is False


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
