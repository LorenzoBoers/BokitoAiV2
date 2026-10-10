"""Estimated operator minutes saved from AI actions (platform credit matrix).

``time_saved = Σ count(action) × minutes(action)`` for AI outcomes only.
Manual human replies are counted for the Overview mix pie but do not add to
time saved. Weights live in ``platform_settings`` (staff Ops) with code defaults.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import DecisionRequest
from app.models.orchestra import WorkstreamRun
from app.models.signal import SignalEvent, SignalMessage
from app.services.ownership import DRAFT_TITLES, NO_REPLY_TITLE

# Staff-editable platform_settings key (JSON object of action → minutes).
WEIGHTS_SETTING_KEY = "time_saved_action_minutes"

# Minutes credited per discrete outcome. Platform defaults; Ops can override.
# Slightly generous vs. a strict stopwatch so the Overview credit reads as
# real operator time saved (still editable under staff Ops).
DEFAULT_ACTION_MINUTES: dict[str, int] = {
    "autonomous_reply": 15,
    "assisted_draft_unchanged": 12,
    "assisted_draft_edited": 8,
    "assisted_draft_human_continued": 9,
    "no_reply_triaged": 3,
    "no_reply_confirmed": 7,
    "ticket_filed_by_agent": 7,
    "flow_run_completed": 10,
    # Human outbound (not time saved — effort weight for the action mix pie).
    "manual_reply": 8,
}

# Which AI-handling mode each credit rolls up into for the Overview pie.
ACTION_MODES: dict[str, str] = {
    "autonomous_reply": "autonomous",
    "assisted_draft_unchanged": "assisted",
    "assisted_draft_edited": "assisted",
    "assisted_draft_human_continued": "assisted",
    "no_reply_triaged": "assisted",
    "no_reply_confirmed": "assisted",
    "ticket_filed_by_agent": "assisted",
    "flow_run_completed": "autonomous",
    "manual_reply": "manual",
}

# Keep a stable name for callers/tests that imported ACTION_MINUTES.
ACTION_MINUTES = DEFAULT_ACTION_MINUTES

# Reply-suggestion cards that count toward draft credits (plus ask-before send).
REPLY_CREDIT_TITLES = DRAFT_TITLES + ("Approve: Send reply",)

UNCHANGED_DRAFT_OPTIONS = frozenset({"send", "approve"})
SKIP_DRAFT_OPTIONS = frozenset(
    {
        "superseded",
        "dismissed",
        "later",
        "defer",
        "superseded_by_inbound",
        "sibling_thread",
        "human_approved_sibling",
        "",
    }
)
# Draft set aside because a human took the conversation forward after AI drafted.
HUMAN_CONTINUED_OPTIONS = frozenset(
    {
        "human_replied",
        "superseded_by_external_reply",
        "handled_externally",
    }
)
NO_REPLY_CONFIRM_OPTIONS = frozenset({"close", "approve", "confirm", "send", "archive"})
# category_set from the inbound triage path uses actor_type "triage", not "agent".
TICKET_ACTOR_TYPES = frozenset({"agent", "triage"})

_MIN_WEIGHT = 0
_MAX_WEIGHT = 120


def clamp_action_minutes(value: Any) -> int | None:
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        return None
    if minutes < _MIN_WEIGHT or minutes > _MAX_WEIGHT:
        return None
    return minutes


def merge_action_minutes(raw: dict[str, Any] | None) -> dict[str, int]:
    """Defaults plus any valid overrides for known action keys."""
    merged = dict(DEFAULT_ACTION_MINUTES)
    if not isinstance(raw, dict):
        return merged
    for key, value in raw.items():
        if key not in DEFAULT_ACTION_MINUTES:
            continue
        minutes = clamp_action_minutes(value)
        if minutes is not None:
            merged[key] = minutes
    return merged


async def load_action_minutes(session: AsyncSession) -> dict[str, int]:
    """Platform weights from Ops, falling back to code defaults."""
    from app.models.model_catalog import PlatformSetting

    row = (
        await session.execute(
            select(PlatformSetting).where(PlatformSetting.key == WEIGHTS_SETTING_KEY)
        )
    ).scalar_one_or_none()
    if row is None or not (row.value or "").strip():
        return dict(DEFAULT_ACTION_MINUTES)
    try:
        parsed = json.loads(row.value)
    except json.JSONDecodeError:
        return dict(DEFAULT_ACTION_MINUTES)
    return merge_action_minutes(parsed if isinstance(parsed, dict) else None)


async def save_action_minutes(
    session: AsyncSession, weights: dict[str, Any]
) -> dict[str, int]:
    """Persist staff overrides for known actions; returns the merged matrix."""
    from app.models.model_catalog import PlatformSetting

    merged = merge_action_minutes(weights)
    payload = json.dumps({key: merged[key] for key in DEFAULT_ACTION_MINUTES})
    row = (
        await session.execute(
            select(PlatformSetting).where(PlatformSetting.key == WEIGHTS_SETTING_KEY)
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(PlatformSetting(key=WEIGHTS_SETTING_KEY, value=payload))
    else:
        row.value = payload
        row.updated_at = datetime.utcnow()
        session.add(row)
    await session.commit()
    return merged


def action_weight_catalog(minutes: dict[str, int] | None = None) -> list[dict[str, Any]]:
    """Staff Ops rows: action key, mode, and minutes each."""
    matrix = minutes or DEFAULT_ACTION_MINUTES
    return [
        {
            "action": key,
            "mode": ACTION_MODES[key],
            "minutes": int(matrix.get(key, DEFAULT_ACTION_MINUTES[key])),
            "counts_as_saved": ACTION_MODES[key] != "manual",
        }
        for key in DEFAULT_ACTION_MINUTES
    ]


async def compute_time_saved(
    session: AsyncSession, tenant_id: UUID, *, days: int = 7
) -> dict[str, Any]:
    """Sum action credits for the last ``days`` days."""
    days = max(1, min(int(days), 90))
    since = datetime.utcnow() - timedelta(days=days)
    minutes_each = await load_action_minutes(session)

    autonomous_replies = int(
        (
            await session.execute(
                select(func.count()).select_from(SignalMessage).where(
                    SignalMessage.tenant_id == tenant_id,
                    SignalMessage.auto_sent.is_(True),
                    SignalMessage.created_at >= since,
                )
            )
        ).scalar()
        or 0
    )

    draft_rows = (
        await session.execute(
            select(DecisionRequest.status, DecisionRequest.chosen_option_id).where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.title.in_(REPLY_CREDIT_TITLES),
                DecisionRequest.resolved_at.is_not(None),
                DecisionRequest.resolved_at >= since,
                DecisionRequest.status.in_(("approved", "deferred")),
            )
        )
    ).all()
    draft_unchanged = 0
    draft_edited = 0
    draft_human_continued = 0
    for status, option_id in draft_rows:
        option = (option_id or "").strip()
        if option in SKIP_DRAFT_OPTIONS:
            continue
        if status == "deferred" and option in HUMAN_CONTINUED_OPTIONS:
            draft_human_continued += 1
            continue
        if status != "approved":
            continue
        if option in UNCHANGED_DRAFT_OPTIONS:
            draft_unchanged += 1
        elif option in HUMAN_CONTINUED_OPTIONS:
            draft_human_continued += 1
        else:
            # Edited send, custom option id, etc.
            draft_edited += 1

    no_reply_confirmed = int(
        (
            await session.execute(
                select(func.count()).select_from(DecisionRequest).where(
                    DecisionRequest.tenant_id == tenant_id,
                    DecisionRequest.title == NO_REPLY_TITLE,
                    DecisionRequest.status == "approved",
                    DecisionRequest.resolved_at.is_not(None),
                    DecisionRequest.resolved_at >= since,
                    or_(
                        DecisionRequest.chosen_option_id.in_(NO_REPLY_CONFIRM_OPTIONS),
                        DecisionRequest.chosen_option_id.is_(None),
                    ),
                )
            )
        ).scalar()
        or 0
    )

    no_reply_triaged = int(
        (
            await session.execute(
                select(func.count()).select_from(SignalEvent).where(
                    SignalEvent.tenant_id == tenant_id,
                    SignalEvent.event_type == "no_reply_noted",
                    SignalEvent.created_at >= since,
                )
            )
        ).scalar()
        or 0
    )

    tickets_by_agent = int(
        (
            await session.execute(
                select(func.count()).select_from(SignalEvent).where(
                    SignalEvent.tenant_id == tenant_id,
                    SignalEvent.event_type == "category_set",
                    SignalEvent.actor_type.in_(TICKET_ACTOR_TYPES),
                    SignalEvent.created_at >= since,
                )
            )
        ).scalar()
        or 0
    )

    flow_runs = int(
        (
            await session.execute(
                select(func.count()).select_from(WorkstreamRun).where(
                    WorkstreamRun.tenant_id == tenant_id,
                    WorkstreamRun.status == "completed",
                    WorkstreamRun.completed_at.is_not(None),
                    WorkstreamRun.completed_at >= since,
                )
            )
        ).scalar()
        or 0
    )

    # Human customer-facing replies (not AI auto-send, not internal notes).
    manual_replies = int(
        (
            await session.execute(
                select(func.count()).select_from(SignalMessage).where(
                    SignalMessage.tenant_id == tenant_id,
                    SignalMessage.direction == "outbound",
                    SignalMessage.auto_sent.is_(False),
                    SignalMessage.author_user_id.is_not(None),
                    SignalMessage.created_at >= since,
                    or_(
                        SignalMessage.kind.is_(None),
                        SignalMessage.kind == "user_message",
                    ),
                )
            )
        ).scalar()
        or 0
    )

    counts = {
        "autonomous_reply": autonomous_replies,
        "assisted_draft_unchanged": draft_unchanged,
        "assisted_draft_edited": draft_edited,
        "assisted_draft_human_continued": draft_human_continued,
        "no_reply_triaged": no_reply_triaged,
        "no_reply_confirmed": no_reply_confirmed,
        "ticket_filed_by_agent": tickets_by_agent,
        "flow_run_completed": flow_runs,
        "manual_reply": manual_replies,
    }
    by_action = [
        {
            "action": key,
            "mode": ACTION_MODES[key],
            "count": counts[key],
            "minutes_each": minutes_each[key],
            "minutes": counts[key] * minutes_each[key],
            "counts_as_saved": ACTION_MODES[key] != "manual",
        }
        for key in DEFAULT_ACTION_MINUTES
    ]
    mode_totals: dict[str, dict[str, int]] = {
        "autonomous": {"count": 0, "minutes": 0},
        "assisted": {"count": 0, "minutes": 0},
        "manual": {"count": 0, "minutes": 0},
    }
    for row in by_action:
        mode = row["mode"]
        bucket = mode_totals.setdefault(mode, {"count": 0, "minutes": 0})
        bucket["count"] += int(row["count"])
        bucket["minutes"] += int(row["minutes"])
    by_mode = [
        {"mode": mode, "count": mode_totals[mode]["count"], "minutes": mode_totals[mode]["minutes"]}
        for mode in ("autonomous", "assisted", "manual")
    ]
    saved_minutes = sum(row["minutes"] for row in by_action if row["counts_as_saved"])
    return {
        "days": days,
        "minutes": saved_minutes,
        "by_action": by_action,
        "by_mode": by_mode,
    }
