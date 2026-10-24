"""One ordered event stream per conversation.

Everything an operator client draws while agents work goes through
:func:`append`: the turn events of ``TurnRecorder``, saved messages and the
floor. Each event gets an ``event_id`` that only grows, and the ``prev_id`` of
the event before it on the same conversation. A client applies events in id
order, skips ids it has seen, and asks for a replay (``sync`` frame on the
gateway) when ``prev_id`` is not the last id it applied.

Wire names stay the gateway event names older clients read (``agent.turn``,
``message.delta``, ...). ``type`` is the normalized name:

- ``turn.started``    ``{stream_id, author}``
- ``item.created``    ``{stream_id, item_kind: speech|thought|tool, item_id, seq?}``
- ``item.delta``      ``{stream_id, item_id, delta}``
- ``item.updated``    ``{stream_id, item_id, item?|text?}``
- ``turn.completed``  ``{stream_id, stop_reason: end_turn|passed|cancelled|superseded|error}``
- ``message.saved``   ``{message}`` the stored bubble; ``payload.turn_id`` and
  ``payload.segment_id`` name the live turn and speech item it replaces
- ``floor.changed``   ``{active_turn}`` who holds or waits for the turn

Every turn event carries ``surface``: the whole live turn as the API renders
it. Replaying one event of a turn is enough to draw that turn.

Invariants:
- The server is the only place that issues ids.
- Every ``turn.started`` is followed by exactly one ``turn.completed``; a turn
  whose worker died is closed by :func:`close_open_turns` with ``error``.
- No placeholder rows: an open turn lives here, never as a thread message.

Storage is a Redis Stream per conversation (``MAXLEN ~5000``, 48 h TTL) plus a
hash with the last event of every open turn and the floor, for a cold start.
Without Redis (dev, tests) one in-process store keeps the same interface.
"""

from __future__ import annotations

import json
import logging
import time
from collections import OrderedDict
from typing import Any

logger = logging.getLogger(__name__)

MAX_LEN = 5000
TTL_S = 48 * 3600
MAX_REPLAY = 2000
FLOOR_KEY = "floor"

TURN_EVENTS = frozenset(
    {"agent.turn", "agent.activity", "agent.thinking", "message.start", "message.delta", "message.part"}
)

_APPEND = """
local last = redis.call('XREVRANGE', KEYS[1], '+', '-', 'COUNT', 1)
local prev = ''
if last[1] then prev = last[1][1] end
local id = redis.call('XADD', KEYS[1], 'MAXLEN', '~', ARGV[2], '*', 'e', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return {id, prev}
"""


def _stream_key(signal_id: Any) -> str:
    return f"bokito:tlog:{signal_id}"


def _live_key(signal_id: Any) -> str:
    return f"bokito:tlog:{signal_id}:live"


def parse_id(event_id: str | None) -> tuple[int, int]:
    """``"<ms>-<n>"`` as a sortable pair. Empty is before everything."""
    if not event_id:
        return (-1, -1)
    head, _, tail = str(event_id).partition("-")
    try:
        return (int(head), int(tail or 0))
    except ValueError:
        return (-1, -1)


def event_type(event: str, data: dict[str, Any]) -> str:
    """The normalized name of a gateway event."""
    phase = data.get("phase")
    if event == "agent.turn":
        return "turn.completed" if phase == "end" else "turn.started"
    if event == "agent.activity":
        return "item.updated" if phase == "end" else "item.created"
    if event in ("agent.thinking", "message.delta"):
        return "item.delta"
    if event == "message.start":
        return "item.created"
    if event == "message.part":
        return "item.updated"
    if event == "message":
        return "message.saved"
    if event == "floor":
        return "floor.changed"
    return event


def stop_reason(outcome: str | None) -> str:
    return {
        "silent": "passed",
        "passed": "passed",
        "cancelled": "cancelled",
        "superseded": "superseded",
        "error": "error",
    }.get(str(outcome or ""), "end_turn")


