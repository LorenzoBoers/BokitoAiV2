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
import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage, is_internal_channel
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
        activity_rows = [*(seg.get("activity") or []), *(seg.get("activity_after") or [])]
        echoed: list[str] = []
        for row in activity_rows:
            if not isinstance(row, dict) or row.get("tool") != "generate_image":
                continue
            echoed.extend(str(url) for url in (row.get("image_urls") or []) if url)
            echoed.extend(_generated_image_urls(row.get("result")))
        spoken = strip_generated_image_echo(seg.get("text") or "", echoed)
        parts = split_chat_messages(spoken, max_messages=0)
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


def activity_from_segments(segments: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Flat activity list for a turn that lands as one card (reply suggestion).

    Assisted inbound often creates only a decision_request (via
    ``suggest_thread_reply``) with no agent speech bubble; without this the
    live tool trail disappears when the turn ends.
    """
    if not segments:
        return []
    planned = plan_turn_messages(segments, "mail", fallback_text="")
    if not planned:
        return []
    return list(planned[0].get("activity") or []) + list(planned[0].get("activity_after") or [])


def attach_activity_to_message(message: SignalMessage, activity: list[dict[str, Any]]) -> bool:
    """Write ``metadata.activity`` onto a saved message. Returns True when set."""
    if not activity:
        return False
    try:
        meta = json.loads(message.metadata_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    existing = meta.get("activity")
    if isinstance(existing, list) and existing:
        # Keep prior items; append only new ids so a second attach is idempotent.
        seen = {
            str(item.get("id"))
            for item in existing
            if isinstance(item, dict) and item.get("id")
        }
        merged = list(existing)
        for item in activity:
            if not isinstance(item, dict):
                continue
            iid = str(item.get("id") or "")
            if iid and iid in seen:
                continue
            merged.append(item)
        meta["activity"] = merged
    else:
        meta["activity"] = activity
    message.metadata_json = json.dumps(meta, default=str)
    return True


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


_MARKDOWN_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]+\)")


def strip_generated_image_echo(text: str, urls: list[str]) -> str:
    """The frame already shows the file. Drop a second copy the model pasted.

    Any generated URL means this bubble's pictures belong to the frames, so a
    markdown image is removed even when the model rewrote the address.
    """
    cleaned = text or ""
    known = [url for url in urls if url]
    for url in known:
        escaped = re.escape(url)
        cleaned = re.sub(rf"!\[[^\]]*\]\({escaped}\)", "", cleaned)
        cleaned = re.sub(rf"\[[^\]]*\]\({escaped}\)", "", cleaned)
        cleaned = cleaned.replace(url, "")
    if known:
        cleaned = _MARKDOWN_IMAGE.sub("", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _generated_image_urls(result: Any) -> list[str]:
    """Short URLs the chat frame needs. The rest of the tool payload stays off the stream."""
    if not isinstance(result, dict):
        return []
    urls: list[str] = []
    images = result.get("images")
    if isinstance(images, list):
        for row in images:
            if isinstance(row, str) and row.strip():
                urls.append(row.strip()[:800])
    if not urls:
        for row in result.get("items") or []:
            if not isinstance(row, dict):
                continue
            url = str(row.get("image_url") or row.get("url") or "").strip()
            if url:
                urls.append(url[:800])
    return urls[:4]


def slim_activity_item(item: dict[str, Any]) -> dict[str, Any]:
    """List/stream shape: no tool payloads or thinking text. A note keeps its
    (short) text: it is the label operators read. Image generation keeps the
    file URL so the frame can replace its placeholder without a second fetch."""
    out = {k: v for k, v in item.items() if k not in _DETAIL_KEYS}
    if item.get("kind") == "think":
        out["has_text"] = bool(str(item.get("text") or "").strip())
    if item.get("label") == "note" and item.get("text"):
        out["text"] = str(item["text"])[:NOTE_TEXT_MAX]
    if item.get("tool") == "generate_image":
        urls = _generated_image_urls(item.get("result"))
        if urls:
            out["image_urls"] = urls
    from app.services.agent.turn_surface import present_activity

    for key, value in present_activity(item).items():
        if value is not None:
            out[key] = value
    return out


def _legacy_activity(meta: dict[str, Any]) -> list[dict[str, Any]]:
    """Messages saved before turns: ``thinking`` + ``steps`` -> activity items."""
    from app.tools.registry import tool_presentation

    items: list[dict[str, Any]] = []
    thinking = meta.get("thinking")
    if isinstance(thinking, dict) and str(thinking.get("text") or "").strip():
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
    shown = shape(activity)
    shown_after = shape(meta.get("activity_after"))
    from app.services.agent.turn_surface import history_view

    public = [slim_activity_item(i) for i in [*shown, *shown_after] if isinstance(i, dict)]
    return {
        "activity": shown,
        "activity_after": shown_after,
        "history": history_view(public),
    }


async def touch_agent_activity(session: AsyncSession, agent_id: UUID | None) -> None:
    """Agent.last_active_at drives "Laatst actief" on the agent panel."""
    if agent_id is None:
        return
    from app.models.agent import Agent

    agent = await session.get(Agent, agent_id)
    if agent is not None:
        agent.last_active_at = datetime.utcnow()
        session.add(agent)


def _is_uuid(value: str) -> bool:
    try:
        UUID(str(value))
        return True
    except ValueError:
        return False


def decision_ids_from_result(result: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(result, dict):
        for key in ("decision_request_id", "decision_id"):
            val = result.get(key)
            if val:
                found.add(str(val))
        for nested in result.values():
            if isinstance(nested, dict):
                found |= decision_ids_from_result(nested)
    return found


def decision_ids_in_activity(meta: dict[str, Any]) -> set[str]:
    found: set[str] = set()
    for key in ("activity", "activity_after"):
        for item in meta.get(key) or []:
            if isinstance(item, dict):
                found |= decision_ids_from_result(item.get("result"))
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
    """Reveal deferred decisions and stamp cards after the bubble that created them.

    Agent turns persist DecisionRequests at tool time with ``reveal=False``.
    After speech bubbles are saved we reveal (thread message + notification)
    so the operator sees the question before the approval card.

    Only cards whose decision id appears in **this** turn's activity are moved.
    A previous fallback relocated every older card with ``received_at <= first
    bubble``, which dragged already-approved decisions into later turns and
    showed them as "Afgehandeld" between new bubbles.
    """
    from app.services.signal_decisions import reveal_decision

    anchors: dict[str, datetime] = {}
    turn_ids: set[str] = set()
    for bubble in turn_messages:
        try:
            meta = json.loads(bubble.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if not isinstance(meta, dict):
            meta = {}
        tid = str(meta.get("turn_id") or "").strip()
        if tid:
            turn_ids.add(tid)
        stamp = _message_time(bubble) or datetime.utcnow()
        for did in decision_ids_in_activity(meta):
            anchors[did] = stamp

    pending_ids = [UUID(did) for did in anchors if _is_uuid(did)]
    # Ask/assistant sessions stream speech on the session thread while tools may
    # target context_signal_id (e.g. the mail host). Cards raised mid-turn must
    # still reveal next to that speech — look up by activity id even when
    # DecisionRequest.signal_id still points at the context thread.
    pending_q = select(DecisionRequest).where(
        DecisionRequest.tenant_id == signal.tenant_id,
        DecisionRequest.message_id.is_(None),
        DecisionRequest.status == "awaiting_human",
    )
    if pending_ids and turn_ids:
        pending_q = pending_q.where(
            (DecisionRequest.id.in_(pending_ids))
            | (
                (DecisionRequest.signal_id == signal.id)
                & (DecisionRequest.bundle_id.in_(list(turn_ids)))
            )
        )
    elif pending_ids:
        pending_q = pending_q.where(DecisionRequest.id.in_(pending_ids))
    elif turn_ids:
        pending_q = pending_q.where(
            DecisionRequest.signal_id == signal.id,
            DecisionRequest.bundle_id.in_(list(turn_ids)),
        )
    else:
        pending_q = None
    if pending_q is not None:
        pending_rows = (await session.execute(pending_q)).scalars().all()
        last_stamp = _message_time(turn_messages[-1]) if turn_messages else datetime.utcnow()
        for decision in pending_rows:
            if decision.signal_id != signal.id:
                decision.signal_id = signal.id
                session.add(decision)
            await reveal_decision(session, signal.tenant_id, decision)
            anchors.setdefault(str(decision.id), last_stamp or datetime.utcnow())

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
    last_time = _message_time(turn_messages[-1])
    later_times = [_message_time(row) for row in turn_messages[1:]]
    turn_window_start = (first_time or datetime.utcnow()) - timedelta(seconds=2)
    turn_window_end = (last_time or datetime.utcnow()) + timedelta(seconds=2)
    for card in cards:
        did = str(card.decision_id) if card.decision_id else str(card.id)
        current = _message_time(card)
        if did in anchors:
            anchor = anchors[did]
            before = next((t for t in later_times if t and t > anchor), None)
            card.received_at = _stamp_after(anchor, before=before)
            continue
        # Heal cards an older bug dragged into a later turn: snap back to
        # created_at when the stamp clearly does not belong to this turn's work.
        created = card.created_at
        if (
            created is not None
            and current is not None
            and (current - created).total_seconds() > 300
            and turn_window_start <= current <= turn_window_end
        ):
            card.received_at = created
    if is_internal_channel(signal.channel or ""):
        turn_cards = [c for c in cards if c.decision_id and str(c.decision_id) in anchors]
        decisions: dict[str, DecisionRequest] = {}
        if turn_cards:
            rows = (
                await session.execute(
                    select(DecisionRequest).where(
                        DecisionRequest.id.in_([c.decision_id for c in turn_cards])
                    )
                )
            ).scalars().all()
            decisions = {str(d.id): d for d in rows}
        _attach_proposal(turn_messages[-1], turn_cards, decisions)


def _json_meta(row: SignalMessage) -> dict[str, Any]:
    try:
        meta = json.loads(row.metadata_json or "{}")
    except json.JSONDecodeError:
        return {}
    return meta if isinstance(meta, dict) else {}


def _merge_items(*groups: list[Any] | None) -> list[dict[str, Any]]:
    from app.services.proposal_items import MAX_ITEMS

    out: list[dict[str, Any]] = []
    seen: set[tuple[Any, Any]] = set()
    for group in groups:
        for item in group or []:
            if not isinstance(item, dict):
                continue
            key = (item.get("type"), item.get("id"))
            if item.get("id") and key in seen:
                continue
            seen.add(key)
            out.append(item)
            if len(out) >= MAX_ITEMS:
                return out
    return out


_CHOICE_WORD = re.compile(
    r"\b(welke|which|kies|pick one|what kind|wat voor)\b",
    re.IGNORECASE,
)
_OPTION_LINE = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$")
_CATALOG_LEAD = re.compile(
    r"^\s*(de beschikbare|the available|hier zijn|here are)\b.*:?\s*$",
    re.IGNORECASE,
)
_RAISES_DECISION = frozenset({"propose_action", "create_decision_request"})


def _is_choice_question(text: str) -> bool:
    body = text or ""
    return "?" in body and _CHOICE_WORD.search(body) is not None


def _activity_rows(blob: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for key in ("activity", "activity_after"):
        for entry in blob.get(key) or []:
            if isinstance(entry, dict):
                rows.append(entry)
    return rows


def _result_dict(entry: dict[str, Any]) -> dict[str, Any]:
    result = entry.get("result")
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except json.JSONDecodeError:
            return {}
    return result if isinstance(result, dict) else {}


def _items_in_entry(entry: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        row
        for row in _result_dict(entry).get("items") or []
        if isinstance(row, dict) and row.get("type")
    ]


def tags_from_bubbles(bubbles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Tag rows kept on ``list_tags`` activity (id, name, kind)."""
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    for bubble in bubbles:
        for entry in _activity_rows(bubble):
            if entry.get("tool") != "list_tags":
                continue
            for row in _result_dict(entry).get("tags") or []:
                if not isinstance(row, dict):
                    continue
                name = str(row.get("name") or "").strip()
                tag_id = str(row.get("id") or "").strip()
                if not name or not tag_id or tag_id in seen:
                    continue
                seen.add(tag_id)
                found.append(
                    {"id": tag_id, "name": name, "kind": str(row.get("kind") or "")}
                )
    return found


def turn_has_decision(bubbles: list[dict[str, Any]]) -> bool:
    for bubble in bubbles:
        meta = {
            "activity": bubble.get("activity") or [],
            "activity_after": bubble.get("activity_after") or [],
        }
        if decision_ids_in_activity(meta):
            return True
        for entry in _activity_rows(bubble):
            if entry.get("tool") in _RAISES_DECISION:
                return True
    return False


def _bullet_labels(text: str) -> list[str]:
    labels: list[str] = []
    for line in (text or "").splitlines():
        match = _OPTION_LINE.match(line)
        if not match:
            continue
        raw = re.sub(r"\s*\([^)]*\)\s*$", "", match.group(1)).strip().lstrip("#").strip()
        if raw:
            labels.append(raw)
    return labels


def choice_options_from_tags(speech: str, tags: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Options for a choice the model asked in prose after ``list_tags``."""
    if not tags or not _is_choice_question(speech):
        return []
    by_name = {str(tag["name"]).lower(): tag for tag in tags}
    picked: list[dict[str, Any]] = []
    for label in _bullet_labels(speech):
        key = label.lower()
        tag = by_name.get(key)
        if tag is None:
            head = key.split()[0] if key.split() else ""
            tag = by_name.get(head)
        if tag is not None and tag not in picked:
            picked.append(tag)
    if len(picked) >= 2:
        return picked
    named = [
        tag
        for tag in tags
        if re.search(rf"(?<![\w]){re.escape(str(tag['name']))}(?![\w])", speech, flags=re.IGNORECASE)
    ]
    if len(named) >= 2:
        return named
    action = [tag for tag in tags if tag.get("kind") == "action_tag"]
    if len(action) >= 2 and re.search(r"categor|ticket|tag|label", speech, flags=re.IGNORECASE):
        return action[:8]
    return []


def choice_question_text(speech: str) -> str:
    lines = [line.strip() for line in (speech or "").splitlines() if line.strip() and "?" in line]
    if lines:
        return lines[-1][:400]
    return (speech or "").strip()[:400]


def strip_option_catalog(text: str) -> str:
    """Drop a bullet catalog once those choices are decision buttons."""
    kept: list[str] = []
    for line in (text or "").splitlines():
        if _OPTION_LINE.match(line) or _CATALOG_LEAD.match(line):
            continue
        kept.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


def prepare_choice_repair(
    bubbles: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """When a turn asks which tag and never calls propose_action, plan the buttons.

    Returns the bubbles with the catalog lines removed, plus the tag options.
    """
    if not bubbles or turn_has_decision(bubbles):
        return bubbles, []
    speech = "\n".join(str(bubble.get("text") or "") for bubble in bubbles)
    options = choice_options_from_tags(speech, tags_from_bubbles(bubbles))
    if len(options) < 2:
        return bubbles, []
    cleaned: list[dict[str, Any]] = []
    carry_activity: list[Any] = []
    carry_after: list[Any] = []
    for bubble in bubbles:
        text = strip_option_catalog(str(bubble.get("text") or ""))
        activity = [*carry_activity, *(bubble.get("activity") or [])]
        after = [*carry_after, *(bubble.get("activity_after") or [])]
        carry_activity, carry_after = [], []
        if not text:
            # A catalog-only bubble would render blank. Keep its tools on the next line.
            carry_activity = activity
            carry_after = after
            continue
        cleaned.append({**bubble, "text": text, "activity": activity, "activity_after": after})
    if carry_activity or carry_after:
        if not cleaned:
            return bubbles, []
        cleaned[-1]["activity_after"] = [
            *(cleaned[-1].get("activity_after") or []),
            *carry_activity,
            *carry_after,
        ]
    return cleaned, options


def assign_bubble_showcases(
    bubbles: list[dict[str, Any]],
    pending: list[dict[str, Any]] | None = None,
    extra: list[dict[str, Any]] | None = None,
) -> list[list[dict[str, Any]]]:
    """Put each showcase on the bubble whose tool produced it.

    Contact cards stay off a choice question. They stay on the bubble that
    looked the contact up when that bubble is not the question.
    """
    from app.services.proposal_items import MAX_ITEMS

    pool: dict[tuple[Any, str], dict[str, Any]] = {}
    order: list[tuple[Any, str]] = []

    def remember(item: dict[str, Any]) -> None:
        if not item.get("type") or not item.get("id"):
            return
        key = (item.get("type"), str(item.get("id")))
        if key in pool:
            return
        pool[key] = item
        order.append(key)

    for item in pending or []:
        if isinstance(item, dict):
            remember(item)

    assigned: set[tuple[Any, str]] = set()
    out: list[list[dict[str, Any]]] = [[] for _ in bubbles]
    for index, bubble in enumerate(bubbles):
        choice = _is_choice_question(str(bubble.get("text") or ""))
        for entry in _activity_rows(bubble):
            for item in _items_in_entry(entry):
                key = (item.get("type"), str(item.get("id") or ""))
                if not item.get("id") or key in assigned:
                    continue
                rich = pool.get(key, item)
                assigned.add(key)
                if rich.get("type") == "contact" and choice:
                    continue
                out[index].append(rich)
                if len(out[index]) >= MAX_ITEMS:
                    break
    target = len(bubbles) - 1
    for index, bubble in enumerate(bubbles):
        if not _is_choice_question(str(bubble.get("text") or "")):
            target = index
    if bubbles and target >= 0:
        choice = _is_choice_question(str(bubbles[target].get("text") or ""))
        for key in order:
            if key in assigned:
                continue
            item = pool[key]
            if item.get("type") == "contact" and choice:
                continue
            out[target].append(item)
        for item in extra or []:
            if isinstance(item, dict) and item.get("type"):
                key = (item.get("type"), str(item.get("id") or ""))
                if key in assigned or (item.get("type") == "contact" and choice):
                    continue
                assigned.add(key)
                out[target].append(item)
    return [group[:MAX_ITEMS] for group in out]


async def _raise_tag_choice(
    session: AsyncSession,
    signal: Signal,
    bubble: SignalMessage,
    tags: list[dict[str, Any]],
    *,
    author_agent_id: UUID | None,
    turn_id: str | None,
) -> None:
    """Soft decision for a category question the model asked without propose_action."""
    from app.services.signal_decisions import create_decision

    question = choice_question_text(bubble.body_text or "")
    if not question:
        return
    options = [{"id": str(tag["id"]), "label": str(tag["name"])} for tag in tags if tag.get("id")]
    if len(options) < 2:
        return
    decision, _ = await create_decision(
        session,
        signal.tenant_id,
        title=question[:200],
        question=question,
        options=options,
        agent_id=author_agent_id,
        signal_id=signal.id,
        source_type="agent",
        source_id=str(author_agent_id) if author_agent_id else None,
        selection="single",
        bundle_id=turn_id or "",
        reveal=False,
    )
    meta = _json_meta(bubble)
    activity = list(meta.get("activity") or [])
    activity.append(
        {
            "id": f"choice-{decision.id}",
            "kind": "other",
            "label": "decision",
            "tool": "propose_action",
            "status": "ok",
            "result": {"decision_request_id": str(decision.id)},
        }
    )
    meta["activity"] = activity
    bubble.metadata_json = json.dumps(meta, default=str)


def _attach_showcase_items(
    signal_id: Any,
    messages: list[SignalMessage],
    *,
    extra_items: list[dict[str, Any]] | None = None,
) -> None:
    """Write showcases onto the bubble that produced them, not the last one."""
    from app.services.proposal_items import take_attach_items

    if not messages:
        return
    pending = take_attach_items(signal_id)
    blobs: list[dict[str, Any]] = []
    metas: list[dict[str, Any]] = []
    for message in messages:
        meta = _json_meta(message)
        metas.append(meta)
        blobs.append(
            {
                "text": message.body_text or "",
                "activity": meta.get("activity") or [],
                "activity_after": meta.get("activity_after") or [],
            }
        )
    groups = assign_bubble_showcases(blobs, pending, extra_items)
    for message, meta, items in zip(messages, metas, groups):
        existing = meta.get("items") if isinstance(meta.get("items"), list) else []
        merged = _merge_items(existing, items)
        if not merged:
            continue
        meta["items"] = merged
        proposal = meta.get("proposal") if isinstance(meta.get("proposal"), dict) else None
        if proposal is not None:
            proposal = {k: v for k, v in proposal.items() if k != "items"}
            proposal["items"] = merged
            meta["proposal"] = proposal
        message.metadata_json = json.dumps(meta, default=str)


_CHOICE_ECHO = re.compile(
    r"(?:\n\s*)+(?:Kies hieronder|Choose below|Pick one)\s*:?\s*"
    r"(?:\n\s*[-*•]\s+.+)+\s*$",
    re.IGNORECASE,
)


def strip_choice_echo(text: str) -> str:
    """Remove 'Kies hieronder / - Ja / - Nee' tails — buttons already show them."""
    cleaned = _CHOICE_ECHO.sub("", text or "").rstrip()
    # Drop a bubble that is only the choice list.
    if re.fullmatch(
        r"(?:Kies hieronder|Choose below|Pick one)\s*:?\s*(?:\n\s*[-*•]\s+.+)+",
        cleaned,
        flags=re.IGNORECASE,
    ):
        return ""
    return cleaned


def _is_action_decision(decision: DecisionRequest | None) -> bool:
    """A card whose approve runs a platform tool or applies a platform change."""
    if decision is None:
        return False
    try:
        options = json.loads(decision.options_json or "[]")
    except json.JSONDecodeError:
        return False
    from app.tools.builtin import executable_option_actions

    actions = executable_option_actions(options if isinstance(options, list) else [])
    return any(a not in ("text",) for a in actions) or decision.platform_change_id is not None


def _attach_proposal(
    last_bubble: SignalMessage,
    turn_cards: list[SignalMessage],
    decisions: dict[str, DecisionRequest] | None = None,
) -> None:
    """The cards raised in this turn become the proposal on the turn's last
    bubble: their buttons render under that message instead of as separate
    cards. Every card whose approve runs a tool joins ``proposal.bundle`` so
    the operator can approve all or pick some; the newest card stays the
    primary ``decision_id`` for soft questions. Customer-facing threads keep
    the card, since the bubble there is addressed to the customer, not to the
    operator."""
    if not turn_cards:
        return
    decisions = decisions or {}
    ordered = sorted(
        turn_cards,
        key=lambda c: (c.created_at or datetime.min, str(c.decision_id or c.id)),
    )
    card = ordered[-1]
    card_meta = _json_meta(card)
    bubble_meta = _json_meta(last_bubble)
    proposal: dict[str, Any] = {"decision_id": str(card.decision_id)}
    bundle = [
        {"decision_id": str(c.decision_id), "card_message_id": str(c.id)}
        for c in ordered
        if _is_action_decision(decisions.get(str(c.decision_id)))
    ]
    if bundle:
        proposal["bundle"] = bundle
        bundle_ids = {d.bundle_id for d in decisions.values() if d.bundle_id}
        if len(bundle_ids) == 1:
            proposal["bundle_id"] = next(iter(bundle_ids))
    bundled_ids = {row["decision_id"] for row in bundle}
    for other in ordered[:-1]:
        if str(other.decision_id) not in bundled_ids:
            continue
        other_meta = _json_meta(other)
        other_meta["attached_to_message_id"] = str(last_bubble.id)
        other.metadata_json = json.dumps(other_meta, default=str)
    card_items = [
        item
        for c in ordered
        for item in (_json_meta(c).get("proposal_items") or [])
        if isinstance(item, dict)
    ]
    if card_items:
        proposal["items"] = card_items
    if card_meta.get("question"):
        proposal["question"] = card_meta["question"]
    selection = str(card_meta.get("selection") or "single").lower()
    if selection in ("single", "multiple"):
        proposal["selection"] = selection
    bubble_meta["proposal"] = proposal
    items = _merge_items(
        bubble_meta.get("items") if isinstance(bubble_meta.get("items"), list) else [],
        proposal.get("items") if isinstance(proposal.get("items"), list) else [],
    )
    if items:
        bubble_meta["items"] = items
        proposal["items"] = items
        bubble_meta["proposal"] = proposal
    # Buttons carry the choices — do not also keep them as prose bullets.
    stripped = strip_choice_echo(last_bubble.body_text or "")
    if stripped != (last_bubble.body_text or ""):
        last_bubble.body_text = stripped
        last_bubble.body_preview = (stripped[:200] if stripped else last_bubble.body_preview)
    last_bubble.metadata_json = json.dumps(bubble_meta, default=str)
    card_meta["attached_to_message_id"] = str(last_bubble.id)
    card.metadata_json = json.dumps(card_meta, default=str)


def _seal_activity_items(items: Any) -> list[dict[str, Any]]:
    """Mark still-running activity rows as failed so the trail stops looking live."""
    out: list[dict[str, Any]] = []
    if not isinstance(items, list):
        return out
    now = datetime.utcnow().isoformat() + "Z"
    for raw in items:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        if str(item.get("status") or "") == "running":
            item["status"] = "error"
            item["ended_at"] = item.get("ended_at") or now
        out.append(item)
    return out


async def seal_in_progress_checkpoints(
    session: AsyncSession,
    signal: Signal,
    *,
    error_text: str | None = None,
    author_agent_id: UUID | None = None,
    replace_with_error: bool = False,
    checkpoint_message_id: UUID | None = None,
) -> list[SignalMessage]:
    """Close open turn checkpoints left by a crash, timeout, or reclaim.

    Clears ``in_progress``, seals running activity as ``error``. When
    ``replace_with_error`` is set, rewrites the newest checkpoint body to the
    error text so the operator sees one bubble (trail + failure), not a stuck
    “Update folder canvas” under a separate error card.
    """
    from app.gateway.publish import publish_signal_message

    rows = (
        await session.execute(
            select(SignalMessage)
            .where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.tenant_id == signal.tenant_id,
                SignalMessage.kind == "agent_message",
            )
            .order_by(SignalMessage.created_at.desc())
            .limit(12)
        )
    ).scalars().all()
    sealed: list[SignalMessage] = []
    preferred = checkpoint_message_id
    for message in rows:
        try:
            meta = json.loads(message.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if not isinstance(meta, dict) or not meta.get("in_progress"):
            continue
        if preferred is not None and message.id != preferred and sealed:
            # Prefer sealing the known checkpoint; still close other orphans.
            pass
        meta["activity"] = _seal_activity_items(meta.get("activity"))
        meta["activity_after"] = _seal_activity_items(meta.get("activity_after"))
        meta.pop("in_progress", None)
        meta["turn_failed"] = True
        if replace_with_error and error_text and not sealed:
            speech = error_text.strip() or "The assistant encountered an error."
            message.body_text = speech
            message.body_preview = speech[:200]
            meta["error"] = True
            if author_agent_id:
                message.author_agent_id = author_agent_id
            now = datetime.utcnow()
            message.created_at = now
            if hasattr(message, "received_at"):
                message.received_at = now
        message.metadata_json = json.dumps(meta, default=str)
        session.add(message)
        sealed.append(message)
        try:
            await publish_signal_message(signal, message)
        except Exception:  # noqa: BLE001
            pass
    if sealed:
        now = datetime.utcnow()
        signal.last_message_at = now
        signal.updated_at = now
        session.add(signal)
        await session.flush()
    return sealed


async def upsert_turn_checkpoint(
    session: AsyncSession,
    signal: Signal,
    *,
    message_id: UUID | None,
    author_agent_id: UUID | None,
    turn_id: str | None,
    segments: list[dict[str, Any]],
    metadata: dict[str, Any] | None = None,
    fallback_text: str = "Working on this.",
) -> SignalMessage:
    """Write the open turn onto one thread message so a reload shows the work.

    One row per turn while it runs; ``persist_agent_turn`` later replaces it
    with the finished bubbles. Caller commits."""
    from app.gateway.publish import publish_signal_message
    from app.services.assistant_threads import append_signal_chat_message
    from app.services.agent.style import strip_emoji

    planned = plan_turn_messages(segments, CHAT, fallback_text=fallback_text)
    text = "\n\n".join(b["text"] for b in planned if (b.get("text") or "").strip()) or fallback_text
    activity: list[dict[str, Any]] = []
    after: list[dict[str, Any]] = []
    for bubble in planned:
        activity.extend(bubble.get("activity") or [])
        after.extend(bubble.get("activity_after") or [])
    speech = strip_emoji(text) or text
    meta: dict[str, Any] = dict(metadata or {})
    if turn_id:
        meta["turn_id"] = turn_id
    meta["in_progress"] = True
    if activity:
        meta["activity"] = activity
    if after:
        meta["activity_after"] = after

    existing = await session.get(SignalMessage, message_id) if message_id else None
    if existing is not None and existing.signal_id == signal.id:
        existing.body_text = speech
        existing.body_preview = speech[:200]
        existing.metadata_json = json.dumps(meta, default=str)
        existing.author_agent_id = author_agent_id or existing.author_agent_id
        now = datetime.utcnow()
        signal.last_message_at = now
        signal.updated_at = now
        await session.flush()
        await publish_signal_message(signal, existing)
        return existing

    message = await append_signal_chat_message(
        session,
        signal,
        role="assistant",
        content=speech,
        author_agent_id=author_agent_id,
        metadata=meta,
    )
    return message


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
    showcase_items: list[dict[str, Any]] | None = None,
    replace_message_id: UUID | None = None,
) -> list[SignalMessage]:
    """Append the turn's bubbles to the thread. ``first_metadata`` (AI
    disclosure) lands on the first message, ``final_metadata`` (usage,
    thinking) on the last; ``append_to_last`` extends the last bubble's text.
    ``replace_message_id`` updates an in-progress checkpoint instead of
    adding a second row. Caller commits."""
    from app.gateway.publish import publish_signal_message
    from app.services.assistant_threads import append_signal_chat_message
    from app.services.agent.mention_repair import repair_mentions
    from app.services.agent.style import strip_emoji

    planned = plan_turn_messages(segments, reply_mode, fallback_text=fallback_text)
    choice_options: list[dict[str, Any]] = []
    if is_internal_channel(signal.channel or ""):
        planned, choice_options = prepare_choice_repair(planned)
    if append_to_last:
        planned[-1]["text"] = f"{planned[-1]['text']}{append_to_last}"
    messages: list[SignalMessage] = []
    replaced = False
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
        meta.pop("in_progress", None)
        # AI speech only — never strip operator/customer content here.
        speech = strip_emoji(bubble["text"] or "") or (bubble["text"] or "")
        speech = await repair_mentions(session, signal.tenant_id, speech)
        existing = None
        if not replaced and replace_message_id:
            existing = await session.get(SignalMessage, replace_message_id)
            if existing is None or existing.signal_id != signal.id:
                existing = None
        if existing is not None:
            existing.body_text = speech
            existing.body_preview = speech[:200]
            existing.metadata_json = json.dumps(meta, default=str)
            existing.author_agent_id = author_agent_id or existing.author_agent_id
            # Checkpoint rows keep the early created_at from "Working on this.".
            # Bump so the finished bubble sorts after mid-turn side effects
            # (tag events, notes) that landed while the turn was open.
            now = datetime.utcnow()
            existing.created_at = now
            if hasattr(existing, "received_at"):
                existing.received_at = now
            await session.flush()
            await publish_signal_message(signal, existing)
            msg = existing
            replaced = True
        else:
            msg = await append_signal_chat_message(
                session,
                signal,
                role="assistant",
                content=speech,
                author_agent_id=author_agent_id,
                metadata=meta,
            )
        if messages:
            prev_t = messages[-1].received_at or messages[-1].created_at
            if (msg.received_at or msg.created_at) <= prev_t:
                msg.received_at = prev_t + timedelta(milliseconds=20)
        messages.append(msg)
    if choice_options and messages:
        await _raise_tag_choice(
            session,
            signal,
            messages[-1],
            choice_options,
            author_agent_id=author_agent_id,
            turn_id=turn_id,
        )
    await place_turn_decisions(session, signal, messages)
    # Attach after place_turn_decisions so decision cards can also contribute items.
    if messages:
        _attach_showcase_items(
            signal.id,
            messages,
            extra_items=showcase_items,
        )
    await touch_agent_activity(session, author_agent_id)
    return messages
