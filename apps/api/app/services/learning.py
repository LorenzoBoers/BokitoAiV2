"""LEARNING layer: feedback processing and eval score aggregation."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEvent
from app.models.learning import EvalScore, Feedback
from app.models.notification import DecisionRequest


async def submit_feedback(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    subject_type: str,
    subject_id: str,
    user_id: UUID | None = None,
    score: int | None = None,
    sentiment: str | None = None,
    comment: str = "",
) -> Feedback:
    row = Feedback(
        tenant_id=tenant_id,
        subject_type=subject_type,
        subject_id=subject_id,
        user_id=user_id,
        score=score,
        sentiment=sentiment,
        comment=comment,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def process_feedback_batch(session: AsyncSession, tenant_id: UUID, limit: int = 50) -> dict[str, Any]:
    result = await session.execute(
        select(Feedback)
        .where(Feedback.tenant_id == tenant_id, Feedback.processed.is_(False))
        .order_by(Feedback.created_at)
        .limit(limit)
    )
    rows = list(result.scalars().all())
    processed = 0
    up = down = 0
    score_sum = 0
    score_count = 0
    for row in rows:
        if row.sentiment == "up":
            up += 1
        elif row.sentiment == "down":
            down += 1
        if row.score is not None:
            score_sum += row.score
            score_count += 1
        row.processed = True
        row.processed_at = datetime.utcnow()
        processed += 1
    await session.commit()
    return {
        "processed": processed,
        "positive": up,
        "negative": down,
        "avg_score": round(score_sum / score_count, 2) if score_count else None,
    }


async def apply_heuristic_guardrails(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    """Adjust tenant autonomy posture from latest eval scores (no ML)."""
    import json as _json

    from app.dependencies import tenant_settings
    from app.models.auth import Tenant
    from app.tools.policy import resolve_posture

    result = await session.execute(
        select(EvalScore)
        .where(EvalScore.tenant_id == tenant_id, EvalScore.metric == "escalation_rate")
        .order_by(EvalScore.created_at.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    escalation = latest.value if latest else 0

    tenant_result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if tenant is None:
        return {}
    posture = resolve_posture(tenant)
    updated: dict[str, Any] = {"posture": posture}

    new_posture = None
    if escalation > 40 and posture == "autonomous":
        new_posture = "assisted"
        updated["reason"] = "High escalation rate; tightened from autonomous to assisted"
    elif escalation < 10 and posture == "manual":
        new_posture = "assisted"
        updated["reason"] = "Low escalation; eased from manual to assisted"

    if new_posture:
        settings = tenant_settings(tenant)
        settings["autonomy_posture"] = new_posture
        tenant.settings_json = _json.dumps(settings)
        session.add(tenant)
        updated["posture"] = new_posture

    await session.commit()
    return updated


async def compute_eval_scores(session: AsyncSession, tenant_id: UUID) -> list[EvalScore]:
    since = datetime.utcnow() - timedelta(days=7)
    now = datetime.utcnow()

    auto_executed = (
        await session.execute(
            select(func.count()).select_from(AuditEvent).where(
                AuditEvent.tenant_id == tenant_id,
                AuditEvent.outcome == "executed",
                AuditEvent.actor_type == "agent",
                AuditEvent.created_at >= since,
            )
        )
    ).scalar_one()

    escalated = (
        await session.execute(
            select(func.count()).select_from(AuditEvent).where(
                AuditEvent.tenant_id == tenant_id,
                AuditEvent.outcome == "escalated",
                AuditEvent.created_at >= since,
            )
        )
    ).scalar_one()

    open_decisions = (
        await session.execute(
            select(func.count()).select_from(DecisionRequest).where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.status == "awaiting_human",
            )
        )
    ).scalar_one()

    feedback_avg = (
        await session.execute(
            select(func.avg(Feedback.score)).where(
                Feedback.tenant_id == tenant_id,
                Feedback.created_at >= since,
                Feedback.score.is_not(None),
            )
        )
    ).scalar_one()

    total_actions = int(auto_executed or 0) + int(escalated or 0)
    autonomy_rate = round((auto_executed / total_actions * 100) if total_actions else 0, 1)
    escalation_rate = round((escalated / total_actions * 100) if total_actions else 0, 1)

    metrics = [
        ("autonomy_rate", autonomy_rate, total_actions),
        ("escalation_rate", escalation_rate, total_actions),
        ("resolution_quality", float(feedback_avg or 0), int(feedback_avg is not None)),
        ("open_decisions", float(open_decisions or 0), 1),
    ]

    created: list[EvalScore] = []
    for metric, value, sample_size in metrics:
        row = EvalScore(
            tenant_id=tenant_id,
            scope="tenant",
            scope_id=str(tenant_id),
            metric=metric,
            value=value,
            sample_size=sample_size,
            window_start=since,
            window_end=now,
            details_json=json.dumps({"computed_at": now.isoformat()}),
        )
        session.add(row)
        created.append(row)
    await session.commit()
    for row in created:
        await session.refresh(row)
    return created


def serialize_eval(row: EvalScore) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "scope": row.scope,
        "scope_id": row.scope_id,
        "metric": row.metric,
        "value": row.value,
        "sample_size": row.sample_size,
        "window_start": row.window_start.isoformat() if row.window_start else None,
        "window_end": row.window_end.isoformat() if row.window_end else None,
        "created_at": row.created_at.isoformat(),
    }
