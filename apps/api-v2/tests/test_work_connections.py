"""Agents, playbooks, triggers, connections and tokens."""

from __future__ import annotations

from httpx import AsyncClient

from tests.conftest import auth


async def test_agent_crud_records_changes(client: AsyncClient, owner: dict) -> None:
    r = await client.get("/api/agents", headers=auth(owner))
    assert len(r.json()) == 1 and r.json()[0]["is_default"]

    r = await client.post(
        "/api/agents",
        json={
            "name": "Sales",
            "role": "Quotes",
            "instructions": "Be concise",
            "autonomy_cap": "assisted",
        },
        headers=auth(owner),
    )
    assert r.status_code == 201, r.text
    agent_id = r.json()["result"]["agent_id"]
    r = await client.patch(
        f"/api/agents/{agent_id}",
        json={"patch": {"model": "mistral:mistral-small-latest"}},
        headers=auth(owner),
    )
    assert r.json()["model"] == "mistral:mistral-small-latest"

    r = await client.get("/api/govern/changes", headers=auth(owner))
    titles = [c["title"] for c in r.json()]
    assert "Create agent Sales" in titles and "Update agent Sales" in titles
    update = next(c for c in r.json() if c["title"] == "Update agent Sales")
    r = await client.post(f"/api/govern/changes/{update['id']}/rollback", headers=auth(owner))
    assert r.status_code == 200
    r = await client.get(f"/api/agents/{agent_id}", headers=auth(owner))
    assert r.json()["model"] == ""

    r = await client.get("/api/govern/audit", headers=auth(owner))
    actions = {e["action"] for e in r.json()}
    assert {"tool.create_agent", "tool.update_agent", "change.rollback"} <= actions


async def test_playbook_runs_inline(client: AsyncClient, owner: dict) -> None:
    await client.post(
        "/api/govern/policy/posture", json={"posture": "autonomous"}, headers=auth(owner)
    )
    r = await client.post(
        "/api/playbooks",
        json={
            "name": "Weekly check",
            "steps": [{"title": "Summarise", "instruction": "Write a short note"}],
        },
        headers=auth(owner),
    )
    playbook_id = r.json()["result"]["playbook_id"]
    r = await client.post(f"/api/playbooks/{playbook_id}/run", headers=auth(owner))
    assert r.status_code == 200, r.text
    run_id = r.json()["result"]["run_id"]
    r = await client.get(f"/api/runs/{run_id}", headers=auth(owner))
    assert r.json()["status"] == "done"
    assert r.json()["kind"] == "playbook"
    assert any(e["kind"] == "step" for e in r.json()["events"])


async def test_trigger_webhook(client: AsyncClient, owner: dict) -> None:
    await client.post(
        "/api/govern/policy/posture", json={"posture": "autonomous"}, headers=auth(owner)
    )
    r = await client.post(
        "/api/triggers",
        json={"name": "Form", "kind": "webhook", "instructions": "Acknowledge the form"},
        headers=auth(owner),
    )
    assert r.status_code == 201, r.text
    trigger_id = r.json()["result"]["trigger_id"]
    secret = r.json()["result"]["webhook_secret"]
    r = await client.post(f"/api/hooks/{trigger_id}", json={"name": "Jane"})
    assert r.status_code == 401
    r = await client.post(
        f"/api/hooks/{trigger_id}", json={"name": "Jane"}, headers={"X-Bokito-Secret": secret}
    )
    assert r.status_code == 200, r.text
    r = await client.get(f"/api/runs/{r.json()['run_id']}", headers=auth(owner))
    assert r.json()["status"] == "done"
    assert r.json()["trust"] == "external"


async def test_connections_and_byok(client: AsyncClient, owner: dict) -> None:
    r = await client.post(
        "/api/connections",
        json={
            "kind": "model_provider",
            "provider": "mistral",
            "name": "Own Mistral",
            "credentials": {"api_key": "sk-secret-1234"},
        },
        headers=auth(owner),
    )
    assert r.status_code == 201, r.text
    conn = r.json()
    assert conn["status"] == "active"
    assert conn["credentials_masked"]["api_key"].endswith("1234")
    assert "sk-secret" not in conn["credentials_masked"]["api_key"]

    r = await client.post(
        "/api/connections",
        json={"kind": "email", "provider": "resend", "name": "Support inbox"},
        headers=auth(owner),
    )
    assert r.json()["address"].endswith("@in.bokito.ai")
    assert r.json()["disclosure_enabled"] is True

    r = await client.get("/api/connections/catalog/providers", headers=auth(owner))
    assert "model_provider" in r.json()


async def test_api_token_lifecycle(client: AsyncClient, owner: dict) -> None:
    r = await client.post(
        "/api/govern/tokens", json={"name": "MCP", "scopes": ["tools"]}, headers=auth(owner)
    )
    assert r.status_code == 201, r.text
    assert r.json()["token"].startswith("bok2_")
    token_id = r.json()["id"]
    r = await client.get("/api/govern/tokens", headers=auth(owner))
    assert len(r.json()) == 1
    r = await client.delete(f"/api/govern/tokens/{token_id}", headers=auth(owner))
    assert r.status_code == 204
    r = await client.get("/api/govern/tokens", headers=auth(owner))
    assert r.json()[0]["revoked_at"] is not None
