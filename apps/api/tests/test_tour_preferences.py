"""First-run tour state persists per user in settings_json via /me/preferences."""

import pytest
from httpx import AsyncClient


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_tour_state_roundtrip(client: AsyncClient):
    headers = await _auth_headers(client)

    res = await client.get("/api/me/preferences", headers=headers)
    assert res.status_code == 200
    assert res.json()["tour"] == {}
    from app.services.language import platform_default_ui_language

    assert res.json()["ui_language"] == platform_default_ui_language()

    res = await client.patch(
        "/api/me/preferences",
        json={"tour": {"intro_done": True, "version": 1}},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["tour"] == {"intro_done": True, "version": 1}

    # Shallow merge: later patches keep earlier keys.
    res = await client.patch(
        "/api/me/preferences",
        json={"tour": {"completed": True}},
        headers=headers,
    )
    assert res.status_code == 200
    tour = res.json()["tour"]
    assert tour["intro_done"] is True
    assert tour["completed"] is True

    res = await client.get("/api/me/preferences", headers=headers)
    assert res.json()["tour"]["completed"] is True


@pytest.mark.asyncio
async def test_tour_state_rejects_non_scalars_and_oversize(client: AsyncClient):
    headers = await _auth_headers(client)

    # Non-scalar values are silently dropped (UI flag bag, not a data store).
    res = await client.patch(
        "/api/me/preferences",
        json={"tour": {"nested": {"a": 1}, "ok": True}},
        headers=headers,
    )
    assert res.status_code == 200
    assert "nested" not in res.json()["tour"]
    assert res.json()["tour"]["ok"] is True

    res = await client.patch(
        "/api/me/preferences",
        json={"tour": {f"key_{i}": i for i in range(30)}},
        headers=headers,
    )
    assert res.status_code == 400
