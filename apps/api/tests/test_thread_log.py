"""The ordered event log per conversation (services/thread_log.py)."""

from __future__ import annotations

import uuid

import pytest

from app.services import thread_log


@pytest.fixture(autouse=True)
def _fresh_log(monkeypatch):
    async def no_redis():
        return None

    monkeypatch.setattr(thread_log, "_redis", no_redis)
    thread_log.memory.reset()
    yield
    thread_log.memory.reset()


def _ids(events):
    return [e["data"]["event_id"] for e in events]


@pytest.mark.asyncio
async def test_append_numbers_events_and_chains_prev_id():
    tenant, sid = uuid.uuid4(), uuid.uuid4()
    first = await thread_log.append(tenant, sid, "agent.turn", {"stream_id": "t1", "phase": "start"})
    second = await thread_log.append(tenant, sid, "message.delta", {"stream_id": "t1", "delta": "Hoi"})
    assert first["prev_id"] == ""
    assert second["prev_id"] == first["event_id"]
    assert thread_log.parse_id(second["event_id"]) > thread_log.parse_id(first["event_id"])
    assert first["type"] == "turn.started"
    assert second["type"] == "item.delta"
    assert await thread_log.head(sid) == second["event_id"]


@pytest.mark.asyncio
async def test_turn_completed_carries_stop_reason_and_leaves_the_live_set():
    tenant, sid = uuid.uuid4(), uuid.uuid4()
    await thread_log.append(tenant, sid, "agent.turn", {"stream_id": "t1", "phase": "start"})
    assert len(await thread_log.live(sid)) == 1
    end = await thread_log.append(tenant, sid, "agent.turn", {"stream_id": "t1", "phase": "end", "outcome": "silent"})
    assert end["type"] == "turn.completed"
    assert end["stop_reason"] == "passed"
    assert await thread_log.live(sid) == []


@pytest.mark.asyncio
async def test_delta_after_turn_end_does_not_reopen_the_live_slot():
    """A late strip/rewrite after end_turn must not leave a ghost writing turn."""
    tenant, sid = uuid.uuid4(), uuid.uuid4()
    await thread_log.append(tenant, sid, "agent.turn", {"stream_id": "t1", "phase": "start"})
    await thread_log.append(tenant, sid, "message.delta", {"stream_id": "t1", "delta": "Hallo"})
    await thread_log.append(tenant, sid, "agent.turn", {"stream_id": "t1", "phase": "end"})
    assert await thread_log.live(sid) == []
    await thread_log.append(
        tenant,
        sid,
        "message.delta",
        {"stream_id": "t1", "delta": "", "surface": {"blocks": [{"type": "speech", "text": "Hallo"}]}},
    )
    assert await thread_log.live(sid) == []
    frames = await thread_log.sync_frames(sid, None)
    assert all(f.get("event") != "message.delta" for f in frames)


@pytest.mark.parametrize(
    ("outcome", "reason"),
    [(None, "end_turn"), ("silent", "passed"), ("cancelled", "cancelled"), ("superseded", "superseded"), ("error", "error")],
)
def test_stop_reason(outcome, reason):
    assert thread_log.stop_reason(outcome) == reason


@pytest.mark.asyncio
async def test_read_after_replays_in_order_from_a_cursor():
    tenant, sid = uuid.uuid4(), uuid.uuid4()
    rows = [
        await thread_log.append(tenant, sid, "message.delta", {"stream_id": "t1", "delta": str(i)}) for i in range(4)
    ]
    events, complete = await thread_log.read_after(sid, rows[1]["event_id"])
    assert complete is True
    assert _ids(events) == [rows[2]["event_id"], rows[3]["event_id"]]
    assert events[0]["data"]["prev_id"] == rows[1]["event_id"]


@pytest.mark.asyncio
async def test_sync_frames_without_cursor_sends_open_turns_and_floor():
    tenant, sid = uuid.uuid4(), uuid.uuid4()
    await thread_log.append(tenant, sid, "agent.turn", {"stream_id": "done", "phase": "start"})
    await thread_log.append(tenant, sid, "agent.turn", {"stream_id": "done", "phase": "end"})
    await thread_log.append(tenant, sid, "agent.turn", {"stream_id": "open", "phase": "start"})
    await thread_log.append(tenant, sid, "floor", {"active_turn": {"kind": "agent", "ref_id": "x"}})
    frames = await thread_log.sync_frames(sid, None)
    assert [f["event"] for f in frames] == ["agent.turn", "floor", "log.synced"]
    assert frames[0]["data"]["stream_id"] == "open"
    assert frames[-1]["data"]["head"] == await thread_log.head(sid)


@pytest.mark.asyncio
async def test_sync_frames_with_cursor_replays_then_marks_synced():
    tenant, sid = uuid.uuid4(), uuid.uuid4()
    first = await thread_log.append(tenant, sid, "agent.turn", {"stream_id": "t1", "phase": "start"})
    await thread_log.append(tenant, sid, "message.delta", {"stream_id": "t1", "delta": "x"})
    frames = await thread_log.sync_frames(sid, first["event_id"])
    assert [f["event"] for f in frames] == ["message.delta", "log.synced"]
    assert frames[-1]["data"]["complete"] is True


@pytest.mark.asyncio
async def test_close_open_turns_skips_fresh_and_kept_turns():
    tenant, sid = uuid.uuid4(), uuid.uuid4()
    await thread_log.append(tenant, sid, "agent.turn", {"stream_id": "old", "phase": "start", "ts": 1.0})
    await thread_log.append(tenant, sid, "agent.turn", {"stream_id": "fresh", "phase": "start"})
    await thread_log.append(tenant, sid, "agent.turn", {"stream_id": "kept", "phase": "start", "ts": 1.0})
    closed = await thread_log.close_open_turns(tenant, sid, older_than_s=60, keep={"kept"})
    assert [c["data"]["stream_id"] for c in closed] == ["old"]
    assert sorted(r["data"]["stream_id"] for r in await thread_log.live(sid)) == ["fresh", "kept"]
    events, _ = await thread_log.read_after(sid, "")
    assert events[-1]["data"]["stop_reason"] == "error"
