"""Custom cockpit metrics (tenant KPIs, fillable by users and agents)."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.metric import CustomMetric, CustomMetricPoint
from app.services.metrics import (
    create_metric,
    list_metrics_with_latest,
    normalize_unit,
    record_metric_point,
    serialize_metric,
)

router = APIRouter(prefix="/metrics", tags=["metrics"])


class MetricCreate(BaseModel):
    key: str = ""
    label: str
    description: str = ""
    unit: str = "number"
    target: float | None = None


class MetricUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    unit: str | None = None
    target: float | None = None
    sort_order: int | None = None


class MetricPointCreate(BaseModel):
    value: float
    note: str = ""


async def _get_metric(
    session: AsyncSession, tenant_id: UUID, metric_id: UUID
) -> CustomMetric:
    result = await session.execute(
        select(CustomMetric).where(
            CustomMetric.id == metric_id, CustomMetric.tenant_id == tenant_id
        )
    )
    metric = result.scalar_one_or_none()
    if not metric:
        raise HTTPException(status_code=404, detail="Metric not found")
    return metric


@router.get("")
async def list_metrics(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return {"items": await list_metrics_with_latest(session, auth.tenant.id)}


@router.post("")
async def create_metric_endpoint(
    body: MetricCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        metric = await create_metric(
            session,
            auth.tenant.id,
            key=body.key,
            label=body.label,
            description=body.description,
            unit=body.unit,
            target=body.target,
            created_by_user_id=auth.user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await session.commit()
    await session.refresh(metric)
    return serialize_metric(metric)


@router.patch("/{metric_id}")
async def update_metric(
    metric_id: UUID,
    body: MetricUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    metric = await _get_metric(session, auth.tenant.id, metric_id)
    if body.label is not None:
        metric.label = body.label.strip()[:120]
    if body.description is not None:
        metric.description = body.description.strip()[:500]
    if body.unit is not None:
        metric.unit = normalize_unit(body.unit)
    if body.target is not None:
        metric.target = body.target
    if body.sort_order is not None:
        metric.sort_order = body.sort_order
    from datetime import datetime

    metric.updated_at = datetime.utcnow()
    session.add(metric)
    await session.commit()
    await session.refresh(metric)
    return serialize_metric(metric)


@router.delete("/{metric_id}")
async def delete_metric(
    metric_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    metric = await _get_metric(session, auth.tenant.id, metric_id)
    points = await session.execute(
        select(CustomMetricPoint).where(CustomMetricPoint.metric_id == metric.id)
    )
    for point in points.scalars().all():
        await session.delete(point)
    await session.delete(metric)
    await session.commit()
    return {"ok": True}


@router.post("/{metric_id}/points")
async def add_metric_point(
    metric_id: UUID,
    body: MetricPointCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    metric = await _get_metric(session, auth.tenant.id, metric_id)
    await record_metric_point(
        session,
        auth.tenant.id,
        metric,
        value=body.value,
        note=body.note,
        source="user",
        recorded_by=str(auth.user.id),
    )
    await session.commit()
    items = await list_metrics_with_latest(session, auth.tenant.id)
    updated = next((m for m in items if m["id"] == str(metric.id)), None)
    return updated or {"ok": True}


@router.get("/{metric_id}/points")
async def list_metric_points(
    metric_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = 50,
):
    metric = await _get_metric(session, auth.tenant.id, metric_id)
    result = await session.execute(
        select(CustomMetricPoint)
        .where(CustomMetricPoint.metric_id == metric.id)
        .order_by(desc(CustomMetricPoint.recorded_at))
        .limit(min(max(limit, 1), 200))
    )
    return {
        "items": [
            {
                "id": str(p.id),
                "value": p.value,
                "note": p.note,
                "source": p.source,
                "recorded_at": p.recorded_at.isoformat(),
            }
            for p in result.scalars().all()
        ]
    }
