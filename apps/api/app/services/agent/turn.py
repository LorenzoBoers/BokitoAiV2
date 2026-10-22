"""One agent turn as ordered speech segments with timed activity in between.

A turn looks like: activity (thinking, tool calls) -> speech -> activity ->
speech. Each speech segment becomes its own chat bubble; the activity that
happened before it travels with it (``metadata.activity``). Activity after the
last speech (rare) is kept as ``activity_after`` on the last segment.

Activity item shape (persisted and streamed):
``{id, kind: think|work|other, label, tool, provider, started_at, ended_at,
status: running|ok|error, input?, result?, text?}``

Gateway events (topic ``signal:{id}``), numbered by ``services/thread_log``:
- ``agent.turn``     ``{stream_id, phase: start|end, stop_reason?}``
- ``agent.activity`` ``{stream_id, phase: start|end, item}``
- ``agent.thinking`` ``{stream_id, item_id, delta}``
- ``message.start``  ``{stream_id, segment_id, seq}`` a bubble opens at its place in the thread
- ``message.delta``  ``{stream_id, segment_id, seq, delta}``
- ``message.part``   ``{stream_id, segment_id, seq, text}`` full bubble when a split rewrites it
- ``thread.presence`` same moments, one envelope (thinking/working/writing/idle).
  Typing for WhatsApp or teammates uses this event too; it is never a row.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from app.services.agent.turn_persist import slim_activity_item

Publisher = Callable[[str, dict[str, Any]], Awaitable[None]]
SeqReserver = Callable[[], Awaitable[int | None]]


def _surface_without_think_text(surface: dict[str, Any]) -> dict[str, Any]:
    """Speech events are visible to visitors. Reasoning stays on the operator socket."""
    blocks: list[dict[str, Any]] = []
    for block in surface.get("blocks") or []:
        if block.get("type") != "activity":
            blocks.append(block)
            continue
        items: list[dict[str, Any]] = []
        for item in block.get("items") or []:
            if item.get("kind") == "think" and item.get("text"):
                item = {key: value for key, value in item.items() if key != "text"}
                item["has_text"] = True
            items.append(item)
        blocks.append({**block, "items": items})
    return {**surface, "blocks": blocks}

KIND_THINK = "think"
KIND_WORK = "work"
KIND_OTHER = "other"

def _raises_proposal(name: str) -> bool:
    """Tools whose call ends in an approval the operator answers inline."""
    if name in ("propose_action", "create_decision_request"):
        return True
    from app.tools.registry import get_tool_spec

    spec = get_tool_spec(name)
    return bool(spec and getattr(spec, "consequential", False))


# Tools that hand the conversation to a person or wait on one: "other" kind.
_OTHER_TOOLS = frozenset(
    {
        "handoff_to_human",
        "create_decision_request",
        "propose_action",
        "attach_items",
        "update_progress",
        "list_tags",
        "request_callback",
        "request_customer_verify",
        "spawn_subagent",
        "continue_on_whatsapp",
    }
)

_MAX_THINK_CHARS = 4000
_MAX_PAYLOAD_CHARS = 480


_MENTION = re.compile(r"@\[([^\]]+)\]\([^)]*\)")
_NON_WORD = re.compile(r"[^\w]+", re.UNICODE)


def _normalized_line(text: str) -> str:
    plain = _MENTION.sub(r"\1", text or "")
    return " ".join(_NON_WORD.sub(" ", plain.lower()).split())


PASS_WORDS = ("pass", "i pass", "skip")


def is_pass(text: str) -> bool:
    """The agent's way to stay silent. Such a turn has no bubble."""
    return _normalized_line(text) in PASS_WORDS


def may_be_pass(text: str) -> bool:
    """True while the text so far could still become the pass word."""
    line = _normalized_line(text)
    return bool(line) and any(word.startswith(line) for word in PASS_WORDS)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _activity_input(tool: str, tool_input: Any) -> Any:
    """Drop the spoken request from the trail. It is its own chat bubble."""
    if tool not in ("ask_agent", "handoff_to"):
        return tool_input
    if not isinstance(tool_input, dict):
        return tool_input
    return {key: value for key, value in tool_input.items() if key not in ("question", "brief")}


def _compact(value: Any) -> Any:
    try:
        text = value if isinstance(value, str) else json.dumps(value, default=str)
    except Exception:  # noqa: BLE001
        text = str(value)
    if len(text) <= _MAX_PAYLOAD_CHARS:
        return value
    return f"{text[:_MAX_PAYLOAD_CHARS]}..."


