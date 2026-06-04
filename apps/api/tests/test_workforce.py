"""Tests for workforce agents, work logs, and messages."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

API = "/api/workforce"


async def _login(client: AsyncClient) -> str:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return res.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_list_agents_and_timeline(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    agents = await client.get(f"{API}/agents", headers=headers)
    assert agents.status_code == 200
    items = agents.json()["items"]
    assert len(items) >= 1
    assert "role_slug" in items[0]
    assert "organisation_id" in items[0]

    timeline = await client.get(f"{API}/timeline", headers=headers)
    assert timeline.status_code == 200
    assert "items" in timeline.json()


@pytest.mark.asyncio
async def test_work_logs_and_events(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)

    created = await client.post(
        "/api/workforce/projects",
        headers=headers,
        json={
            "name": "Workforce Test",
            "slug": "workforce-test",
            "autonomous_scope": "Test project for workforce work log endpoints in pytest.",
        },
    )
    assert created.status_code == 200
    project_id = created.json()["id"]

    logs = await client.get(f"{API}/work_logs", headers=headers, params={"project_id": project_id})
    assert logs.status_code == 200
    items = logs.json()["items"]
    assert isinstance(items, list)

    agents = await client.get(f"{API}/agents", headers=headers)
    agent_id = agents.json()["items"][0]["id"]
    trigger = await client.post(
        f"{API}/workforce/trigger-agent",
        headers=headers,
        json={"agent_id": agent_id, "instruction": "Create work log for pytest"},
    )
    assert trigger.status_code == 200
    run_id = trigger.json()["run_id"]

    events = await client.get(f"{API}/work_logs/{run_id}/events", headers=headers)
    assert events.status_code == 200
    body = events.json()
    assert "events" in body
    assert len(body["events"]) >= 1


@pytest.mark.asyncio
async def test_messages_and_trigger_agent(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)

    pending = await client.get(f"{API}/messages", headers=headers, params={"status": "awaiting_human"})
    assert pending.status_code == 200
    items = pending.json()["items"]
    assert isinstance(items, list)

    agents = await client.get(f"{API}/agents", headers=headers)
    agent_id = agents.json()["items"][0]["id"]
    trigger = await client.post(
        f"{API}/workforce/trigger-agent",
        headers=headers,
        json={"agent_id": agent_id, "instruction": "Test trigger from pytest"},
    )
    assert trigger.status_code == 200
    assert trigger.json().get("ok") is True

    status_patch = await client.patch(
        f"{API}/agents/{agent_id}/status",
        headers=headers,
        json={"status": "standby"},
    )
    assert status_patch.status_code == 200
    assert status_patch.json()["ok"] is True
