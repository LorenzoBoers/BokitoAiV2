"""Staff ops directory: tenants, users, support access logs."""

import pytest
from httpx import AsyncClient
from jose import jwt

from app.config import get_settings
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
    owner = next(row for row in body["users"] if row["email"] == "ops-owner@example.com")
    assert owner["membership_count"] >= 1
    assert any(m["slug"] == "ops-co" and m["support_allowed"] is True for m in owner["memberships"])
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


@pytest.mark.asyncio
async def test_staff_impersonate_and_stop(client: AsyncClient, session_override):
    staff = await _create_staff(session_override)
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": "impersonate-target@example.com",
            "password": "test-password",
            "tenant_slug": "impersonate-co",
            "tenant_name": "Impersonate Co",
        },
    )
    assert signup.status_code == 200
    target_user_id = signup.json()["user"]["id"]
    tenant_id = signup.json()["tenant"]["id"]

    staff_token = await _staff_token(client)
    imp = await client.post(
        f"/api/staff/ops/users/{target_user_id}/impersonate",
        json={"tenant_id": tenant_id},
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert imp.status_code == 200, imp.text
    body = imp.json()
    access = body["access_token"]
    settings = get_settings()
    payload = jwt.decode(access, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    assert payload["sub"] == target_user_id
    assert payload["tenant_id"] == tenant_id
    assert payload.get("staff") is False
    assert payload["impersonator_id"] == str(staff.id)
    assert body["user"]["impersonating"] is True
    assert body["user"]["impersonator"]["email"] == STAFF_EMAIL

    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200, me.text
    me_body = me.json()
    assert me_body["impersonating"] is True
    assert me_body["is_staff"] is False
    assert me_body["email"] == "impersonate-target@example.com"
    assert me_body["impersonator"]["email"] == STAFF_EMAIL

    stop = await client.post(
        "/api/auth/stop-impersonation",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert stop.status_code == 200, stop.text
    restored = stop.json()["access_token"]
    restored_payload = jwt.decode(
        restored, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
    )
    assert restored_payload["sub"] == str(staff.id)
    assert restored_payload.get("staff") is True
    assert "impersonator_id" not in restored_payload

    ops = await client.get(
        "/api/staff/ops",
        headers={"Authorization": f"Bearer {restored}"},
    )
    assert ops.status_code == 200
    actions = {row["action"] for row in ops.json()["access_logs"]}
    assert "impersonate" in actions
    assert "impersonate_end" in actions


@pytest.mark.asyncio
async def test_staff_cannot_impersonate_staff(client: AsyncClient, session_override):
    staff = await _create_staff(session_override)
    other = User(
        email="other-staff@example.com",
        password_hash=hash_password("other-staff-password"),
        display_name="Other Staff",
        is_staff=True,
        email_verified=True,
    )
    session_override.add(other)
    await session_override.commit()
    await session_override.refresh(other)

    token = await _staff_token(client)
    forbidden = await client.post(
        f"/api/staff/ops/users/{other.id}/impersonate",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert forbidden.status_code == 403
    assert staff.id  # keep fixture used
