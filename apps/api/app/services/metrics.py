"""Custom cockpit metrics: shared logic for the API router and agent tools.

A metric definition (`CustomMetric`) carries presentation (label, unit,
target); observations are appended as `CustomMetricPoint` rows. The Cockpit
shows the latest point per metric plus the delta against the previous point.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.metric import METRIC_UNITS, CustomMetric, CustomMetricPoint

MAX_METRICS_PER_TENANT = 24

# Platform aggregates a metric can be bound to instead of manual/agent fill.
# Values are computed from platform data at read time and snapshotted daily
# by the worker so history accrues.
PLATFORM_METRIC_SOURCES: dict[str, dict[str, str]] = {
    "csat_30d": {"label": "CSAT (last 30 days)", "unit": "number"},
    "inbox_volume_7d": {"label": "Inbox volume (last 7 days)", "unit": "count"},
    "auto_resolve_rate_7d": {"label": "Auto-resolve rate (last 7 days)", "unit": "percent"},
}


async def compute_platform_source(
    session: AsyncSession, tenant_id: UUID, source: str
) -> float | None:
    """Current value of a platform aggregate; None when there is no data."""
    from datetime import timedelta

    from sqlalchemy import func

    from app.models.learning import Feedback
    from app.models.signal import Signal, SignalMessage

    now = datetime.utcnow()
    if source == "csat_30d":
        row = (
            await session.execute(
                select(func.avg(Feedback.score)).where(
                    Feedback.tenant_id == tenant_id,
                    Feedback.score.is_not(None),
                    Feedback.subject_type == "signal",
                    Feedback.created_at >= now - timedelta(days=30),
                )
            )
        ).scalar_one()
        return round(float(row), 2) if row is not None else None
    if source == "inbox_volume_7d":
        count = (
            await session.execute(
                select(func.count()).select_from(Signal).where(
                    Signal.tenant_id == tenant_id,
                    Signal.created_at >= now - timedelta(days=7),
                )
            )
        ).scalar_one()
        return float(count or 0)
    if source == "auto_resolve_rate_7d":
        since = now - timedelta(days=7)
        auto = (
            await session.execute(
                select(func.count()).select_from(SignalMessage).where(
                    SignalMessage.tenant_id == tenant_id,
                    SignalMessage.auto_sent.is_(True),
                    SignalMessage.created_at >= since,
                )
            )
        ).scalar_one()
        total = (
            await session.execute(
                select(func.count()).select_from(SignalMessage).where(
                    SignalMessage.tenant_id == tenant_id,
                    SignalMessage.role == "assistant",
                    SignalMessage.created_at >= since,
                )
            )
        ).scalar_one()
        return round(auto / total * 100, 1) if total else None
    return None

_KEY_RE = re.compile(r"[^a-z0-9_]+")


def normalize_metric_key(raw: str) -> str:
    """Slugify a metric key: lowercase, underscores, max 64 chars."""
    key = _KEY_RE.sub("_", (raw or "").strip().lower()).strip("_")
    return key[:64]


def normalize_unit(raw: str | None) -> str:
    unit = (raw or "number").strip().lower()
    return unit if unit in METRIC_UNITS else "number"


def serialize_metric(
    metric: CustomMetric,
    latest: CustomMetricPoint | None = None,
    previous: CustomMetricPoint | None = None,
) -> dict[str, Any]:
    delta: Optional[float] = None
    if latest is not None and previous is not None:
        delta = latest.value - previous.value
    return {
        "id": str(metric.id),
        "key": metric.key,
        "label": metric.label,
        "description": metric.description,
        "unit": metric.unit,
        "target": metric.target,
        "sort_order": metric.sort_order,
        "source": metric.source or "manual",
        "latest_value": latest.value if latest else None,
        "latest_at": latest.recorded_at.isoformat() if latest else None,
        "latest_note": latest.note if latest else "",
        "latest_source": latest.source if latest else None,
        "previous_value": previous.value if previous else None,
        "delta": delta,
        "created_at": metric.created_at.isoformat(),
    }


async def list_metrics_with_latest(
    session: AsyncSession, tenant_id: UUID
) -> list[dict[str, Any]]:
    metrics_result = await session.execute(
        select(CustomMetric)
        .where(CustomMetric.tenant_id == tenant_id)
        .order_by(CustomMetric.sort_order, CustomMetric.created_at)
    )
    metrics = list(metrics_result.scalars().all())
    if not metrics:
        return []

    out: list[dict[str, Any]] = []
    for metric in metrics:
        points_result = await session.execute(
            select(CustomMetricPoint)
            .where(CustomMetricPoint.metric_id == metric.id)
            .order_by(desc(CustomMetricPoint.recorded_at), desc(CustomMetricPoint.created_at))
            .limit(2)
        )
        points = list(points_result.scalars().all())
        latest = points[0] if points else None
        previous = points[1] if len(points) > 1 else None
        row = serialize_metric(metric, latest, previous)
        # Platform-sourced metrics show the live aggregate; stored snapshots
        # (written daily by the worker) provide the delta baseline.
        if (metric.source or "manual") in PLATFORM_METRIC_SOURCES:
            live = await compute_platform_source(session, tenant_id, metric.source)
            if live is not None:
                row["latest_value"] = live
                row["latest_at"] = datetime.utcnow().isoformat()
                row["latest_note"] = ""
                row["latest_source"] = "platform"
                row["previous_value"] = latest.value if latest else None
                row["delta"] = live - latest.value if latest else None
        out.append(row)
    return out


async def get_metric_by_key(
    session: AsyncSession, tenant_id: UUID, key: str
) -> CustomMetric | None:
    result = await session.execute(
        select(CustomMetric).where(
            CustomMetric.tenant_id == tenant_id, CustomMetric.key == key
        )
    )
    return result.scalar_one_or_none()


async def create_metric(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    key: str,
    label: str,
    description: str = "",
    unit: str = "number",
    target: float | None = None,
    source: str = "manual",
    created_by_user_id: UUID | None = None,
) -> CustomMetric:
    normalized_key = normalize_metric_key(key or label)
    if not normalized_key:
        raise ValueError("Metric key is required")
    if source != "manual" and source not in PLATFORM_METRIC_SOURCES:
        raise ValueError(f"Unknown metric source: {source}")
    existing = await get_metric_by_key(session, tenant_id, normalized_key)
    if existing:
        return existing

    count_result = await session.execute(
        select(CustomMetric.id).where(CustomMetric.tenant_id == tenant_id)
    )
    if len(count_result.scalars().all()) >= MAX_METRICS_PER_TENANT:
        raise ValueError(f"Metric limit reached ({MAX_METRICS_PER_TENANT})")

    if source in PLATFORM_METRIC_SOURCES:
        unit = PLATFORM_METRIC_SOURCES[source]["unit"]
    metric = CustomMetric(
        tenant_id=tenant_id,
        key=normalized_key,
        label=(label or normalized_key.replace("_", " ").title())[:120],
        description=(description or "")[:500],
        unit=normalize_unit(unit),
        target=target,
        source=source,
        created_by_user_id=created_by_user_id,
    )
    session.add(metric)
    await session.flush()
    return metric


async def snapshot_platform_metrics(session: AsyncSession) -> int:
    """Record a daily system point for every platform-sourced metric.

    Skips metrics whose last point is younger than 20 hours so the job is
    idempotent across restarts. Returns the number of points written.
    """
    from datetime import timedelta

    metrics_result = await session.execute(
        select(CustomMetric).where(CustomMetric.source != "manual")
    )
    written = 0
    for metric in metrics_result.scalars().all():
        if metric.source not in PLATFORM_METRIC_SOURCES:
            continue
        last = (
            await session.execute(
                select(CustomMetricPoint)
                .where(CustomMetricPoint.metric_id == metric.id)
                .order_by(desc(CustomMetricPoint.recorded_at))
                .limit(1)
            )
        ).scalar_one_or_none()
        if last and last.recorded_at > datetime.utcnow() - timedelta(hours=20):
            continue
        value = await compute_platform_source(session, metric.tenant_id, metric.source)
        if value is None:
            continue
        await record_metric_point(
            session,
            metric.tenant_id,
            metric,
            value=value,
            source="system",
            recorded_by=f"platform:{metric.source}",
        )
        written += 1
    if written:
        await session.commit()
    return written


async def record_metric_point(
    session: AsyncSession,
    tenant_id: UUID,
    metric: CustomMetric,
    *,
    value: float,
    note: str = "",
    source: str = "user",
    recorded_by: str = "",
    recorded_at: datetime | None = None,
) -> CustomMetricPoint:
    point = CustomMetricPoint(
        tenant_id=tenant_id,
        metric_id=metric.id,
        value=float(value),
        note=(note or "")[:500],
        source=source if source in ("agent", "user", "system") else "user",
        recorded_by=recorded_by[:120],
        recorded_at=recorded_at or datetime.utcnow(),
    )
    session.add(point)
    metric.updated_at = datetime.utcnow()
    session.add(metric)
    await session.flush()
    return point
