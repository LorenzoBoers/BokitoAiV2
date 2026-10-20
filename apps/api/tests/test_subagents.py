"""Subagents: spawn, limits, depth, messages, resume, parent wake, thread row."""

import json

import pytest
from sqlalchemy import select

from app.models.agent import Agent, AgentRun
from app.models.agent_context import SubagentMessage
from app.models.agent_turn import AgentTurn
from app.models.auth import Tenant
from app.models.signal import Signal, SignalMessage
from app.services import subagents
from app.services.agent.loop import AgentLoop, _append_user_text
from app.tools.registry import ToolContext


@pytest.fixture
def fake_run_chat(monkeypatch):
    seen: list[dict] = []

    async def _run_chat(self, messages, extra_context="", attachments=None):
        seen.append({"messages": messages, "extra": extra_context, "tools": [t["name"] for t in self.tools]})
        return f"Result for: {messages[-1]['content']}", {"input_tokens": 7, "output_tokens": 3}

    monkeypatch.setattr(AgentLoop, "run_chat", _run_chat)
    return seen


async def _setup(session, **tenant_settings):
    tenant = (await session.execute(select(Tenant))).scalars().first()
    if tenant_settings:
        tenant.settings_json = json.dumps(tenant_settings)
        session.add(tenant)
    agent = (await session.execute(select(Agent).where(Agent.slug == "assistant"))).scalar_one()
    signal = Signal(tenant_id=tenant.id, channel="assistant", subject="Work")
    session.add(signal)
    await session.commit()
    ctx = ToolContext(session=session, tenant_id=tenant.id, user_id=None, agent=agent, signal_id=signal.id)
    return tenant, agent, signal, ctx


async def _finish(run_id: str) -> None:
    from uuid import UUID

    task = subagents._LOCAL_TASKS.get(UUID(run_id))
    if task is not None:
        await task


@pytest.mark.asyncio
async def test_background_spawn_runs_posts_row_and_wakes_parent(client, session_override, fake_run_chat):
    _, agent, signal, ctx = await _setup(session_override)
    started = await subagents.spawn(ctx, {"prompt": "Count the open tickets", "description": "Count tickets"})
    assert started["status"] == "running", started
    await _finish(started["run_id"])

    run = await session_override.get(AgentRun, __import__("uuid").UUID(started["run_id"]))
    await session_override.refresh(run)
    assert (run.status, run.run_role, run.stop_reason) == ("completed", "delegate", "end_turn")
    assert "Count the open tickets" in json.loads(run.result_json)["text"]
    # The child does not get the subagent tools (max depth 1) and gets the subagent brief.
    assert "spawn_subagent" not in fake_run_chat[0]["tools"]
    assert "You are a subagent" in fake_run_chat[0]["extra"]

    row = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.signal_id == signal.id, SignalMessage.kind == "system_event")
        )
    ).scalar_one()
    meta = json.loads(row.metadata_json)
    assert meta["kind"] == "subagent" and meta["status"] == "completed"

    wake = (
        await session_override.execute(select(AgentTurn).where(AgentTurn.signal_id == signal.id))
    ).scalar_one()
    assert (wake.cause_kind, wake.agent_id) == ("subagent_result", agent.id)
    assert "Count the open tickets" in wake.prompt

    out = await subagents.output(ctx, {"run_id": started["run_id"]})
    assert out["status"] == "completed"


@pytest.mark.asyncio
async def test_foreground_returns_result_without_waking(client, session_override, fake_run_chat):
    _, _, signal, ctx = await _setup(session_override)
    done = await subagents.spawn(
        ctx, {"prompt": "Summarize", "description": "Summary", "run_in_background": False}
    )
    assert done["status"] == "completed" and done["result"].startswith("Result for")
    turns = (await session_override.execute(select(AgentTurn).where(AgentTurn.signal_id == signal.id))).all()
    assert turns == []


@pytest.mark.asyncio
async def test_concurrency_limit_queue_and_fail(client, session_override, fake_run_chat):
    tenant, agent, signal, ctx = await _setup(session_override, subagents={"max_concurrent": 0, "limit_behavior": "fail"})
    assert subagents.limits(tenant)["max_concurrent"] == 1
    session_override.add(
        AgentRun(tenant_id=tenant.id, agent_id=agent.id, run_role="delegate", status="running", signal_id=signal.id)
    )
    await session_override.commit()
    refused = await subagents.spawn(ctx, {"prompt": "x", "description": "x"})
    assert refused["error"] == "QuotaExceeded"

    tenant.settings_json = json.dumps({"subagents": {"max_concurrent": 1}})
    session_override.add(tenant)
    await session_override.commit()
    queued = await subagents.spawn(ctx, {"prompt": "x", "description": "x"})
    assert queued["status"] == "queued"


