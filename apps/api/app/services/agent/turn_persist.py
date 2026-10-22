"""Save one agent turn as thread messages.

Chat mode: one turn is one SignalMessage. Speech before and after tool calls
joins with a blank line; the work sits on that message (``metadata.activity``
above, ``activity_after`` below).

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

from app.core.time import utcnow
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage, is_internal_channel
from app.services.agent.reply_mode import CHAT, MAX_CHAT_MESSAGES, split_chat_messages

_RULE_SETTINGS_LINK = re.compile(r"/settings/channels#automation-rules", re.IGNORECASE)


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

    # One turn is one bubble: all speech in order, the work above it, the work
    # after the last sentence below it.
    texts: list[str] = []
    before: list[dict[str, Any]] = []
    after: list[dict[str, Any]] = []
    segment_id = None
    for seg in segments:
        activity_rows = [*(seg.get("activity") or []), *(seg.get("activity_after") or [])]
        echoed: list[str] = []
        for row in activity_rows:
            if not isinstance(row, dict) or row.get("tool") != "generate_image":
                continue
            echoed.extend(str(url) for url in (row.get("image_urls") or []) if url)
            echoed.extend(_generated_image_urls(row.get("result")))
        spoken = strip_generated_image_echo(seg.get("text") or "", echoed).strip()
        if spoken:
            before.extend(after)
            after = []
            before.extend(seg.get("activity") or [])
            after.extend(seg.get("activity_after") or [])
            texts.append(spoken)
            segment_id = segment_id or seg.get("id")
        else:
            after.extend(activity_rows)
    if not texts:
        return [{"text": fallback_text, "activity": [*before, *after], "activity_after": [], "segment_id": None}]
    return [{"text": "\n\n".join(texts), "activity": before, "activity_after": after, "segment_id": segment_id}]


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
        agent.last_active_at = utcnow()
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
            if not isinstance(item, dict):
                continue
            raw_ids = item.get("decision_ids")
            if isinstance(raw_ids, list):
                found.update(str(value) for value in raw_ids if value)
            found |= decision_ids_from_result(item.get("result"))
    return found


def drop_redundant_rule_link(planned: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop a trailing settings-link bubble when this turn already raised a card.

    The card is the question. A last bubble that only points at Automation
    rules repeats it.
    """
    if len(planned) < 2:
        return planned
    if not any(
        decision_ids_in_activity(
            {"activity": bubble.get("activity"), "activity_after": bubble.get("activity_after")}
        )
        for bubble in planned
    ):
        return planned
    text = str(planned[-1].get("text") or "").strip()
    if not text or not _RULE_SETTINGS_LINK.search(text):
        return planned
    without = _RULE_SETTINGS_LINK.sub("", text)
    without = re.sub(r"\[[^\]]*\]\([^)]*\)", "", without)
    if len(re.sub(r"[\W_]+", "", without)) > 80:
        return planned
    dropped = planned[-1]
    kept = planned[:-1]
    extra = list(dropped.get("activity") or []) + list(dropped.get("activity_after") or [])
    if extra:
        host = kept[-1]
        host["activity_after"] = list(host.get("activity_after") or []) + extra
    return kept


def _message_time(row: SignalMessage) -> datetime:
    return row.received_at or row.created_at


def _is_customer_reply(decision: DecisionRequest) -> bool:
    """A suggested reply is the approve row on the customer thread, not a question in the session."""
    try:
        options = json.loads(decision.options_json or "[]")
    except json.JSONDecodeError:
        return False
    if not isinstance(options, list):
        return False
    return any(
        isinstance(opt, dict) and str(opt.get("action_type") or "") == "send_reply"
        for opt in options
    )


