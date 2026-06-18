"""Phase 5 wiring: password-reset and email-verification token flows."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

API = "/api"


@pytest.mark.asyncio
async def test_password_reset_flow(client: AsyncClient):
    req = await client.post(
        f"{API}/auth/password-reset-request", json={"email": TEST_EMAIL}
    )
    assert req.status_code == 200
    token = req.json().get("dev_token")
    assert token, "dev_token should be exposed outside production"

    new_password = "bokito-new-password"
    reset = await client.post(
        f"{API}/auth/password-reset",
        json={"token": token, "password": new_password, "password_confirmation": new_password},
    )
    assert reset.status_code == 200

    login = await client.post(
        f"{API}/auth/login", json={"email": TEST_EMAIL, "password": new_password}
    )
    assert login.status_code == 200

    # Token is single-use.
    reuse = await client.post(
        f"{API}/auth/password-reset",
        json={"token": token, "password": new_password, "password_confirmation": new_password},
    )
    assert reuse.status_code == 400

    # Restore original password so other tests using TEST_PASSWORD keep working.
    again = await client.post(
        f"{API}/auth/password-reset-request", json={"email": TEST_EMAIL}
    )
    restore_token = again.json()["dev_token"]
    restored = await client.post(
        f"{API}/auth/password-reset",
        json={"token": restore_token, "password": TEST_PASSWORD, "password_confirmation": TEST_PASSWORD},
    )
    assert restored.status_code == 200


@pytest.mark.asyncio
async def test_password_reset_request_unknown_email_is_silent(client: AsyncClient):
    res = await client.post(
        f"{API}/auth/password-reset-request", json={"email": "nobody@example.com"}
    )
    assert res.status_code == 200
    assert "dev_token" not in res.json()


@pytest.mark.asyncio
async def test_email_verification_flow(client: AsyncClient):
    req = await client.post(
        f"{API}/auth/resend-verification", json={"email": TEST_EMAIL}
    )
    assert req.status_code == 200
    token = req.json().get("dev_token")
    assert token

    verified = await client.post(f"{API}/auth/verify-email", json={"token": token})
    assert verified.status_code == 200
    assert verified.json()["email_verified"] is True

    bad = await client.post(f"{API}/auth/verify-email", json={"token": "not-a-token"})
    assert bad.status_code == 400
