"""Tenant LLM spend caps: enforcement at the model-call choke point + alerts.

Caps live in `Tenant.settings_json.spend` and apply to platform-key usage
only (BYOK tenants pay their own provider, so they are never hard-blocked):

- `daily_token_cap`: tokens (in+out) on platform keys per UTC day
- `monthly_customer_micros_cap`: billable customer cost (micro-USD) per month

`check_tenant_budget` is called from `resolve_model_call` whenever the
resolved key is a platform key, so every LLM call path is covered by one
check. Aggregates are cached in-process for 60s to keep the hot path cheap.

Threshold alerts (80%/100%) reuse the ops-alert pipeline with the
`billing-alerts` preference category; dedupe comes from the notification
cooldown plus period-specific titles.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import AppError
from app.models.auth import Tenant
from app.models.usage import UsageLedger

logger = logging.getLogger(__name__)

# Category id; row lives in inbox_settings.DEFAULT_NOTIFICATION_ROWS.
BILLING_ALERTS = "billing-alerts"

# Conservative defaults that protect platform keys out of the box.
DEFAULT_DAILY_TOKEN_CAP = 2_000_000
DEFAULT_MONTHLY_CUSTOMER_MICROS_CAP = 100_000_000  # $100 in micro-USD

ALERT_THRESHOLDS = (1.0, 0.8)  # checked highest first

_CACHE_TTL_SECONDS = 60
_status_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def get_spend_config(tenant: Tenant) -> dict[str, Any]:
    """Caps for a tenant; `None` means uncapped (explicit opt-out)."""
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    spend = settings.get("spend") if isinstance(settings, dict) else {}
    if not isinstance(spend, dict):
        spend = {}

    def _cap(key: str, default: int) -> int | None:
        if key not in spend:
            return default
        value = spend.get(key)
        if value in (None, 0, ""):
            return None
        try:
            return max(0, int(value)) or None
        except (TypeError, ValueError):
            return default

    return {
        "daily_token_cap": _cap("daily_token_cap", DEFAULT_DAILY_TOKEN_CAP),
        "monthly_customer_micros_cap": _cap(
            "monthly_customer_micros_cap", DEFAULT_MONTHLY_CUSTOMER_MICROS_CAP
        ),
    }


async def update_spend_config(
    session: AsyncSession, tenant: Tenant, updates: dict[str, Any]
) -> dict[str, Any]:
    """Persist cap overrides in tenant settings. `None`/0 stores uncapped."""
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    if not isinstance(settings, dict):
        settings = {}
    spend = settings.get("spend")
    if not isinstance(spend, dict):
        spend = {}
    for key in ("daily_token_cap", "monthly_customer_micros_cap"):
        if key in updates:
            value = updates[key]
            spend[key] = None if value in (None, 0, "") else max(0, int(value))
    settings["spend"] = spend
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    invalidate_cache(tenant.id)
    return get_spend_config(tenant)


def invalidate_cache(tenant_id: UUID) -> None:
    _status_cache.pop(str(tenant_id), None)


async def get_spend_status(
    session: AsyncSession, tenant_id: UUID, *, use_cache: bool = False
) -> dict[str, Any]:
    """Used-vs-cap for the current UTC day (tokens) and month (customer cost)."""
    key = str(tenant_id)
    if use_cache:
        cached = _status_cache.get(key)
        if cached and cached[0] > time.monotonic():
            return cached[1]

    tenant = await session.get(Tenant, tenant_id)
    config = get_spend_config(tenant) if tenant else {
        "daily_token_cap": DEFAULT_DAILY_TOKEN_CAP,
        "monthly_customer_micros_cap": DEFAULT_MONTHLY_CUSTOMER_MICROS_CAP,
    }

    now = datetime.utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    tokens_today = int(
        (
            await session.execute(
                select(func.coalesce(func.sum(UsageLedger.tokens_in + UsageLedger.tokens_out), 0)).where(
                    UsageLedger.tenant_id == tenant_id,
                    UsageLedger.key_source == "platform",
                    UsageLedger.created_at >= day_start,
                )
            )
        ).scalar_one()
    )
    micros_month = int(
        (
            await session.execute(
                select(func.coalesce(func.sum(UsageLedger.customer_cost_micros), 0)).where(
                    UsageLedger.tenant_id == tenant_id,
                    UsageLedger.billable == True,  # noqa: E712
                    UsageLedger.created_at >= month_start,
                )
            )
        ).scalar_one()
    )

    def _period(used: int, cap: int | None) -> dict[str, Any]:
        return {
            "used": used,
            "cap": cap,
            "ratio": (used / cap) if cap else 0.0,
            "exceeded": bool(cap and used >= cap),
        }

    daily = _period(tokens_today, config["daily_token_cap"])
    monthly = _period(micros_month, config["monthly_customer_micros_cap"])
    status = {
        "daily_tokens": daily,
        "monthly_customer_micros": monthly,
        "blocked": daily["exceeded"] or monthly["exceeded"],
    }
    _status_cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, status)
    return status


async def check_tenant_budget(session: AsyncSession, tenant_id: UUID) -> None:
    """Raise 402 `budget_exceeded` when the tenant is over a platform-key cap.

    Only called for platform-key resolutions; BYOK is never hard-blocked.
    """
    status = await get_spend_status(session, tenant_id, use_cache=True)
    if not status["blocked"]:
        return
    if status["daily_tokens"]["exceeded"]:
        detail = "Daily LLM token budget exhausted. Raise the cap in Usage settings or wait until tomorrow."
    else:
        detail = "Monthly LLM spend cap reached. Raise the cap in Usage settings to continue."
    raise AppError(detail, code="budget_exceeded", status_code=402)


# ---------------------------------------------------------------------------
# Threshold alerts (80% / 100%)
# ---------------------------------------------------------------------------


async def check_and_send_spend_alerts(session: AsyncSession, tenant_id: UUID) -> int:
    """Notify owners/admins when spend crosses 80%/100% of a cap.

    Dedupe: titles carry the period (day/month), and the notification-level
    cooldown suppresses repeats within the period.
    """
    from app.services.ops_alerts import notify_tenant_admins

    status = await get_spend_status(session, tenant_id)
    now = datetime.utcnow()
    sent = 0
    checks = (
        (
            status["daily_tokens"],
            f"daily token cap ({now.strftime('%b %d')})",
            26 * 60,  # cooldown just over a day; the date in the title resets it
        ),
        (
            status["monthly_customer_micros"],
            f"monthly spend cap ({now.strftime('%B %Y')})",
            45 * 24 * 60,
        ),
    )
    for period, label, cooldown in checks:
        if not period["cap"]:
            continue
        for threshold in ALERT_THRESHOLDS:
            if period["ratio"] >= threshold:
                pct = int(threshold * 100)
                title = f"LLM budget: {pct}% of {label}"
                body = (
                    "AI calls on platform keys are paused until the cap is raised or the period resets."
                    if threshold >= 1.0
                    else "Usage is approaching the configured cap. Review it on the Usage page."
                )
                sent += await notify_tenant_admins(
                    session,
                    tenant_id,
                    category=BILLING_ALERTS,
                    title=title,
                    body=body,
                    cooldown_minutes=cooldown,
                )
                break  # only the highest crossed threshold per period
    return sent


def schedule_spend_alert_check(tenant_id: UUID) -> None:
    """Fire-and-forget alert evaluation; never blocks the usage write path."""
    from app.services.push import _schedule_push_task

    async def _run() -> None:
        from app.db.session import async_session_factory

        async with async_session_factory() as session:
            await check_and_send_spend_alerts(session, tenant_id)

    _schedule_push_task(_run())
