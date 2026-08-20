"""TOTP 2FA: RFC 6238 primitives, enrollment, the two-step login and disable."""

import pytest
from httpx import AsyncClient

from app.services.totp import generate_secret, otpauth_uri, totp_code, verify_totp
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login_headers(client: AsyncClient) -> dict:
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# --- Primitives ----------------------------------------------------------------


def test_totp_roundtrip_and_window():
    secret = generate_secret()
    now = 1_700_000_000.0
    code = totp_code(secret, at_time=now)
    assert len(code) == 6 and code.isdigit()
    assert verify_totp(secret, code, at_time=now)
    # One step of clock skew in either direction is tolerated.
    assert verify_totp(secret, code, at_time=now + 30)
    assert verify_totp(secret, code, at_time=now - 30)
    # Two steps is outside the window.
    assert not verify_totp(secret, code, at_time=now + 90)
    assert not verify_totp(secret, "000000", at_time=now) or code == "000000"
    assert not verify_totp(secret, "", at_time=now)
    assert not verify_totp("", code, at_time=now)


def test_totp_known_vector():
    # RFC 6238 test vector: secret "12345678901234567890" (base32
    # GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ), T=59 -> 94287082.  We use 6 digits.
    assert totp_code("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", at_time=59) == "287082"


def test_otpauth_uri_contains_account_and_issuer():
    uri = otpauth_uri("ABC234", account="op@test.local")
    assert uri.startswith("otpauth://totp/Bokito:op%40test.local?secret=ABC234")
    assert "issuer=Bokito" in uri


# --- Enrollment + login flow -----------------------------------------------------


@pytest.mark.asyncio
async def test_totp_full_flow(client: AsyncClient, session_override):
    headers = await _login_headers(client)

    # Enable requires setup first.
    r = await client.post("/api/auth/2fa/enable", json={"code": "123456"}, headers=headers)
    assert r.status_code == 400

    r = await client.post("/api/auth/2fa/setup", headers=headers)
    assert r.status_code == 200, r.text
    secret = r.json()["secret"]
    assert "otpauth://totp/" in r.json()["otpauth_uri"]

    # A wrong code does not enable.
    r = await client.post("/api/auth/2fa/enable", json={"code": "000000"}, headers=headers)
    assert r.status_code == 400

    r = await client.post(
        "/api/auth/2fa/enable", json={"code": totp_code(secret)}, headers=headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["totp_enabled"] is True

    # Login now returns a challenge instead of a session.
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["requires_2fa"] is True
    assert "access_token" not in payload
    challenge = payload["challenge_token"]

    # Wrong code is rejected; correct code completes the login.
    r = await client.post(
        "/api/auth/2fa/verify", json={"challenge_token": challenge, "code": "000000"}
    )
    assert r.status_code == 401
    r = await client.post(
        "/api/auth/2fa/verify",
        json={"challenge_token": challenge, "code": totp_code(secret)},
    )
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]
    assert r.json()["user"]["totp_enabled"] is True

    # A garbage challenge token never works.
    r = await client.post(
        "/api/auth/2fa/verify",
        json={"challenge_token": "not-a-token", "code": totp_code(secret)},
    )
    assert r.status_code == 401

    # Enrollment and audit trail.
    from sqlalchemy import select

    from app.models.audit import AuditEvent

    actions = {
        e.action
        for e in (await session_override.execute(select(AuditEvent))).scalars().all()
    }
    assert "user:2fa_enabled" in actions

    # Disable requires the correct password.
    fresh = {"Authorization": headers["Authorization"]}
    r = await client.post(
        "/api/auth/2fa/disable", json={"password": "wrong-password"}, headers=fresh
    )
    assert r.status_code == 400
    r = await client.post(
        "/api/auth/2fa/disable", json={"password": TEST_PASSWORD}, headers=fresh
    )
    assert r.status_code == 200, r.text

    # Login is single-step again.
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200
    assert r.json().get("access_token")