def _activity_result(tool: str, result: Any) -> Any:
    """Keep activity payloads small but keep fields the UI needs (e.g. favicons)."""
    if tool in ("ask_agent", "handoff_to") and isinstance(result, dict):
        return {key: result[key] for key in ("ok", "error", "agent_id", "agent_name") if key in result}
    if tool == "web_search" and isinstance(result, dict):
        rows: list[dict[str, Any]] = []
        kind = str(result.get("kind") or "web")[:20]
        for row in result.get("results") or []:
            if not isinstance(row, dict):
                continue
            entry = {
                "host": str(row.get("host") or "")[:120],
                "favicon_url": str(row.get("favicon_url") or "")[:240],
                "title": str(row.get("title") or "")[:80],
                "url": str(row.get("url") or "")[:240],
            }
            # Image hits need the CDN url so attach_items / UI can show them.
            if kind == "images":
                image = str(row.get("image_url") or row.get("url") or "")[:400]
                if image:
                    entry["image_url"] = image
            rows.append(entry)
            if len(rows) >= 3:
                break
        slim: dict[str, Any] = {
            "query": str(result.get("query") or "")[:200],
            "kind": kind,
            "count": result.get("count") if isinstance(result.get("count"), int) else len(rows),
            "results": rows,
        }
        if result.get("error"):
            slim["error"] = str(result.get("error"))[:120]
            if result.get("message"):
                slim["message"] = str(result.get("message"))[:200]
        return slim
    if tool == "invite_to_thread" and isinstance(result, dict):
        turn = result.get("turn") if isinstance(result.get("turn"), dict) else {}
        slim = {
            "ok": bool(result.get("ok")),
            "kind": str(result.get("kind") or "")[:20],
            "ref_id": str(result.get("ref_id") or "")[:80],
            "name": str(result.get("name") or turn.get("agent_name") or "")[:80],
        }
        if result.get("error"):
            slim["error"] = str(result["error"])[:120]
        return slim
    if tool == "fetch_url" and isinstance(result, dict):
        slim = {
            "url": str(result.get("url") or "")[:240],
            "host": str(result.get("host") or "")[:120],
            "title": str(result.get("title") or "")[:120],
            "chars": result.get("chars") if isinstance(result.get("chars"), int) else None,
            "truncated": bool(result.get("truncated")),
        }
        if result.get("error"):
            slim["error"] = str(result.get("error"))[:120]
            if result.get("message"):
                slim["message"] = str(result.get("message"))[:200]
        elif result.get("markdown"):
            # Keep a short preview in the trail; full text stayed in the tool result for the model.
            md = str(result.get("markdown") or "")
            slim["markdown_preview"] = md[:400] + ("…" if len(md) > 400 else "")
        return slim
    if isinstance(result, dict) and isinstance(result.get("items"), list):
        # Keep enough to rebuild showcase cards if the in-memory stash is lost
        # (attach_items and tools that showcase a thing they just created).
        rows: list[dict[str, Any]] = []
        for row in result.get("items") or []:
            if not isinstance(row, dict):
                continue
            rows.append(
                {
                    "type": str(row.get("type") or "")[:40],
                    "id": str(row.get("id") or "")[:400],
                    "title": str(row.get("title") or "")[:80],
                    "subtitle": str(row.get("subtitle") or "")[:80],
                    "path": str(row.get("path") or "")[:240],
                    "url": str(row.get("url") or "")[:400],
                    "image_url": str(row.get("image_url") or row.get("url") or "")[:400],
                }
            )
            if len(rows) >= 12:
                break
        slim: dict[str, Any] = {"items": rows}
        if tool == "attach_items":
            slim["ok"] = bool(result.get("ok", True))
            slim["attached"] = (
                result.get("attached") if isinstance(result.get("attached"), int) else len(rows)
            )
        elif tool == "list_folders" and isinstance(result.get("folders"), list):
            slim["count"] = len(result["folders"])
        elif tool == "list_agents" and isinstance(result.get("count"), int):
            slim["count"] = result["count"]
        # Keep decision ids so the UI can hold the card until speech finishes.
        for key in ("decision_request_id", "decision_id"):
            if result.get(key):
                slim[key] = str(result[key])[:80]
        return slim
    if tool == "list_tags" and isinstance(result, dict):
        tags: list[dict[str, Any]] = []
        for row in result.get("tags") or []:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            tags.append(
                {
                    "id": str(row.get("id") or "")[:40],
                    "name": name[:80],
                    "kind": str(row.get("kind") or "")[:20],
                }
            )
            if len(tags) >= 24:
                break
        return {"tags": tags, "count": len(tags)}
    if isinstance(result, dict):
        compact = _compact(result)
        if isinstance(compact, dict):
            for key in ("decision_request_id", "decision_id"):
                if result.get(key):
                    compact[key] = str(result[key])[:80]
        return compact
    return _compact(result)


