"""Archive keeps a channel's conversations and access; delete removes both."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from app.models.signal import Signal
from app.services.crypto import get_connection_credentials
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _mailbox_with_thread(session: AsyncSession) -> tuple[ChannelAccount, Signal]:
    tenant = (await session.execute(select(Tenant).limit(1))).scalar_one()
    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        provider="outlook",
        address="archive@bokito.ai",
        credentials_json=json.dumps({"access_token": "tok"}),
    )
    session.add(account)
    await session.commit()
    await session.refresh(account)
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Kept thread",
        channel_account_id=account.id,
    )
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return account, signal


@pytest.mark.asyncio
async def test_archive_keeps_conversations_and_access(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    account, signal = await _mailbox_with_thread(session_override)

    res = await client.post(f"/api/channels/accounts/{account.id}/archive", headers=headers)
    assert res.status_code == 200, res.text
    row = res.json()
    assert row["state"] == "archived"
    assert row["archived_at"]
    assert row["actions"] == ["restore", "delete"]
    assert row["conversation_count"] == 1

    await session_override.refresh(signal)
    await session_override.refresh(account)
    assert signal.channel_account_id == account.id
    assert account.is_enabled is False
    assert get_connection_credentials(account) == {}
    access = await client.put(
        f"/api/channels/accounts/{account.id}/access",
        headers=headers,
        json={"entries": [{"kind": "team", "id": "agents", "level": "view"}]},
    )
    assert access.status_code == 200, access.text
    assert access.json()["is_default"] is False

    status = (await client.get("/api/channels/status", headers=headers)).json()
    assert account.address not in [c.get("address") for c in status["channels"]]


@pytest.mark.asyncio
async def test_archived_channel_refuses_resume_and_sync(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    account, _ = await _mailbox_with_thread(session_override)
    await client.post(f"/api/channels/accounts/{account.id}/archive", headers=headers)

    resumed = await client.patch(
        f"/api/channels/accounts/{account.id}", headers=headers, json={"is_enabled": True}
    )
    assert resumed.status_code == 409
    synced = await client.post(f"/api/channels/accounts/{account.id}/sync", headers=headers)
    assert synced.status_code == 409


@pytest.mark.asyncio
async def test_delete_requires_archive_when_channel_has_conversations(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    account, signal = await _mailbox_with_thread(session_override)

    blocked = await client.delete(f"/api/channels/accounts/{account.id}", headers=headers)
    assert blocked.status_code == 409

    await client.post(f"/api/channels/accounts/{account.id}/archive", headers=headers)
    deleted = await client.delete(f"/api/channels/accounts/{account.id}", headers=headers)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["conversations_deleted"] == 1

    signal_id = signal.id
    session_override.expunge_all()
    assert await session_override.get(Signal, signal_id) is None
    assert await session_override.get(ChannelAccount, account.id) is None


@pytest.mark.asyncio
async def test_restore_brings_channel_back_paused(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    account, _ = await _mailbox_with_thread(session_override)
    await client.post(f"/api/channels/accounts/{account.id}/archive", headers=headers)

    res = await client.post(f"/api/channels/accounts/{account.id}/restore", headers=headers)
    assert res.status_code == 200, res.text
    row = res.json()
    assert row["archived_at"] is None
    assert row["state"] != "archived"
    assert "archive" in row["actions"]
