"""Save one agent turn as thread messages.

Chat mode: every speech segment is split into bubbles (blank line = new
bubble), capped per turn; each bubble is its own SignalMessage and the
activity that preceded it sits on that message (``metadata.activity``).

Mail and document mode: one message with the final speech. Earlier speech
(narration before tools) never reaches the reader; it becomes an ``other``
activity note so the team can still see it.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal, SignalMessage
from app.services.agent.reply_mode import CHAT, MAX_CHAT_MESSAGES, split_chat_messages


def _note_item(segment: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"note-{segment.get('id', '')}",
        "kind": "other",
        "label": "note",
        "tool": "",
        "provider": "",
        "started_at": None,
        "ended_at": None,
        "status": "ok",
        "text": segment.get("text", ""),
    }


def plan_turn_messages(
    segments: list[dict[str, Any]],
    reply_mode: str,
    *,
    fallback_text: str = "Done.",
    max_messages: int = MAX_CHAT_MESSAGES,
) -> list[dict[str, Any]]:
    """Pure: segments -> ``[{text, activity, activity_after, segment_id}]``."""
    if reply_mode != CHAT:
        activity: list[dict[str, Any]] = []
        final_index = max(
            (i for i, s in enumerate(segments) if (s.get("text") or "").strip()), default=-1
        )
        for i, seg in enumerate(segments):
            activity.extend(seg.get("activity") or [])
            if i != final_index and (seg.get("text") or "").strip():
                activity.append(_note_item(seg))
            activity.extend(seg.get("activity_after") or [])
        text = segments[final_index]["text"] if final_index >= 0 else fallback_text
        seg_id = segments[final_index].get("id") if final_index >= 0 else None
        return [{"text": text, "activity": activity, "activity_after": [], "segment_id": seg_id}]

    bubbles: list[dict[str, Any]] = []
    carry: list[dict[str, Any]] = []
    for seg in segments:
        parts = split_chat_messages(seg.get("text") or "", max_messages=0)
        before = [*carry, *(seg.get("activity") or [])]
        carry = []
        if not parts:
            # No speech: the work joins the next bubble's group (one "Worked for").
            carry = [*before, *(seg.get("activity_after") or [])]
            continue
        for j, part in enumerate(parts):
            bubbles.append(
                {
                    "text": part,
                    "activity": before if j == 0 else [],
                    "activity_after": [],
                    "segment_id": seg.get("id"),
                }
            )
        bubbles[-1]["activity_after"].extend(seg.get("activity_after") or [])

    if not bubbles:
        return [{"text": fallback_text, "activity": carry, "activity_after": [], "segment_id": None}]
    # Work after the last speech hangs under the last bubble.
    bubbles[-1]["activity_after"].extend(carry)

    if max_messages > 0 and len(bubbles) > max_messages:
        head = bubbles[: max_messages - 1]
        rest = bubbles[max_messages - 1 :]
        merged = {
            "text": "\n\n".join(b["text"] for b in rest),
            "activity": [a for b in rest for a in b["activity"]],
            "activity_after": [a for b in rest for a in b["activity_after"]],
            "segment_id": rest[0]["segment_id"],
        }
        bubbles = [*head, merged]
    return bubbles


def plan_customer_bubbles(
    segments: list[dict[str, Any]], *, fallback_text: str = ""
) -> list[dict[str, Any]]:
    """Customer replies from a finished (non-streamed) run: only the final
    speech is sent, split into chat bubbles; earlier narration ("let me check")
    would arrive stale, so it stays an activity note for the team."""
    single = plan_turn_messages(segments, "mail", fallback_text=fallback_text)[0]
    parts = split_chat_messages(single["text"])
    if not parts:
        return []
    return [
        {
            "text": part,
            "activity": single["activity"] if index == 0 else [],
            "activity_after": [],
            "segment_id": single["segment_id"],
        }
        for index, part in enumerate(parts)
    ]


_DETAIL_KEYS = ("input", "result", "text")
NOTE_TEXT_MAX = 280


def slim_activity_item(item: dict[str, Any]) -> dict[str, Any]:
    """List/stream shape: no tool payloads or thinking text. A note keeps its
    (short) text: it is the label operators read."""
    out = {k: v for k, v in item.items() if k not in _DETAIL_KEYS}
    if item.get("label") == "note" and item.get("text"):
        out["text"] = str(item["text"])[:NOTE_TEXT_MAX]
    return out


def _legacy_activity(meta: dict[str, Any]) -> list[dict[str, Any]]:
    """Messages saved before turns: ``thinking`` + ``steps`` -> activity items."""
    from app.tools.registry import tool_presentation

    items: list[dict[str, Any]] = []
    thinking = meta.get("thinking")
    if isinstance(thinking, dict) and (thinking.get("text") or thinking.get("ms")):
        items.append(
            {
                "id": "legacy-think",
                "kind": "think",
                "label": "",
                "status": "ok",
                "duration_ms": int(thinking.get("ms") or 0),
                "text": str(thinking.get("text") or ""),
            }
        )
    open_calls: dict[str, dict[str, Any]] = {}
    for index, step in enumerate(meta.get("steps") or []):
        if not isinstance(step, dict):
            continue
        name = str(step.get("name") or "")
        payload = step.get("payload") if isinstance(step.get("payload"), dict) else {}
        if step.get("step_type") == "tool_call":
            shown = tool_presentation(name)
            item = {
                "id": f"legacy-{index}",
                "kind": "work",
                "label": shown["label"],
                "tool": name,
                "provider": shown["provider"],
                "status": "ok",
                "input": payload.get("input"),
            }
            items.append(item)
            open_calls[name] = item
        elif step.get("step_type") == "tool_result" and name in open_calls:
            item = open_calls.pop(name)
            item["result"] = payload.get("result")
            result = payload.get("result")
            if isinstance(result, dict) and result.get("error"):
                item["status"] = "error"
    return items


def message_activity(meta: dict[str, Any], *, detail: bool) -> dict[str, Any]:
    """``{activity, activity_after}`` for a saved message. ``detail=False``
    drops tool input/result and thinking text (list payloads)."""

    def shape(items: Any) -> list[dict[str, Any]]:
        if not isinstance(items, list):
            return []
        out = [i for i in items if isinstance(i, dict)]
        if detail:
            return out
        return [slim_activity_item(i) for i in out]

    activity = meta.get("activity")
    if not isinstance(activity, list) and not isinstance(meta.get("activity_after"), list):
        activity = _legacy_activity(meta)
    return {"activity": shape(activity), "activity_after": shape(meta.get("activity_after"))}


async def touch_agent_activity(session: AsyncSession, agent_id: UUID | None) -> None:
    """Agent.last_active_at drives "Laatst actief" on the agent panel."""
    if agent_id is None:
        return
    from app.models.agent import Agent

    agent = await session.get(Agent, agent_id)
    if agent is not None:
        agent.last_active_at = datetime.utcnow()
        session.add(agent)


def _decision_ids_from_result(result: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(result, dict):
        for key in ("decision_request_id", "decision_id"):
            val = result.get(key)
            if val:
                found.add(str(val))
        for nested in result.values():
            if isinstance(nested, dict):
                found |= _decision_ids_from_result(nested)
    return found


def decision_ids_in_activity(meta: dict[str, Any]) -> set[str]:
    found: set[str] = set()
    for key in ("activity", "activity_after"):
        for item in meta.get(key) or []:
            if isinstance(item, dict):
                found |= _decision_ids_from_result(item.get("result"))
    return found


def _message_time(row: SignalMessage) -> datetime:
    return row.received_at or row.created_at


def _stamp_after(anchor: datetime, *, before: datetime | None) -> datetime:
    later = anchor + timedelta(milliseconds=40)
    if before is not None and before > anchor:
        mid = anchor + (before - anchor) / 2
        return mid if mid > anchor else later
    return later


async def place_turn_decisions(
    session: AsyncSession,
    signal: Signal,
    turn_messages: list[SignalMessage],
) -> None:
    """Put wait-for-OK cards after the bubble whose activity created them.

    ``create_decision`` writes the card at tool time; bubbles persist later, so
    without this the card sorts between the user message and the agent work.
    """
    if not turn_messages:
        return
    cards = (
        await session.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.kind == "decision_request",
            )
        )
    ).scalars().all()
    if not cards:
        return
    first_time = _message_time(turn_messages[0])
    later_times = [_message_time(row) for row in turn_messages[1:]]
    anchors: dict[str, datetime] = {}
    for bubble in turn_messages:
        try:
            meta = json.loads(bubble.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        stamp = _message_time(bubble)
        for did in decision_ids_in_activity(meta if isinstance(meta, dict) else {}):
            anchors[did] = stamp
    for card in cards:
        did = str(card.decision_id) if card.decision_id else str(card.id)
        current = _message_time(card)
        if did in anchors:
            anchor = anchors[did]
        elif current <= first_time:
            # Mid-turn card with no id on activity: sit after the first bubble.
            anchor = first_time
        else:
            continue
        before = next((t for t in later_times if t > anchor), None)
        card.received_at = _stamp_after(anchor, before=before)


async def persist_agent_turn(
    session: AsyncSession,
    signal: Signal,
    *,
    segments: list[dict[str, Any]],
    reply_mode: str,
    author_agent_id: UUID | None,
    metadata: dict[str, Any] | None = None,
    first_metadata: dict[str, Any] | None = None,
    final_metadata: dict[str, Any] | None = None,
    turn_id: str | None = None,
    fallback_text: str = "Done.",
    append_to_last: str = "",
) -> list[SignalMessage]:
    """Append the turn's bubbles to the thread. ``first_metadata`` (AI
    disclosure) lands on the first message, ``final_metadata`` (usage,
    thinking) on the last; ``append_to_last`` extends the last bubble's text.
    Caller commits."""
    from app.services.assistant_threads import append_signal_chat_message

    planned = plan_turn_messages(segments, reply_mode, fallback_text=fallback_text)
    if append_to_last:
        planned[-1]["text"] = f"{planned[-1]['text']}{append_to_last}"
    messages: list[SignalMessage] = []
    for index, bubble in enumerate(planned):
        meta: dict[str, Any] = dict(metadata or {})
        if index == 0 and first_metadata:
            meta.update(first_metadata)
        if bubble["activity"]:
            meta["activity"] = bubble["activity"]
        if bubble["activity_after"]:
            meta["activity_after"] = bubble["activity_after"]
        if turn_id:
            meta["turn_id"] = turn_id
        if bubble.get("segment_id"):
            meta["segment_id"] = bubble["segment_id"]
        if len(planned) > 1:
            meta["bubble_index"] = index
        if index == len(planned) - 1 and final_metadata:
            meta.update(final_metadata)
        msg = await append_signal_chat_message(
            session,
            signal,
            role="assistant",
            content=bubble["text"],
            author_agent_id=author_agent_id,
            metadata=meta,
        )
        if messages:
            prev_t = messages[-1].received_at or messages[-1].created_at
            if (msg.received_at or msg.created_at) <= prev_t:
                msg.received_at = prev_t + timedelta(milliseconds=20)
        messages.append(msg)
    await place_turn_decisions(session, signal, messages)
    await touch_agent_activity(session, author_agent_id)
    return messages
