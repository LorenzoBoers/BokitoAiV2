"""Nested project folders: parent, cycle, slug scope, and conversation rollup."""

import pytest
from httpx import AsyncClient


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _project(
    client: AsyncClient,
    headers: dict[str, str],
    name: str,
    slug: str,
    parent_id: str | None = None,
) -> dict:
    body: dict = {"name": name, "slug": slug, "autonomous_scope": "ops"}
    if parent_id:
        body["parent_id"] = parent_id
    response = await client.post("/api/workforce/projects", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_nested_folders_slug_cycle_and_thread_rollup(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    admin = await _project(client, headers, "Administratie", "administratie-folders")
    invoices = await _project(
        client, headers, "Facturen", "facturen", parent_id=admin["id"]
    )
    orders = await _project(client, headers, "Werkbonnen", "werkbonnen", parent_id=admin["id"])
    same_name = await _project(client, headers, "Facturen", "facturen", parent_id=orders["id"])
    assert same_name["parent_id"] == orders["id"]

    clash = await client.post(
        "/api/workforce/projects",
        headers=headers,
        json={"name": "Other", "slug": "facturen", "autonomous_scope": "ops", "parent_id": admin["id"]},
    )
    assert clash.status_code == 409

    cycle = await client.patch(
        f"/api/workforce/projects/{admin['id']}",
        headers=headers,
        json={"parent_id": invoices["id"]},
    )
    assert cycle.status_code == 422

    detail = await client.get(f"/api/workforce/projects/{admin['id']}", headers=headers)
    assert detail.status_code == 200
    names = {child["name"] for child in detail.json()["children"]}
    assert names == {"Facturen", "Werkbonnen"}
    assert detail.json()["child_count"] == 2

    listed = await client.get("/api/workforce/projects", headers=headers)
    assert listed.status_code == 200
    rows = listed.json()
    roots = [row for row in rows if row["slug"] == "administratie-folders"]
    assert roots and roots[0]["parent_id"] is None
    assert roots[0]["child_count"] == 2

    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "internal",
            "source": "mock",
            "subject": "Old invoice",
            "body_text": "File me",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]
    filed = await client.patch(
        f"/api/signals/{signal_id}",
        headers=headers,
        json={"status": "closed", "project_id": invoices["id"]},
    )
    assert filed.status_code == 200
    assert filed.json()["project_id"] == invoices["id"]
    assert filed.json()["status"] == "closed"

    parent_list = await client.get(
        "/api/signals",
        headers=headers,
        params={"view": "closed", "project_id": admin["id"]},
    )
    assert parent_list.status_code == 200
    assert any(item["id"] == signal_id for item in parent_list.json()["items"])

    child_only = await client.get(
        "/api/signals",
        headers=headers,
        params={"view": "closed", "project_id": orders["id"]},
    )
    assert child_only.status_code == 200
    assert all(item["id"] != signal_id for item in child_only.json()["items"])

    removed = await client.request(
        "DELETE",
        f"/api/workforce/projects/{admin['id']}",
        headers=headers,
        json={"confirm_name": "Administratie"},
    )
    assert removed.status_code == 200
    gone = await client.get(f"/api/workforce/projects/{invoices['id']}", headers=headers)
    assert gone.status_code == 404
