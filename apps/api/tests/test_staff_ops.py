"""Staff ops directory: tenants, users, support access logs."""

import pytest
from httpx import AsyncClient

from app.models.auth import User
from app.services.auth import hash_password


STAFF_EMAIL = "staff-ops@example.com"
STAFF_PASSWORD = "staff-ops-password"


async def _create_staff(session) -> User:
    user = User(
        email=STAFF_EMAIL,
        password_hash=hash_password(STAFF_PASSWORD),
        display_name="Ops Staff",
        is_staff=True,
        email_verified=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _staff_token(client: AsyncClient) -> str:
    login = await client.post(
        "/api/auth/login",
        json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD},
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


@pytest.mark.asyncio
async def test_staff_ops_directory(client: AsyncClient, session_override):
    await _create_staff(session_override)
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": "ops-owner@example.com",
            "password": "test-password",
            "tenant_slug": "ops-co",
            "tenant_name": "Ops Co",
        },
    )
    assert signup.status_code == 200
    tenant_id = signup.json()["tenant"]["id"]

    token = await _staff_token(client)
    switched = await client.post(
        "/api/auth/switch-tenant",
        json={"tenant_id": tenant_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert switched.status_code == 200, switched.text
    token = switched.json()["access_token"]

    res = await client.get(
        "/api/staff/ops",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["environment"]
    assert body["api_url"]
    assert body["tenant_count"] >= 1
    assert body["user_count"] >= 2
    assert any(row["slug"] == "ops-co" and row["support_allowed"] is True for row in body["tenants"])
    assert any(row["email"] == "ops-owner@example.com" for row in body["users"])
    assert any(row["email"] == STAFF_EMAIL and row["is_staff"] is True for row in body["users"])
    assert any(row["tenant_id"] == tenant_id and row["action"] == "enter" for row in body["access_logs"])

    filtered = await client.get(
        "/api/staff/ops",
        params={"q": "ops-co"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert filtered.status_code == 200
    assert all("ops" in row["slug"] or "ops" in row["name"].lower() for row in filtered.json()["tenants"])


@pytest.mark.asyncio
async def test_member_cannot_access_staff_ops(client: AsyncClient, session_override):
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": "ops-member@example.com",
            "password": "test-password",
            "tenant_slug": "member-ops",
            "tenant_name": "Member Ops",
        },
    )
    token = signup.json()["access_token"]
    forbidden = await client.get(
        "/api/staff/ops",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert forbidden.status_code == 403
