"""Platform support: staff may enter workspaces that allow it; opt-out is honored."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant, User
from app.services.auth import decode_access_token, hash_password
from app.services.tenant_bootstrap import serialize_settings


STAFF_EMAIL = "staff-support@example.com"
STAFF_PASSWORD = "staff-test-password"


async def _create_staff(session) -> User:
    user = User(
        email=STAFF_EMAIL,
        password_hash=hash_password(STAFF_PASSWORD),
        display_name="Platform Support",
        is_staff=True,
        email_verified=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _opt_out(session, tenant: Tenant) -> None:
    tenant.settings_json = serialize_settings({"security": {"allow_platform_support": False}})
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)


@pytest.mark.asyncio
async def test_staff_login_without_membership(client: AsyncClient, session_override):
    await _create_staff(session_override)
    login = await client.post(
        "/api/auth/login",
        json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD},
    )
    assert login.status_code == 200, login.text
    body = login.json()
    assert body.get("access_token")
    payload = decode_access_token(body["access_token"])
    assert payload["staff"] is True
    assert payload["tenant_id"]


@pytest.mark.asyncio
async def test_staff_can_switch_when_support_allowed(client: AsyncClient, session_override):
    await _create_staff(session_override)
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": "owner-allow@example.com",
            "password": "test-password",
            "tenant_slug": "allow-co",
            "tenant_name": "Allow Co",
        },
    )
    assert signup.status_code == 200
    tenant_id = signup.json()["tenant"]["id"]

    login = await client.post(
        "/api/auth/login",
        json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD},
    )
    token = login.json()["access_token"]
    switched = await client.post(
        "/api/auth/switch-tenant",
        json={"tenant_id": tenant_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert switched.status_code == 200, switched.text
    assert decode_access_token(switched.json()["access_token"])["tenant_id"] == tenant_id
    assert decode_access_token(switched.json()["access_token"])["staff"] is True


@pytest.mark.asyncio
async def test_staff_blocked_when_workspace_opts_out(client: AsyncClient, session_override):
    await _create_staff(session_override)
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": "owner-deny@example.com",
            "password": "test-password",
            "tenant_slug": "deny-co",
            "tenant_name": "Deny Co",
        },
    )
    assert signup.status_code == 200
    owner_token = signup.json()["access_token"]
    tenant_id = signup.json()["tenant"]["id"]

    updated = await client.post(
        f"/api/app/workspaces/{tenant_id}",
        json={"allow_platform_support": False},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["allow_platform_support"] is False

    login = await client.post(
        "/api/auth/login",
        json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD},
    )
    staff_token = login.json()["access_token"]
    blocked = await client.post(
        "/api/auth/switch-tenant",
        json={"tenant_id": tenant_id},
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert blocked.status_code == 403

    listed = await client.get(
        "/api/app/workspaces",
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert listed.status_code == 200
    assert all(str(row.get("id")) != tenant_id for row in listed.json())

    staff_tenants = await client.get(
        "/api/auth/tenants",
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert staff_tenants.status_code == 200
    deny = next(row for row in staff_tenants.json() if row["id"] == tenant_id)
    assert deny["support_allowed"] is False

    restored = await client.post(
        f"/api/app/workspaces/{tenant_id}",
        json={"allow_platform_support": True},
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["allow_platform_support"] is True


@pytest.mark.asyncio
async def test_member_cannot_switch_without_membership(client: AsyncClient, session_override):
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": "member-iso@example.com",
            "password": "test-password",
            "tenant_slug": "member-co",
            "tenant_name": "Member Co",
        },
    )
    token = signup.json()["access_token"]
    other = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    forbidden = await client.post(
        "/api/auth/switch-workspace",
        json={"tenant_id": str(other.id)},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert forbidden.status_code == 403


@pytest.mark.asyncio
async def test_staff_login_skips_opted_out_last_tenant(client: AsyncClient, session_override):
    staff = await _create_staff(session_override)
    deny = Tenant(slug="closed-co", name="Closed Co")
    session_override.add(deny)
    await session_override.commit()
    await session_override.refresh(deny)
    await _opt_out(session_override, deny)
    staff.last_tenant_id = deny.id
    session_override.add(staff)
    await session_override.commit()

    login = await client.post(
        "/api/auth/login",
        json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD},
    )
    assert login.status_code == 200, login.text
    landed = decode_access_token(login.json()["access_token"])["tenant_id"]
    assert landed != str(deny.id)
