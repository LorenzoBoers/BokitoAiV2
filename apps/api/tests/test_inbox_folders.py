"""Communication folders: saved filters, computed project folders, list filters."""

import json
import os

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.case import CaseType
from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.signal import Signal
from app.services.cases import create_binding, create_case, ensure_platform_case_types
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

os.environ["BOKITO_MOCK_EXECUTION"] = "true"

STAGES = json.dumps(
    [
        {"key": "new", "name": "New", "kind": "open"},
        {"key": "parts", "name": "Waiting for parts", "kind": "waiting"},
        {"key": "fixed", "name": "Fixed", "kind": "done"},
    ]
)


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
async def test_folders_filter_by_category_stage_and_project(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    tenant_id = tenant.id
    await ensure_platform_case_types(session_override, tenant_id)
    bug = (
        await session_override.execute(
            select(CaseType).where(CaseType.tenant_id == tenant_id, CaseType.slug == "bug_report")
        )
    ).scalar_one()
    bug_id = bug.id

    project = Project(tenant_id=tenant_id, name="Repairs", slug="repairs")
    session_override.add(project)
    await session_override.commit()
    project_id = project.id
    ws = Workstream(tenant_id=tenant_id, name="Repair flow", project_id=project_id, stages_json=STAGES)
    session_override.add(ws)
    await session_override.commit()
    await create_binding(
        session_override,
        tenant_id,
        case_type_id=bug_id,
        target_kind="workstream",
        target_id=ws.id,
        auto_link=True,
        auto_start_run=False,
    )

    ticket = await _signal(session_override, tenant_id, "Broken charger")
    other = await _signal(session_override, tenant_id, "Just a question")
    ticket_id, other_id = str(ticket.id), str(other.id)
    await create_case(session_override, tenant_id, case_type_id=bug_id, signal_id=ticket.id)

    by_category = await client.get(f"/api/signals?view=all&category_id={bug_id}", headers=headers)
    assert ticket_id in _ids(by_category) and other_id not in _ids(by_category)
    by_kind = await client.get("/api/signals?view=all&stage=open", headers=headers)
    assert ticket_id in _ids(by_kind) and other_id not in _ids(by_kind)
    assert ticket_id not in _ids(await client.get("/api/signals?view=all&stage=parts", headers=headers))
    # The ticket's playbook belongs to the project: the conversation is in its folder.
    by_project = await client.get(f"/api/signals?view=all&project_id={project_id}", headers=headers)
    assert _ids(by_project) == {ticket_id}

    saved = await client.post(
        "/api/signals/folders",
        headers=headers,
        json={"name": "Open repairs", "filter": {"category_id": str(bug_id), "stage": "open"}},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["kind"] == "saved"
    rejected = await client.post("/api/signals/folders", headers=headers, json={"name": "Empty", "filter": {}})
    assert rejected.status_code == 422

    folders = (await client.get("/api/signals/folders", headers=headers)).json()
    by_name = {row["name"]: row for row in folders}
    assert by_name["Open repairs"]["count"] == 1
    assert by_name["Repairs"]["kind"] == "project"
    assert by_name["Repairs"]["filter"] == {"project_id": str(project_id)}
    assert by_name["Repairs"]["count"] == 1

    renamed = await client.patch(
        f"/api/signals/folders/{saved.json()['id']}", headers=headers, json={"name": "Repairs open"}
    )
    assert renamed.json()["name"] == "Repairs open"
    removed = await client.delete(f"/api/signals/folders/{saved.json()['id']}", headers=headers)
    assert removed.status_code == 204
    names = [row["name"] for row in (await client.get("/api/signals/folders", headers=headers)).json()]
    assert "Repairs open" not in names
