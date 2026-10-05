"""Tests for project hub endpoints."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

API = "/api/workforce/projects"


async def _login(client: AsyncClient) -> str:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return res.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_create_and_get_project(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    created = await client.post(
        API,
        headers=headers,
        json={
            "name": "Test Project",
            "slug": "test-project",
            "autonomous_scope": "Build and ship features for the test tenant workspace.",
        },
    )
    assert created.status_code == 200
    body = created.json()
    assert body["slug"] == "test-project"
    assert body["autonomous_scope"].startswith("Build")

    fetched = await client.get(f"{API}/{body['id']}", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "Test Project"


@pytest.mark.asyncio
async def test_project_workstreams_crud(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    created = await client.post(
        API,
        headers=headers,
        json={
            "name": "Stream Project",
            "slug": "stream-project",
            "autonomous_scope": "Workstream management for automated agents.",
        },
    )
    project_id = created.json()["id"]

    stream = await client.post(
        "/api/workstreams",
        headers=headers,
        json={
            "name": "Weekly digest",
            "description": "Summarize activity",
            "project_id": project_id,
        },
    )
    assert stream.status_code == 200
    body = stream.json()
    assert body["project_id"] == project_id
    assert body["enabled"] is True
    assert body["steps_count"] == 0

    patched = await client.patch(
        f"/api/workstreams/{body['id']}",
        headers=headers,
        json={"enabled": False},
    )
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False

    listed = await client.get(
        f"/api/workstreams?project_id={project_id}", headers=headers
    )
    assert listed.status_code == 200
    assert any(s["id"] == body["id"] for s in listed.json()["items"])


@pytest.mark.asyncio
async def test_project_repo_and_po_agent(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    created = await client.post(
        API,
        headers=headers,
        json={
            "name": "Repo Project",
            "slug": "repo-project",
            "autonomous_scope": "Connect a GitHub repository and configure the product owner agent.",
        },
    )
    project_id = created.json()["id"]

    linked = await client.patch(
        f"{API}/{project_id}/repo",
        headers=headers,
        json={"github_repo_full_name": "bokito/docs", "github_default_branch": "main"},
    )
    assert linked.status_code == 200
    assert linked.json()["github_repo_full_name"] == "bokito/docs"

    reindex = await client.post(f"{API}/{project_id}/repo/reindex", headers=headers)
    assert reindex.status_code == 200
    assert reindex.json()["queued"] is True

    # Real indexing runs in the background; without a GitHub token it fails
    # honestly instead of pretending to be ready.
    status = await client.get(f"{API}/{project_id}/repo/status", headers=headers)
    assert status.status_code == 200
    assert status.json()["repo_index_status"] in ("indexing", "error")

    po = await client.post(f"{API}/{project_id}/po-agent", headers=headers, json={"name": "Repo PO"})
    assert po.status_code == 200
    assert po.json()["setup_complete"] is True
    assert po.json()["po_agent"]["role"] == "orchestrator"

    summary = await client.get(f"{API}/{project_id}/po-agent", headers=headers)
    assert summary.status_code == 200
    assert summary.json()["po_agent"] is not None


@pytest.mark.asyncio
async def test_project_token_budget_patch(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    created = await client.post(
        API,
        headers=headers,
        json={
            "name": "Budget Project",
            "slug": "budget-project",
            "autonomous_scope": "Hold a spend cap for this goal.",
        },
    )
    assert created.status_code == 200
    project_id = created.json()["id"]
    assert created.json()["token_budget_daily"] is None

    patched = await client.patch(
        f"{API}/{project_id}",
        headers=headers,
        json={"token_budget_daily": 5000, "token_budget_hourly": 800},
    )
    assert patched.status_code == 200
    assert patched.json()["token_budget_daily"] == 5000
    assert patched.json()["token_budget_hourly"] == 800

    budget = await client.get(f"{API}/{project_id}/usage/budget", headers=headers)
    assert budget.status_code == 200
    body = budget.json()
    assert body["token_budget_daily"] == 5000
    assert body["token_budget_hourly"] == 800
    assert body["token_budget_daily_set"] == 5000


@pytest.mark.asyncio
async def test_project_po_agent_includes_avatar(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    created = await client.post(
        API,
        headers=headers,
        json={
            "name": "Avatar Project",
            "slug": "avatar-project",
            "autonomous_scope": "Show the project agent like other surfaces.",
        },
    )
    project_id = created.json()["id"]
    po = await client.post(f"{API}/{project_id}/po-agent", headers=headers, json={"name": "Avatar PO"})
    assert po.status_code == 200
    agent = po.json()["po_agent"]
    assert "avatar_kind" in agent
    fetched = await client.get(f"{API}/{project_id}", headers=headers)
    assert fetched.json()["po_agent"]["avatar_kind"]
    assert fetched.json()["po_agent"]["status"] in ("standby", "active", "error")
    assert "last_active_at" in fetched.json()["po_agent"]


@pytest.mark.asyncio
async def test_link_any_company_agent_as_project_default(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    created = await client.post(
        API,
        headers=headers,
        json={
            "name": "Default Agent Project",
            "slug": "default-agent-project",
            "autonomous_scope": "Assign a company agent as the project default.",
        },
    )
    project_id = created.json()["id"]
    agent = await client.post(
        "/api/workforce/agents",
        headers=headers,
        json={"name": "Desk Worker", "role": "communication"},
    )
    assert agent.status_code == 200, agent.text
    agent_id = agent.json()["agent"]["id"]

    linked = await client.patch(
        f"{API}/{project_id}/po-agent",
        headers=headers,
        json={"po_agent_id": agent_id},
    )
    assert linked.status_code == 200, linked.text
    assert linked.json()["po_agent_id"] == agent_id
    assert linked.json()["po_agent"]["id"] == agent_id

    roster = await client.get(f"{API}/{project_id}/agents", headers=headers)
    assert roster.status_code == 200
    rows = roster.json()
    items = rows if isinstance(rows, list) else rows.get("items", [])
    match = next((row for row in items if row["agent_id"] == agent_id), None)
    assert match is not None
    assert match["is_default"] is True


@pytest.mark.asyncio
async def test_patch_ignores_legacy_autonomous_mode_field(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    created = await client.post(
        API,
        headers=headers,
        json={
            "name": "Posture Only",
            "slug": "posture-only",
            "autonomous_scope": "Workspace posture is the only autonomy dial.",
        },
    )
    assert created.status_code == 200
    assert "autonomous_mode" not in created.json()
    patched = await client.patch(
        f"{API}/{created.json()['id']}",
        headers=headers,
        json={"autonomous_mode": True},
    )
    assert patched.status_code == 200
    assert "autonomous_mode" not in patched.json()


