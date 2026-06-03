import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health(client: AsyncClient):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True


@pytest.mark.asyncio
async def test_login(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    response = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["tenant"]["slug"] == "test"
