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
        out.append(serialize_metric(metric, latest, previous))
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
    created_by_user_id: UUID | None = None,
) -> CustomMetric:
    normalized_key = normalize_metric_key(key or label)
    if not normalized_key:
        raise ValueError("Metric key is required")
    existing = await get_metric_by_key(session, tenant_id, normalized_key)
    if existing:
        return existing

    count_result = await session.execute(
        select(CustomMetric.id).where(CustomMetric.tenant_id == tenant_id)
    )
    if len(count_result.scalars().all()) >= MAX_METRICS_PER_TENANT:
        raise ValueError(f"Metric limit reached ({MAX_METRICS_PER_TENANT})")

    metric = CustomMetric(
        tenant_id=tenant_id,
        key=normalized_key,
        label=(label or normalized_key.replace("_", " ").title())[:120],
        description=(description or "")[:500],
        unit=normalize_unit(unit),
        target=target,
        created_by_user_id=created_by_user_id,
    )
    session.add(metric)
    await session.flush()
    return metric


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
