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

    ws = await client.post(f"{API}/workstreams", headers=headers, json={"name": "Test WS"})
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
    step_id = steps.json()[0]["id"]

    run = await client.post(f"{API}/workstreams/{ws_id}/run", headers=headers)
    assert run.status_code == 200
    body = run.json()
    assert body.get("workstream_id") == ws_id or body.get("id")

    deleted = await client.delete(f"{API}/workstreams/{ws_id}/steps/{step_id}", headers=headers)
    assert deleted.status_code == 200
    steps_after = await client.get(f"{API}/workstreams/{ws_id}/steps", headers=headers)
    assert steps_after.status_code == 200
    assert steps_after.json() == []


@pytest.mark.asyncio
async def test_workstream_human_gate_pauses_and_resumes(client: AsyncClient):
    headers = await _login(client)

    ws = await client.post(f"{API}/workstreams", headers=headers, json={"name": "Gated WS"})
    assert ws.status_code == 200
    ws_id = ws.json()["id"]

    agents = await client.get("/api/workforce/agents", headers=headers)
    agent_id = agents.json()["items"][0]["id"]

    steps = [
        {"name": "Draft", "order": 0, "agent_id": agent_id, "step_kind": "agent"},
        {"name": "Review", "order": 1, "step_kind": "human_gate", "prompt_template": "Approve to continue."},
        {"name": "Finalize", "order": 2, "agent_id": agent_id, "step_kind": "agent"},
    ]
    for payload in steps:
        res = await client.post(f"{API}/workstreams/{ws_id}/steps", headers=headers, json=payload)
        assert res.status_code == 200

    # Inline mock execution runs step 1, then pauses at the approval gate.
    run = await client.post(f"{API}/workstreams/{ws_id}/run", headers=headers)
    assert run.status_code == 200
    task = run.json()
    assert task["status"] == "awaiting_decision"
    assert task["pause_reason"] == "human_gate"

    # Resuming records the gate as passed and finishes the remaining step.
    resumed = await client.post(f"{API}/tasks/{task['id']}/resume", headers=headers)
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_workstream_run_requires_steps(client: AsyncClient):
    headers = await _login(client)
    ws = await client.post(f"{API}/workstreams", headers=headers, json={"name": "Empty WS"})
    assert ws.status_code == 200
    ws_id = ws.json()["id"]
    run = await client.post(f"{API}/workstreams/{ws_id}/run", headers=headers)
    assert run.status_code == 400
    payload = run.json()
    detail = payload.get("detail") or payload.get("error", {}).get("message") or ""
    assert "step" in str(detail).lower()


@pytest.mark.asyncio
async def test_triggers_crud_and_bindings(client: AsyncClient):
    headers = await _login(client)

    created = await client.post(
        "/api/triggers",
        headers=headers,
        json={
            "name": "Nightly scan",
            "kind": "interval",
            "interval_minutes": 1440,
            "agent_role": "orchestra",
            "instructions": "Scan open threads.",
        },
    )
    assert created.status_code == 200
    trigger = created.json()
    assert trigger["kind"] == "interval"
    assert trigger["next_run_at"]

    listed = await client.get("/api/triggers", headers=headers)
    assert listed.status_code == 200
    assert any(t["id"] == trigger["id"] for t in listed.json()["triggers"])

    updated = await client.patch(
        f"/api/triggers/{trigger['id']}", headers=headers, json={"enabled": False}
    )
    assert updated.status_code == 200
    assert updated.json()["enabled"] is False
    assert updated.json()["next_run_at"] is None

    webhook = await client.post(
        "/api/triggers",
        headers=headers,
        json={"name": "Inbound hook", "kind": "webhook", "instructions": "Handle the payload."},
    )
    assert webhook.status_code == 200
    secret = webhook.json().get("webhook_secret")
    assert secret

    bad = await client.post(f"/api/hooks/{webhook.json()['id']}?secret=wrong")
    assert bad.status_code == 403

    hook_id = webhook.json()["id"]
    rotated = await client.post(f"/api/triggers/{hook_id}/rotate-webhook-secret", headers=headers)
    assert rotated.status_code == 200
    new_secret = rotated.json().get("webhook_secret")
    assert new_secret
    assert new_secret != secret
    assert rotated.json()["has_webhook_secret"] is True

    ok_hook = await client.post(
        f"/api/hooks/{hook_id}",
        headers={"X-Bokito-Secret": new_secret},
        json={"ping": True},
    )
    assert ok_hook.status_code == 200

    tested = await client.post(f"/api/triggers/{hook_id}/test-webhook", headers=headers)
    assert tested.status_code == 200
    assert tested.json()["ok"] is True

    deleted = await client.delete(f"/api/triggers/{trigger['id']}", headers=headers)
    assert deleted.status_code == 200

    agents = await client.get("/api/workforce/agents", headers=headers)
    agent_id = agents.json()["items"][0]["id"]
    binding = await client.post(
        "/api/channels/bindings",
        headers=headers,
        json={"channel": "widget", "agent_id": agent_id},
    )
    assert binding.status_code == 200
    binding_id = binding.json()["id"]

    bindings = await client.get("/api/channels/bindings", headers=headers)
    assert bindings.status_code == 200
    assert any(b["id"] == binding_id for b in bindings.json()["bindings"])

    patched = await client.patch(
        f"/api/channels/bindings/{binding_id}",
        headers=headers,
        json={"enabled": False, "priority": 20},
    )
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False
    assert patched.json()["priority"] == 20

    removed = await client.delete(f"/api/channels/bindings/{binding_id}", headers=headers)
    assert removed.status_code == 200
