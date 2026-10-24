"""Staff OPS rollups over usage_ledger (cross-tenant)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.pricing import PriceBook, TenantPriceBinding
from app.models.usage import UsageLedger
from app.services import pricing as pricing_svc
from app.services.spend_guard import get_spend_status


def _period_bounds(period: str) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    key = (period or "30d").strip().lower()
    if key in ("mtd", "month"):
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif key == "7d":
        start = now - timedelta(days=7)
    elif key == "90d":
        start = now - timedelta(days=90)
    else:
        start = now - timedelta(days=30)
    return start, now


def _usd(micros: int) -> float:
    return round(int(micros or 0) / 1_000_000, 6)


async def usage_overview(
    session: AsyncSession, *, period: str = "30d"
) -> dict[str, Any]:
    await pricing_svc.ensure_default_book(session)
    since, until = _period_bounds(period)

    token_expr = UsageLedger.tokens_in + UsageLedger.tokens_out
    rows = (
        await session.execute(
            select(
                Tenant.id,
                Tenant.slug,
                Tenant.name,
                func.coalesce(func.sum(token_expr), 0),
                func.coalesce(func.sum(UsageLedger.provider_cost_micros), 0),
                func.coalesce(func.sum(UsageLedger.customer_cost_micros), 0),
                func.count(UsageLedger.id),
            )
            .select_from(Tenant)
            .outerjoin(
                UsageLedger,
                (UsageLedger.tenant_id == Tenant.id)
                & (UsageLedger.created_at >= since)
                & (UsageLedger.created_at <= until),
            )
            .group_by(Tenant.id, Tenant.slug, Tenant.name)
            .order_by(func.coalesce(func.sum(token_expr), 0).desc())
        )
    ).all()

    bindings = {
        row.tenant_id: row
        for row in (
            await session.execute(
                select(TenantPriceBinding.tenant_id, PriceBook.slug, PriceBook.name)
                .join(PriceBook, PriceBook.id == TenantPriceBinding.price_book_id)
            )
        ).all()
    }
    default_book = (
        await session.execute(select(PriceBook).where(PriceBook.is_default.is_(True)).limit(1))
    ).scalar_one_or_none()

    tenants: list[dict[str, Any]] = []
    tot_tokens = tot_prov = tot_cust = 0
    for tid, slug, name, tokens, prov, cust, calls in rows:
        tokens_i, prov_i, cust_i = int(tokens), int(prov), int(cust)
        tot_tokens += tokens_i
        tot_prov += prov_i
        tot_cust += cust_i
        bound = bindings.get(tid)
        spend = await get_spend_status(session, tid)
        tenants.append(
            {
                "tenant_id": str(tid),
                "slug": slug,
                "name": name,
                "tokens": tokens_i,
                "provider_cost_micros": prov_i,
                "customer_cost_micros": cust_i,
                "margin_micros": cust_i - prov_i,
                "margin_pct": round(100.0 * (cust_i - prov_i) / prov_i, 1) if prov_i else None,
                "calls": int(calls),
                "price_book_slug": bound.slug if bound else (default_book.slug if default_book else None),
                "price_book_name": bound.name if bound else (default_book.name if default_book else None),
                "spend": {
                    "daily_tokens_used": spend["daily_tokens"]["used"],
                    "daily_token_cap": spend["daily_tokens"]["cap"],
                    "monthly_customer_micros_used": spend["monthly_customer_micros"]["used"],
                    "monthly_customer_micros_cap": spend["monthly_customer_micros"]["cap"],
                    "blocked": spend["blocked"],
                },
            }
        )

    return {
        "period": period,
        "from": since.isoformat(),
        "to": until.isoformat(),
        "totals": {
            "tokens": tot_tokens,
            "provider_cost_micros": tot_prov,
            "customer_cost_micros": tot_cust,
            "margin_micros": tot_cust - tot_prov,
            "provider_usd": _usd(tot_prov),
            "customer_usd": _usd(tot_cust),
            "margin_usd": _usd(tot_cust - tot_prov),
        },
        "tenants": tenants,
    }


async def usage_tenant_detail(
    session: AsyncSession, tenant_id: UUID, *, period: str = "30d"
) -> dict[str, Any] | None:
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        return None
    since, until = _period_bounds(period)
    base = (
        (UsageLedger.tenant_id == tenant_id)
        & (UsageLedger.created_at >= since)
        & (UsageLedger.created_at <= until)
    )
    token_expr = UsageLedger.tokens_in + UsageLedger.tokens_out

    totals = (
        await session.execute(
            select(
                func.coalesce(func.sum(token_expr), 0),
                func.coalesce(func.sum(UsageLedger.provider_cost_micros), 0),
                func.coalesce(func.sum(UsageLedger.customer_cost_micros), 0),
                func.coalesce(func.sum(UsageLedger.tokens_in), 0),
                func.coalesce(func.sum(UsageLedger.tokens_out), 0),
                func.coalesce(func.sum(UsageLedger.tokens_in_uncached), 0),
                func.coalesce(func.sum(UsageLedger.tokens_cache_write), 0),
                func.coalesce(func.sum(UsageLedger.tokens_cache_read), 0),
                func.count(UsageLedger.id),
            ).where(base)
        )
    ).one()

    by_model = (
        await session.execute(
            select(
                UsageLedger.model,
                UsageLedger.provider,
                UsageLedger.backing_provider,
                UsageLedger.backing_model,
                func.sum(token_expr),
                func.sum(UsageLedger.provider_cost_micros),
                func.sum(UsageLedger.customer_cost_micros),
                func.count(),
            )
            .where(base)
            .group_by(
                UsageLedger.model,
                UsageLedger.provider,
                UsageLedger.backing_provider,
                UsageLedger.backing_model,
            )
            .order_by(func.sum(token_expr).desc())
        )
    ).all()

    by_call_type = (
        await session.execute(
            select(
                UsageLedger.call_type,
                func.sum(token_expr),
                func.sum(UsageLedger.units),
                func.sum(UsageLedger.provider_cost_micros),
                func.sum(UsageLedger.customer_cost_micros),
                func.count(),
            )
            .where(base)
            .group_by(UsageLedger.call_type)
            .order_by(func.sum(UsageLedger.provider_cost_micros).desc())
        )
    ).all()

    backing_col = case(
        (UsageLedger.backing_provider != "", UsageLedger.backing_provider),
        else_=UsageLedger.provider,
    )
    by_backing = (
        await session.execute(
            select(
                backing_col,
                func.sum(token_expr),
                func.sum(UsageLedger.provider_cost_micros),
                func.sum(UsageLedger.customer_cost_micros),
                func.count(),
            )
            .where(base)
            .group_by(backing_col)
            .order_by(func.sum(UsageLedger.provider_cost_micros).desc())
        )
    ).all()

    by_day = (
        await session.execute(
            select(
                func.date_trunc("day", UsageLedger.created_at).label("day"),
                func.sum(token_expr),
                func.sum(UsageLedger.provider_cost_micros),
                func.sum(UsageLedger.customer_cost_micros),
            )
            .where(base)
            .group_by("day")
            .order_by("day")
        )
    ).all()

    book = await pricing_svc.resolve_book(session, tenant_id)
    spend = await get_spend_status(session, tenant_id)

    (
        tokens,
        prov,
        cust,
        tin,
        tout,
        uncached,
        cache_w,
        cache_r,
        calls,
    ) = (int(x or 0) for x in totals)

    return {
        "tenant_id": str(tenant.id),
        "slug": tenant.slug,
        "name": tenant.name,
        "period": period,
        "from": since.isoformat(),
        "to": until.isoformat(),
        "price_book": {
            "id": str(book.id),
            "slug": book.slug,
            "name": book.name,
        },
        "totals": {
            "tokens": tokens,
            "tokens_in": tin,
            "tokens_out": tout,
            "tokens_in_uncached": uncached,
            "tokens_cache_write": cache_w,
            "tokens_cache_read": cache_r,
            "provider_cost_micros": prov,
            "customer_cost_micros": cust,
            "margin_micros": cust - prov,
            "calls": calls,
        },
        "by_token_kind": [
            {"kind": "input", "tokens": tin},
            {"kind": "output", "tokens": tout},
            {"kind": "uncached_input", "tokens": uncached},
            {"kind": "cache_write", "tokens": cache_w},
            {"kind": "cache_read", "tokens": cache_r},
        ],
        "by_model": [
            {
                "model": m,
                "provider": p,
                "backing_provider": bp or "",
                "backing_model": bm or "",
                "tokens": int(tok or 0),
                "provider_cost_micros": int(pr or 0),
                "customer_cost_micros": int(cu or 0),
                "margin_micros": int(cu or 0) - int(pr or 0),
                "calls": int(n or 0),
            }
            for m, p, bp, bm, tok, pr, cu, n in by_model
        ],
        "by_call_type": [
            {
                "call_type": ct,
                "tokens": int(tok or 0),
                "units": int(u or 0),
                "provider_cost_micros": int(pr or 0),
                "customer_cost_micros": int(cu or 0),
                "calls": int(n or 0),
            }
            for ct, tok, u, pr, cu, n in by_call_type
        ],
        "by_backing_provider": [
            {
                "provider": bp,
                "tokens": int(tok or 0),
                "provider_cost_micros": int(pr or 0),
                "customer_cost_micros": int(cu or 0),
                "calls": int(n or 0),
            }
            for bp, tok, pr, cu, n in by_backing
        ],
        "by_day": [
            {
                "day": d.date().isoformat() if hasattr(d, "date") else str(d)[:10],
                "tokens": int(tok or 0),
                "provider_cost_micros": int(pr or 0),
                "customer_cost_micros": int(cu or 0),
            }
            for d, tok, pr, cu in by_day
        ],
        "spend": {
            "daily_tokens_used": spend["daily_tokens"]["used"],
            "daily_token_cap": spend["daily_tokens"]["cap"],
            "monthly_customer_micros_used": spend["monthly_customer_micros"]["used"],
            "monthly_customer_micros_cap": spend["monthly_customer_micros"]["cap"],
            "blocked": spend["blocked"],
        },
    }
