"""Cockpit KPI aggregation."""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import RunEvent
from app.models.audit import AuditEvent
from app.models.auth import User
from app.models.learning import EvalScore, Feedback
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.models.usage import UsageLedger


async def cockpit_summary(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    since_week = datetime.utcnow() - timedelta(days=7)
    since_month = datetime.utcnow() - timedelta(days=30)

    conv_count = (
        await session.execute(
            select(func.count()).select_from(Signal).where(
                Signal.tenant_id == tenant_id,
                Signal.created_at >= since_week,
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

    auto_msgs = (
        await session.execute(
            select(func.count()).select_from(SignalMessage).where(
                SignalMessage.tenant_id == tenant_id,
                SignalMessage.auto_sent.is_(True),
                SignalMessage.created_at >= since_week,
            )
        )
    ).scalar_one()

    total_ai_msgs = (
        await session.execute(
            select(func.count()).select_from(SignalMessage).where(
                SignalMessage.tenant_id == tenant_id,
                SignalMessage.role == "assistant",
                SignalMessage.created_at >= since_week,
            )
        )
    ).scalar_one()

    avg_feedback = (
        await session.execute(
            select(func.avg(Feedback.score)).where(
                Feedback.tenant_id == tenant_id,
                Feedback.score.is_not(None),
                Feedback.created_at >= since_month,
            )
        )
    ).scalar_one()

    # End-customer satisfaction: signal-scoped ratings (widget CSAT prompt).
    csat = (
        await session.execute(
            select(func.avg(Feedback.score), func.count()).where(
                Feedback.tenant_id == tenant_id,
                Feedback.score.is_not(None),
                Feedback.subject_type == "signal",
                Feedback.created_at >= since_month,
            )
        )
    ).one()

    usage_month = (
        await session.execute(
            select(
                func.sum(UsageLedger.tokens_in + UsageLedger.tokens_out),
                func.sum(UsageLedger.cost_cents),
            ).where(UsageLedger.tenant_id == tenant_id, UsageLedger.created_at >= since_month)
        )
    ).one()

    autonomy_rate = round((auto_msgs / total_ai_msgs * 100) if total_ai_msgs else 0, 1)
    time_saved_minutes = auto_msgs * 5  # heuristic: 5 min per autonomously handled item

    latest_eval = (
        await session.execute(
            select(EvalScore)
            .where(EvalScore.tenant_id == tenant_id, EvalScore.metric == "autonomy_rate")
            .order_by(EvalScore.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    return {
        "volume_week": conv_count,
        "open_decisions": open_decisions,
        "autonomy_rate_pct": autonomy_rate,
        "avg_feedback_score": round(float(avg_feedback or 0), 2),
        "csat_score": round(float(csat[0]), 2) if csat[0] is not None else None,
        "csat_responses": int(csat[1] or 0),
        "tokens_month": int(usage_month[0] or 0),
        "cost_cents_month": int(usage_month[1] or 0),
        "time_saved_minutes_week": time_saved_minutes,
        "learning_autonomy_rate": latest_eval.value if latest_eval else autonomy_rate,
        "learning_sample_size": latest_eval.sample_size if latest_eval else 0,
    }


async def usage_breakdown(
    session: AsyncSession, tenant_id: UUID, *, days: int = 30
) -> dict[str, Any]:
    """Token + cost breakdown by model and agent, splitting BYOK vs billable."""
    from app.models.agent import Agent

    since = datetime.utcnow() - timedelta(days=days)

    # By model (+ key source so we can split BYOK vs platform/billable).
    model_rows = (
        await session.execute(
            select(
                UsageLedger.model,
                UsageLedger.provider,
                UsageLedger.key_source,
                func.sum(UsageLedger.tokens_in + UsageLedger.tokens_out),
                func.sum(UsageLedger.provider_cost_micros),
                func.sum(UsageLedger.customer_cost_micros),
            )
            .where(UsageLedger.tenant_id == tenant_id, UsageLedger.created_at >= since)
            .group_by(UsageLedger.model, UsageLedger.provider, UsageLedger.key_source)
        )
    ).all()

    by_model = [
        {
            "model": row[0] or "unknown",
            "provider": row[1] or "",
            "key_source": row[2] or "mock",
            "billable": (row[2] == "platform"),
            "tokens": int(row[3] or 0),
            "provider_cost_micros": int(row[4] or 0),
            "customer_cost_micros": int(row[5] or 0),
        }
        for row in model_rows
    ]

    # By agent (join names; rows without an agent are grouped as "System").
    agent_rows = (
        await session.execute(
            select(
                UsageLedger.agent_id,
                Agent.name,
                func.sum(UsageLedger.tokens_in + UsageLedger.tokens_out),
                func.sum(UsageLedger.customer_cost_micros),
            )
            .outerjoin(Agent, Agent.id == UsageLedger.agent_id)
            .where(UsageLedger.tenant_id == tenant_id, UsageLedger.created_at >= since)
            .group_by(UsageLedger.agent_id, Agent.name)
        )
    ).all()

    by_agent = [
        {
            "agent_id": str(row[0]) if row[0] else None,
            "agent_name": row[1] or "System / untracked",
            "tokens": int(row[2] or 0),
            "customer_cost_micros": int(row[3] or 0),
        }
        for row in agent_rows
    ]

    totals = (
        await session.execute(
            select(
                func.sum(UsageLedger.tokens_in + UsageLedger.tokens_out),
                func.sum(UsageLedger.provider_cost_micros),
                func.sum(UsageLedger.customer_cost_micros),
            ).where(UsageLedger.tenant_id == tenant_id, UsageLedger.created_at >= since)
        )
    ).one()

    by_model.sort(key=lambda r: r["tokens"], reverse=True)
    by_agent.sort(key=lambda r: r["tokens"], reverse=True)

    return {
        "days": days,
        "total_tokens": int(totals[0] or 0),
        "total_provider_cost_micros": int(totals[1] or 0),
        "total_customer_cost_micros": int(totals[2] or 0),
        "by_model": by_model,
        "by_agent": by_agent,
    }


async def activity_timeline(
    session: AsyncSession,
    tenant_id: UUID,
    limit: int = 50,
    before: datetime | None = None,
) -> list[dict[str, Any]]:
    """Unified newest-first activity: agent run events merged with human audit
    events, so the Cockpit shows one "who did what" timeline. `before` pages
    further into history."""
    events: list[dict[str, Any]] = []

    stmt = select(RunEvent).where(RunEvent.tenant_id == tenant_id)
    if before is not None:
        stmt = stmt.where(RunEvent.created_at < before)
    run_events = await session.execute(stmt.order_by(RunEvent.created_at.desc()).limit(limit))
    for ev in run_events.scalars().all():
        events.append(
            {
                "id": str(ev.id),
                "kind": "agent_run",
                "event_type": ev.event_type,
                "message": ev.message,
                "actor_name": None,
                "created_at": ev.created_at.isoformat(),
            }
        )

    # Human actions come from the govern audit trail. Agent tool calls are
    # excluded here because they already stream in as run events above.
    audit_stmt = select(AuditEvent).where(
        AuditEvent.tenant_id == tenant_id, AuditEvent.actor_type == "user"
    )
    if before is not None:
        audit_stmt = audit_stmt.where(AuditEvent.created_at < before)
    audit_rows = (
        await session.execute(audit_stmt.order_by(AuditEvent.created_at.desc()).limit(limit))
    ).scalars().all()

    actor_ids: set[UUID] = set()
    for ev in audit_rows:
        try:
            actor_ids.add(UUID(ev.actor_id))
        except (ValueError, TypeError):
            continue
    names: dict[str, str] = {}
    if actor_ids:
        user_rows = await session.execute(
            select(User.id, User.display_name, User.email).where(User.id.in_(actor_ids))
        )
        for uid, display_name, email in user_rows.all():
            names[str(uid)] = display_name or email

    for ev in audit_rows:
        events.append(
            {
                "id": str(ev.id),
                "kind": "audit",
                "event_type": ev.action,
                "message": ev.summary,
                "actor_name": names.get(ev.actor_id),
                "created_at": ev.created_at.isoformat(),
            }
        )

    events.sort(key=lambda x: x["created_at"], reverse=True)
    return events[:limit]
