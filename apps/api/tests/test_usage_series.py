"""Token series for Overview (hourly) and Usage (daily) charts."""

from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.usage import UsageLedger
from app.services.cockpit import usage_token_series
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


@pytest.mark.asyncio
async def test_usage_token_series_fills_zeros_and_sums_day(
    client: AsyncClient, session_override
):
    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200, login.text
    session = session_override
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    today = datetime.utcnow().replace(hour=12, minute=0, second=0, microsecond=0)
    session.add_all(
        [
            UsageLedger(
                tenant_id=tenant.id,
                model="test",
                provider="test",
                key_source="mock",
                tokens_in=100,
                tokens_out=50,
                created_at=today,
            ),
            UsageLedger(
                tenant_id=tenant.id,
                model="test",
                provider="test",
                key_source="mock",
                tokens_in=10,
                tokens_out=5,
                created_at=today - timedelta(days=2),
            ),
        ]
    )
    await session.commit()

    series = await usage_token_series(session, tenant.id, days=7)
    assert series["days"] == 7
    assert len(series["points"]) == 7
    by_date = {row["date"]: row["tokens"] for row in series["points"]}
    assert by_date[today.date().isoformat()] == 150
    assert by_date[(today - timedelta(days=2)).date().isoformat()] == 15
    assert by_date[(today - timedelta(days=1)).date().isoformat()] == 0


@pytest.mark.asyncio
async def test_usage_token_series_hourly_last_24h(client: AsyncClient, session_override):
    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200, login.text
    session = session_override
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    session.add_all(
        [
            UsageLedger(
                tenant_id=tenant.id,
                model="test",
                provider="test",
                key_source="mock",
                tokens_in=40,
                tokens_out=10,
                created_at=now.replace(minute=20),
            ),
            UsageLedger(
                tenant_id=tenant.id,
                model="test",
                provider="test",
                key_source="mock",
                tokens_in=5,
                tokens_out=5,
                created_at=(now - timedelta(hours=3)).replace(minute=10),
            ),
        ]
    )
    await session.commit()

    series = await usage_token_series(session, tenant.id, hours=24)
    assert series["hours"] == 24
    assert len(series["points"]) == 24
    by_at = {row["at"]: row["tokens"] for row in series["points"]}
    assert by_at[now.isoformat()] == 50
    assert by_at[(now - timedelta(hours=3)).isoformat()] == 10
    assert by_at[(now - timedelta(hours=1)).isoformat()] == 0

    token = login.json()["access_token"]
    http = await client.get(
        "/api/cockpit/usage/series?hours=24",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert http.status_code == 200, http.text
    body = http.json()
    assert body["hours"] == 24
    assert len(body["points"]) == 24
