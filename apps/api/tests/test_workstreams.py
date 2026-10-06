"""Workstream API: stages-only playbooks (step engine retired)."""

import os

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.project import Project
from app.models.signal import Signal
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

os.environ["BOKITO_MOCK_EXECUTION"] = "true"

API = "/api/workstreams"


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.mark.asyncio
async def test_workstream_crud_and_stages(client: AsyncClient):
    headers = await _login(client)

    created = await client.post(
        API, headers=headers, json={"name": "Tax filing", "description": "Collect and file"}
    )
    assert created.status_code == 200
    body = created.json()
    ws_id = body["id"]
    assert "stages" in body
    assert body["stages_count"] >= 1

    # Steps endpoint is gone.
    replaced = await client.put(
        f"{API}/{ws_id}/steps",
        headers=headers,
        json={"steps": [{"name": "Nope", "kind": "agent_task"}]},
    )
    assert replaced.status_code == 404

    detail = await client.get(f"{API}/{ws_id}", headers=headers)
    assert detail.status_code == 200
    assert "steps" not in detail.json() or detail.json().get("steps") in (None, [])
    assert detail.json()["stages_count"] >= 1

    patched = await client.patch(
        f"{API}/{ws_id}",
        headers=headers,
        json={
            "stages": [
                {"key": "intake", "name": "Intake", "kind": "open"},
                {"key": "done", "name": "Done", "kind": "done"},
            ]
        },
    )
    assert patched.status_code == 200
    assert patched.json()["stages_count"] == 2
    assert [s["key"] for s in patched.json()["stages"]] == ["intake", "done"]


@pytest.mark.asyncio
async def test_start_run_stages_only(client: AsyncClient):
    headers = await _login(client)
    created = await client.post(API, headers=headers, json={"name": "Quick run"})
    assert created.status_code == 200
    ws_id = created.json()["id"]

    run = await client.post(
        f"{API}/{ws_id}/runs",
        headers=headers,
        json={"input_kind": "manual", "input_text": "hello"},
    )
    assert run.status_code == 200
    body = run.json()
    assert body["status"] == "completed"
    assert body["current_step_id"] is None
    assert "retired" in (body.get("summary") or "").lower() or "stages" in (
        body.get("summary") or ""
    ).lower()


@pytest.mark.asyncio
async def test_creating_a_flow_makes_its_hashtag_the_one_action_tag(client: AsyncClient):
    headers = await _login(client)

    created = await client.post(API, headers=headers, json={"name": "#Retour"})
    assert created.status_code == 200, created.text
    flow = created.json()
    assert flow["name"] == "retour"
    assert [t["name"] for t in flow["tags"]] == ["retour"]

    tags = {row["name"]: row for row in (await client.get("/api/signals/tags", headers=headers)).json()}
    assert tags["retour"]["is_category"] is True

    duplicate = await client.post(API, headers=headers, json={"name": "retour"})
    assert duplicate.status_code == 400

    # A free hashtag is reused, not duplicated.
    free = await client.post("/api/signals/tags", headers=headers, json={"name": "garantie"})
    assert free.status_code in (200, 201), free.text
    reused = await client.post(API, headers=headers, json={"name": "garantie"})
    assert reused.status_code == 200, reused.text
    assert reused.json()["tags"][0]["id"] == free.json()["id"]

    two = await client.patch(
        f"{API}/{flow['id']}",
        headers=headers,
        json={"tag_ids": [flow["tags"][0]["id"], free.json()["id"]]},
    )
    assert two.status_code == 400


@pytest.mark.asyncio
async def test_renaming_the_action_tag_renames_the_flow(client: AsyncClient):
    headers = await _login(client)
    flow = (await client.post(API, headers=headers, json={"name": "klacht"})).json()
    other = (await client.post(API, headers=headers, json={"name": "storing"})).json()
    tag_id = flow["tags"][0]["id"]

    renamed = await client.patch(f"/api/signals/tags/{tag_id}", headers=headers, json={"name": "#Klachten"})
    assert renamed.status_code == 200, renamed.text
    detail = (await client.get(f"{API}/{flow['id']}", headers=headers)).json()
    assert detail["name"] == "klachten"
    assert [t["name"] for t in detail["tags"]] == ["klachten"]

    taken = await client.patch(
        f"/api/signals/tags/{tag_id}", headers=headers, json={"name": other["tags"][0]["name"]}
    )
    assert taken.status_code == 422
    assert "already in use" in taken.text


@pytest.mark.asyncio
async def test_flow_board_groups_tickets_into_project_lanes(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    acme = Project(tenant_id=tenant.id, name="Acme", slug="acme", autonomous_scope="project")
    session_override.add(acme)
    await session_override.commit()
    await session_override.refresh(acme)

    flow = (await client.post(API, headers=headers, json={"name": "reparatie"})).json()
    linked = await client.patch(f"{API}/{flow['id']}", headers=headers, json={"project_ids": [str(acme.id)]})
    assert linked.status_code == 200, linked.text

    on_project = Signal(tenant_id=tenant.id, channel="widget", source="widget", subject="Pump")
    loose = Signal(tenant_id=tenant.id, channel="widget", source="widget", subject="Valve")
    session_override.add_all([on_project, loose])
    await session_override.commit()
    await session_override.refresh(on_project)
    await session_override.refresh(loose)

    filed = await client.put(
        f"/api/signals/{on_project.id}/ticket",
        headers=headers,
        json={"tag": "reparatie", "project_id": str(acme.id)},
    )
    assert filed.status_code == 200, filed.text
    filed = await client.put(
        f"/api/signals/{loose.id}/ticket",
        headers=headers,
        json={"tag": "reparatie", "project_id": None},
    )
    assert filed.status_code == 200, filed.text

    board = await client.get(f"{API}/{flow['id']}/board", headers=headers)
    assert board.status_code == 200, board.text
    body = board.json()
    assert [lane["id"] for lane in body["lanes"]] == [str(acme.id), None]
    by_signal = {t["signal_id"]: t for t in body["tickets"]}
    assert by_signal[str(on_project.id)]["project_id"] == str(acme.id)
    assert by_signal[str(loose.id)]["project_id"] is None

    rows = (await client.get(API, headers=headers)).json()["items"]
    row = next(r for r in rows if r["id"] == flow["id"])
    assert sum(row["ticket_counts"].values()) == 2
    assert row["last_activity_at"] is None or isinstance(row["last_activity_at"], str)