class _MemoryLog:
    """Same interface as the Redis store, for one process."""

    def __init__(self) -> None:
        self._streams: dict[str, list[tuple[str, str]]] = {}
        self._live: dict[str, OrderedDict[str, str]] = {}
        self._counter = 0

    def reset(self) -> None:
        self._streams.clear()
        self._live.clear()

    def append(self, signal_id: str, blob: str) -> tuple[str, str]:
        rows = self._streams.setdefault(signal_id, [])
        self._counter += 1
        event_id = f"{int(time.time() * 1000)}-{self._counter}"
        prev = rows[-1][0] if rows else ""
        rows.append((event_id, blob))
        if len(rows) > MAX_LEN:
            del rows[: len(rows) - MAX_LEN]
        return event_id, prev

    def after(self, signal_id: str, cursor: str, limit: int) -> tuple[list[tuple[str, str]], bool]:
        rows = self._streams.get(signal_id, [])
        if not rows:
            return [], True
        floor = parse_id(cursor)
        complete = not cursor or parse_id(rows[0][0]) <= floor or len(rows) < MAX_LEN
        out = [row for row in rows if parse_id(row[0]) > floor]
        if len(out) > limit:
            return out[:limit], False
        return out, complete

    def head(self, signal_id: str) -> str:
        rows = self._streams.get(signal_id, [])
        return rows[-1][0] if rows else ""

    def live_set(self, signal_id: str, key: str, blob: str | None) -> None:
        live = self._live.setdefault(signal_id, OrderedDict())
        if blob is None:
            live.pop(key, None)
        else:
            live[key] = blob

    def live_all(self, signal_id: str) -> dict[str, str]:
        return dict(self._live.get(signal_id, {}))


memory = _MemoryLog()


async def _redis() -> Any:
    from app.gateway.bus import event_bus

    return await event_bus.redis()


def _live_slot(event: str, data: dict[str, Any]) -> str | None:
    if event == "floor":
        return FLOOR_KEY
    if event in TURN_EVENTS and data.get("stream_id"):
        return str(data["stream_id"])
    return None


async def _store(signal_id: str, event: str, topics: list[str], data: dict[str, Any]) -> tuple[str, str]:
    blob = json.dumps({"event": event, "topics": topics, "data": data}, default=str)
    redis = await _redis()
    if redis is None:
        return memory.append(signal_id, blob)
    try:
        event_id, prev = await redis.eval(_APPEND, 1, _stream_key(signal_id), blob, MAX_LEN, TTL_S)
    except Exception:  # noqa: BLE001
        logger.warning("thread log append failed on redis; using memory", exc_info=True)
        return memory.append(signal_id, blob)
    as_text = lambda value: value.decode() if isinstance(value, bytes) else str(value or "")  # noqa: E731
    return as_text(event_id), as_text(prev)


async def _set_live(signal_id: str, slot: str, record: dict[str, Any] | None) -> None:
    blob = json.dumps(record, default=str) if record is not None else None
    redis = await _redis()
    if redis is None:
        memory.live_set(signal_id, slot, blob)
        return
    try:
        if blob is None:
            await redis.hdel(_live_key(signal_id), slot)
        else:
            await redis.hset(_live_key(signal_id), slot, blob)
            await redis.expire(_live_key(signal_id), TTL_S)
    except Exception:  # noqa: BLE001
        logger.debug("thread log live write failed", exc_info=True)


async def _live_has(signal_id: str, slot: str) -> bool:
    """True when this turn (or floor) is still in the cold-start live hash."""
    redis = await _redis()
    if redis is None:
        return slot in memory.live_all(signal_id)
    try:
        return bool(await redis.hexists(_live_key(signal_id), slot))
    except Exception:  # noqa: BLE001
        logger.debug("thread log live has failed", exc_info=True)
        return slot in memory.live_all(signal_id)


async def append(
    tenant_id: Any,
    signal_id: Any,
    event: str,
    data: dict[str, Any],
    *,
    topics: list[str] | None = None,
) -> dict[str, Any]:
    """Number ``event``, store it, and publish it. Returns the published data."""
    from app.gateway.bus import event_bus

    sid = str(signal_id)
    topics = topics or [f"signal:{sid}"]
    payload = {"signal_id": sid, **data, "type": event_type(event, data)}
    if payload["type"] == "turn.completed":
        payload.setdefault("stop_reason", stop_reason(payload.get("outcome")))
    payload.setdefault("ts", time.time())
    event_id, prev = await _store(sid, event, topics, payload)
    payload["event_id"] = event_id
    payload["prev_id"] = prev
    slot = _live_slot(event, payload)
    if slot is not None:
        kind = payload["type"]
        # turn.completed clears the slot. A late message.delta after that must
        # not reopen it: reload would then re-stream a finished reply forever.
        if kind == "turn.completed":
            await _set_live(sid, slot, None)
        elif kind == "turn.started" or event == "floor":
            await _set_live(sid, slot, {"event": event, "topics": topics, "data": payload})
        elif await _live_has(sid, slot):
            await _set_live(sid, slot, {"event": event, "topics": topics, "data": payload})
    try:
        await event_bus.publish(tenant_id, topics, event, payload)
    except Exception:  # noqa: BLE001
        logger.exception("thread log publish failed: %s", event)
    return payload


def _decode(event_id: str, prev: str, blob: str) -> dict[str, Any] | None:
    try:
        row = json.loads(blob)
    except (TypeError, ValueError):
        return None
    data = row.get("data") if isinstance(row.get("data"), dict) else {}
    return {
        "event": row.get("event"),
        "topics": row.get("topics") or [],
        "data": {**data, "event_id": event_id, "prev_id": prev},
    }


