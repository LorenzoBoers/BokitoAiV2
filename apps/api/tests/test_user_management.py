"""Cycle 9: user management end-to-end — invites, roles, reset, verification, deletion."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient, email: str, password: str) -> str:
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _owner_headers(client: AsyncClient) -> dict:
    token = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    return {"Authorization": f"Bearer {token}"}


async def _workspace_id(client: AsyncClient, headers: dict) -> str:
    r = await client.get("/api/app/workspaces", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()[0]["id"]


@pytest.mark.asyncio
async def test_invite_accept_role_change_and_remove(client: AsyncClient):
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)

    # Invite carries a link + invited_by, mail is dev-logged (mail_sent False).
    r = await client.post(
        "/api/app/workspace-invites",
        headers=headers,
        json={"workspace_id": ws, "email": "newbie@example.com", "role": "member"},
    )
    assert r.status_code == 200, r.text
    invite = r.json()
    assert "/accept-invite?token=" in invite["invite_link"]
    assert invite["mail_sent"] is False
    token = invite["invite_link"].split("token=")[1]

    # Pending invites include the copyable link and inviter name.
    r = await client.get(f"/api/app/workspaces/{ws}/invites", headers=headers)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["invite_link"] == invite["invite_link"]
    assert rows[0]["invited_by_name"] == "Test"

    # Public invite preview.
    r = await client.get("/api/auth/invite-info", params={"token": token})
    assert r.status_code == 200
    info = r.json()
    assert info["email"] == "newbie@example.com"
    assert info["existing_user"] is False

    # Accept: creates the account and returns a session.
    r = await client.post(
        "/api/auth/accept-invite",
        json={"token": token, "password": "newbiepass123", "display_name": "Newbie"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "member"

    # Accepted invites disappear from the pending list.
    r = await client.get(f"/api/app/workspaces/{ws}/invites", headers=headers)
    assert r.json() == []

    # Members list exposes uuid + avatar passthrough.
    r = await client.get(f"/api/app/workspaces/{ws}/members", headers=headers)
    members = r.json()
    assert len(members) == 2
    newbie = next(m for m in members if m["email"] == "newbie@example.com")
    assert newbie["role"] == "member"
    assert newbie["uuid"]

    # Role change member -> admin.
    r = await client.patch(
        f"/api/app/workspaces/{ws}/members/{newbie['uuid']}",
        headers=headers,
        json={"role": "admin"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "admin"

    # Promote to owner: transfers ownership (single-owner model).
    r = await client.patch(
        f"/api/app/workspaces/{ws}/members/{newbie['uuid']}",
        headers=headers,
        json={"role": "owner"},
    )
    assert r.status_code == 200, r.text
    r = await client.get(f"/api/app/workspaces/{ws}/members", headers=headers)
    roles = {m["email"]: m["role"] for m in r.json()}
    assert roles["newbie@example.com"] == "owner"
    assert roles[TEST_EMAIL] == "admin"

    # Transfer back so the original owner can manage again.
    newbie_token = await _login(client, "newbie@example.com", "newbiepass123")
    newbie_headers = {"Authorization": f"Bearer {newbie_token}"}
    original = next(m for m in r.json() if m["email"] == TEST_EMAIL)
    r = await client.patch(
        f"/api/app/workspaces/{ws}/members/{original['uuid']}",
        headers=newbie_headers,
        json={"role": "owner"},
    )
    assert r.status_code == 200, r.text

    # Remove the member.
    r = await client.delete(
        f"/api/app/workspaces/{ws}/members/{newbie['uuid']}", headers=headers
    )
    assert r.status_code == 200, r.text
    r = await client.get(f"/api/app/workspaces/{ws}/members", headers=headers)
    assert [m["email"] for m in r.json()] == [TEST_EMAIL]


@pytest.mark.asyncio
async def test_role_guards(client: AsyncClient):
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)
    r = await client.get(f"/api/app/workspaces/{ws}/members", headers=headers)
    me = r.json()[0]

    # Sole owner cannot demote themselves.
    r = await client.patch(
        f"/api/app/workspaces/{ws}/members/{me['uuid']}",
        headers=headers,
        json={"role": "member"},
    )
    assert r.status_code == 400

    # Nor remove themselves.
    r = await client.delete(
        f"/api/app/workspaces/{ws}/members/{me['uuid']}", headers=headers
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_invite_revoke(client: AsyncClient):
    headers = await _owner_headers(client)
    ws = await _workspace_id(client, headers)
    r = await client.post(
        "/api/app/workspace-invites",
        headers=headers,
        json={"workspace_id": ws, "email": "revoked@example.com", "role": "member"},
    )
    invite_id = r.json()["id"]
    r = await client.delete(f"/api/app/workspaces/{ws}/invites/{invite_id}", headers=headers)
    assert r.status_code == 200
    r = await client.get(f"/api/app/workspaces/{ws}/invites", headers=headers)
    assert r.json() == []


@pytest.mark.asyncio
async def test_accept_invite_existing_user_requires_password(client: AsyncClient):
    headers = await _owner_headers(client)

    # Second workspace owner invites the existing test user.
    r = await client.post(
        "/api/auth/signup",
        json={
            "email": "other-owner@example.com",
            "password": "otherpass123",
            "tenant_slug": "other-co",
            "tenant_name": "Other Co",
        },
    )
    assert r.status_code == 200, r.text
    other_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = await client.post(
        "/api/auth/invite",
        headers=other_headers,
        json={"email": TEST_EMAIL, "role": "member"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]

    r = await client.get("/api/auth/invite-info", params={"token": token})
    assert r.json()["existing_user"] is True

    # Invite token alone must not grant a session for an existing account.
    r = await client.post(
        "/api/auth/accept-invite", json={"token": token, "password": "wrong-password"}
    )
    assert r.status_code == 400

    r = await client.post(
        "/api/auth/accept-invite", json={"token": token, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text

    # The invited user now sees both workspaces.
    del headers
    token2 = await _login(client, TEST_EMAIL, TEST_PASSWORD)
    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token2}"})
    slugs = {m["tenant_slug"] for m in r.json()["memberships"]}
    assert "other-co" in slugs


@pytest.mark.asyncio
async def test_password_reset_flow(client: AsyncClient):
    r = await client.post("/api/auth/password-reset-request", json={"email": TEST_EMAIL})
    assert r.status_code == 200
    token = r.json().get("dev_token")
    assert token, "dev flow should expose the reset token"

    r = await client.post(
        "/api/auth/password-reset", json={"token": token, "password": "brand-new-pass1"}
    )
    assert r.status_code == 200, r.text
    await _login(client, TEST_EMAIL, "brand-new-pass1")

    # Token is single-use.
    r = await client.post(
        "/api/auth/password-reset", json={"token": token, "password": "another-pass12"}
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_email_change_requires_verification(client: AsyncClient):
    headers = await _owner_headers(client)
    r = await client.patch(
        "/api/auth/profile", headers=headers, json={"email": "renamed@example.com"}
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["email"] == "renamed@example.com"
    assert payload["email_verified"] is False
    assert payload.get("verification_required") is True
    token = payload.get("dev_token")
    assert token

    r = await client.post("/api/auth/verify-email", json={"token": token})
    assert r.status_code == 200
    assert r.json()["email_verified"] is True


@pytest.mark.asyncio
async def test_delete_account(client: AsyncClient):
    r = await client.post(
        "/api/auth/signup",
        json={
            "email": "goner@example.com",
            "password": "gonerpass123",
            "tenant_slug": "goner-co",
            "tenant_name": "Goner Co",
        },
    )
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # Wrong password is rejected.
    r = await client.post(
        "/api/auth/delete-account", headers=headers, json={"password": "nope"}
    )
    assert r.status_code == 400

    r = await client.post(
        "/api/auth/delete-account", headers=headers, json={"password": "gonerpass123"}
    )
    assert r.status_code == 200, r.text

    # Credentials are gone.
    r = await client.post(
        "/api/auth/login", json={"email": "goner@example.com", "password": "gonerpass123"}
    )
    assert r.status_code in (400, 401)
