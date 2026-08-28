"""Unified channel state: one lifecycle enum, capabilities, and granular checks."""

import json
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from app.services.channel_registry import channel_kind, resolve_channel
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _tenant(session: AsyncSession) -> Tenant:
    return (await session.execute(select(Tenant).limit(1))).scalar_one()


def _mailbox(tenant_id, **kwargs) -> ChannelAccount:
    defaults = {
        "tenant_id": tenant_id,
        "channel": "email",
        "provider": "outlook",
        "address": "state@bokito.ai",
        "display_name": "State Test",
    }
    return ChannelAccount(**{**defaults, **kwargs})


def test_channel_kind_splits_email_by_provider():
    assert channel_kind(_mailbox(None, provider="gmail")) == "email_mailbox"
    assert channel_kind(_mailbox(None, provider="bokito")) == "email_relay"
    assert channel_kind(_mailbox(None, channel="slack", provider="slack")) == "slack"


def test_mailbox_without_credentials_needs_action():
    row = resolve_channel(_mailbox(None))
    assert row["state"] == "action_required"
    assert row["state_reason"] == "credentials"
    credentials = next(c for c in row["checks"] if c["id"] == "credentials")
    assert credentials["state"] == "fail"
    assert credentials["action"] == "reconnect"
    # No point offering a sync detail while the mailbox cannot authenticate.
    assert next(c for c in row["checks"] if c["id"] == "last_sync")["state"] == "na"


def test_mailbox_with_credentials_is_connecting_until_first_sync():
    account = _mailbox(None, credentials_json=json.dumps({"access_token": "tok"}))
    row = resolve_channel(account)
    assert row["state"] == "connecting"
    assert row["capabilities"] == ["receive", "send", "sync"]


def test_mailbox_sync_error_is_degraded_not_broken():
    account = _mailbox(
        None,
        credentials_json=json.dumps({"access_token": "tok"}),
        settings_json=json.dumps(
            {"last_sync_at": datetime.utcnow().isoformat(), "last_error": "Graph 503"}
        ),
    )
    row = resolve_channel(account)
    assert row["state"] == "degraded"
    assert row["last_error"] == "Graph 503"


def test_mailbox_repeated_sync_errors_are_an_error():
    account = _mailbox(
        None,
        credentials_json=json.dumps({"access_token": "tok"}),
        settings_json=json.dumps(
            {
                "last_sync_at": datetime.utcnow().isoformat(),
                "last_error": "Graph 503",
                "sync_error_count": 7,
            }
        ),
    )
    assert resolve_channel(account)["state"] == "error"


def test_stale_sync_is_degraded():
    account = _mailbox(
        None,
        credentials_json=json.dumps({"access_token": "tok"}),
        settings_json=json.dumps(
            {"last_sync_at": (datetime.utcnow() - timedelta(days=3)).isoformat()}
        ),
    )
    row = resolve_channel(account)
    assert row["state"] == "degraded"
    assert row["state_reason"] == "last_sync"


def test_disabled_channel_is_paused_and_offers_resume():
    account = _mailbox(None, is_enabled=False)
    row = resolve_channel(account)
    assert row["state"] == "paused"
    assert "resume" in row["actions"]
    assert "pause" not in row["actions"]


def test_widget_receives_without_credentials():
    account = ChannelAccount(
        channel="widget", provider="widget", address="acme", display_name="Website chat"
    )
    row = resolve_channel(account)
    assert row["state"] == "active"
    assert row["capabilities"] == ["receive", "send"]
    assert row["configure_href"] == "/ai/assistant/external/customization"
    assert "remove" not in row["actions"]
    assert next(c for c in row["checks"] if c["id"] == "installed")["state"] == "pending"


def test_slack_missing_token_needs_action():
    account = ChannelAccount(
        channel="slack",
        provider="slack",
        address="T123",
        credentials_json=json.dumps({"signing_secret": "s"}),
    )
    row = resolve_channel(account)
    assert row["state"] == "action_required"
    assert row["state_reason"] == "bot_token"


def test_whatsapp_without_phone_number_needs_setup():
    account = ChannelAccount(
        channel="whatsapp",
        provider="whatsapp_cloud",
        address="",
        credentials_json=json.dumps({"access_token": "tok"}),
    )
    row = resolve_channel(account)
    assert row["state"] == "setup_required"
    assert row["state_reason"] == "phone_number"


@pytest.mark.asyncio
async def test_channels_endpoint_hides_internal_and_mock(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    session_override.add(
        ChannelAccount(
            tenant_id=tenant.id, channel="internal", provider="internal", address="team"
        )
    )
    session_override.add(
        _mailbox(tenant.id, provider="mock", address="phantom@bokito.ai")
    )
    await session_override.commit()

    rows = (await client.get("/api/channels", headers=headers)).json()["channels"]
    assert not [r for r in rows if r["channel"] == "internal"]
    assert not [r for r in rows if r["provider"] == "mock"]


@pytest.mark.asyncio
async def test_patch_channel_pauses_renames_and_sets_primary(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    account = _mailbox(tenant.id, address="primary@bokito.ai")
    session_override.add(account)
    await session_override.commit()
    await session_override.refresh(account)

    patched = await client.patch(
        f"/api/channels/accounts/{account.id}",
        headers=headers,
        json={"label": "Shared inbox", "is_enabled": False, "is_primary": True},
    )
    assert patched.status_code == 200, patched.text
    row = patched.json()
    assert row["label"] == "Shared inbox"
    assert row["state"] == "paused"
    assert row["is_primary"] is True

    detail = await client.get(f"/api/channels/accounts/{account.id}", headers=headers)
    assert detail.json()["display_name"] == "Shared inbox"


@pytest.mark.asyncio
async def test_patch_channel_sets_backfill_window(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    account = _mailbox(tenant.id, address="backfill@bokito.ai")
    session_override.add(account)
    await session_override.commit()
    await session_override.refresh(account)

    patched = await client.patch(
        f"/api/channels/accounts/{account.id}",
        headers=headers,
        json={"sync_window_days": 90},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["sync_window_days"] == 90

    rejected = await client.patch(
        f"/api/channels/accounts/{account.id}",
        headers=headers,
        json={"sync_window_days": -1},
    )
    assert rejected.status_code == 400


@pytest.mark.asyncio
async def test_sync_endpoint_rejects_channels_without_sync(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    widget = (
        await session_override.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant.id, ChannelAccount.channel == "widget"
            )
        )
    ).scalars().first()
    if widget is None:
        widget = ChannelAccount(
            tenant_id=tenant.id, channel="widget", provider="widget", address=tenant.slug
        )
        session_override.add(widget)
        await session_override.commit()
        await session_override.refresh(widget)

    res = await client.post(
        f"/api/channels/accounts/{widget.id}/sync", headers=headers
    )
    assert res.status_code == 400
    assert "does not sync" in res.json()["error"]["message"]


@pytest.mark.asyncio
async def test_widget_channel_cannot_be_removed(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    from app.services.tenant_bootstrap import ensure_widget_channel

    widget = await ensure_widget_channel(session_override, tenant.id)
    res = await client.delete(f"/api/channels/accounts/{widget.id}", headers=headers)
    assert res.status_code == 400
