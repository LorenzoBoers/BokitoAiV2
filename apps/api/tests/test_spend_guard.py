"""Tenant LLM spend caps: status math, enforcement, alerts, budget API."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _tenant(session):
    from app.models.auth import Tenant

    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


def _usage_row(tenant_id, *, tokens: int = 0, micros: int = 0):
    from app.models.usage import UsageLedger

    return UsageLedger(
        tenant_id=tenant_id,
        key_source="platform",
        billable=True,
        tokens_in=tokens,
        tokens_out=0,
        customer_cost_micros=micros,
        provider_cost_micros=micros,
    )


@pytest.mark.asyncio
async def test_spend_status_and_enforcement(client: AsyncClient, session_override):
    from app.exceptions import AppError
    from app.services import spend_guard

    await _login(client)  # ensure seed ran
    tenant = await _tenant(session_override)
    spend_guard.invalidate_cache(tenant.id)

    status = await spend_guard.get_spend_status(session_override, tenant.id)
    assert status["daily_tokens"]["cap"] == spend_guard.DEFAULT_DAILY_TOKEN_CAP
    assert status["blocked"] is False

    # Tiny cap + usage above it: blocked and check raises 402.
    await spend_guard.update_spend_config(
        session_override, tenant, {"daily_token_cap": 100}
    )
    session_override.add(_usage_row(tenant.id, tokens=150))
    await session_override.commit()
    spend_guard.invalidate_cache(tenant.id)

    status = await spend_guard.get_spend_status(session_override, tenant.id)
    assert status["daily_tokens"]["exceeded"] is True
    with pytest.raises(AppError) as exc:
        await spend_guard.check_tenant_budget(session_override, tenant.id)
    assert exc.value.code == "budget_exceeded"
    assert exc.value.status_code == 402

    # Uncapped again: no block.
    await spend_guard.update_spend_config(
        session_override, tenant, {"daily_token_cap": None, "monthly_customer_micros_cap": None}
    )
    status = await spend_guard.get_spend_status(session_override, tenant.id)
    assert status["blocked"] is False
    await spend_guard.check_tenant_budget(session_override, tenant.id)


@pytest.mark.asyncio
async def test_spend_alerts_at_thresholds(client: AsyncClient, session_override):
    from app.models.notification import Notification
    from app.services import spend_guard

    await _login(client)
    tenant = await _tenant(session_override)
    await spend_guard.update_spend_config(
        session_override, tenant, {"daily_token_cap": 1000, "monthly_customer_micros_cap": None}
    )
    session_override.add(_usage_row(tenant.id, tokens=850))
    await session_override.commit()
    spend_guard.invalidate_cache(tenant.id)

    sent = await spend_guard.check_and_send_spend_alerts(session_override, tenant.id)
    assert sent >= 1
    titles = [
        n.title
        for n in (
            await session_override.execute(
                select(Notification).where(
                    Notification.tenant_id == tenant.id, Notification.kind == "ops_alert"
                )
            )
        ).scalars().all()
    ]
    assert any(t.startswith("LLM budget: 80%") for t in titles)
    assert not any(t.startswith("LLM budget: 100%") for t in titles)

    session_override.add(_usage_row(tenant.id, tokens=200))
    await session_override.commit()
    spend_guard.invalidate_cache(tenant.id)
    await spend_guard.check_and_send_spend_alerts(session_override, tenant.id)
    titles = [
        n.title
        for n in (
            await session_override.execute(
                select(Notification).where(
                    Notification.tenant_id == tenant.id, Notification.kind == "ops_alert"
                )
            )
        ).scalars().all()
    ]
    assert any(t.startswith("LLM budget: 100%") for t in titles)

    # Cleanup so other tests see an unconstrained tenant.
    await spend_guard.update_spend_config(session_override, tenant, {"daily_token_cap": None})


@pytest.mark.asyncio
async def test_budget_api_get_and_patch(client: AsyncClient, session_override):
    from app.services import spend_guard

    headers = await _login(client)

    res = await client.get("/api/cockpit/budget", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert "daily_tokens" in body["status"]

    res = await client.patch(
        "/api/cockpit/budget",
        headers=headers,
        json={"daily_token_cap": 555_000},
    )
    assert res.status_code == 200, res.text
    assert res.json()["config"]["daily_token_cap"] == 555_000

    # Reset to defaults for other tests.
    tenant = await _tenant(session_override)
    await spend_guard.update_spend_config(
        session_override, tenant, {"daily_token_cap": None}
    )
    res = await client.get("/api/cockpit/budget", headers=headers)
    assert res.json()["config"]["daily_token_cap"] is None
