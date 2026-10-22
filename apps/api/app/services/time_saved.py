"""Estimated operator minutes saved from AI actions (platform credit matrix).

``time_saved = Σ count(action) × minutes(action)`` for AI outcomes only.
Manual human replies are counted for the Overview mix chart but do not add to
time saved. Weights live in ``platform_settings`` (staff Ops) with code defaults.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.agent import AgentRun
from app.models.notification import DecisionRequest
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
    # Human outbound (not time saved — effort weight for the action mix chart).
    "manual_reply": 8,
}

# Which AI-handling mode each credit rolls up into for the Overview mix.
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
        row.updated_at = utcnow()
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


def _naive_dt(value: datetime | None) -> datetime | None:
    if value is None or not hasattr(value, "replace"):
        return value
    if getattr(value, "tzinfo", None) is not None:
        return value.replace(tzinfo=None)
    return value


def _event_day(value: datetime | None) -> str | None:
    when = _naive_dt(value)
    if when is None:
        return None
    return when.date().isoformat() if hasattr(when, "date") else str(when)[:10]


def _classify_draft(status: str | None, option_id: str | None) -> str | None:
    option = (option_id or "").strip()
    if option in SKIP_DRAFT_OPTIONS:
        return None
    if status == "deferred" and option in HUMAN_CONTINUED_OPTIONS:
        return "assisted_draft_human_continued"
    if status != "approved":
        return None
    if option in UNCHANGED_DRAFT_OPTIONS:
        return "assisted_draft_unchanged"
    if option in HUMAN_CONTINUED_OPTIONS:
        return "assisted_draft_human_continued"
    return "assisted_draft_edited"


async def collect_action_events(
    session: AsyncSession, tenant_id: UUID, *, since: datetime
) -> list[tuple[datetime, str]]:
    """Dated (when, action_key) rows for the Overview mix and time-saved totals."""
    events: list[tuple[datetime, str]] = []

    auto_rows = (
        await session.execute(
            select(SignalMessage.created_at).where(
                SignalMessage.tenant_id == tenant_id,
                SignalMessage.auto_sent.is_(True),
                SignalMessage.created_at >= since,
            )
        )
    ).all()
    for (created,) in auto_rows:
        when = _naive_dt(created)
        if when is not None:
            events.append((when, "autonomous_reply"))

    draft_rows = (
        await session.execute(
            select(
                DecisionRequest.resolved_at,
                DecisionRequest.status,
                DecisionRequest.chosen_option_id,
            ).where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.title.in_(REPLY_CREDIT_TITLES),
                DecisionRequest.resolved_at.is_not(None),
                DecisionRequest.resolved_at >= since,
                DecisionRequest.status.in_(("approved", "deferred")),
            )
        )
    ).all()
    for resolved_at, status, option_id in draft_rows:
        action = _classify_draft(status, option_id)
        when = _naive_dt(resolved_at)
        if action and when is not None:
            events.append((when, action))

    no_reply_rows = (
        await session.execute(
            select(DecisionRequest.resolved_at).where(
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
    ).all()
    for (resolved_at,) in no_reply_rows:
        when = _naive_dt(resolved_at)
        if when is not None:
            events.append((when, "no_reply_confirmed"))

    triage_rows = (
        await session.execute(
            select(SignalEvent.created_at).where(
                SignalEvent.tenant_id == tenant_id,
                SignalEvent.event_type == "no_reply_noted",
                SignalEvent.created_at >= since,
            )
        )
    ).all()
    for (created,) in triage_rows:
        when = _naive_dt(created)
        if when is not None:
            events.append((when, "no_reply_triaged"))

    ticket_rows = (
        await session.execute(
            select(SignalEvent.created_at).where(
                SignalEvent.tenant_id == tenant_id,
                SignalEvent.event_type == "category_set",
                SignalEvent.actor_type.in_(TICKET_ACTOR_TYPES),
                SignalEvent.created_at >= since,
            )
        )
    ).all()
    for (created,) in ticket_rows:
        when = _naive_dt(created)
        if when is not None:
            events.append((when, "ticket_filed_by_agent"))

    # Flow attribution lives on AgentRun.workstream_id (workstream_runs retired).
    flow_rows = (
        await session.execute(
            select(AgentRun.completed_at).where(
                AgentRun.tenant_id == tenant_id,
                AgentRun.workstream_id.is_not(None),
                AgentRun.status == "completed",
                AgentRun.completed_at.is_not(None),
                AgentRun.completed_at >= since,
            )
        )
    ).all()
    for (completed_at,) in flow_rows:
        when = _naive_dt(completed_at)
        if when is not None:
            events.append((when, "flow_run_completed"))

    manual_rows = (
        await session.execute(
            select(SignalMessage.created_at).where(
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
    ).all()
    for (created,) in manual_rows:
        when = _naive_dt(created)
        if when is not None:
            events.append((when, "manual_reply"))

    return events


def aggregate_time_saved(
    events: list[tuple[datetime, str]],
    minutes_each: dict[str, int],
    *,
    days: int,
) -> dict[str, Any]:
    counts = {key: 0 for key in DEFAULT_ACTION_MINUTES}
    for _when, action in events:
        if action in counts:
            counts[action] += 1
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


def bucket_action_mix_series(
    events: list[tuple[datetime, str]],
    minutes_each: dict[str, int],
    *,
    days: int,
    end: datetime | None = None,
) -> list[dict[str, Any]]:
    """Daily AI vs manual weighted minutes. Empty days stay in the list as zeros."""
    days = max(1, min(int(days), 90))
    today = (end or utcnow()).date()
    start_day = today - timedelta(days=days - 1)
    buckets: dict[str, dict[str, int]] = {
        (start_day + timedelta(days=i)).isoformat(): {
            "ai_minutes": 0,
            "manual_minutes": 0,
            "ai_count": 0,
            "manual_count": 0,
        }
        for i in range(days)
    }
    for when, action in events:
        day = _event_day(when)
        if day not in buckets:
            continue
        minutes = int(minutes_each.get(action, 0))
        if ACTION_MODES.get(action) == "manual":
            buckets[day]["manual_minutes"] += minutes
            buckets[day]["manual_count"] += 1
        else:
            buckets[day]["ai_minutes"] += minutes
            buckets[day]["ai_count"] += 1
    return [{"date": day, **values} for day, values in buckets.items()]


async def compute_time_saved(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    days: int = 7,
    series_days: int | None = None,
) -> dict[str, Any]:
    """Sum action credits for the last ``days`` days, plus a daily mix series."""
    days = max(1, min(int(days), 90))
    series_days_n = max(days, min(int(series_days), 90)) if series_days is not None else days
    now = utcnow()
    since = now - timedelta(days=series_days_n)
    minutes_each = await load_action_minutes(session)
    events = await collect_action_events(session, tenant_id, since=since)
    week_since = now - timedelta(days=days)
    week_events = [(when, action) for when, action in events if when >= week_since]
    result = aggregate_time_saved(week_events, minutes_each, days=days)
    result["by_day"] = bucket_action_mix_series(
        events, minutes_each, days=series_days_n, end=now
    )
    return result
