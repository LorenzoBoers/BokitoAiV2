"""Communication rail: category and tag rows, project rows, list filters."""

import os


import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.signal import Signal
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

os.environ["BOKITO_MOCK_EXECUTION"] = "true"

STAGES = [
    {"name": "New", "kind": "open"},
    {"name": "Waiting for parts", "kind": "waiting"},
    {"name": "Fixed", "kind": "done"},
]


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _signal(session, tenant_id, subject: str) -> Signal:
    signal = Signal(tenant_id=tenant_id, channel="widget", source="widget", subject=subject, status="open")
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal


def _ids(response) -> set[str]:
    return {row["id"] for row in response.json()["items"]}


@pytest.mark.asyncio
async def test_nav_rows_and_list_filters(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    created = await client.post(
        "/api/folders",
        headers=headers,
        json={"name": "Repairs", "slug": "repairs", "tags": ["repairs"]},
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["id"]
    assert created.json()["tag_names"] == ["repairs"]

    category = (await client.post("/api/categories", headers=headers, json={"name": "storing"})).json()
    await client.patch(
        f"/api/workstreams/{category['workstream_id']}",
        headers=headers,
        json={"stages": STAGES, "project_ids": [project_id]},
    )
    pinned = (
        await client.post("/api/signals/tags", headers=headers, json={"name": "#VIP", "show_in_nav": True})
    ).json()
    assert pinned["name"] == "vip"
    await client.post("/api/signals/tags", headers=headers, json={"name": "hidden"})

    ticket = await _signal(session_override, tenant.id, "Broken charger")
    other = await _signal(session_override, tenant.id, "Just a question")
    ticket_id, other_id = str(ticket.id), str(other.id)
    filed = await client.put(
        f"/api/signals/{ticket_id}/ticket",
        headers=headers,
        json={"tag_id": category["id"], "project_id": project_id},
    )
    assert filed.status_code == 200, filed.text
    await client.patch(f"/api/signals/{other_id}", headers=headers, json={"tags": ["vip"]})

    by_category = await client.get(f"/api/signals?view=all&category_id={category['id']}", headers=headers)
    assert _ids(by_category) == {ticket_id}
    by_kind = await client.get("/api/signals?view=all&stage=open", headers=headers)
    assert ticket_id in _ids(by_kind) and other_id not in _ids(by_kind)
    assert ticket_id not in _ids(
        await client.get("/api/signals?view=all&stage=waiting-for-parts", headers=headers)
    )
    by_project = await client.get(f"/api/signals?view=all&project_id={project_id}", headers=headers)
    assert _ids(by_project) == {ticket_id}
    by_tag = await client.get("/api/signals?view=all&tag=storing", headers=headers)
    assert _ids(by_tag) == {ticket_id}

    nav = await client.get("/api/signals/nav", headers=headers)
    assert nav.status_code == 200
    body = nav.json()
    assert [(row["id"], row["name"], row["count"]) for row in body["ticket_tags"]] == [
        (category["id"], "storing", 1)
    ]
    # The folder's own tag shows as the folder, not as a tag row.
    assert [row["name"] for row in body["tags"]] == ["vip"]
    assert body["tags"][0]["count"] == 1
    folder_rows = {row["id"]: row for row in body["projects"]}
    assert folder_rows[project_id]["name"].lower() == "repairs"
    assert folder_rows[project_id]["count"] == 1
    assert folder_rows[project_id]["tag_ids"] == created.json()["tag_ids"]
    assert folder_rows[project_id]["children"] == []

    hidden = await client.patch(f"/api/categories/{category['id']}", headers=headers, json={"show_in_nav": False})
    assert hidden.status_code == 200
    assert (await client.get("/api/signals/nav", headers=headers)).json()["ticket_tags"] == []

    assert (await client.get("/api/signals/folders", headers=headers)).status_code in (404, 405, 422)
