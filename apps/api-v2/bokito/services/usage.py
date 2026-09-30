"""Usage metering: tokens, channel messages, tool calls; per conversation and per period."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.base import utcnow
from bokito.domain.metering import UsageEvent, UsageKind

# Meta WhatsApp business-initiated conversation prices, EUR (indicative, NL/EU tier).
WHATSAPP_PRICES = {"utility": 0.03, "marketing": 0.13, "authentication": 0.03, "service": 0.0}


async def record(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    kind: UsageKind,
    provider: str = "",
    model: str = "",
    region: str = "",
    conversation_id: uuid.UUID | None = None,
    run_id: uuid.UUID | None = None,
    agent_id: uuid.UUID | None = None,
    connection_id: uuid.UUID | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    units: int = 1,
    cost_eur: float = 0.0,
    billed_by_tenant: bool = False,
    meta: dict[str, Any] | None = None,
) -> UsageEvent:
    ev = UsageEvent(
        tenant_id=tenant_id,
        kind=kind,
        provider=provider,
        model=model,
        region=region,
        conversation_id=conversation_id,
        run_id=run_id,
        agent_id=agent_id,
        connection_id=connection_id,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        units=units,
        cost_eur=cost_eur,
        billed_by_tenant=billed_by_tenant,
        meta=meta or {},
        created_at=utcnow(),
    )
    session.add(ev)
    await session.flush()
    return ev


async def conversation_report(
    session: AsyncSession, tenant_id: uuid.UUID, conversation_id: uuid.UUID
) -> dict[str, Any]:
    stmt = (
        select(
            UsageEvent.kind,
            UsageEvent.provider,
            UsageEvent.model,
            UsageEvent.region,
            func.count(UsageEvent.id),
            func.coalesce(func.sum(UsageEvent.tokens_in), 0),
            func.coalesce(func.sum(UsageEvent.tokens_out), 0),
            func.coalesce(func.sum(UsageEvent.cost_eur), 0),
        )
        .where(UsageEvent.tenant_id == tenant_id, UsageEvent.conversation_id == conversation_id)
        .group_by(UsageEvent.kind, UsageEvent.provider, UsageEvent.model, UsageEvent.region)
    )
    rows = (await session.execute(stmt)).all()
    lines = [
        {
            "kind": kind.value,
            "provider": provider,
            "model": model,
            "region": region,
            "events": int(count),
            "tokens_in": int(tin),
            "tokens_out": int(tout),
            "cost_eur": float(cost),
        }
        for kind, provider, model, region, count, tin, tout, cost in rows
    ]
    return {
        "conversation_id": str(conversation_id),
        "lines": lines,
        "total_cost_eur": round(sum(line["cost_eur"] for line in lines), 6),
    }


async def period_report(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    since: datetime | None = None,
    until: datetime | None = None,
) -> dict[str, Any]:
    since = since or (utcnow() - timedelta(days=30))
    until = until or utcnow()
    stmt = (
        select(
            UsageEvent.kind,
            UsageEvent.provider,
            UsageEvent.region,
            UsageEvent.billed_by_tenant,
            func.count(UsageEvent.id),
            func.coalesce(func.sum(UsageEvent.tokens_in), 0),
            func.coalesce(func.sum(UsageEvent.tokens_out), 0),
            func.coalesce(func.sum(UsageEvent.cost_eur), 0),
        )
        .where(
            UsageEvent.tenant_id == tenant_id,
            UsageEvent.created_at >= since,
            UsageEvent.created_at < until,
        )
        .group_by(
            UsageEvent.kind, UsageEvent.provider, UsageEvent.region, UsageEvent.billed_by_tenant
        )
    )
    rows = (await session.execute(stmt)).all()
    lines = [
        {
            "kind": kind.value,
            "provider": provider,
            "region": region,
            "billed_by_tenant": byok,
            "events": int(count),
            "tokens_in": int(tin),
            "tokens_out": int(tout),
            "cost_eur": float(cost),
        }
        for kind, provider, region, byok, count, tin, tout, cost in rows
    ]
    # Bind the literal once and group on the label; asyncpg otherwise sees two
    # distinct `$n` parameters and rejects the GROUP BY.
    day_col = func.date_trunc(literal("day"), UsageEvent.created_at).label("day")
    by_day_stmt = (
        select(day_col, func.coalesce(func.sum(UsageEvent.cost_eur), 0))
        .where(
            UsageEvent.tenant_id == tenant_id,
            UsageEvent.created_at >= since,
            UsageEvent.created_at < until,
        )
        .group_by(day_col)
        .order_by(day_col)
    )
    by_day = [
        {"day": day.date().isoformat(), "cost_eur": float(cost)}
        for day, cost in (await session.execute(by_day_stmt)).all()
    ]
    return {
        "since": since.isoformat(),
        "until": until.isoformat(),
        "lines": lines,
        "by_day": by_day,
        "total_cost_eur": round(sum(line["cost_eur"] for line in lines), 6),
        "eu_share": _eu_share(lines),
    }


def _eu_share(lines: list[dict[str, Any]]) -> float:
    total = sum(line["events"] for line in lines if line["kind"] in ("llm", "embedding"))
    if not total:
        return 1.0
    eu = sum(
        line["events"]
        for line in lines
        if line["kind"] in ("llm", "embedding") and line["region"] == "eu"
    )
    return round(eu / total, 3)
