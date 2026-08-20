"""No-workspace login state: removed members keep their account (ClickUp-style)
and re-enter via a pending invite or by creating a fresh workspace."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Membership, Tenant, User
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

MEMBER_EMAIL = "orphan@example.com"
MEMBER_PASSWORD = "orphanpass123"


async def _owner_headers(client: AsyncClient) -> dict:
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _workspace_id(client: AsyncClient, headers: dict) -> str:
    r = await client.get("/api/app/workspaces", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()[0]["id"]


async def _invite(client: AsyncClient, headers: dict, ws: str, email: str) -> dict:
    r = await client.post(
        "/api/app/workspace-invites",
        headers=headers,
        json={"workspace_id": ws, "email": email, "role": "member"},
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _member_id_by_email(client: AsyncClient, headers: dict, ws: str, email: str) -> str:
    r = await client.get(f"/api/app/workspaces/{ws}/members", headers=headers)
    assert r.status_code == 200, r.text
    for row in r.json():
        if row.get("email") == email:
            return str(row["id"])
    raise AssertionError(f"member {email} not found: {r.json()}")


async def _seed_orphaned_member(client: AsyncClient, headers: dict, ws: str) -> None:
    """Invite + accept + remove, leaving an account with zero memberships."""
    invite = await _invite(client, headers, ws, MEMBER_EMAIL)
    token = invite["invite_link"].split("token=")[1]
    r = await client.post(
        "/api/auth/accept-invite",
        json={"token": token, "password": MEMBER_PASSWORD, "display_name": "Orphan"},
    )
    assert r.status_code == 200, r.text
    member_id = await _member_id_by_email(client, headers, ws, MEMBER_EMAIL)
    r = await client.delete(f"/api/app/workspaces/{ws}/members/{member_id}", headers=headers)
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_removed_member_login_returns_workspace_setup(
    client: AsyncClient, session_override
):
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)
    await _seed_orphaned_member(client, headers, ws)

    # The account persists; login succeeds with a setup state instead of 403.
    r = await client.post(
        "/api/auth/login", json={"email": MEMBER_EMAIL, "password": MEMBER_PASSWORD}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["requires_workspace"] is True
    assert body["setup_token"]
    assert body["email"] == MEMBER_EMAIL
    assert body["pending_invites"] == []

    user = (
        await session_override.execute(select(User).where(User.email == MEMBER_EMAIL))
    ).scalar_one()
    memberships = (
        await session_override.execute(
            select(Membership).where(Membership.user_id == user.id)
        )
    ).scalars().all()
    assert memberships == []


@pytest.mark.asyncio
async def test_setup_accept_pending_invite_rejoins_workspace(
    client: AsyncClient, session_override
):
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)
    await _seed_orphaned_member(client, headers, ws)

    # A fresh invite is now pending for the removed member.
    await _invite(client, headers, ws, MEMBER_EMAIL)

    r = await client.post(
        "/api/auth/login", json={"email": MEMBER_EMAIL, "password": MEMBER_PASSWORD}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["requires_workspace"] is True
    invites = body["pending_invites"]
    assert len(invites) == 1
    assert invites[0]["role"] == "member"
    assert invites[0]["tenant_name"]

    r = await client.post(
        "/api/auth/workspace-setup/accept-invite",
        json={"setup_token": body["setup_token"], "invite_id": invites[0]["id"]},
    )
    assert r.status_code == 200, r.text
    session_body = r.json()
    assert session_body["access_token"]
    assert session_body["user"]["email"] == MEMBER_EMAIL

    # Full login now works again.
    r = await client.post(
        "/api/auth/login", json={"email": MEMBER_EMAIL, "password": MEMBER_PASSWORD}
    )
    assert r.status_code == 200, r.text
    assert "access_token" in r.json()


@pytest.mark.asyncio
async def test_setup_create_workspace_makes_owner(client: AsyncClient, session_override):
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)
    await _seed_orphaned_member(client, headers, ws)

    r = await client.post(
        "/api/auth/login", json={"email": MEMBER_EMAIL, "password": MEMBER_PASSWORD}
    )
    setup_token = r.json()["setup_token"]

    r = await client.post(
        "/api/auth/workspace-setup/create",
        json={"setup_token": setup_token, "workspace_name": "Orphan Studio"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"]
    assert body["tenant"]["name"] == "Orphan Studio"

    user = (
        await session_override.execute(select(User).where(User.email == MEMBER_EMAIL))
    ).scalar_one()
    membership = (
        await session_override.execute(
            select(Membership).where(Membership.user_id == user.id)
        )
    ).scalar_one()
    assert membership.role == "owner"
    tenant = (
        await session_override.execute(
            select(Tenant).where(Tenant.id == membership.tenant_id)
        )
    ).scalar_one()
    assert tenant.name == "Orphan Studio"


@pytest.mark.asyncio
async def test_setup_endpoints_reject_invalid_token(client: AsyncClient, session_override):
    r = await client.post(
        "/api/auth/workspace-setup/create",
        json={"setup_token": "garbage", "workspace_name": "Nope"},
    )
    assert r.status_code == 401

    r = await client.post(
        "/api/auth/workspace-setup/accept-invite",
        json={"setup_token": "garbage", "invite_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_setup_accept_rejects_foreign_invite(client: AsyncClient, session_override):
    """A setup token cannot accept an invite addressed to another email."""
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)
    await _seed_orphaned_member(client, headers, ws)

    other = await _invite(client, headers, ws, "someone-else@example.com")

    r = await client.post(
        "/api/auth/login", json={"email": MEMBER_EMAIL, "password": MEMBER_PASSWORD}
    )
    setup_token = r.json()["setup_token"]

    r = await client.post(
        "/api/auth/workspace-setup/accept-invite",
        json={"setup_token": setup_token, "invite_id": other["id"]},
    )
    assert r.status_code == 404
