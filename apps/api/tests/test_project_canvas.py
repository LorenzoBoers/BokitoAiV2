"""Project canvas — get-or-create, patch widgets, revision conflicts."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_project_canvas_seed_and_patch(client: AsyncClient):
    headers = await _auth_headers(client)
    created = await client.post(
        "/api/workforce/projects",
        headers=headers,
        json={
            "name": "Ops board",
            "slug": "ops-board-canvas",
            "autonomous_scope": "Run the ops dashboard",
            "description": "Canvas test project",
        },
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["id"]

    listed = await client.get(f"/api/workforce/projects/{project_id}/canvases", headers=headers)
    assert listed.status_code == 200
    assert any(item["slug"] == "main" for item in listed.json()["items"])

    canvas = await client.get(
        f"/api/workforce/projects/{project_id}/canvases/main", headers=headers
    )
    assert canvas.status_code == 200
    body = canvas.json()
    assert body["slug"] == "main"
    assert body["revision"] >= 1
    assert any(w["type"] == "queue_summary" for w in body["widgets"])
    queue_tile = next(w for w in body["widgets"] if w["type"] == "queue_summary")
    assert "data" in queue_tile

    patched = await client.patch(
        f"/api/workforce/projects/{project_id}/canvases/main",
        headers=headers,
        json={
            "expected_revision": body["revision"],
            "notes": "Added KPI",
            "upsert": [
                {
                    "id": "kpi-1",
                    "type": "metric",
                    "title": "NPS",
                    "x": 0,
                    "y": 20,
                    "w": 3,
                    "h": 2,
                    "config": {"label": "NPS", "value": "72", "trend": "+2"},
                }
            ],
        },
    )
    assert patched.status_code == 200, patched.text
    next_body = patched.json()
    assert next_body["revision"] == body["revision"] + 1
    assert any(w["id"] == "kpi-1" and w["config"]["value"] == "72" for w in next_body["widgets"])
    assert next_body["notes"] == "Added KPI"

    conflict = await client.patch(
        f"/api/workforce/projects/{project_id}/canvases/main",
        headers=headers,
        json={
            "expected_revision": body["revision"],
            "upsert": [
                {
                    "id": "kpi-2",
                    "type": "metric",
                    "x": 0,
                    "y": 22,
                    "w": 3,
                    "h": 2,
                    "config": {"value": "1"},
                }
            ],
        },
    )
    assert conflict.status_code == 409
