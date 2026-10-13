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


def slim_activity_item(item: dict[str, Any]) -> dict[str, Any]:
    """List/stream shape: no tool payloads or thinking text. A note keeps its
    (short) text: it is the label operators read."""
    out = {k: v for k, v in item.items() if k not in _DETAIL_KEYS}
    if item.get("kind") == "think":
        out["has_text"] = bool(str(item.get("text") or "").strip())
    if item.get("label") == "note" and item.get("text"):
        out["text"] = str(item["text"])[:NOTE_TEXT_MAX]
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
    pending_q = select(DecisionRequest).where(
        DecisionRequest.tenant_id == signal.tenant_id,
        DecisionRequest.signal_id == signal.id,
        DecisionRequest.message_id.is_(None),
        DecisionRequest.status == "awaiting_human",
    )
    if pending_ids and turn_ids:
        pending_q = pending_q.where(
            (DecisionRequest.id.in_(pending_ids)) | (DecisionRequest.bundle_id.in_(list(turn_ids)))
        )
    elif pending_ids:
        pending_q = pending_q.where(DecisionRequest.id.in_(pending_ids))
    elif turn_ids:
        pending_q = pending_q.where(DecisionRequest.bundle_id.in_(list(turn_ids)))
    else:
        pending_q = None
    if pending_q is not None:
        pending_rows = (await session.execute(pending_q)).scalars().all()
        last_stamp = _message_time(turn_messages[-1]) if turn_messages else datetime.utcnow()
        for decision in pending_rows:
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


def _items_from_attach_activity(messages: list[SignalMessage]) -> list[dict[str, Any]]:
    """Rebuild showcase rows from tool activity when the in-memory stash is empty.

    ``list_folders`` / ``list_agents`` / ``attach_items`` (and similar) stash
    cards under ``result.items`` — harvest any of those, not only attach_items.
    """
    out: list[dict[str, Any]] = []
    for msg in messages:
        meta = _json_meta(msg)
        for key in ("activity", "activity_after"):
            for entry in meta.get(key) or []:
                if not isinstance(entry, dict):
                    continue
                result = entry.get("result")
                if isinstance(result, str):
                    try:
                        result = json.loads(result)
                    except json.JSONDecodeError:
                        continue
                if not isinstance(result, dict):
                    continue
                for row in result.get("items") or []:
                    if isinstance(row, dict) and row.get("type"):
                        out.append(row)
    return out


def _attach_showcase_items(
    signal_id: Any,
    last_bubble: SignalMessage,
    *,
    extra_items: list[dict[str, Any]] | None = None,
    turn_messages: list[SignalMessage] | None = None,
) -> None:
    """Write pending attach_items (and proposal items) onto the last bubble."""
    from app.services.proposal_items import infer_marketplace_items_from_text, take_attach_items

    bubble_meta = _json_meta(last_bubble)
    proposal = bubble_meta.get("proposal") if isinstance(bubble_meta.get("proposal"), dict) else {}

    pending = take_attach_items(signal_id)
    from_activity = _items_from_attach_activity(turn_messages or [last_bubble])
    proposal_items = proposal.get("items") if isinstance(proposal.get("items"), list) else []
    existing = bubble_meta.get("items") if isinstance(bubble_meta.get("items"), list) else []
    speech = "\n".join((m.body_text or "") for m in (turn_messages or [last_bubble]))
    inferred = infer_marketplace_items_from_text(speech)
    items = _merge_items(existing, pending, extra_items, from_activity, proposal_items, inferred)
    if not items:
        return
    bubble_meta["items"] = items
    if proposal:
        # Items live once on the bubble; keep decision_id / question / selection.
        proposal = {k: v for k, v in proposal.items() if k != "items"}
        proposal["items"] = items
        bubble_meta["proposal"] = proposal
    last_bubble.metadata_json = json.dumps(bubble_meta, default=str)


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
    ordered = sorted(turn_cards, key=lambda c: c.created_at or datetime.min)
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
    await place_turn_decisions(session, signal, messages)
    # Attach after place_turn_decisions so decision cards can also contribute items.
    if messages:
        _attach_showcase_items(
            signal.id,
            messages[-1],
            extra_items=showcase_items,
            turn_messages=messages,
        )
    await touch_agent_activity(session, author_agent_id)
    return messages
