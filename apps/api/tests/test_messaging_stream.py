"""Tests for agent streaming, gateway events, and chat error recovery."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker


async def _reload_run(session: AsyncSession, run_id):
    """The stream handler closes the request session; read via a sibling."""
    from app.models.agent import AgentRun

    factory = sessionmaker(session.bind, class_=AsyncSession, expire_on_commit=False)
    async with factory() as check:
        return await check.get(AgentRun, run_id)


@pytest.mark.asyncio
async def test_agent_loop_stream_yields_real_deltas():
    from app.services.agent.loop import AgentLoop

    class FakeLLM:
        async def stream_chat(self, messages, tools=None, model=None, **kwargs):
            yield {"type": "thinking", "text": "Considering... "}
            yield {"type": "delta", "text": "Hello "}
            yield {"type": "delta", "text": "world"}
            yield {
                "type": "done",
                "usage": {"input_tokens": 5, "output_tokens": 3},
                "content": [{"type": "text", "text": "Hello world"}],
                "stop_reason": "end_turn",
            }

        async def chat(self, messages, tools=None, model=None, **kwargs):
            return {
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "Hello world"}],
                "usage": {"input_tokens": 5, "output_tokens": 3},
            }

    loop = AgentLoop(AsyncMock(), __import__("uuid").uuid4(), None, enable_chat_thinking=True)
    loop.tools = []
    loop.max_loops = 1
    loop.llm = FakeLLM()
    loop.thinking_budget = 1024
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
            with patch.object(loop, "_resolve_thinking_budget", return_value=1024):
                events = []
                async for event in loop.stream_chat([{"role": "user", "content": "Hi"}]):
                    events.append(event)

    thinking = [e["text"] for e in events if e["type"] == "thinking" and e.get("text")]
    deltas = [e["text"] for e in events if e["type"] == "delta"]
    assert thinking == ["Considering... "]
    assert deltas == ["Hello ", "world"]
    assert events[-1]["type"] == "done"
    assert events[-1]["text"] == "Hello world"
    assert events[-1]["thinking"] == "Considering... "


@pytest.mark.asyncio
async def test_turn_recorder_publishes_segments_and_activity():
    from app.services.agent.turn import TurnRecorder

    published: list[tuple] = []

    async def capture(event, data):
        published.append((event, data))

    turn = TurnRecorder(capture, stream_id="s1")
    await turn.thinking("Hmm...")
    await turn.speech("Ik kijk even.")
    item = await turn.tool_start("search_index", {"q": "x"}, label="Search index")
    await turn.tool_end(item, {"hits": []})
    await turn.speech("Gevonden.")
    await turn.finish()

    events = [e for e, _ in published]
    assert events[0] == "agent.turn" and published[0][1]["phase"] == "start"
    assert events[-1] == "agent.turn" and published[-1][1]["phase"] == "end"
    assert "agent.thinking" in events and "message.delta" in events
    activity = [d for e, d in published if e == "agent.activity"]
    assert [a["phase"] for a in activity] == ["start", "end", "start", "end"]
    assert activity[2]["item"]["kind"] == "work"
    assert "input" not in activity[2]["item"]

    # Pre-tool speech is its own segment; activity travels with the next bubble.
    assert [s["text"] for s in turn.segments] == ["Ik kijk even.", "Gevonden."]
    assert [a["kind"] for a in turn.segments[0]["activity"]] == ["think"]
    assert [a["kind"] for a in turn.segments[1]["activity"]] == ["work"]
    assert turn.segments[1]["activity"][0]["status"] == "ok"
    assert turn.final_text == "Gevonden."
    deltas = [d for e, d in published if e == "message.delta"]
    assert deltas[0]["segment_id"] != deltas[-1]["segment_id"]


@pytest.mark.asyncio
async def test_publish_turn_event_rejects_unknown():
    from app.gateway.publish import publish_turn_event

    published: list[tuple] = []

    async def capture(tenant_id, topics, event, data):
        published.append((event, data))

    with patch("app.gateway.publish.event_bus.publish", side_effect=capture):
        tid = __import__("uuid").uuid4()
        sid = __import__("uuid").uuid4()
        await publish_turn_event(tid, sid, "message.delta", {"delta": "Hi", "stream_id": "s1"})
        with pytest.raises(ValueError):
            await publish_turn_event(tid, sid, "agent.step", {})

    assert published[0][0] == "message.delta"
    assert published[0][1]["signal_id"] == str(sid)
    assert published[1][0] == "thread.presence"
    assert published[1][1]["phase"] == "writing"
    assert "delta" not in published[1][1] or not published[1][1].get("delta")


@pytest.mark.asyncio
async def test_chat_send_persists_error_reply(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    conv = await client.post("/api/signals/conversations", json={"title": "Error test"}, headers=headers)
    conv_id = conv.json()["id"]

    with patch(
        "app.services.agent.loop.AgentLoop.run_chat",
        new=AsyncMock(side_effect=RuntimeError("LLM down")),
    ):
        msg = await client.post(
            f"/api/signals/conversations/{conv_id}/messages",
            json={"content": "Hello"},
            headers=headers,
        )

    assert msg.status_code == 200
    body = msg.json()
    assert body["message"]["role"] == "assistant"
    assert body.get("error") is True

    listed = await client.get(f"/api/signals/conversations/{conv_id}/messages", headers=headers)
    payload = listed.json()
    items = payload["items"] if isinstance(payload, dict) else payload
    roles = [m["role"] for m in items]
    assert roles.count("assistant") >= 1


@pytest.mark.asyncio
async def test_chat_stream_sse(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    conv = await client.post("/api/signals/conversations", json={"title": "Stream test"}, headers=headers)
    conv_id = conv.json()["id"]

    async def fake_stream(self, messages, extra_context="", attachments=None, **kwargs):
        yield {"type": "delta", "text": "Streamed "}
        yield {"type": "delta", "text": "reply"}
        yield {"type": "done", "text": "Streamed reply", "usage": {"input_tokens": 1, "output_tokens": 2}}

    with patch("app.services.agent.loop.AgentLoop.stream_chat", new=fake_stream):
        async with client.stream(
            "POST",
            f"/api/signals/conversations/{conv_id}/stream",
            json={"content": "Stream please"},
            headers=headers,
        ) as resp:
            assert resp.status_code == 200
            chunks = []
            async for line in resp.aiter_lines():
                if line.startswith("data:"):
                    chunks.append(json.loads(line[5:].strip()))
            assert any("Streamed" in (c.get("text") or "") for c in chunks)


@pytest.mark.asyncio
async def test_wake_thread_stream_same_as_assistant(client: AsyncClient, session_override):
    """Ask on a scheduled wake (channel=internal) uses the same stream path."""
    from sqlalchemy import select

    from app.models.agent import Agent
    from app.models.auth import Tenant
    from app.models.signal import Signal
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.kind == "company").limit(1)
        )
    ).scalars().first()
    assert agent is not None

    wake = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="schedule",
        subject="Refresh canvas · test wake",
        agent_id=agent.id,
        status="open",
    )
    session_override.add(wake)
    await session_override.commit()
    await session_override.refresh(wake)

    async def fake_stream(self, messages, extra_context="", attachments=None, **kwargs):
        yield {"type": "delta", "text": "Wake ok"}
        yield {"type": "done", "text": "Wake ok", "usage": {}}

    with patch("app.services.agent.loop.AgentLoop.stream_chat", new=fake_stream):
        async with client.stream(
            "POST",
            f"/api/signals/conversations/{wake.id}/stream",
            json={"content": "Welke andere agents zijn er?"},
            headers=headers,
        ) as resp:
            assert resp.status_code == 200, await resp.aread()
            chunks = []
            async for line in resp.aiter_lines():
                if line.startswith("data:"):
                    chunks.append(json.loads(line[5:].strip()))
            assert any("Wake ok" in (c.get("text") or "") for c in chunks)


@pytest.mark.asyncio
async def test_chat_stream_broadcasts_agent_working_then_standby(client: AsyncClient):
    """Avatars pulse while Ask/chat runs: agent.status working, then standby."""
    from unittest.mock import AsyncMock

    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    conv = await client.post("/api/signals/conversations", json={"title": "Live status"}, headers=headers)
    conv_id = conv.json()["id"]

    async def fake_stream(self, messages, extra_context="", attachments=None, **kwargs):
        yield {"type": "delta", "text": "Hi"}
        yield {"type": "done", "text": "Hi", "usage": {}}

    pub = AsyncMock()
    with (
        patch("app.services.agent.loop.AgentLoop.stream_chat", new=fake_stream),
        patch("app.gateway.publish.publish_agent_status", new=pub),
    ):
        async with client.stream(
            "POST",
            f"/api/signals/conversations/{conv_id}/stream",
            json={"content": "Ping"},
            headers=headers,
        ) as resp:
            assert resp.status_code == 200
            async for _ in resp.aiter_lines():
                pass

    statuses = [call.kwargs.get("status") for call in pub.await_args_list]
    assert "working" in statuses
    assert statuses[-1] == "standby"


@pytest.mark.asyncio
async def test_stale_chat_run_is_reclaimed_before_busy(client: AsyncClient, session_override):
    """A dropped SSE left AgentRun=running; the next send must not 409 forever."""
    from datetime import datetime, timedelta

    from sqlalchemy import select

    from app.models.agent import Agent, AgentRun
    from app.models.auth import Tenant
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    conv = await client.post("/api/signals/conversations", json={"title": "Stale busy"}, headers=headers)
    conv_id = conv.json()["id"]

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))
    ).scalars().first()
    assert agent is not None
    stuck = AgentRun(
        tenant_id=tenant.id,
        agent_id=agent.id,
        trigger_type="chat",
        trigger_id=str(conv_id),
        status="running",
        subject="Stuck",
        started_at=datetime.utcnow() - timedelta(minutes=20),
    )
    session_override.add(stuck)
    await session_override.commit()

    async def fake_stream(self, messages, extra_context="", attachments=None, **kwargs):
        yield {"type": "delta", "text": "Ok"}
        yield {"type": "done", "text": "Ok", "usage": {}}

    with patch("app.services.agent.loop.AgentLoop.stream_chat", new=fake_stream):
        async with client.stream(
            "POST",
            f"/api/signals/conversations/{conv_id}/stream",
            json={"content": "Again"},
            headers=headers,
        ) as resp:
            assert resp.status_code == 200
            body = ""
            async for line in resp.aiter_lines():
                body += line
            assert "Ok" in body

    row = await _reload_run(session_override, stuck.id)
    assert row is not None
    assert row.status != "running"


@pytest.mark.asyncio
async def test_fresh_orphaned_chat_run_is_reclaimed_without_live_task(
    client: AsyncClient, session_override
):
    """API reload leaves a young running row with no in-process task — do not 409."""
    from datetime import datetime, timedelta

    from sqlalchemy import select

    from app.models.agent import Agent, AgentRun
    from app.models.auth import Tenant
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    conv = await client.post("/api/signals/conversations", json={"title": "Ghost busy"}, headers=headers)
    conv_id = conv.json()["id"]

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))
    ).scalars().first()
    assert agent is not None
    stuck = AgentRun(
        tenant_id=tenant.id,
        agent_id=agent.id,
        trigger_type="chat",
        trigger_id=str(conv_id),
        status="running",
        subject="Ghost",
        started_at=datetime.utcnow() - timedelta(seconds=30),
    )
    session_override.add(stuck)
    await session_override.commit()

    async def fake_stream(self, messages, extra_context="", attachments=None, **kwargs):
        yield {"type": "delta", "text": "Ok"}
        yield {"type": "done", "text": "Ok", "usage": {}}

    with patch("app.services.agent.loop.AgentLoop.stream_chat", new=fake_stream):
        async with client.stream(
            "POST",
            f"/api/signals/conversations/{conv_id}/stream",
            json={"content": "Again"},
            headers=headers,
        ) as resp:
            assert resp.status_code == 200
            body = ""
            async for line in resp.aiter_lines():
                body += line
            assert "Ok" in body

    row = await _reload_run(session_override, stuck.id)
    assert row is not None
    assert row.status != "running"


def test_operator_stream_persist_text_uses_done_not_empty_fallback():
    from app.routers.signal_chat import (
        _EMPTY_FALLBACK,
        _operator_stream_persist_text,
    )

    assert (
        _operator_stream_persist_text(stream_text="Done.", cancelled=False, loop=None)
        == "Done."
    )
    assert (
        _operator_stream_persist_text(stream_text="", cancelled=False, loop=None)
        == _EMPTY_FALLBACK
    )


def test_operator_stream_persist_text_tool_only_graceful():
    from app.routers.signal_chat import (
        _TOOL_ONLY_STREAM_FALLBACK,
        _operator_stream_persist_text,
    )
    from app.services.agent.turn import TurnRecorder

    turn = TurnRecorder(lambda *_: None, stream_id="s1")
    turn._pending = [
        {
            "id": "t1",
            "kind": "tool",
            "label": "Search index",
            "tool": "search_index",
            "provider": "",
            "started_at": None,
            "ended_at": None,
            "status": "ok",
        }
    ]
    from types import SimpleNamespace

    loop = SimpleNamespace(turn=turn)

    assert (
        _operator_stream_persist_text(stream_text="", cancelled=False, loop=loop)
        == _TOOL_ONLY_STREAM_FALLBACK
    )


@pytest.mark.asyncio
async def test_chat_turn_live_map_and_reclaim_rule():
    import asyncio
    from datetime import datetime, timedelta
    from uuid import uuid4

    from app.routers import signal_chat as sc

    cid = uuid4()
    assert sc._chat_turn_is_live(cid) is False
    assert sc._should_reclaim_chat_run(cid, datetime.utcnow()) is True

    async def sleeper():
        await asyncio.sleep(60)

    task = asyncio.create_task(sleeper())
    try:
        sc._track_chat_turn(cid, task)
        assert sc._chat_turn_is_live(cid) is True
        assert sc._should_reclaim_chat_run(cid, datetime.utcnow()) is False
        assert sc._should_reclaim_chat_run(cid, datetime.utcnow() - timedelta(minutes=20)) is True
        sc._cancel_live_chat_turn(cid)
        try:
            await task
        except asyncio.CancelledError:
            pass
        assert sc._chat_turn_is_live(cid) is False
        assert sc._should_reclaim_chat_run(cid, datetime.utcnow()) is True
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