def _is_error(result: Any) -> bool:
    if isinstance(result, dict):
        if result.get("error"):
            return True
        status = str(result.get("status") or "").lower()
        return status in ("error", "failed", "denied", "timeout", "invalid")
    return False


class TurnRecorder:
    def __init__(
        self,
        publish: Publisher | None = None,
        stream_id: str | None = None,
        reserve_seq: SeqReserver | None = None,
        author: dict[str, Any] | None = None,
    ):
        self._publish = publish
        self._reserve_seq = reserve_seq
        # Who speaks. Every event carries it, so a client never borrows the
        # name of whoever holds the floor next.
        self.author = author
        # The one bubble of this turn: its id and the text the stream showed.
        self._bubble_id: str | None = None
        self._shown = ""
        # Thread order per bubble, taken when its first token arrives.
        self._seqs: dict[str, int] = {}
        # Lines said on the agent's behalf (an ask, a handoff). The model
        # repeating one does not become a second bubble.
        self._said: list[str] = []
        self.stream_id = stream_id or str(uuid.uuid4())
        self.segments: list[dict[str, Any]] = []
        self._pending: list[dict[str, Any]] = []
        self._think: dict[str, Any] | None = None
        self._speech_id: str | None = None
        self._speech_text = ""
        self._part_ids: list[str] = []
        self._part_texts: list[str] = []
        self.started = False
        self._sealed = False
        # After the first tool, later reasoning must not take the face back
        # to Thinking. The live state stays Working until the next sentence.
        self._worked = False

    def _opening(self) -> bool:
        """True from the first event until the turn seals. The quiet start is a line."""
        return self.started and not self._sealed

    def _status(self) -> dict[str, Any] | None:
        from app.services.agent.turn_surface import status_view

        speaking = any(text.strip() for text in self._part_texts)
        return status_view(
            self._pending,
            worked=self._worked,
            speaking=speaking,
            opening=self._opening(),
        )

    def _surface(self, status: dict[str, Any] | None) -> dict[str, Any]:
        """The live document. The socket renders this; it does not rebuild the turn."""
        from app.services.agent.turn_persist import slim_activity_item

        blocks: list[dict[str, Any]] = []
        items: list[dict[str, Any]] = []
        for seg in self.live_segments():
            for row in [*(seg.get("activity") or []), *(seg.get("activity_after") or [])]:
                if not isinstance(row, dict):
                    continue
                shown = slim_activity_item(row)
                if row.get("kind") == "think" and str(row.get("text") or "").strip():
                    shown["text"] = str(row["text"])[:4000]
                items.append(shown)
        if items:
            blocks.append({"type": "activity", "id": f"a-{self.stream_id}", "items": items})
        if self._bubble_id and self._shown:
            blocks.append({"type": "speech", "id": self._bubble_id, "text": self._shown})
        from app.services.agent.turn_surface import surface_motion

        speaking = any(text.strip() for text in self._part_texts)
        return {
            "status": status,
            "blocks": blocks,
            "motion": surface_motion(
                self._pending,
                speaking=speaking,
                worked=self._worked,
                opening=self._opening(),
            ),
        }

    async def _emit(self, event: str, data: dict[str, Any]) -> None:
        if self._publish is None:
            return
        payload = {"stream_id": self.stream_id, **data}
        if self.author:
            payload["author"] = self.author
        if "status" not in payload:
            payload["status"] = self._status()
        surface = self._surface(payload.get("status") if isinstance(payload.get("status"), dict) else None)
        if event in ("message.delta", "message.part"):
            surface = _surface_without_think_text(surface)
        payload["surface"] = surface
        await self._publish(event, payload)

    async def start(self) -> None:
        if self.started:
            return
        self.started = True
        await self._emit("agent.turn", {"phase": "start"})

    # -- thinking -----------------------------------------------------------

    async def thinking(self, delta: str) -> None:
        if not delta or (self._think is None and not delta.strip()):
            return
        if self._worked:
            return
        await self.start()
        if self._think is None:
            if self._speech_text.strip():
                # Already talking. A later think burst (continue loop) must
                # not close the bubble or open a new waiting row — that
                # remounts the thinking animation and restarts the stream.
                return
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
        self._speech_text += delta
        await self._sync_speech_parts()

    @property
    def current_segment_id(self) -> str | None:
        return self._speech_id

    @property
    def has_open_speech(self) -> bool:
        return bool(self._speech_text.strip())

    @property
    def open_speech_text(self) -> str:
        return self._speech_text.strip()

    def discard_open_speech(self) -> None:
        """Drop streamed filler so it does not become a bubble next to tools."""
        self._speech_id = None
        self._speech_text = ""
        self._part_ids = []
        self._part_texts = []

    def set_speech_text(self, text: str) -> None:
        """Non-streaming loops: one model response's text as a segment."""
        if not text.strip():
            return
        if self._speech_id is None:
            self._speech_id = f"seg-{uuid.uuid4().hex[:10]}"
        self._speech_text = text

    async def rewrite_open_speech(self, text: str) -> None:
        """Replace the open bubble, including a live message.part when it shrinks."""
        self._speech_text = text or ""
        await self._sync_speech_parts()

    async def say(self, text: str) -> None:
        """A finished bubble the operator can read while the turn continues."""
        cleaned = (text or "").strip()
        if not cleaned:
            return
        await self.speech(cleaned)
        self._close_speech()

    def image_urls(self) -> list[str]:
        """Pictures this turn made, in order."""
        return self._echo_urls()

    def _echo_urls(self) -> list[str]:
        from app.services.agent.turn_persist import _generated_image_urls

        urls: list[str] = []
        for item in self.all_activity():
            urls.extend(_generated_image_urls(item.get("result")))
        return urls

    def _visible_speech(self) -> str:
        from app.services.agent.turn_persist import strip_generated_image_echo

        raw = self._speech_text
        urls = self._echo_urls()
        if not urls:
            return raw
        return strip_generated_image_echo(raw, urls)

    def speech_parts(self) -> list[str]:
        """Bubbles already decided for the open reply."""
        return list(self._part_texts)

    def _speech_parts(self) -> list[str]:
        """The open speech as one block. A turn is one bubble."""
        visible = self._visible_speech().strip()
        return [visible] if visible else []

    def bubble_text(self) -> str:
        """Everything this turn said so far, as the one bubble shows it."""
        lines = [str(seg.get("text") or "").strip() for seg in self.segments]
        lines.extend(text.strip() for text in self._part_texts)
        return "\n\n".join(line for line in lines if line)

    async def _open_bubble(self) -> None:
        """The bubble opens on its first visible word and takes its place in the thread."""
        seg_id = self._part_ids[0] if self._part_ids else f"seg-{uuid.uuid4().hex[:10]}"
        self._bubble_id = seg_id
        seq: int | None = None
        if self._reserve_seq is not None:
            try:
                seq = await self._reserve_seq()
            except Exception:  # noqa: BLE001
                seq = None
        if seq is not None:
            self._seqs[seg_id] = seq
        await self._emit("message.start", {"segment_id": seg_id, "seq": seq})

    async def _sync_bubble(self) -> None:
        text = self.bubble_text()
        if may_be_pass(text):
            text = ""
        if not text:
            if self._bubble_id and self._shown:
                self._shown = ""
                await self._emit("message.part", {"segment_id": self._bubble_id, "text": ""})
            return
        if self._bubble_id is None:
            await self._open_bubble()
        if text == self._shown:
            return
        seq = self._seqs.get(self._bubble_id or "")
        old, self._shown = self._shown, text
        if old and not text.startswith(old):
            await self._emit("message.part", {"segment_id": self._bubble_id, "seq": seq, "text": text})
            return
        await self._emit(
            "message.delta", {"segment_id": self._bubble_id, "seq": seq, "delta": text[len(old) :]}
        )

    def seq_for(self, segment_id: str) -> int | None:
        return self._seqs.get(segment_id)

    def note_said(self, text: str) -> None:
        cleaned = _normalized_line(text)
        if cleaned:
            self._said.append(cleaned)

    def _repeats_said(self, text: str) -> bool:
        line = _normalized_line(text)
        if not line or not self._said:
            return False
        from difflib import SequenceMatcher

        for said in self._said:
            if line == said:
                return True
            short, long_ = sorted((line, said), key=len)
            if short in long_ and len(short) >= 0.8 * len(long_):
                return True
            if SequenceMatcher(None, line, said).ratio() >= 0.85:
                return True
        return False

    async def _sync_speech_parts(self) -> None:
        parts = self._speech_parts()
        if parts and not self._part_ids:
            self._part_ids = [f"seg-{uuid.uuid4().hex[:10]}"]
        if not parts:
            self._part_ids = []
        self._part_texts = list(parts)
        self._speech_id = self._part_ids[0] if self._part_ids else None
        await self._sync_bubble()

    def _close_speech(self) -> None:
        parts = self._speech_parts()
        if parts:
            if len(self._part_ids) < len(parts):
                self._part_ids.extend(
                    f"seg-{uuid.uuid4().hex[:10]}" for _ in range(len(parts) - len(self._part_ids))
                )
            kept = 0
            for index, text in enumerate(parts):
                if self._repeats_said(text):
                    continue
                seg_id = self._part_ids[index]
                self.segments.append(
                    {
                        "id": seg_id,
                        "text": text,
                        "seq": self._seqs.get(seg_id),
                        "activity": self._pending if kept == 0 else [],
                    }
                )
                kept += 1
            if kept:
                self._pending = []
        self._speech_id = None
        self._speech_text = ""
        self._part_ids = []
        self._part_texts = []

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
        await self._sync_bubble()
        self._worked = True
        item = {
            "id": f"tool-{uuid.uuid4().hex[:10]}",
            "kind": KIND_OTHER if name in _OTHER_TOOLS else KIND_WORK,
            "label": label or name,
            "tool": name,
            "provider": provider,
            "started_at": _now(),
            "ended_at": None,
            "status": "running",
        "input": _compact(_activity_input(name, tool_input)),
        }
        if _raises_proposal(name):
            item["proposes"] = True
        self._pending.append(item)
        await self._emit("agent.activity", {"phase": "start", "item": self._public(item)})
        return item

    async def tool_end(self, item: dict[str, Any], result: Any) -> None:
        from app.services.agent.turn_persist import decision_ids_from_result

        item["ended_at"] = _now()
        item["status"] = "error" if _is_error(result) else "ok"
        decision_ids = decision_ids_from_result(result)
        if decision_ids:
            item["proposes"] = True
            # Survives result compaction (480 chars). Placement reads this, not the slim result.
            item["decision_ids"] = sorted(decision_ids)
        item["result"] = _activity_result(str(item.get("tool") or ""), result)
        # Concrete trail copy so collapsed activity is not just "1 action".
        tool = str(item.get("tool") or "")
        if tool == "set_thread_tags" and isinstance(result, dict) and not result.get("error"):
            added = result.get("added") if isinstance(result.get("added"), list) else []
            names = [str(n).lstrip("#") for n in added if n]
            if names:
                item["label"] = "Added #" + ", #".join(names)
        await self._emit("agent.activity", {"phase": "end", "item": self._public(item)})

    # -- finish -------------------------------------------------------------

    async def finish(self, outcome: str | None = None) -> None:
        if self._sealed:
            return
        await self._end_think()
        self._close_speech()
        if outcome == "silent" or is_pass(self.bubble_text()):
            outcome = "silent"
            if self._bubble_id and self._shown:
                self._shown = ""
                await self._emit("message.part", {"segment_id": self._bubble_id, "text": ""})
        else:
            await self._sync_bubble()
        if self._pending:
            if self.segments:
                self.segments[-1].setdefault("activity_after", []).extend(self._pending)
            else:
                self.segments.append({"id": f"seg-{uuid.uuid4().hex[:10]}", "text": "", "activity": self._pending})
            self._pending = []
        if self.started:
            from app.services.agent.turn_surface import closing_motion

            self._sealed = True
            end: dict[str, Any] = {"phase": "end", "status": None}
            if outcome:
                end["outcome"] = outcome
            items = [
                row
                for seg in self.segments
                for row in [*(seg.get("activity") or []), *(seg.get("activity_after") or [])]
                if isinstance(row, dict)
            ]
            closing = closing_motion(items, outcome)
            if closing:
                end["closing"] = closing
            await self._emit("agent.turn", end)

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

    def live_segments(self) -> list[dict[str, Any]]:
        """Segments plus the open think/tool/speech so a mid-turn checkpoint
        matches what the operator sees, not only closed bubbles."""
        segs = [dict(s) for s in self.segments]
        pending = list(self._pending)
        if self._part_texts and self._part_ids:
            for index, text in enumerate(self._part_texts):
                if not text.strip():
                    continue
                seg_id = self._part_ids[index]
                segs.append(
                    {
                        "id": seg_id,
                        "text": text,
                        "seq": self._seqs.get(seg_id),
                        "activity": pending if index == 0 else [],
                    }
                )
            return segs
        if pending:
            if segs:
                last = dict(segs[-1])
                last["activity_after"] = [*(last.get("activity_after") or []), *pending]
                segs[-1] = last
            else:
                segs.append({"id": "live", "text": "", "activity": pending})
        return segs

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