def _copy_turn_id(card: SignalMessage, bubbles: list[SignalMessage]) -> None:
    """Keep the card on the same live turn as the speech, so it stays hidden
    until that speech has landed and does not shove the bubbles aside."""
    turn_id = ""
    for bubble in reversed(bubbles):
        turn_id = str(_json_meta(bubble).get("turn_id") or "").strip()
        if turn_id:
            break
    if not turn_id:
        return
    meta = _json_meta(card)
    if meta.get("turn_id") == turn_id:
        return
    meta["turn_id"] = turn_id
    card.metadata_json = json.dumps(meta, default=str)


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
        # The card follows the whole explanation, not the tool bubble that raised it.
        stamp = _message_time(turn_messages[-1]) or utcnow()
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
        last_stamp = _message_time(turn_messages[-1]) if turn_messages else utcnow()
        for decision in pending_rows:
            home_id = decision.signal_id
            home = (
                await session.get(Signal, home_id)
                if home_id is not None and home_id != signal.id
                else None
            )
            # A suggested reply stays on the customer thread, under the speech.
            # Other cards raised against that thread still follow the session,
            # where the question is read.
            keep_home = (
                home is not None
                and not is_internal_channel(home.channel or "")
                and _is_customer_reply(decision)
            )
            if home_id != signal.id and not keep_home:
                decision.signal_id = signal.id
                session.add(decision)
            await reveal_decision(session, signal.tenant_id, decision)
            anchors.setdefault(str(decision.id), last_stamp or utcnow())
            if keep_home and decision.message_id and turn_messages:
                from app.services.message_seq import next_seq

                card = await session.get(SignalMessage, decision.message_id)
                if card is not None:
                    # Strictly after the speech. The merged timeline orders a
                    # host card and a session bubble by time, and an equal
                    # time puts the card first.
                    spoken = _message_time(turn_messages[-1]) or utcnow()
                    card.received_at = spoken + timedelta(milliseconds=50)
                    card.seq = await next_seq(session, home.id)
                    _copy_turn_id(card, turn_messages)
                    session.add(card)

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
    turn_window_start = (first_time or utcnow()) - timedelta(seconds=2)
    turn_window_end = (last_time or utcnow()) + timedelta(seconds=2)
    for card in cards:
        did = str(card.decision_id) if card.decision_id else str(card.id)
        current = _message_time(card)
        if did in anchors:
            from app.services.message_seq import next_seq

            card.received_at = anchors[did]
            card.seq = await next_seq(session, signal.id)
            _copy_turn_id(card, turn_messages)
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
        proposal_meta = meta.get("proposal") if isinstance(meta.get("proposal"), dict) else {}
        row_keys = {
            key
            for row in proposal_meta.get("bundle") or []
            if isinstance(row, dict)
            for item in row.get("items") or []
            if isinstance(item, dict)
            for key in _item_keys(item)
        }
        if row_keys:
            merged = [i for i in merged if not isinstance(i, dict) or not (_item_keys(i) & row_keys)]
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


def _item_keys(item: dict[str, Any]) -> set[tuple[str, str]]:
    """Ways one showcase object is named: by id and by name."""
    kind = str(item.get("type") or "")
    keys = set()
    if item.get("id"):
        keys.add((kind, str(item["id"])))
    name = str(item.get("name") or item.get("title") or "").strip().lstrip("#").lower()
    if name:
        keys.add((kind, f"name:{name}"))
    return keys


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
    # An action card shows its object in its own row; it is not also a
    # showcase under the bubble, or the operator reads the same list twice.
    bundle = []
    for c in ordered:
        if not _is_action_decision(decisions.get(str(c.decision_id))):
            continue
        row: dict[str, Any] = {"decision_id": str(c.decision_id), "card_message_id": str(c.id)}
        row_items = [i for i in (_json_meta(c).get("proposal_items") or []) if isinstance(i, dict)]
        if row_items:
            row["items"] = row_items
        bundle.append(row)
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
        if str(c.decision_id) not in bundled_ids
        for item in (_json_meta(c).get("proposal_items") or [])
        if isinstance(item, dict)
    ]
    if bundled_ids:
        row_keys = {key for r in bundle for i in r.get("items") or [] for key in _item_keys(i)}
        kept = [
            i
            for i in (bubble_meta.get("items") if isinstance(bubble_meta.get("items"), list) else [])
            if not isinstance(i, dict) or not (_item_keys(i) & row_keys)
        ]
        if kept:
            bubble_meta["items"] = kept
        else:
            bubble_meta.pop("items", None)
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
    now = utcnow().isoformat() + "Z"
    for raw in items:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        if str(item.get("status") or "") == "running":
            item["status"] = "error"
            item["ended_at"] = item.get("ended_at") or now
        out.append(item)
    return out


