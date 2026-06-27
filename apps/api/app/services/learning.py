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


async def map_outcomes_to_feedback(session: AsyncSession, tenant_id: UUID, days: int = 7) -> int:
    """Create feedback rows from operational outcomes not yet reflected in feedback."""
    from app.models.outcome import OperationalOutcome
    from app.services.outcomes import _sentiment_from_payload

    since = datetime.utcnow() - timedelta(days=days)
    outcomes = (
        await session.execute(
            select(OperationalOutcome).where(
                OperationalOutcome.tenant_id == tenant_id,
                OperationalOutcome.created_at >= since,
            )
        )
    ).scalars().all()
    created = 0
    for outcome in outcomes:
        try:
            payload = json.loads(outcome.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        sentiment = _sentiment_from_payload(payload)
        if not sentiment:
            continue
        subject_id = str(outcome.signal_id or outcome.id)
        existing = (
            await session.execute(
                select(Feedback).where(
                    Feedback.tenant_id == tenant_id,
                    Feedback.subject_type.in_(("signal", "run")),
                    Feedback.subject_id == subject_id,
                    Feedback.comment == json.dumps(payload)[:2000],
                )
            )
        ).scalar_one_or_none()
        if existing:
            continue
        await submit_feedback(
            session,
            tenant_id,
            subject_type="signal" if outcome.signal_id else "run",
            subject_id=subject_id,
            sentiment=sentiment,
            comment=json.dumps(payload)[:2000],
        )
        created += 1
    return created


async def _eval_trend_worsened(session: AsyncSession, tenant_id: UUID, metric: str) -> bool:
    rows = (
        await session.execute(
            select(EvalScore)
            .where(EvalScore.tenant_id == tenant_id, EvalScore.metric == metric)
            .order_by(EvalScore.created_at.desc())
            .limit(2)
        )
    ).scalars().all()
    if len(rows) < 2:
        return False
    latest, previous = rows[0], rows[1]
    if metric == "escalation_rate":
        return latest.value > previous.value + 5
    if metric == "resolution_quality":
        return latest.value < previous.value - 0.5
    return False


async def run_tenant_learning_cycle(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    """Process feedback, compute evals, optionally flag strategy review."""
    from app.dependencies import tenant_settings
    from app.models.auth import Tenant

    tenant = await session.get(Tenant, tenant_id)
    if not tenant:
        return {"skipped": True, "reason": "tenant_not_found"}

    settings = tenant_settings(tenant)
    if not settings.get("learning_enabled"):
        return {"skipped": True, "reason": "learning_disabled"}

    mapped = await map_outcomes_to_feedback(session, tenant_id)
    batch = await process_feedback_batch(session, tenant_id)
    evals = await compute_eval_scores(session, tenant_id)
    guardrails = await apply_heuristic_guardrails(session, tenant_id)

    enqueue_strategy = await _eval_trend_worsened(session, tenant_id, "escalation_rate")
    if await _eval_trend_worsened(session, tenant_id, "resolution_quality"):
        enqueue_strategy = True

    workstream_enqueued = False
    if enqueue_strategy:
        from uuid import UUID as _UUID

        from app.models.orchestra import Workstream
        from app.services.orchestration.queue import enqueue_workstream_run

        ws_id = settings.get("strategy_workstream_id")
        ws = None
        if ws_id:
            ws = await session.get(Workstream, _UUID(str(ws_id)))
        if not ws:
            ws = (
                await session.execute(
                    select(Workstream).where(
                        Workstream.tenant_id == tenant_id,
                        Workstream.name == "MMXM strategy review",
                    )
                )
            ).scalar_one_or_none()
        if ws:
            workstream_enqueued = await enqueue_workstream_run(
                str(tenant_id), str(ws.id), "learning_cycle"
            )

    return {
        "mapped_outcomes": mapped,
        "feedback_batch": batch,
        "eval_count": len(evals),
        "guardrails": guardrails,
        "strategy_review_recommended": enqueue_strategy,
        "strategy_workstream_enqueued": workstream_enqueued,
    }


async def run_learning_for_enabled_tenants(session: AsyncSession) -> dict[str, Any]:
    from app.dependencies import tenant_settings
    from app.models.auth import Tenant

    tenants = (await session.execute(select(Tenant))).scalars().all()
    results: dict[str, Any] = {}
    for tenant in tenants:
        if tenant_settings(tenant).get("learning_enabled"):
            results[str(tenant.id)] = await run_tenant_learning_cycle(session, tenant.id)
    return results
