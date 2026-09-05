"""Reply can rebind an email thread to another sendable mailbox."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    r = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _create_email_account(client: AsyncClient, headers: dict, address: str) -> dict:
    created = await client.post(
        "/api/channels/accounts",
        json={
            "channel": "email",
            "provider": "mock",
            "address": address,
            "display_name": address.split("@")[0].title(),
        },
        headers=headers,
    )
    assert created.status_code == 200, created.text
    return created.json()


@pytest.mark.asyncio
async def test_reply_rebinds_to_selected_mailbox(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    source = await _create_email_account(client, headers, "sales@test.local")
    target = await _create_email_account(client, headers, "support@test.local")

    from app.models.auth import Tenant
    from uuid import UUID

    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Rebind me",
        contact_email="customer@example.com",
        channel_account_id=UUID(source["id"]),
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    r = await client.post(
        f"/api/signals/{signal.id}/reply",
        headers=headers,
        json={
            "body_text": "Sending from the other mailbox",
            "channel_account_id": target["id"],
        },
    )
    assert r.status_code == 200, r.text

    await session_override.refresh(signal)
    assert str(signal.channel_account_id) == target["id"]


@pytest.mark.asyncio
async def test_reply_rejects_non_email_channel_account(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    source = await _create_email_account(client, headers, "only-mail@test.local")
    widget = await client.post(
        "/api/channels/accounts",
        json={"channel": "widget", "provider": "widget", "address": "site", "display_name": "Site"},
        headers=headers,
    )
    assert widget.status_code == 200, widget.text

    from app.models.auth import Tenant
    from uuid import UUID

    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="No hop",
        contact_email="customer@example.com",
        channel_account_id=UUID(source["id"]),
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    r = await client.post(
        f"/api/signals/{signal.id}/reply",
        headers=headers,
        json={
            "body_text": "Nope",
            "channel_account_id": widget.json()["id"],
        },
    )
    assert r.status_code == 400, r.text
    await session_override.refresh(signal)
    assert str(signal.channel_account_id) == source["id"]


@pytest.mark.asyncio
async def test_reply_same_mailbox_keeps_binding(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    source = await _create_email_account(client, headers, "same@test.local")

    from app.models.auth import Tenant
    from uuid import UUID

    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Stay put",
        contact_email="customer@example.com",
        channel_account_id=UUID(source["id"]),
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    r = await client.post(
        f"/api/signals/{signal.id}/reply",
        headers=headers,
        json={
            "body_text": "Same mailbox",
            "channel_account_id": source["id"],
        },
    )
    assert r.status_code == 200, r.text
    await session_override.refresh(signal)
    assert str(signal.channel_account_id) == source["id"]
