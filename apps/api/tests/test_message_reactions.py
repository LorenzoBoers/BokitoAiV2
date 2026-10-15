"""Stacked message reactions (LinkedIn-style) and learning bridge."""

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
            "subject": "Reaction test",
            "body_text": "Original question",
            "contact_email": "react@test.com",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]
    thread = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert thread.status_code == 200
    message_id = thread.json()["messages"][0]["id"]
    return signal_id, message_id


@pytest.mark.asyncio
async def test_reaction_put_toggle_and_thread_exposure(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    signal_id, message_id = await _seed_thread_with_message(client, headers)

    up = await client.put(
        f"/api/messages/{message_id}/reactions",
        headers=headers,
        json={"kind": "up"},
    )
    assert up.status_code == 200
    body = up.json()
    assert body["mine"] == "up"
    assert any(k["kind"] == "up" and k["count"] >= 1 for k in body["kinds"])

    # Same kind again clears (LinkedIn toggle).
    cleared = await client.put(
        f"/api/messages/{message_id}/reactions",
        headers=headers,
        json={"kind": "up"},
    )
    assert cleared.status_code == 200
    assert cleared.json()["mine"] is None
    assert cleared.json()["kinds"] == []

    hundred = await client.put(
        f"/api/messages/{message_id}/reactions",
        headers=headers,
        json={"kind": "hundred"},
    )
    assert hundred.status_code == 200
    assert hundred.json()["mine"] == "hundred"

    thread = await client.get(f"/api/signals/{signal_id}", headers=headers)
    message = next(m for m in thread.json()["messages"] if m["id"] == message_id)
    assert message["reactions"]["mine"] == "hundred"
    assert message["my_feedback"] == {"score": 5, "sentiment": "up"}


@pytest.mark.asyncio
async def test_reaction_delete_and_validation(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    _signal_id, message_id = await _seed_thread_with_message(client, headers)

    await client.put(
        f"/api/messages/{message_id}/reactions",
        headers=headers,
        json={"kind": "thinking"},
    )
    deleted = await client.delete(
        f"/api/messages/{message_id}/reactions", headers=headers
    )
    assert deleted.status_code == 200
    assert deleted.json()["mine"] is None

    bad = await client.put(
        f"/api/messages/{message_id}/reactions",
        headers=headers,
        json={"kind": "sparkles"},
    )
    assert bad.status_code == 400

    agent_only = await client.put(
        f"/api/messages/{message_id}/reactions",
        headers=headers,
        json={"kind": "investigating"},
    )
    assert agent_only.status_code == 403


@pytest.mark.asyncio
async def test_legacy_feedback_maps_to_reactions(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    signal_id, message_id = await _seed_thread_with_message(client, headers)

    up = await client.post(
        f"/api/messages/{message_id}/feedback", headers=headers, json={"sentiment": "up"}
    )
    assert up.status_code == 200
    assert up.json()["score"] == 5
    assert up.json()["reactions"]["mine"] == "up"

    thread = await client.get(f"/api/signals/{signal_id}", headers=headers)
    message = next(m for m in thread.json()["messages"] if m["id"] == message_id)
    assert message["reactions"]["mine"] == "up"
    assert message["my_feedback"] == {"score": 5, "sentiment": "up"}