async def head(signal_id: Any) -> str:
    sid = str(signal_id)
    redis = await _redis()
    if redis is None:
        return memory.head(sid)
    try:
        rows = await redis.xrevrange(_stream_key(sid), count=1)
    except Exception:  # noqa: BLE001
        logger.debug('thread log redis head failed', exc_info=True)
        return memory.head(sid)
    if not rows:
        return ""
    raw = rows[0][0]
    return raw.decode() if isinstance(raw, bytes) else str(raw)


async def read_after(signal_id: Any, cursor: str, limit: int = MAX_REPLAY) -> tuple[list[dict[str, Any]], bool]:
    """Events after ``cursor``, oldest first. ``complete`` is False when some were trimmed."""
    sid = str(signal_id)
    redis = await _redis()
    rows: list[tuple[str, str]]
    complete = True
    if redis is None:
        rows, complete = memory.after(sid, cursor, limit)
    else:
        try:
            raw = await redis.xrange(_stream_key(sid), min=f"({cursor}" if cursor else "-", count=limit + 1)
            rows = []
            for event_id, fields in raw:
                key = event_id.decode() if isinstance(event_id, bytes) else str(event_id)
                blob = fields.get(b"e") if b"e" in fields else fields.get("e")
                rows.append((key, blob.decode() if isinstance(blob, bytes) else str(blob or "")))
            if len(rows) > limit:
                rows, complete = rows[:limit], False
            if cursor and rows:
                first = await redis.xrange(_stream_key(sid), count=1)
                if first:
                    oldest = first[0][0].decode() if isinstance(first[0][0], bytes) else str(first[0][0])
                    complete = complete and parse_id(oldest) <= parse_id(cursor)
        except Exception:  # noqa: BLE001
            logger.debug("thread log read failed", exc_info=True)
            return [], False
    out: list[dict[str, Any]] = []
    prev = cursor or ""
    for event_id, blob in rows:
        decoded = _decode(event_id, prev, blob)
        prev = event_id
        if decoded is not None:
            out.append(decoded)
    return out, complete


async def live(signal_id: Any) -> list[dict[str, Any]]:
    """The last event of every open turn and the floor, oldest turn first."""
    sid = str(signal_id)
    redis = await _redis()
    raw: dict[Any, Any]
    if redis is None:
        raw = memory.live_all(sid)
    else:
        try:
            raw = await redis.hgetall(_live_key(sid))
        except Exception:  # noqa: BLE001
            logger.debug('thread log redis live_all failed', exc_info=True)
            raw = memory.live_all(sid)
    out: list[dict[str, Any]] = []
    for value in raw.values():
        try:
            record = json.loads(value.decode() if isinstance(value, bytes) else value)
        except (TypeError, ValueError):
            continue
        if isinstance(record, dict) and isinstance(record.get("data"), dict):
            out.append(record)
    out.sort(key=lambda record: parse_id(str(record["data"].get("event_id") or "")))
    return out


async def close_open_turns(
    tenant_id: Any,
    signal_id: Any,
    *,
    reason: str = "error",
    older_than_s: float | None = None,
    keep: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Send ``turn.completed`` for open turns whose writer is gone. Returns their last events."""
    closed: list[dict[str, Any]] = []
    now = time.time()
    for record in await live(signal_id):
        if record.get("event") == "floor":
            continue
        data = record["data"]
        stream_id = str(data.get("stream_id") or "")
        if not stream_id or (keep and stream_id in keep):
            continue
        if older_than_s is not None and now - float(data.get("ts") or 0) < older_than_s:
            continue
        end: dict[str, Any] = {"stream_id": stream_id, "phase": "end", "outcome": reason, "status": None}
        if data.get("author"):
            end["author"] = data["author"]
        await append(tenant_id, signal_id, "agent.turn", {**end, "audience": "operator"})
        closed.append(record)
    return closed


async def sync_frames(signal_id: Any, after: str | None) -> list[dict[str, Any]]:
    """Gateway frames for a client that (re)joins: a replay, or the open turns."""
    sid = str(signal_id)
    topic = f"signal:{sid}"
    frames: list[dict[str, Any]] = []
    if after:
        events, complete = await read_after(sid, after)
        frames.extend(events)
        end = events[-1]["data"]["event_id"] if events else after
        frames.append(
            {"event": "log.synced", "topics": [topic], "data": {"signal_id": sid, "head": end, "complete": complete}}
        )
        return frames
    current = await head(sid)
    frames.extend(await live(sid))
    frames.append(
        {"event": "log.synced", "topics": [topic], "data": {"signal_id": sid, "head": current, "complete": True}}
    )
    return frames
