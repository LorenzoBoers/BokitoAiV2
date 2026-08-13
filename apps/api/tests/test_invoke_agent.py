"""Cycle 11: inline agent invocation on signal threads (@agent mentions)."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _create_thread(client: AsyncClient, headers: dict) -> str:
    r = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "test",
            "subject": "Shipping question",
            "body_text": "Where is my order #123?",
            "contact_email": "customer@example.com",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _assistant_agent_id(client: AsyncClient, headers: dict) -> str:
    r = await client.get("/api/workforce/agents", headers=headers)
    assert r.status_code == 200, r.text
    items = r.json().get("items", [])
    assert items, "expected seeded agents"
    return items[0]["id"]


@pytest.mark.asyncio
async def test_invoke_agent_as_note(client: AsyncClient):
    headers = await _login(client)
    signal_id = await _create_thread(client, headers)
    agent_id = await _assistant_agent_id(client, headers)

    r = await client.post(
        f"/api/signals/{signal_id}/invoke-agent",
        headers=headers,
        json={"agent_id": agent_id, "instruction": "Summarize this thread", "output": "note"},
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["output"] == "note"
    assert payload["message"]["direction"] == "internal"
    assert payload["message"]["body_text"]

    # The note is part of the thread notes/timeline.
    r = await client.get(f"/api/signals/{signal_id}/notes", headers=headers)
    assert r.status_code == 200
    assert any(n.get("body_text") == payload["message"]["body_text"] for n in r.json())

    # An audit event records the invocation.
    r = await client.get(f"/api/signals/{signal_id}", headers=headers)
    events = r.json().get("events", [])
    assert any(e.get("event_type") == "agent_invoked" for e in events)


@pytest.mark.asyncio
async def test_invoke_agent_reply_suggestion(client: AsyncClient):
    headers = await _login(client)
    signal_id = await _create_thread(client, headers)
    agent_id = await _assistant_agent_id(client, headers)

    r = await client.post(
        f"/api/signals/{signal_id}/invoke-agent",
        headers=headers,
        json={
            "agent_id": agent_id,
            "instruction": "Draft a reply about order #123",
            "output": "reply_suggestion",
        },
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["output"] == "reply_suggestion"
    assert payload.get("decision_id") or payload.get("skipped")


@pytest.mark.asyncio
async def test_invoke_unknown_agent_404(client: AsyncClient):
    headers = await _login(client)
    signal_id = await _create_thread(client, headers)
    r = await client.post(
        f"/api/signals/{signal_id}/invoke-agent",
        headers=headers,
        json={"agent_id": "00000000-0000-0000-0000-000000000000", "output": "note"},
    )
    assert r.status_code == 404
