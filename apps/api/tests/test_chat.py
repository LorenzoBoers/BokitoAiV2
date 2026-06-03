import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_chat_flow(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    conv = await client.post("/api/chat/conversations", json={"title": "Test chat"}, headers=headers)
    assert conv.status_code == 200
    conv_id = conv.json()["id"]

    msg = await client.post(
        f"/api/chat/conversations/{conv_id}/messages",
        json={"content": "What is Bokito?"},
        headers=headers,
    )
    assert msg.status_code == 200
    assert msg.json()["message"]["role"] == "assistant"
    assert "mock" in msg.json()["message"]["content"].lower() or "bokito" in msg.json()["message"]["content"].lower()
