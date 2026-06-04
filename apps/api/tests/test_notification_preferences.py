"""User notification preference endpoints."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

AUTH = "/api/auth"


async def _login(client: AsyncClient) -> str:
    res = await client.post(f"{AUTH}/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return res.json()["access_token"]


@pytest.mark.asyncio
async def test_notification_preferences_roundtrip(client: AsyncClient):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}

    initial = await client.get("/api/user/notification-preferences", headers=headers)
    assert initial.status_code == 200
    rows = initial.json()["rows"]
    assert isinstance(rows, list)
    assert len(rows) >= 1

    updated = [
        {**rows[0], "channels": {"desktop": False, "email": True, "mobile": False}},
        *rows[1:],
    ]
    patch = await client.patch(
        "/api/user/notification-preferences",
        headers=headers,
        json={"rows": updated},
    )
    assert patch.status_code == 200
    assert patch.json()["rows"][0]["channels"]["email"] is True

    again = await client.get("/api/user/notification-preferences", headers=headers)
    assert again.status_code == 200
    assert again.json()["rows"][0]["channels"]["email"] is True
