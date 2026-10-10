"""Estimated operator minutes saved from AI actions (platform credit matrix).

``time_saved = Σ count(action) × minutes(action)``. Credits concrete outcomes
only; escalations, rejects and human-only replies are not counted.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import DecisionRequest
from app.models.orchestra import WorkstreamRun
from app.models.signal import SignalEvent, SignalMessage
from app.services.ownership import DRAFT_TITLES

# Minutes credited per discrete outcome. Tunable platform defaults (not tenant config).
ACTION_MINUTES: dict[str, int] = {
    "autonomous_reply": 8,
    "assisted_draft_unchanged": 4,
    "assisted_draft_edited": 2,
    "ticket_filed_by_agent": 3,
    "flow_run_completed": 6,
}

UNCHANGED_DRAFT_OPTIONS = frozenset({"send", "approve"})
SKIP_DRAFT_OPTIONS = frozenset({"superseded", "dismissed", "later", "defer", ""})


async def compute_time_saved(
    session: AsyncSession, tenant_id: UUID, *, days: int = 7
) -> dict[str, Any]:
    """Sum action credits for the last ``days`` days."""
    days = max(1, min(int(days), 90))
    since = datetime.utcnow() - timedelta(days=days)

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
            select(DecisionRequest.chosen_option_id).where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.title.in_(DRAFT_TITLES),
                DecisionRequest.status == "approved",
                DecisionRequest.resolved_at.is_not(None),
                DecisionRequest.resolved_at >= since,
            )
        )
    ).all()
    draft_unchanged = 0
    draft_edited = 0
    for (option_id,) in draft_rows:
        option = (option_id or "").strip()
        if option in SKIP_DRAFT_OPTIONS:
            continue
        if option in UNCHANGED_DRAFT_OPTIONS:
            draft_unchanged += 1
        else:
            draft_edited += 1

    tickets_by_agent = int(
        (
            await session.execute(
                select(func.count()).select_from(SignalEvent).where(
                    SignalEvent.tenant_id == tenant_id,
                    SignalEvent.event_type == "category_set",
                    SignalEvent.actor_type == "agent",
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

    counts = {
        "autonomous_reply": autonomous_replies,
        "assisted_draft_unchanged": draft_unchanged,
        "assisted_draft_edited": draft_edited,
        "ticket_filed_by_agent": tickets_by_agent,
        "flow_run_completed": flow_runs,
    }
    by_action = [
        {
            "action": key,
            "count": counts[key],
            "minutes_each": ACTION_MINUTES[key],
            "minutes": counts[key] * ACTION_MINUTES[key],
        }
        for key in ACTION_MINUTES
    ]
    return {
        "days": days,
        "minutes": sum(row["minutes"] for row in by_action),
        "by_action": by_action,
    }
