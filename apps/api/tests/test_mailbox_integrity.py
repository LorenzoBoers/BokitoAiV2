"""Mailbox lifecycle integrity: replying to a thread whose mailbox was
disconnected must be blocked (409) instead of silently 'sending' nothing,
and an explicit mailbox choice may rebind the orphaned thread."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import ChannelAccount
from app.models.signal import Signal
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    r = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _orphaned_thread(session: AsyncSession) -> Signal:
    from app.models.auth import Tenant

    tenant = (await session.execute(select(Tenant))).scalars().first()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Orphaned thread",
        contact_email="customer@example.com",
        channel_account_id=None,
        status="open",
    )
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal


@pytest.mark.asyncio
async def test_reply_to_orphaned_thread_is_409(client: AsyncClient, session_override: AsyncSession):
    headers = await _login(client)
    signal = await _orphaned_thread(session_override)

    r = await client.post(
        "/api/email/send",
        headers=headers,
        json={"thread_id": str(signal.id), "body_text": "Hello?"},
    )
    assert r.status_code == 409, r.text
    assert "disconnected" in r.text.lower()


@pytest.mark.asyncio
async def test_disconnect_then_reply_blocked(client: AsyncClient, session_override: AsyncSession):
    headers = await _login(client)

    listing = await client.get("/api/email/accounts", headers=headers)
    assert listing.status_code == 200
    conn_id = listing.json()[0]["id"]

    account = (
        (await session_override.execute(select(ChannelAccount).limit(1))).scalars().first()
    )
    signal = Signal(
        tenant_id=account.tenant_id,
        channel="email",
        subject="Reply after disconnect",
        contact_email="customer@example.com",
        channel_account_id=account.id,
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    # Replying while connected works (dev store-only send).
    r = await client.post(
        "/api/email/send",
        headers=headers,
        json={"thread_id": str(signal.id), "body_text": "Before disconnect"},
    )
    assert r.status_code == 200, r.text

    r = await client.delete(f"/api/email/connections/{conn_id}", headers=headers)
    assert r.status_code == 200, r.text

    # History stays but replying is now blocked with a clear error.
    r = await client.post(
        "/api/email/send",
        headers=headers,
        json={"thread_id": str(signal.id), "body_text": "After disconnect"},
    )
    assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_explicit_mailbox_choice_rebinds_orphaned_thread(
    client: AsyncClient, session_override: AsyncSession
):
    from app.models.auth import user_numeric_id

    headers = await _login(client)
    signal = await _orphaned_thread(session_override)

    # A second, still-connected mailbox in the same tenant.
    other = ChannelAccount(
        tenant_id=signal.tenant_id,
        channel="email",
        address="second@test.local",
        provider="outlook",
    )
    session_override.add(other)
    await session_override.commit()
    await session_override.refresh(other)

    r = await client.post(
        "/api/email/send",
        headers=headers,
        json={
            "thread_id": str(signal.id),
            "body_text": "Reply via other mailbox",
            "connection_id": user_numeric_id(other.id),
        },
    )
    assert r.status_code == 200, r.text

    await session_override.refresh(signal)
    assert signal.channel_account_id == other.id


@pytest.mark.asyncio
async def test_thread_serializer_reports_disconnected_mailbox(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    signal = await _orphaned_thread(session_override)

    r = await client.get(f"/api/signals/{signal.id}", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["thread"]["email_connection_id"] is None
