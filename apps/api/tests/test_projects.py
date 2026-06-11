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
async def test_project_orchestration_and_notifications(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    created = await client.post(
        API,
        headers=headers,
        json={
            "name": "Orch Project",
            "slug": "orch-project",
            "autonomous_scope": "Orchestration and notification preferences for automated agents.",
        },
    )
    project_id = created.json()["id"]

    orch = await client.get(f"{API}/{project_id}/orchestration", headers=headers)
    assert orch.status_code == 200
    assert orch.json()["wake_cadence"] == "daily"

    patched = await client.patch(
        f"{API}/{project_id}/orchestration",
        headers=headers,
        json={"wake_cadence": "weekly", "continuous_enabled": True},
    )
    assert patched.status_code == 200
    assert patched.json()["wake_cadence"] == "weekly"
    assert patched.json()["continuous_enabled"] is True

    prefs = await client.get(f"{API}/{project_id}/notifications/preferences", headers=headers)
    assert prefs.status_code == 200
    assert len(prefs.json()["preferences"]) == 12


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

    status = await client.get(f"{API}/{project_id}/repo/status", headers=headers)
    assert status.status_code == 200
    assert status.json()["repo_index_status"] == "ready"

    po = await client.post(f"{API}/{project_id}/po-agent", headers=headers, json={"name": "Repo PO"})
    assert po.status_code == 200
    assert po.json()["setup_complete"] is True
    assert po.json()["po_agent"]["agent_type"] == "orchestrator"

    streams = await client.get(f"{API}/{project_id}/workstreams", headers=headers)
    assert streams.status_code == 200
    assert streams.json()["po_agent"] is not None