@pytest.mark.asyncio
async def test_child_cannot_spawn(client, session_override, fake_run_chat):
    tenant, agent, signal, ctx = await _setup(session_override)
    child = AgentRun(tenant_id=tenant.id, agent_id=agent.id, run_role="delegate", status="running")
    session_override.add(child)
    await session_override.commit()
    ctx.run_id = child.id
    refused = await subagents.spawn(ctx, {"prompt": "x", "description": "x"})
    assert refused["status"] == "denied" and "max depth 1" in refused["error"]


@pytest.mark.asyncio
async def test_resume_from_only_completed_same_agent(client, session_override, fake_run_chat):
    tenant, agent, signal, ctx = await _setup(session_override)
    other = (await session_override.execute(select(Agent).where(Agent.slug == "orchestra"))).scalar_one()
    foreign = AgentRun(tenant_id=tenant.id, agent_id=other.id, run_role="delegate", status="completed")
    running = AgentRun(tenant_id=tenant.id, agent_id=agent.id, run_role="delegate", status="running")
    done = AgentRun(
        tenant_id=tenant.id,
        agent_id=agent.id,
        run_role="delegate",
        status="completed",
        checkpoint_json=json.dumps([{"role": "user", "content": "first"}, {"role": "assistant", "content": "one"}]),
    )
    session_override.add_all([foreign, running, done])
    await session_override.commit()
    for bad in (foreign, running):
        assert "resume_from" in (await subagents.spawn(ctx, {"prompt": "x", "description": "x", "resume_from": str(bad.id)}))["error"]
    resumed = await subagents.spawn(
        ctx, {"prompt": "second", "description": "x", "resume_from": str(done.id), "run_in_background": False}
    )
    assert resumed["status"] == "completed"
    assert [m["content"] for m in fake_run_chat[-1]["messages"]] == ["first", "one", "second"]


@pytest.mark.asyncio
async def test_messages_quota_and_delivery_order(client, session_override):
    tenant, agent, signal, ctx = await _setup(session_override)
    child = AgentRun(
        tenant_id=tenant.id,
        agent_id=agent.id,
        run_role="delegate",
        status="running",
        runtime_snapshot_json=json.dumps({"parent_agent_id": str(agent.id)}),
    )
    session_override.add(child)
    await session_override.commit()
    ctx.turn_id = "turn-1"

    assert (await subagents.send_message(ctx, {"run_id": str(child.id), "message": "a", "delivery": "bogus"}))["error"]
    await subagents.send_message(ctx, {"run_id": str(child.id), "message": "steer one"})
    await subagents.send_message(ctx, {"run_id": str(child.id), "message": "interject", "delivery": "interject"})
    await subagents.send_message(ctx, {"run_id": str(child.id), "message": "later", "delivery": "queue"})
    await subagents.send_message(ctx, {"run_id": str(child.id), "message": "steer two"})
    over = await subagents.send_message(ctx, {"run_id": str(child.id), "message": "fifth"})
    assert over["error"] == "QuotaExceeded"

    bodies = await subagents.take_messages(session_override, child.id, deliveries=("interject", "steer"))
    assert bodies == ["interject", "steer one", "steer two"]
    left = (await session_override.execute(select(SubagentMessage).where(SubagentMessage.status == "pending"))).scalars().all()
    assert [m.body for m in left] == ["later"]

    messages = [{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": "{}"}]}]
    _append_user_text(messages, subagents.reminder(bodies))
    assert len(messages) == 1 and messages[0]["content"][-1]["type"] == "text"


@pytest.mark.asyncio
async def test_kill_and_ownership(client, session_override):
    tenant, agent, signal, ctx = await _setup(session_override)
    other = (await session_override.execute(select(Agent).where(Agent.slug == "orchestra"))).scalar_one()
    mine = AgentRun(
        tenant_id=tenant.id, agent_id=agent.id, run_role="delegate", status="running",
        runtime_snapshot_json=json.dumps({"parent_agent_id": str(agent.id)}),
    )
    theirs = AgentRun(
        tenant_id=tenant.id, agent_id=agent.id, run_role="delegate", status="running",
        runtime_snapshot_json=json.dumps({"parent_agent_id": str(other.id)}),
    )
    session_override.add_all([mine, theirs])
    await session_override.commit()
    assert "not started by you" in (await subagents.kill(ctx, {"run_id": str(theirs.id)}))["error"]
    killed = await subagents.kill(ctx, {"run_id": str(mine.id)})
    assert killed["status"] == "cancelled"
    await session_override.refresh(mine)
    assert mine.stop_reason == "user_interrupt"


@pytest.mark.asyncio
async def test_transcript_endpoint(client, session_override, fake_run_chat):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    _, _, signal, ctx = await _setup(session_override)
    done = await subagents.spawn(ctx, {"prompt": "Look", "description": "Look", "run_in_background": False})
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    res = await client.get(f"/api/signals/{signal.id}/subagents/{done['run_id']}", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "completed"
    missing = await client.get(f"/api/signals/{signal.id}/subagents/{__import__('uuid').uuid4()}", headers=headers)
    assert missing.status_code == 404
