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
        f"{API}/{project_id}/workstreams",
        headers=headers,
        json={"name": "Weekly digest", "description": "Summarize activity"},
    )
    assert stream.status_code == 200
    body = stream.json()
    assert body["project_id"] == project_id
    assert body["enabled"] is True
    assert body["steps_count"] == 0

    patched = await client.patch(
        f"{API}/{project_id}/workstreams/{body['id']}",
        headers=headers,
        json={"enabled": False},
    )
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False

    listed = await client.get(f"{API}/{project_id}/workstreams", headers=headers)
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
    assert po.json()["po_agent"]["agent_type"] == "orchestrator"

    streams = await client.get(f"{API}/{project_id}/workstreams", headers=headers)
    assert streams.status_code == 200
    assert streams.json()["po_agent"] is not None
