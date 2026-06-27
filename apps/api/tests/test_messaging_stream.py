"""Tests for agent streaming, gateway events, and chat error recovery."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_agent_loop_stream_yields_real_deltas():
    from app.services.agent.loop import AgentLoop

    class FakeLLM:
        async def stream_chat(self, messages, tools=None, model=None):
            yield {"type": "delta", "text": "Hello "}
            yield {"type": "delta", "text": "world"}
            yield {
                "type": "done",
                "usage": {"input_tokens": 5, "output_tokens": 3},
                "content": [{"type": "text", "text": "Hello world"}],
                "stop_reason": "end_turn",
            }

        async def chat(self, messages, tools=None, model=None):
            return {
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "Hello world"}],
                "usage": {"input_tokens": 5, "output_tokens": 3},
            }

    loop = AgentLoop(AsyncMock(), __import__("uuid").uuid4(), None)
    loop.tools = []
    loop.max_loops = 1
    loop.llm = FakeLLM()
    loop.resolved_call = type(
        "Call",
        (),
        {
            "model_id": "mock",
            "provider_type": "mock",
            "api_key": "",
            "base_url": "",
            "live": False,
            "key_source": "mock",
        },
    )()

    with patch.object(loop, "_prepare_chat", new=AsyncMock(return_value=([], {"input_tokens": 0, "output_tokens": 0}))):
        with patch.object(loop, "_record_usage", new=AsyncMock()):
            events = []
            async for event in loop.stream_chat([{"role": "user", "content": "Hi"}]):
                events.append(event)

    deltas = [e["text"] for e in events if e["type"] == "delta"]
    assert deltas == ["Hello ", "world"]
    assert events[-1]["type"] == "done"
    assert events[-1]["text"] == "Hello world"


@pytest.mark.asyncio
async def test_publish_message_delta_and_agent_step():
    from app.gateway.publish import publish_agent_step, publish_message_delta

    published: list[tuple] = []

    async def capture(tenant_id, topics, event, data):
        published.append((event, data))

    with patch("app.gateway.publish.event_bus.publish", side_effect=capture):
        tid = __import__("uuid").uuid4()
        sid = __import__("uuid").uuid4()
        await publish_message_delta(tid, sid, delta="Hi", stream_id="s1")
        await publish_agent_step(
            tid, sid, step_type="tool_call", name="search_index", payload={"q": "x"}, stream_id="s1"
        )

    assert published[0][0] == "message.delta"
    assert published[0][1]["delta"] == "Hi"
    assert published[1][0] == "agent.step"
    assert published[1][1]["step_type"] == "tool_call"


@pytest.mark.asyncio
async def test_chat_send_persists_error_reply(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    conv = await client.post("/api/chat/conversations", json={"title": "Error test"}, headers=headers)
    conv_id = conv.json()["id"]

    with patch(
        "app.services.agent.loop.AgentLoop.run_chat",
        new=AsyncMock(side_effect=RuntimeError("LLM down")),
    ):
        msg = await client.post(
            f"/api/chat/conversations/{conv_id}/messages",
            json={"content": "Hello"},
            headers=headers,
        )

    assert msg.status_code == 200
    body = msg.json()
    assert body["message"]["role"] == "assistant"
    assert body.get("error") is True

    listed = await client.get(f"/api/chat/conversations/{conv_id}/messages", headers=headers)
    roles = [m["role"] for m in listed.json()]
    assert roles.count("assistant") >= 1


@pytest.mark.asyncio
async def test_chat_stream_sse(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    conv = await client.post("/api/chat/conversations", json={"title": "Stream test"}, headers=headers)
    conv_id = conv.json()["id"]

    async def fake_stream(self, messages, extra_context="", attachments=None):
        yield {"type": "delta", "text": "Streamed "}
        yield {"type": "delta", "text": "reply"}
        yield {"type": "done", "text": "Streamed reply", "usage": {"input_tokens": 1, "output_tokens": 2}}

    with patch("app.services.agent.loop.AgentLoop.stream_chat", new=fake_stream):
        async with client.stream(
            "POST",
            f"/api/chat/conversations/{conv_id}/stream",
            json={"content": "Stream please"},
            headers=headers,
        ) as resp:
            assert resp.status_code == 200
            chunks = []
            async for line in resp.aiter_lines():
                if line.startswith("data:"):
                    chunks.append(json.loads(line[5:].strip()))
            assert any("Streamed" in (c.get("text") or "") for c in chunks)
