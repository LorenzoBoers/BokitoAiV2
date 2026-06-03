import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_mock_inbound_email_queues(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Ensure email account exists
    accounts = await client.get("/api/email/accounts", headers=headers)
    assert accounts.status_code == 200

    if not accounts.json():
        pytest.skip("No seeded email account in test DB")

    response = await client.post(
        "/api/email/mock/inbound",
        json={
            "from_address": "customer@example.com",
            "subject": "Help with billing",
            "body_text": "Can you explain my invoice?",
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "queued_for_ai"
