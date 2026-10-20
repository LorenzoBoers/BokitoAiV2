"""Tests for folder hub endpoints."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

API = "/api/folders"


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
            "tags": ["test-project"],
        },
    )
    assert created.status_code == 200
    body = created.json()
    assert body["slug"] == "test_project"
    assert body["tag_names"] == ["test_project"]
    assert body["autonomous_scope"].startswith("Build")

    fetched = await client.get(f"{API}/{body['id']}", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["tag_names"] == ["test_project"]


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
            "tags": ["stream-project"],
        },
    )
    project_id = created.json()["id"]

    stream = await client.post(
        "/api/flows",
        headers=headers,
        json={
            "name": "Weekly digest",
            "description": "Summarize activity",
            "project_ids": [project_id],
        },
    )
    assert stream.status_code == 200
    body = stream.json()
    assert body["project_ids"] == [project_id]

    listed = await client.get(
        f"/api/flows?project_id={project_id}", headers=headers
    )
    assert listed.status_code == 200
    assert any(s["id"] == body["id"] for s in listed.json()["items"])


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
            "tags": ["posture-only"],
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
