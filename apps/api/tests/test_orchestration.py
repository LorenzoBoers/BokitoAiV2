"""Tests for orchestration API and segment runner."""

import json
import os

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

os.environ["BOKITO_MOCK_EXECUTION"] = "true"

API = "/api/orchestration"


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_runtime_profiles_and_task(client: AsyncClient):
    headers = await _login(client)

    prof = await client.post(
        f"{API}/runtime-profiles",
        headers=headers,
        json={"name": "Test Fast", "slug": "test-fast", "role_tag": "planner", "model": "claude-haiku-4-20250514"},
    )
    assert prof.status_code == 200
    profile_id = prof.json()["id"]

    listed = await client.get(f"{API}/runtime-profiles", headers=headers)
    assert listed.status_code == 200
    assert any(p["id"] == profile_id for p in listed.json())

    agents = await client.get("/api/workforce/agents", headers=headers)
    assert agents.status_code == 200
    agent_list = agents.json()["items"]
    assert len(agent_list) >= 1
    agent_id = agent_list[0]["id"]

    task_resp = await client.post(
        f"{API}/tasks",
        headers=headers,
        json={
            "title": "Test orchestration task",
            "description": "Summarize open operational items.",
            "agent_id": agent_id,
            "default_runtime_profile_id": profile_id,
            "success_criteria_json": json.dumps({"min_length": 5}),
        },
    )
    assert task_resp.status_code == 200
    task = task_resp.json()
    assert task["id"]
    assert task["status"] in ("completed", "running", "queued", "failed")

    detail = await client.get(f"{API}/tasks/{task['id']}", headers=headers)
    assert detail.status_code == 200

    artifacts = await client.get(f"{API}/tasks/{task['id']}/artifacts", headers=headers)
    assert artifacts.status_code == 200


@pytest.mark.asyncio
async def test_workstream_steps(client: AsyncClient):
    headers = await _login(client)

    ws = await client.post("/api/orchestra/workstreams", headers=headers, json={"name": "Test WS"})
    assert ws.status_code == 200
    ws_id = ws.json()["id"]

    agents = await client.get("/api/workforce/agents", headers=headers)
    agent_id = agents.json()["items"][0]["id"]

    step = await client.post(
        f"{API}/workstreams/{ws_id}/steps",
        headers=headers,
        json={"name": "Step 1", "order": 0, "agent_id": agent_id, "step_kind": "agent"},
    )
    assert step.status_code == 200

    steps = await client.get(f"{API}/workstreams/{ws_id}/steps", headers=headers)
    assert steps.status_code == 200
    assert len(steps.json()) == 1

    run = await client.post(f"{API}/workstreams/{ws_id}/run", headers=headers)
    assert run.status_code == 200
    body = run.json()
    assert body.get("workstream_id") == ws_id or body.get("id")


@pytest.mark.asyncio
async def test_automation_templates(client: AsyncClient):
    headers = await _login(client)
    resp = await client.get(f"{API}/automation-templates", headers=headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
