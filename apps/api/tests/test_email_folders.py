"""Tests for mailbox folder selection and the inbox sync-status endpoint."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant, user_numeric_id
from app.models.channel import ChannelAccount
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _ensure_mailbox(session: AsyncSession) -> ChannelAccount:
    tenant = (await session.execute(select(Tenant).limit(1))).scalar_one()
    account = (
        await session.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant.id,
                ChannelAccount.channel == "email",
                ChannelAccount.provider == "outlook",
            )
        )
    ).scalars().first()
    if account is None:
        account = ChannelAccount(
            tenant_id=tenant.id,
            channel="email",
            provider="outlook",
            address="folders-test@bokito.ai",
            display_name="Folders Test",
        )
        session.add(account)
        await session.commit()
        await session.refresh(account)
    return account


@pytest.mark.asyncio
async def test_folder_selection_roundtrip(client: AsyncClient, session_override: AsyncSession):
    headers = await _login(client)
    account = await _ensure_mailbox(session_override)
    numeric_id = user_numeric_id(account.id)

    listed = await client.get(f"/api/email/connections/{numeric_id}/folders", headers=headers)
    assert listed.status_code == 200
    folders = listed.json()["folders"]
    assert any(f["id"] == "inbox" and f["is_selected"] for f in folders)

    update = await client.put(
        f"/api/email/connections/{numeric_id}/folders",
        headers=headers,
        json={
            "folders": [
                {"id": "inbox", "display_name": "Inbox", "is_selected": True},
                {"id": "archive", "display_name": "Archive", "is_selected": True},
                {"id": "junk", "display_name": "Spam", "is_selected": False},
            ]
        },
    )
    assert update.status_code == 200

    relisted = await client.get(f"/api/email/connections/{numeric_id}/folders", headers=headers)
    by_id = {f["id"]: f for f in relisted.json()["folders"]}
    assert by_id["archive"]["is_selected"] is True
    assert by_id["junk"]["is_selected"] is False

    empty = await client.put(
        f"/api/email/connections/{numeric_id}/folders",
        headers=headers,
        json={"folders": [{"id": "inbox", "display_name": "Inbox", "is_selected": False}]},
    )
    assert empty.status_code == 400


@pytest.mark.asyncio
async def test_sync_status_reports_mailboxes(client: AsyncClient, session_override: AsyncSession):
    headers = await _login(client)
    account = await _ensure_mailbox(session_override)
    numeric_id = user_numeric_id(account.id)

    res = await client.get("/api/signals/sync-status", headers=headers)
    assert res.status_code == 200
    rows = res.json()
    row = next((r for r in rows if r["id"] == numeric_id), None)
    assert row is not None
    assert row["mailbox_email"] == account.address
    # No credentials stored for the test mailbox.
    assert row["status"] == "needs_auth"
    assert any(f["folder_id"] == "inbox" for f in row["folders"])
