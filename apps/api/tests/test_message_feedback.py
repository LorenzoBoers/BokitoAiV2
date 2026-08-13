"""Tests for message feedback (thumbs) and its exposure on thread detail."""

import pytest
from httpx import AsyncClient


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _seed_thread_with_message(client: AsyncClient, headers: dict[str, str]) -> tuple[str, str]:
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "mock",
            "subject": "Feedback test",
            "body_text": "Original question",
            "contact_email": "fb@test.com",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]
    thread = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert thread.status_code == 200
    message_id = thread.json()["messages"][0]["id"]
    return signal_id, message_id


@pytest.mark.asyncio
async def test_feedback_upsert_and_thread_exposure(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    signal_id, message_id = await _seed_thread_with_message(client, headers)

    up = await client.post(
        f"/api/messages/{message_id}/feedback", headers=headers, json={"sentiment": "up"}
    )
    assert up.status_code == 200
    assert up.json()["score"] == 5

    # Re-voting updates the same entry instead of creating a duplicate.
    down = await client.post(
        f"/api/messages/{message_id}/feedback", headers=headers, json={"sentiment": "down"}
    )
    assert down.status_code == 200
    assert down.json()["id"] == up.json()["id"]
    assert down.json()["score"] == 1

    thread = await client.get(f"/api/signals/{signal_id}", headers=headers)
    message = next(m for m in thread.json()["messages"] if m["id"] == message_id)
    assert message["my_feedback"] == {"score": 1, "sentiment": "down"}


@pytest.mark.asyncio
async def test_feedback_validation(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    _signal_id, message_id = await _seed_thread_with_message(client, headers)

    missing = await client.post(
        f"/api/messages/{message_id}/feedback", headers=headers, json={}
    )
    assert missing.status_code == 400

    bad_sentiment = await client.post(
        f"/api/messages/{message_id}/feedback", headers=headers, json={"sentiment": "meh"}
    )
    assert bad_sentiment.status_code == 400

    bad_score = await client.post(
        f"/api/messages/{message_id}/feedback", headers=headers, json={"score": 9}
    )
    assert bad_score.status_code == 400
