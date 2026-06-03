import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_signup_and_tenant_isolation(client: AsyncClient):
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": "isolated@example.com",
            "password": "test-password",
            "tenant_slug": "isolated-co",
            "tenant_name": "Isolated Co",
        },
    )
    assert signup.status_code == 200
    token_a = signup.json()["access_token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    signup_b = await client.post(
        "/api/auth/signup",
        json={
            "email": "other@example.com",
            "password": "test-password",
            "tenant_slug": "other-co",
            "tenant_name": "Other Co",
        },
    )
    assert signup_b.status_code == 200
    token_b = signup_b.json()["access_token"]
    headers_b = {"Authorization": f"Bearer {token_b}"}

    inbox_a = await client.get("/api/inbox", headers=headers_a)
    assert inbox_a.status_code == 200

    # Tenant B cannot see tenant A conversations via wrong token (different tenant_id in JWT)
    conv_a = await client.post("/api/chat/conversations", json={"title": "Secret"}, headers=headers_a)
    conv_id = conv_a.json()["id"]
    detail_b = await client.get(f"/api/chat/conversations/{conv_id}/messages", headers=headers_b)
    assert detail_b.status_code in (404, 401, 403)


@pytest.mark.asyncio
async def test_inbox_endpoint(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    resp = await client.get("/api/inbox", headers=headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_cockpit_summary(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    resp = await client.get("/api/cockpit/summary", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "volume_week" in data