async def end_dead_turns(
    session: AsyncSession,
    signal: Signal,
    *,
    error_text: str | None = None,
    author_agent_id: UUID | None = None,
    older_than: timedelta | None = None,
    keep: set[str] | None = None,
) -> list[SignalMessage]:
    """Close open turns whose writer is gone (crash, timeout, reclaim).

    Each gets ``turn.completed`` with ``error`` on the thread log. With
    ``error_text``, the newest one also leaves one error bubble that carries
    the work it did, sealed. Caller commits.
    """
    from app.services import thread_log
    from app.services.assistant_threads import append_signal_chat_message

    closed = await thread_log.close_open_turns(
        signal.tenant_id,
        signal.id,
        reason="error",
        older_than_s=older_than.total_seconds() if older_than is not None else None,
        keep=keep,
    )
    if not closed or not error_text:
        return []
    data = closed[-1]["data"]
    items: list[dict[str, Any]] = []
    surface = data.get("surface") if isinstance(data.get("surface"), dict) else {}
    for block in surface.get("blocks") or []:
        if isinstance(block, dict) and block.get("type") == "activity":
            items.extend(row for row in block.get("items") or [] if isinstance(row, dict))
    author = author_agent_id
    raw_author = data.get("author") if isinstance(data.get("author"), dict) else {}
    if author is None and raw_author.get("id"):
        try:
            author = UUID(str(raw_author["id"]))
        except ValueError:
            author = None
    meta: dict[str, Any] = {"error": True, "turn_failed": True}
    if data.get("stream_id"):
        meta["turn_id"] = str(data["stream_id"])
    if items:
        meta["activity"] = _seal_activity_items(items)
    message = await append_signal_chat_message(
        session,
        signal,
        role="assistant",
        content=error_text.strip() or "The assistant encountered an error.",
        author_agent_id=author,
        metadata=meta,
    )
    return [message]


MAX_KNOWLEDGE_REFS = 8


def knowledge_refs(hits: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    """The workspace docs a turn read: ``[{doc_id, title}]``, unique, in read order."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for hit in hits or []:
        if not isinstance(hit, dict):
            continue
        doc_id = str(hit.get("doc_id") or "").strip()
        if not doc_id or doc_id in seen or not _is_uuid(doc_id):
            continue
        seen.add(doc_id)
        out.append({"doc_id": doc_id, "title": str(hit.get("title") or "")[:160]})
        if len(out) >= MAX_KNOWLEDGE_REFS:
            break
    return out


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
    knowledge_hits: list[dict[str, Any]] | None = None,
) -> list[SignalMessage]:
    """Append the turn's bubbles to the thread. ``first_metadata`` (AI
    disclosure) lands on the first message, ``final_metadata`` (usage,
    thinking) on the last; ``append_to_last`` extends the last bubble's text.
    Each bubble keeps the ``seq`` its speech item reserved and names it in
    ``segment_id``, so the live item and the saved row are the same object.
    Caller commits."""
    from app.services.agent.mention_repair import repair_mentions
    from app.services.agent.style import strip_emoji
    from app.services.assistant_threads import append_signal_chat_message

    planned = plan_turn_messages(segments, reply_mode, fallback_text=fallback_text)
    if append_to_last and planned:
        planned[-1]["text"] = f"{planned[-1]['text']}{append_to_last}"
    planned = drop_redundant_rule_link(planned)
    refs = knowledge_refs(knowledge_hits)
    messages: list[SignalMessage] = []
    reserved = {
        str(seg.get("id")): int(seg["seq"])
        for seg in segments
        if seg.get("id") and isinstance(seg.get("seq"), int)
    }
    for index, bubble in enumerate(planned):
        meta: dict[str, Any] = dict(metadata or {})
        if refs:
            meta["knowledge_refs"] = refs
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
        # AI speech only — never strip operator/customer content here.
        speech = strip_emoji(bubble["text"] or "") or (bubble["text"] or "")
        speech = await repair_mentions(session, signal.tenant_id, speech)
        seq = reserved.pop(str(bubble.get("segment_id") or ""), None)
        if messages and seq is not None and messages[-1].seq is not None and seq <= messages[-1].seq:
            seq = None
        msg = await append_signal_chat_message(
            session,
            signal,
            role="assistant",
            content=speech,
            author_agent_id=author_agent_id,
            metadata=meta,
            seq=seq,
        )
        messages.append(msg)
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
