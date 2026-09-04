"""LEARNING layer: feedback processing and eval score aggregation."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEvent
from app.models.learning import EvalScore, Feedback
from app.models.notification import DecisionRequest
from app.services.privacy import scrub_pii_text


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


async def _pending_change_exists(
    session: AsyncSession, tenant_id: UUID, resource_type: str
) -> bool:
    from app.models.platform_change import PlatformChange

    row = (
        await session.execute(
            select(PlatformChange.id).where(
                PlatformChange.tenant_id == tenant_id,
                PlatformChange.resource_type == resource_type,
                PlatformChange.status.in_(("draft", "pending_review")),
            )
        )
    ).first()
    return row is not None


async def apply_heuristic_guardrails(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    """Adjust tenant autonomy posture from latest eval scores (no ML).

    Safety asymmetry: tightening (autonomous -> assisted on high escalation)
    applies immediately with an audit trail; loosening (manual -> assisted on
    low escalation) only creates a Govern proposal a human must accept.
    """
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

    if escalation > 40 and posture == "autonomous":
        reason = "High escalation rate; tightened from autonomous to assisted"
        settings = tenant_settings(tenant)
        settings["autonomy_posture"] = "assisted"
        tenant.settings_json = _json.dumps(settings)
        session.add(tenant)
        updated["posture"] = "assisted"
        updated["reason"] = reason
        from app.services.audit import record_audit

        await record_audit(
            session,
            tenant_id,
            action="learning:posture_tightened",
            actor_type="system",
            resource_type="tenant",
            resource_id=tenant_id,
            summary=reason,
            before={"posture": posture},
            after={"posture": "assisted"},
            commit=False,
        )
    elif escalation < 10 and posture == "manual":
        # Loosening is proposed, never silently applied.
        if not await _pending_change_exists(session, tenant_id, "autonomy_posture"):
            from app.models.platform_change import PlatformChange

            session.add(
                PlatformChange(
                    tenant_id=tenant_id,
                    resource_type="autonomy_posture",
                    resource_id=str(tenant_id),
                    change_kind="update",
                    status="pending_review",
                    summary=(
                        "Low escalation rate over the past week. "
                        "Proposal: ease autonomy from manual to assisted."
                    ),
                    before_json=_json.dumps({"posture": posture}),
                    after_json=_json.dumps({"posture": "assisted"}),
                    proposed_by_type="system",
                )
            )
            updated["posture_proposal"] = "assisted"

    await session.commit()
    return updated


# Escalated tool gates / rejected tool decisions that justify allow → ask.
_ALLOWANCE_ESCALATION_THRESHOLD = 5
_ALLOWANCE_REJECT_THRESHOLD = 3
_LEARNING_HISTORY_MAX = 5


def _tool_category_from_action(action: str) -> str | None:
    from app.tools.registry import get_tool_spec

    if not action.startswith("tool_call:"):
        return None
    spec = get_tool_spec(action[len("tool_call:") :])
    return spec.category if spec else None


def _tool_category_from_name(tool_name: str) -> str | None:
    from app.tools.registry import get_tool_spec

    spec = get_tool_spec(tool_name)
    return spec.category if spec else None


async def _category_exception_counts(
    session: AsyncSession, tenant_id: UUID, *, since: datetime
) -> dict[str, dict[str, int]]:
    """Per-category counts of escalated tool calls and rejected tool-gate decisions."""
    from collections import defaultdict

    counts: dict[str, dict[str, int]] = defaultdict(lambda: {"escalations": 0, "rejects": 0})

    escalations = (
        await session.execute(
            select(AuditEvent.action).where(
                AuditEvent.tenant_id == tenant_id,
                AuditEvent.outcome == "escalated",
                AuditEvent.action.startswith("tool_call:"),
                AuditEvent.created_at >= since,
            )
        )
    ).scalars().all()
    for action in escalations:
        category = _tool_category_from_action(action)
        if category:
            counts[category]["escalations"] += 1

    rejected = (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.status == "rejected",
                DecisionRequest.resolved_at.is_not(None),
                DecisionRequest.resolved_at >= since,
            )
        )
    ).scalars().all()
    for decision in rejected:
        try:
            options = json.loads(decision.options_json or "[]")
        except json.JSONDecodeError:
            options = []
        if not isinstance(options, list):
            continue
        categories_seen: set[str] = set()
        for option in options:
            if not isinstance(option, dict):
                continue
            action_type = str(option.get("action_type") or "").strip()
            if not action_type or action_type in ("reject", "defer", "escalate", "acknowledge"):
                continue
            category = _tool_category_from_name(action_type)
            if category:
                categories_seen.add(category)
        for category in categories_seen:
            counts[category]["rejects"] += 1

    return dict(counts)


async def apply_heuristic_allowance_tighten(
    session: AsyncSession, tenant_id: UUID
) -> dict[str, Any]:
    """Tighten category sliders from operator exceptions (no ML).

    Safety asymmetry: only ``allow`` → ``ask`` is auto-applied. Loosening
    stays a human Govern edit. Evidence is escalated tool audits and rejected
    tool-gate decisions in the past week.
    """
    from app.dependencies import tenant_settings
    from app.models.auth import Tenant
    from app.services.audit import record_audit
    from app.tools.policy import (
        is_stricter_mode,
        set_category_allowance,
        tenant_allowances,
    )
    from app.tools.registry import TOOL_CATEGORIES

    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        return {"tightened": []}

    since = datetime.utcnow() - timedelta(days=7)
    counts = await _category_exception_counts(session, tenant_id, since=since)
    effective = tenant_allowances(tenant)
    tightened: list[dict[str, Any]] = []

    for category in TOOL_CATEGORIES:
        current = effective.get(category, "ask")
        if current != "allow":
            # Already ask/deny — never auto-loosen, and don't push ask→deny.
            continue
        stats = counts.get(category) or {"escalations": 0, "rejects": 0}
        escalations = int(stats.get("escalations") or 0)
        rejects = int(stats.get("rejects") or 0)
        if (
            escalations < _ALLOWANCE_ESCALATION_THRESHOLD
            and rejects < _ALLOWANCE_REJECT_THRESHOLD
        ):
            continue
        if not is_stricter_mode("ask", current):
            continue

        reason_bits = []
        if escalations >= _ALLOWANCE_ESCALATION_THRESHOLD:
            reason_bits.append(f"{escalations} escalated tool calls")
        if rejects >= _ALLOWANCE_REJECT_THRESHOLD:
            reason_bits.append(f"{rejects} rejected tool decisions")
        reason = (
            f"High exception load on {category} "
            f"({', '.join(reason_bits)} in 7 days); tightened allow → ask"
        )
        change = await set_category_allowance(
            session, tenant_id, category, "ask", commit=False
        )
        if not change:
            continue
        await record_audit(
            session,
            tenant_id,
            action="learning:allowance_tightened",
            actor_type="system",
            resource_type="tool_allowances",
            resource_id=category,
            summary=reason,
            before={"category": category, "mode": change["from"]},
            after={"category": category, "mode": change["to"]},
            payload={
                "escalations": escalations,
                "rejects": rejects,
            },
            commit=False,
        )
        # Refresh tenant settings for history append (set_category_allowance
        # already mutated settings_json; re-read after flush).
        await session.refresh(tenant)
        settings = tenant_settings(tenant)
        history = settings.get("learning_allowance_history")
        if not isinstance(history, list):
            history = []
        entry = {
            "category": category,
            "from": change["from"],
            "to": change["to"],
            "reason": reason,
            "at": datetime.utcnow().isoformat() + "Z",
            "escalations": escalations,
            "rejects": rejects,
        }
        history = [entry, *[h for h in history if isinstance(h, dict)]][:_LEARNING_HISTORY_MAX]
        settings["learning_allowance_history"] = history
        tenant.settings_json = json.dumps(settings)
        session.add(tenant)
        tightened.append(entry)
        # Recompute effective so a second category in the same pass sees updates.
        effective = tenant_allowances(tenant)

    if tightened:
        await session.commit()
    return {"tightened": tightened}


async def propose_persona_review(session: AsyncSession, tenant_id: UUID) -> bool:
    """Turn a cluster of negative feedback into a Govern persona-review proposal.

    When the past week has 3+ negative feedback entries, a pending_review
    PlatformChange (resource_type "persona_review") is created with the
    feedback samples as evidence, so an operator reviews the assistant persona
    with concrete examples. Deduped on open proposals.
    """
    import json as _json

    since = datetime.utcnow() - timedelta(days=7)
    negatives = (
        await session.execute(
            select(Feedback)
            .where(
                Feedback.tenant_id == tenant_id,
                Feedback.sentiment == "down",
                Feedback.created_at >= since,
            )
            .order_by(Feedback.created_at.desc())
            .limit(25)
        )
    ).scalars().all()
    if len(negatives) < 3:
        return False
    if await _pending_change_exists(session, tenant_id, "persona_review"):
        return False

    from app.models.platform_change import PlatformChange

    samples = [
        {
            "subject_type": f.subject_type,
            "subject_id": f.subject_id,
            "comment": scrub_pii_text((f.comment or "")[:300]),
        }
        for f in negatives[:10]
    ]
    # Concrete diff the approval will apply: a persona.md addition built from
    # the feedback comments (see platform_apply.apply_persona_review_change).
    comment_lines = [f"- {s['comment']}" for s in samples if s["comment"].strip()]
    proposed_addition = (
        "Recent feedback to account for in replies:\n" + "\n".join(comment_lines)
        if comment_lines
        else f"Reviewed {len(negatives)} negative feedback signal(s) without comments."
    )
    session.add(
        PlatformChange(
            tenant_id=tenant_id,
            resource_type="persona_review",
            change_kind="review",
            status="pending_review",
            summary=(
                f"{len(negatives)} negative feedback signal(s) this week. "
                "Proposal: review the assistant persona and reply guidelines."
            ),
            after_json=_json.dumps(
                {
                    "negative_count": len(negatives),
                    "samples": samples,
                    "proposed_addition": proposed_addition,
                }
            ),
            proposed_by_type="system",
        )
    )
    await session.commit()
    return True


async def suggest_rules_from_feedback(session: AsyncSession, tenant_id: UUID) -> int:
    """Cluster repeated thumbs-down per sender into a suggested mute_ai rule.

    When operators keep rejecting AI output on threads from the same sender,
    the honest lesson is usually "stop letting the AI handle this sender".
    Reuses the inbox-rule suggestion path, so the proposal shows up in Inbox
    settings where a human activates it. Returns the number of rules
    suggested/reinforced.
    """
    from app.models.signal import Signal, SignalMessage
    from app.services.inbox_rules import PROMOTION_THRESHOLD, suggest_rule

    since = datetime.utcnow() - timedelta(days=7)
    rows = (
        await session.execute(
            select(Feedback.subject_id)
            .where(
                Feedback.tenant_id == tenant_id,
                Feedback.sentiment == "down",
                Feedback.subject_type == "message",
                Feedback.created_at >= since,
            )
            .limit(500)
        )
    ).scalars().all()
    if not rows:
        return 0

    message_ids = []
    for raw in rows:
        try:
            message_ids.append(UUID(str(raw)))
        except (ValueError, TypeError):
            continue
    if not message_ids:
        return 0

    # Sender per thread; only external email threads can carry sender rules.
    pairs = (
        await session.execute(
            select(Signal.contact_email, Signal.id)
            .join(SignalMessage, SignalMessage.signal_id == Signal.id)
            .where(
                SignalMessage.id.in_(message_ids),
                Signal.tenant_id == tenant_id,
                Signal.channel == "email",
            )
        )
    ).all()
    threads_per_sender: dict[str, set] = {}
    for sender, signal_id in pairs:
        addr = (sender or "").strip().lower()
        if "@" in addr:
            threads_per_sender.setdefault(addr, set()).add(signal_id)

    suggested = 0
    for sender, signal_ids in threads_per_sender.items():
        if len(signal_ids) < PROMOTION_THRESHOLD:
            continue
        payload = await suggest_rule(
            session,
            tenant_id,
            match_type="sender",
            match_value=sender,
            action="mute_ai",
            source="learned",
            reason=(
                f"{len(signal_ids)} threads from this sender got negative feedback "
                "on AI output in the past week."
            ),
            observations=len(signal_ids),
        )
        if payload is not None:
            suggested += 1
    if suggested:
        await session.commit()
    return suggested


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

    # CSAT: end-customer ratings on conversations (widget prompt writes
    # signal-scoped Feedback), separate from internal operator feedback.
    csat_row = (
        await session.execute(
            select(func.avg(Feedback.score), func.count()).where(
                Feedback.tenant_id == tenant_id,
                Feedback.created_at >= since,
                Feedback.score.is_not(None),
                Feedback.subject_type == "signal",
            )
        )
    ).one()
    csat_avg, csat_count = csat_row[0], int(csat_row[1] or 0)

    total_actions = int(auto_executed or 0) + int(escalated or 0)
    autonomy_rate = round((auto_executed / total_actions * 100) if total_actions else 0, 1)
    escalation_rate = round((escalated / total_actions * 100) if total_actions else 0, 1)

    metrics = [
        ("autonomy_rate", autonomy_rate, total_actions),
        ("escalation_rate", escalation_rate, total_actions),
        ("resolution_quality", float(feedback_avg or 0), int(feedback_avg is not None)),
        ("open_decisions", float(open_decisions or 0), 1),
        ("csat", round(float(csat_avg), 2) if csat_avg is not None else 0.0, csat_count),
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
    # Learning is on by default; tenants opt out with `learning_enabled: false`.
    if not settings.get("learning_enabled", True):
        return {"skipped": True, "reason": "learning_disabled"}

    mapped = await map_outcomes_to_feedback(session, tenant_id)
    rules_suggested = await suggest_rules_from_feedback(session, tenant_id)
    batch = await process_feedback_batch(session, tenant_id)
    evals = await compute_eval_scores(session, tenant_id)
    guardrails = await apply_heuristic_guardrails(session, tenant_id)
    allowances = await apply_heuristic_allowance_tighten(session, tenant_id)
    persona_proposed = await propose_persona_review(session, tenant_id)

    enqueue_strategy = await _eval_trend_worsened(session, tenant_id, "escalation_rate")
    if await _eval_trend_worsened(session, tenant_id, "resolution_quality"):
        enqueue_strategy = True

    workstream_enqueued = False
    if enqueue_strategy:
        from uuid import UUID as _UUID

        from app.models.orchestra import Workstream
        from app.services.workstreams import start_run

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
        if ws and ws.enabled:
            try:
                await start_run(
                    session,
                    tenant_id,
                    ws.id,
                    input_kind="trigger",
                    input_text="Learning cycle detected a worsening eval trend; review strategy.",
                    triggered_by_type="system",
                    triggered_by_id="learning_cycle",
                )
                workstream_enqueued = True
            except HTTPException:
                workstream_enqueued = False

    return {
        "mapped_outcomes": mapped,
        "rules_suggested": rules_suggested,
        "feedback_batch": batch,
        "eval_count": len(evals),
        "guardrails": guardrails,
        "allowances": allowances,
        "persona_review_proposed": persona_proposed,
        "strategy_review_recommended": enqueue_strategy,
        "strategy_workstream_enqueued": workstream_enqueued,
    }


async def run_learning_for_enabled_tenants(session: AsyncSession) -> dict[str, Any]:
    from app.dependencies import tenant_settings
    from app.models.auth import Tenant

    tenants = (await session.execute(select(Tenant))).scalars().all()
    results: dict[str, Any] = {}
    for tenant in tenants:
        if tenant_settings(tenant).get("learning_enabled", True):
            results[str(tenant.id)] = await run_tenant_learning_cycle(session, tenant.id)
    return results
