"""Tests for human takeover (ai_paused) and real-vs-mock OAuth start gating."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.oauth_state import OAuthState


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_takeover_and_release(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "widget",
            "source": "widget",
            "subject": "Live chat",
            "body_text": "Is anyone there?",
            "contact_email": "visitor@test.com",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]

    took = await client.post(f"/api/signals/{signal_id}/takeover", headers=headers)
    assert took.status_code == 200
    assert took.json()["ai_paused"] is True

    detail = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert detail.json()["thread"]["ai_paused"] is True

    released = await client.post(f"/api/signals/{signal_id}/release", headers=headers)
    assert released.status_code == 200
    assert released.json()["ai_paused"] is False


@pytest.mark.asyncio
async def test_takeover_missing_signal(client: AsyncClient):
    headers = await _auth_headers(client)
    res = await client.post(
        "/api/signals/00000000-0000-0000-0000-000000000000/takeover", headers=headers
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_email_oauth_start_mock_when_unconfigured(client: AsyncClient):
    headers = await _auth_headers(client)
    res = await client.get(
        "/api/email/oauth/start",
        headers=headers,
        params={"provider": "gmail", "return_url": "http://localhost:5174/settings"},
    )
    assert res.status_code == 200
    url = res.json()["authorize_url"]
    # Mock flow appends success params directly to the return URL (no Google redirect).
    assert "oauth_status=connected" in url
    assert "accounts.google.com" not in url


@pytest.mark.asyncio
async def test_oauth_start_real_when_configured(client: AsyncClient, session_override, monkeypatch):
    from app.services import oauth_providers

    monkeypatch.setattr(oauth_providers, "is_configured", lambda provider: provider == "gmail")
    monkeypatch.setattr(
        oauth_providers, "_credentials", lambda provider: ("test-client-id", "test-secret")
    )

    headers = await _auth_headers(client)
    res = await client.get(
        "/api/email/oauth/start",
        headers=headers,
        params={"provider": "gmail", "return_url": "http://localhost:5174/settings"},
    )
    assert res.status_code == 200
    url = res.json()["authorize_url"]
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth")
    assert "client_id=test-client-id" in url
    assert "state=" in url

    states = (await session_override.execute(select(OAuthState))).scalars().all()
    assert any(s.provider == "gmail" and s.flow == "email" for s in states)


@pytest.mark.asyncio
async def test_oauth_callback_invalid_state_redirects(client: AsyncClient):
    res = await client.get(
        "/api/integrations/oauth/callback",
        params={"state": "does-not-exist", "code": "abc"},
        follow_redirects=False,
    )
    assert res.status_code == 302
    assert "oauth_error=invalid_state" in res.headers["location"]


@pytest.mark.asyncio
async def test_email_sync_ingests_messages(session_override, monkeypatch):
    """A connected mailbox with a token ingests fetched messages as signals."""
    import json

    from app.models.auth import Tenant
    from app.models.channel import ChannelAccount
    from app.models.signal import Signal
    from app.services import email_sync

    tenant = Tenant(slug="sync-co", name="Sync Co")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        provider="gmail",
        address="support@sync-co.test",
        is_enabled=True,
        credentials_json=json.dumps({"access_token": "test-token"}),
    )
    session_override.add(account)
    await session_override.commit()
    await session_override.refresh(account)

    async def fake_fetch(acct, token):
        return [
            {
                "from_address": "lead@customer.test",
                "from_name": "Lead",
                "subject": "Quote request",
                "body_text": "Can you send a quote?",
                "message_id": "gmail-msg-1",
                "thread_id": "gmail-thread-1",
            }
        ]

    monkeypatch.setattr(email_sync, "_fetch_messages", fake_fetch)

    result = await email_sync.sync_account(session_override, account)
    assert result["status"] == "ok"
    assert result["fetched"] == 1

    signals = (
        await session_override.execute(
            select(Signal).where(Signal.tenant_id == tenant.id, Signal.channel == "email")
        )
    ).scalars().all()
    assert any(s.subject == "Quote request" for s in signals)

    # Re-syncing the same message id is deduped (no duplicate thread).
    again = await email_sync.sync_account(session_override, account)
    assert again["synced"] == 0
