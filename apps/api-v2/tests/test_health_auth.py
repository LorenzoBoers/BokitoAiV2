from httpx import AsyncClient

from tests.conftest import auth, signup


async def test_health(client: AsyncClient) -> None:
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["region"] == "eu"
    r = await client.get("/api/health/ready")
    assert r.status_code == 200


async def test_signup_login_me(client: AsyncClient) -> None:
    token = await signup(client)
    assert token["tenant_id"]
    r = await client.get("/api/me", headers=auth(token))
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "owner@example.com"
    assert body["role"] == "owner"
    assert body["workspace"]["slug"] == "acme"
    assert body["workspace"]["posture"] == "assisted"

    r = await client.post(
        "/api/auth/login", json={"email": "owner@example.com", "password": "wrong password"}
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"

    r = await client.post(
        "/api/auth/login",
        json={"email": "owner@example.com", "password": "correct horse battery"},
    )
    assert r.status_code == 200
    assert r.cookies.get("bokito2_refresh")

    r = await client.post("/api/auth/refresh")
    assert r.status_code == 200
    assert r.json()["access_token"]

    r = await client.post("/api/auth/logout")
    assert r.status_code == 204


async def test_duplicate_email_conflict(client: AsyncClient) -> None:
    await signup(client)
    r = await client.post(
        "/api/auth/signup",
        json={
            "email": "owner@example.com",
            "password": "correct horse battery",
            "workspace_name": "Other",
        },
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "email_taken"


async def test_workspace_switch_requires_membership(client: AsyncClient) -> None:
    a = await signup(client, "a@example.com", "A Co")
    b = await signup(client, "b@example.com", "B Co")
    r = await client.post(f"/api/auth/workspaces/{b['tenant_id']}/switch", headers=auth(a))
    assert r.status_code == 403
    r = await client.get("/api/auth/workspaces", headers=auth(a))
    assert [w["slug"] for w in r.json()] == ["a-co"]
