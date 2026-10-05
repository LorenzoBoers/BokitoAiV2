"""One agent turn as ordered speech segments with timed activity in between.

A turn looks like: activity (thinking, tool calls) -> speech -> activity ->
speech. Each speech segment becomes its own chat bubble; the activity that
happened before it travels with it (``metadata.activity``). Activity after the
last speech (rare) is kept as ``activity_after`` on the last segment.

Activity item shape (persisted and streamed):
``{id, kind: think|work|other, label, tool, provider, started_at, ended_at,
status: running|ok|error, input?, result?, text?}``

Gateway events (topic ``signal:{id}``):
- ``agent.turn``     ``{stream_id, phase: start|end}``
- ``agent.activity`` ``{stream_id, phase: start|end, item}``
- ``agent.thinking`` ``{stream_id, item_id, delta}``
- ``message.delta``  ``{stream_id, segment_id, delta}``
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from app.services.agent.turn_persist import slim_activity_item

Publisher = Callable[[str, dict[str, Any]], Awaitable[None]]

KIND_THINK = "think"
KIND_WORK = "work"
KIND_OTHER = "other"

# Tools that hand the conversation to a person or wait on one: "other" kind.
_OTHER_TOOLS = frozenset(
    {
        "handoff_to_human",
        "create_decision_request",
        "request_callback",
        "request_customer_verify",
        "delegate_to_agent",
        "continue_on_whatsapp",
    }
)

_MAX_THINK_CHARS = 4000
_MAX_PAYLOAD_CHARS = 480


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _compact(value: Any) -> Any:
    try:
        text = value if isinstance(value, str) else json.dumps(value, default=str)
    except Exception:  # noqa: BLE001
        text = str(value)
    if len(text) <= _MAX_PAYLOAD_CHARS:
        return value
    return f"{text[:_MAX_PAYLOAD_CHARS]}..."


def _is_error(result: Any) -> bool:
    if isinstance(result, dict):
        if result.get("error"):
            return True
        status = str(result.get("status") or "").lower()
        return status in ("error", "failed", "denied")
    return False


class TurnRecorder:
    def __init__(self, publish: Publisher | None = None, stream_id: str | None = None):
        self._publish = publish
        self.stream_id = stream_id or str(uuid.uuid4())
        self.segments: list[dict[str, Any]] = []
        self._pending: list[dict[str, Any]] = []
        self._think: dict[str, Any] | None = None
        self._speech_id: str | None = None
        self._speech_text = ""
        self.started = False

    async def _emit(self, event: str, data: dict[str, Any]) -> None:
        if self._publish is None:
            return
        await self._publish(event, {"stream_id": self.stream_id, **data})

    async def start(self) -> None:
        if self.started:
            return
        self.started = True
        await self._emit("agent.turn", {"phase": "start"})

    # -- thinking -----------------------------------------------------------

    async def thinking(self, delta: str) -> None:
        if not delta:
            return
        await self.start()
        if self._think is None:
            self._close_speech()
            self._think = {
                "id": f"think-{uuid.uuid4().hex[:10]}",
                "kind": KIND_THINK,
                "label": "",
                "started_at": _now(),
                "ended_at": None,
                "status": "running",
                "text": "",
            }
            self._pending.append(self._think)
            await self._emit("agent.activity", {"phase": "start", "item": self._public(self._think)})
        if len(self._think["text"]) < _MAX_THINK_CHARS:
            self._think["text"] = (self._think["text"] + delta)[:_MAX_THINK_CHARS]
        await self._emit("agent.thinking", {"item_id": self._think["id"], "delta": delta})

    async def _end_think(self) -> None:
        if self._think is None:
            return
        self._think["ended_at"] = _now()
        self._think["status"] = "ok"
        item = self._think
        self._think = None
        await self._emit("agent.activity", {"phase": "end", "item": self._public(item)})

    # -- speech -------------------------------------------------------------

    async def speech(self, delta: str) -> None:
        if not delta:
            return
        await self.start()
        await self._end_think()
        if self._speech_id is None:
            self._speech_id = f"seg-{uuid.uuid4().hex[:10]}"
        self._speech_text += delta
        await self._emit("message.delta", {"segment_id": self._speech_id, "delta": delta})

    @property
    def current_segment_id(self) -> str | None:
        return self._speech_id

    @property
    def has_open_speech(self) -> bool:
        return bool(self._speech_text.strip())

    def set_speech_text(self, text: str) -> None:
        """Non-streaming loops: one model response's text as a segment."""
        if not text.strip():
            return
        if self._speech_id is None:
            self._speech_id = f"seg-{uuid.uuid4().hex[:10]}"
        self._speech_text = text

    def _close_speech(self) -> None:
        text = self._speech_text.strip()
        if text and self._speech_id:
            self.segments.append({"id": self._speech_id, "text": text, "activity": self._pending})
            self._pending = []
        self._speech_id = None
        self._speech_text = ""

    # -- tools --------------------------------------------------------------

    async def tool_start(
        self,
        name: str,
        tool_input: Any,
        *,
        label: str = "",
        provider: str = "",
    ) -> dict[str, Any]:
        await self.start()
        await self._end_think()
        self._close_speech()
        item = {
            "id": f"tool-{uuid.uuid4().hex[:10]}",
            "kind": KIND_OTHER if name in _OTHER_TOOLS else KIND_WORK,
            "label": label or name,
            "tool": name,
            "provider": provider,
            "started_at": _now(),
            "ended_at": None,
            "status": "running",
            "input": _compact(tool_input),
        }
        self._pending.append(item)
        await self._emit("agent.activity", {"phase": "start", "item": self._public(item)})
        return item

    async def tool_end(self, item: dict[str, Any], result: Any) -> None:
        item["ended_at"] = _now()
        item["status"] = "error" if _is_error(result) else "ok"
        item["result"] = _compact(result)
        await self._emit("agent.activity", {"phase": "end", "item": self._public(item)})

    # -- finish -------------------------------------------------------------

    async def finish(self) -> None:
        await self._end_think()
        self._close_speech()
        if self._pending:
            if self.segments:
                self.segments[-1].setdefault("activity_after", []).extend(self._pending)
            else:
                self.segments.append({"id": f"seg-{uuid.uuid4().hex[:10]}", "text": "", "activity": self._pending})
            self._pending = []
        if self.started:
            await self._emit("agent.turn", {"phase": "end"})

    # -- views --------------------------------------------------------------

    @property
    def final_text(self) -> str:
        for seg in reversed(self.segments):
            if seg.get("text"):
                return seg["text"]
        return self._speech_text.strip()

    @property
    def full_text(self) -> str:
        """Every speech segment joined (chat mode keeps them as separate bubbles)."""
        return "\n\n".join(s["text"] for s in self.segments if s.get("text"))

    def all_activity(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for seg in self.segments:
            items.extend(seg.get("activity") or [])
            items.extend(seg.get("activity_after") or [])
        items.extend(self._pending)
        return items

    def tool_names(self) -> list[str]:
        return [i.get("tool", "") for i in self.all_activity() if i.get("tool")]

    @staticmethod
    def _public(item: dict[str, Any]) -> dict[str, Any]:
        """Streamed shape: no long payloads (expanded detail comes from the saved message)."""
        return slim_activity_item(item)
