"""Notification tiers, availability, the bell, and read state per conversation."""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.notify import (
    TIER_DIGEST,
    TIER_LATER,
    TIER_NOW,
    channels_for,
    notify,
    parse_prefs,
)
from app.services.presence import AVAILABLE, AWAY, OFFLINE
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    r = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _tenant_and_user(session: AsyncSession):
    from app.models.auth import Tenant, User

    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    return tenant, user


def test_tier_one_pushes_only_outside_the_app():
    prefs = parse_prefs(None)
    assert channels_for(prefs, tier=TIER_NOW, category="mentions", status=OFFLINE) == {"inapp", "push"}
    assert channels_for(prefs, tier=TIER_NOW, category="mentions", status=AVAILABLE) == {"inapp"}


def test_tier_two_and_three_never_push():
    prefs = parse_prefs('{"tiers": {"2": {"push": true}, "3": {"push": true, "email": true}}}')
    assert "push" not in channels_for(prefs, tier=TIER_LATER, category=None, status=OFFLINE)
    digest = channels_for(prefs, tier=TIER_DIGEST, category=None, status=OFFLINE)
    assert digest == {"inapp"}


def test_away_lets_only_critical_tier_one_through():
    prefs = parse_prefs('{"tiers": {"1": {"email": true}}}')
    assert channels_for(prefs, tier=TIER_NOW, category="mentions", status=AWAY) == {"inapp"}
    assert channels_for(prefs, tier=TIER_NOW, category=None, status=AWAY, critical=True) == {
        "inapp",
        "push",
        "email",
    }


def test_category_row_narrows_the_tier():
    prefs = parse_prefs('{"rows": [{"id": "mentions", "channels": {"inapp": true, "push": false}}]}')
    assert channels_for(prefs, tier=TIER_NOW, category="mentions", status=OFFLINE) == {"inapp"}
    assert "push" in channels_for(prefs, tier=TIER_NOW, category="decisions", status=OFFLINE)


def test_legacy_rows_still_parse():
    prefs = parse_prefs(
        '[{"id": "mentions", "channels": {"desktop": false, "push": true}},'
        ' {"id": "digest-daily", "channels": {"email": true}}]'
    )
    assert prefs["categories"]["mentions"]["inapp"] is False
    assert prefs["tiers"][TIER_DIGEST]["email"] is True


@pytest.mark.asyncio
async def test_bell_lists_system_notices_and_conversation_read_clears_rows(
    client: AsyncClient, session_override
):
    from app.models.notification import Notification
    from app.models.signal import Signal

    session = session_override
    tenant, user = await _tenant_and_user(session)
    user.last_seen_at = datetime.utcnow() - timedelta(hours=2)
    session.add(user)
    signal = Signal(tenant_id=tenant.id, channel="email", subject="Invoice", assigned_user_id=user.id)
    session.add(signal)
    await session.commit()

    with patch("app.services.push.send_push_to_user", new_callable=AsyncMock) as mock_push:
        mock_push.return_value = 1
        await notify(
            session,
            tenant.id,
            kind="mention",
            recipients=[user.id],
            title="Jane mentioned you",
            tier=TIER_NOW,
            category="mentions",
            signal_id=signal.id,
        )
        await notify(
            session, tenant.id, kind="ops_alert", recipients=[user.id], title="Run failed: x"
        )
    # Only the tier 1 notice pushed.
    assert mock_push.await_count == 1

    headers = await _login(client)
    bell = await client.get("/api/notifications", headers=headers)
    assert bell.status_code == 200, bell.text
    titles = [row["title"] for row in bell.json()]
    assert "Run failed: x" in titles
    assert "Jane mentioned you" not in titles

    summary = await client.get("/api/notifications/summary", headers=headers)
    assert summary.status_code == 200, summary.text
    assert summary.json()["unread"] >= 1
    assert summary.json()["for_you"] >= 1

    signal_id = signal.id
    r = await client.patch(f"/api/signals/{signal_id}/mark-read", headers=headers)
    assert r.status_code == 200, r.text
    session.expire_all()
    rows = (
        await session.execute(select(Notification).where(Notification.signal_id == signal_id))
    ).scalars().all()
    assert rows and all(row.status == "read" for row in rows)


@pytest.mark.asyncio
async def test_preferences_roundtrip_per_tier(client: AsyncClient, session_override):
    headers = await _login(client)
    r = await client.get("/api/user/notification-preferences", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["tiers"]["1"]["push"] is True
    r = await client.patch(
        "/api/user/notification-preferences",
        json={"tiers": {"1": {"push": False}}, "rows": [{"id": "mentions", "channels": {"email": True}}]},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tiers"]["1"]["push"] is False
    assert body["tiers"]["1"]["inapp"] is True
    mentions = next(row for row in body["rows"] if row["id"] == "mentions")
    assert mentions["channels"]["email"] is True
