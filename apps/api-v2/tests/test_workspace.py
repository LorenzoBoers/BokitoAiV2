"""Workspace settings, members and invites."""

from __future__ import annotations

from httpx import AsyncClient

from tests.conftest import auth


async def test_workspace_patch_and_members(client: AsyncClient, owner: dict) -> None:
    r = await client.patch(
        "/api/workspace", json={"name": "Acme BV", "language": "nl"}, headers=auth(owner)
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Acme BV" and r.json()["language"] == "nl"

    r = await client.get("/api/workspace/members", headers=auth(owner))
    assert len(r.json()) == 1 and r.json()[0]["role"] == "owner"

    r = await client.post(
        "/api/workspace/invites",
        json={"email": "colleague@example.com", "role": "member"},
        headers=auth(owner),
    )
    assert r.status_code == 201, r.text
    accept_url = r.json()["accept_url"]
    token = accept_url.split("invite=", 1)[1]
    r = await client.get("/api/workspace/invites", headers=auth(owner))
    assert len(r.json()) == 1 and r.json()[0]["accept_url"] is None

    r = await client.post(
        "/api/auth/signup",
        json={
            "email": "colleague@example.com",
            "password": "correct horse battery",
            "name": "Col",
            "invite": token,
        },
    )
    assert r.status_code == 201, r.text
    colleague = r.json()
    assert colleague["tenant_id"] == owner["tenant_id"]

    r = await client.get("/api/workspace/members", headers=auth(owner))
    roles = {m["email"]: m["role"] for m in r.json()}
    assert roles["colleague@example.com"] == "member"
    r = await client.get("/api/workspace/invites", headers=auth(owner))
    assert r.json() == []

    # Members cannot change roles; owners can.
    r = await client.patch(
        f"/api/workspace/members/{owner['user_id']}",
        json={"role": "member"},
        headers=auth(colleague),
    )
    assert r.status_code == 403
    r = await client.patch(
        f"/api/workspace/members/{colleague['user_id']}",
        json={"role": "admin"},
        headers=auth(owner),
    )
    assert r.json()["role"] == "admin"
    r = await client.patch(
        f"/api/workspace/members/{owner['user_id']}", json={"role": "member"}, headers=auth(owner)
    )
    assert r.status_code == 409  # last owner

    r = await client.delete(f"/api/workspace/members/{colleague['user_id']}", headers=auth(owner))
    assert r.status_code == 204
    r = await client.get("/api/workspace/members", headers=auth(owner))
    assert len(r.json()) == 1

    r = await client.post(
        "/api/auth/signup",
        json={"email": "x@example.com", "password": "correct horse battery", "invite": token},
    )
    assert r.status_code == 401
