"""Tests for the Workstream engine: CRUD, linear runs, wait/gate/deadline."""

import os
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

os.environ["BOKITO_MOCK_EXECUTION"] = "true"

API = "/api/workstreams"


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _make_workstream(client: AsyncClient, headers: dict, name: str, steps: list[dict]) -> str:
    ws = await client.post(API, headers=headers, json={"name": name})
    assert ws.status_code == 200
    ws_id = ws.json()["id"]
    replaced = await client.put(f"{API}/{ws_id}/steps", headers=headers, json={"steps": steps})
    assert replaced.status_code == 200
    return ws_id


@pytest.mark.asyncio
async def test_workstream_crud_and_steps(client: AsyncClient):
    headers = await _login(client)

    created = await client.post(
        API, headers=headers, json={"name": "Tax filing", "description": "Collect and file"}
    )
    assert created.status_code == 200
    ws_id = created.json()["id"]

    replaced = await client.put(
        f"{API}/{ws_id}/steps",
        headers=headers,
        json={
            "steps": [
                {"name": "Collect data", "kind": "agent", "goal": "Collect the client data."},
                {"name": "Wait for client", "kind": "wait", "wait_kind": "input"},
                {"name": "File", "kind": "agent", "goal": "File the declaration."},
            ]
        },
    )
    assert replaced.status_code == 200
    steps = replaced.json()["steps"]
    assert [s["position"] for s in steps] == [0, 1, 2]

    detail = await client.get(f"{API}/{ws_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["steps_count"] == 3

    # Replace keeps ids for surviving steps and drops removed ones.
    kept = steps[0]
    replaced2 = await client.put(
        f"{API}/{ws_id}/steps",
        headers=headers,
        json={"steps": [{"id": kept["id"], "name": "Collect data v2", "kind": "agent"}]},
    )
    assert replaced2.status_code == 200
    after = replaced2.json()["steps"]
    assert len(after) == 1
    assert after[0]["id"] == kept["id"]
    assert after[0]["name"] == "Collect data v2"

    patched = await client.patch(f"{API}/{ws_id}", headers=headers, json={"enabled": False})
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False

    listed = await client.get(API, headers=headers)
    assert any(w["id"] == ws_id for w in listed.json()["items"])

    deleted = await client.delete(f"{API}/{ws_id}", headers=headers)
    assert deleted.status_code == 200


@pytest.mark.asyncio
async def test_run_requires_steps_and_enabled(client: AsyncClient):
    headers = await _login(client)
    ws = await client.post(API, headers=headers, json={"name": "Empty"})
    ws_id = ws.json()["id"]
    run = await client.post(f"{API}/{ws_id}/runs", headers=headers, json={})
    assert run.status_code == 400
    detail = str(run.json())
    assert "step" in detail.lower()


@pytest.mark.asyncio
async def test_linear_run_completes_with_worklog(client: AsyncClient):
    headers = await _login(client)
    ws_id = await _make_workstream(
        client,
        headers,
        "Two step flow",
        [
            {"name": "Analyze", "kind": "agent", "goal": "Analyze the input."},
            {"name": "Report", "kind": "agent", "goal": "Write the report."},
        ],
    )

    run = await client.post(
        f"{API}/{ws_id}/runs",
        headers=headers,
        json={"input_kind": "manual", "input_text": "Quarterly numbers attached."},
    )
    assert run.status_code == 200
    body = run.json()
    assert body["status"] == "completed"
    assert body["summary"]

    detail = await client.get(f"{API}/runs/{body['id']}", headers=headers)
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["run"]["workstream_name"] == "Two step flow"
    assert len(payload["step_outputs"]) == 2
    assert [o["name"] for o in payload["step_outputs"]] == ["Analyze", "Report"]
    # One AgentRun per agent step, each with worklog events.
    assert len(payload["agent_runs"]) == 2
    for agent_run in payload["agent_runs"]:
        assert agent_run["status"] == "completed"
        event_types = [e["event_type"] for e in agent_run["events"]]
        assert "step_started" in event_types
        assert "step_completed" in event_types

    runs = await client.get(f"{API}/{ws_id}/runs", headers=headers)
    assert any(r["id"] == body["id"] for r in runs.json()["items"])


@pytest.mark.asyncio
async def test_wait_step_parks_and_resume_continues(client: AsyncClient):
    headers = await _login(client)
    ws_id = await _make_workstream(
        client,
        headers,
        "Wait flow",
        [
            {"name": "Prepare", "kind": "agent", "goal": "Prepare the request."},
            {"name": "Wait for client", "kind": "wait", "wait_kind": "input"},
            {"name": "Finish", "kind": "agent", "goal": "Process the client answer."},
        ],
    )

    run = await client.post(f"{API}/{ws_id}/runs", headers=headers, json={})
    assert run.status_code == 200
    body = run.json()
    assert body["status"] == "waiting"

    resumed = await client.post(
        f"{API}/runs/{body['id']}/resume",
        headers=headers,
        json={"input_text": "Client sent the documents."},
    )
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "completed"

    detail = await client.get(f"{API}/runs/{body['id']}", headers=headers)
    outputs = detail.json()["step_outputs"]
    assert [o["name"] for o in outputs] == ["Prepare", "Finish"]


@pytest.mark.asyncio
async def test_gate_step_raises_decision_and_cancel(client: AsyncClient):
    headers = await _login(client)
    ws_id = await _make_workstream(
        client,
        headers,
        "Gated flow",
        [
            {"name": "Draft", "kind": "agent", "goal": "Draft the output."},
            {"name": "Approval", "kind": "gate"},
            {"name": "Send", "kind": "agent", "goal": "Send it."},
        ],
    )

    run = await client.post(f"{API}/{ws_id}/runs", headers=headers, json={})
    assert run.status_code == 200
    body = run.json()
    assert body["status"] == "awaiting_gate"

    cancelled = await client.post(f"{API}/runs/{body['id']}/cancel", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_deadline_sweep_continues_and_fails(session_override):
    """The scheduler sweep applies on_deadline when a waiting run expires."""
    from app.models.agent import Agent
    from app.models.auth import Tenant
    from app.models.notification import DecisionRequest
    from app.models.orchestra import Workstream, WorkstreamRun, WorkstreamStep
    from app.services.workstreams import process_due_run_deadlines, start_run

    tenant = Tenant(slug="ws-deadline", name="WS Deadline")
    session_override.add(tenant)
    await session_override.flush()
    session_override.add(
        Agent(tenant_id=tenant.id, name="Lead", role="assistant", slug="lead", is_lead=True)
    )
    await session_override.flush()

    async def make_ws(name: str, on_deadline: str) -> Workstream:
        ws = Workstream(tenant_id=tenant.id, name=name)
        session_override.add(ws)
        await session_override.flush()
        session_override.add(
            WorkstreamStep(
                tenant_id=tenant.id,
                workstream_id=ws.id,
                position=0,
                name="Wait",
                kind="wait",
                wait_kind="input",
                deadline_hours=1,
                on_deadline=on_deadline,
            )
        )
        session_override.add(
            WorkstreamStep(
                tenant_id=tenant.id,
                workstream_id=ws.id,
                position=1,
                name="After",
                kind="agent",
                goal="Continue after the wait.",
            )
        )
        await session_override.commit()
        return ws

    ws_continue = await make_ws("Deadline continue", "continue")
    ws_fail = await make_ws("Deadline fail", "fail")

    run_continue = await start_run(
        session_override, tenant.id, ws_continue.id, triggered_by_type="system"
    )
    run_fail = await start_run(
        session_override, tenant.id, ws_fail.id, triggered_by_type="system"
    )
    assert run_continue.status == "waiting"
    assert run_fail.status == "waiting"

    # Force both deadlines into the past and sweep.
    for run in (run_continue, run_fail):
        run.wait_until = datetime.utcnow() - timedelta(minutes=5)
        session_override.add(run)
    await session_override.commit()

    woken = await process_due_run_deadlines(session_override)
    assert woken == 2

    refreshed_continue = (
        await session_override.execute(
            select(WorkstreamRun).where(WorkstreamRun.id == run_continue.id)
        )
    ).scalar_one()
    assert refreshed_continue.status == "completed"

    refreshed_fail = (
        await session_override.execute(
            select(WorkstreamRun).where(WorkstreamRun.id == run_fail.id)
        )
    ).scalar_one()
    assert refreshed_fail.status == "failed"
    # Failure is never silent: a decision offers retry/cancel.
    decisions = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.tenant_id == tenant.id)
        )
    ).scalars().all()
    assert any("failed" in d.title.lower() for d in decisions)


async def _make_project(client: AsyncClient, headers: dict, slug: str) -> str:
    created = await client.post(
        "/api/workforce/projects",
        headers=headers,
        json={"name": slug, "slug": slug, "autonomous_scope": "test scope"},
    )
    assert created.status_code == 200
    return created.json()["id"]


@pytest.mark.asyncio
async def test_project_creation_seeds_default_workstream(client: AsyncClient):
    headers = await _login(client)
    project_id = await _make_project(client, headers, "ws-seed-project")

    listed = await client.get(API, headers=headers, params={"project_id": project_id})
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert len(items) == 1
    assert items[0]["is_default"] is True
    assert items[0]["steps_count"] == 1


@pytest.mark.asyncio
async def test_queue_item_routes_to_run_and_status_follows(
    client: AsyncClient, session_override
):
    """Accepting a queue item starts a run on the project workstream; the
    completed (mock) run completes the item with the run summary."""
    headers = await _login(client)
    project_id = await _make_project(client, headers, "ws-queue-route")

    res = await client.post(
        f"/api/workforce/projects/{project_id}/queue",
        headers=headers,
        json={"kind": "feature", "title": "CSV export", "body": "Add CSV export."},
    )
    assert res.status_code == 200
    item_id = res.json()["id"]

    accepted = await client.patch(
        f"/api/workforce/projects/{project_id}/queue/{item_id}",
        headers=headers,
        json={"status": "queued"},
    )
    assert accepted.status_code == 200

    runs = await client.get(
        f"{API}/runs", headers=headers, params={"project_id": project_id}
    )
    assert runs.status_code == 200
    run_items = runs.json()["items"]
    assert len(run_items) == 1
    run = run_items[0]
    assert run["input_kind"] == "queue_item"
    assert run["input_ref"] == item_id
    assert run["status"] == "completed"

    from uuid import UUID as _UUID

    from app.models.auth import Tenant
    from app.services.project_work import get_queue_item

    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    item = await get_queue_item(session_override, tenant.id, _UUID(item_id))
    assert item.status == "completed"
    assert item.impact_summary
    import json as _json

    ctx = _json.loads(item.context_json or "{}")
    assert ctx.get("workstream_run_id") == run["id"]


@pytest.mark.asyncio
async def test_write_doc_requires_run_context_and_gate_finalizes(
    client: AsyncClient, session_override
):
    """Autonomous agent writes to project docs need a workstream run; a
    section written in a run goes to review and gate approval makes it final."""
    import json as _json
    from uuid import UUID as _UUID

    from app.models.agent import Agent, AgentRun
    from app.models.auth import Tenant
    from app.models.orchestra import WorkstreamRun
    from app.models.workspace import DocSection, WorkspaceDoc
    from app.services.workstreams import resume_run, start_run
    from app.tools import execute_tool

    headers = await _login(client)
    project_id = await _make_project(client, headers, "ws-run-context")
    listed = await client.get(API, headers=headers, params={"project_id": project_id})
    ws_id = listed.json()["items"][0]["id"]

    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()

    doc_input = {
        "path": "projects/ws-run-context/handbook.md",
        "content": "The export runs nightly and lands in the shared drive.",
        "section": "Export process",
        "project_id": project_id,
    }
    # Autonomous write without a run context is refused.
    blocked = await execute_tool(
        session_override, tenant.id, None, "write_doc", dict(doc_input), agent=agent
    )
    assert "workstream run" in str(blocked.get("error", ""))

    # The same write inside a workstream run applies and lands as review.
    run = await start_run(
        session_override,
        tenant.id,
        _UUID(ws_id),
        input_kind="manual",
        triggered_by_type="system",
        advance=False,
    )
    agent_run = AgentRun(
        tenant_id=tenant.id,
        agent_id=agent.id,
        project_id=_UUID(project_id),
        workstream_run_id=run.id,
        status="running",
        trigger_type="workstream",
    )
    session_override.add(agent_run)
    await session_override.commit()

    written = await execute_tool(
        session_override,
        tenant.id,
        None,
        "write_doc",
        dict(doc_input),
        agent=agent,
        run_id=agent_run.id,
        project_id=_UUID(project_id),
    )
    assert not written.get("error")

    doc = (
        await session_override.execute(
            select(WorkspaceDoc).where(
                WorkspaceDoc.tenant_id == tenant.id,
                WorkspaceDoc.path == doc_input["path"],
            )
        )
    ).scalar_one()
    section = (
        await session_override.execute(
            select(DocSection).where(DocSection.doc_id == doc.id, DocSection.heading == "Export process")
        )
    ).scalar_one()
    assert section.status == "review"

    refreshed = (
        await session_override.execute(
            select(WorkstreamRun).where(WorkstreamRun.id == run.id)
        )
    ).scalar_one()
    run_ctx = _json.loads(refreshed.context_json or "{}")
    section_id = section.id
    assert str(section_id) in run_ctx.get("written_section_ids", [])

    # Gate approval promotes the run's written sections to final.
    refreshed.status = "awaiting_gate"
    session_override.add(refreshed)
    await session_override.commit()
    await resume_run(session_override, tenant.id, run.id, advance=False)

    session_override.expire_all()
    section = (
        await session_override.execute(
            select(DocSection).where(DocSection.id == section_id)
        )
    ).scalar_one()
    assert section.status == "final"
    assert section.status_changed_by_id == "workstream_gate"


@pytest.mark.asyncio
async def test_module_template_requirements_block_install(client: AsyncClient):
    """Templates list their unmet requirements; install is refused until met."""
    headers = await _login(client)
    listed = await client.get(
        "/api/integrations/modules/accounting/templates", headers=headers
    )
    assert listed.status_code == 200
    rows = listed.json()["items"]
    vat = next(r for r in rows if r["slug"] == "vat-filing-prep")
    assert vat["installable"] is False
    assert vat["problems"]

    blocked = await client.post(
        "/api/integrations/modules/accounting/templates/vat-filing-prep/install",
        headers=headers,
    )
    assert blocked.status_code == 400
    assert "requirements" in str(blocked.json()).lower()

    unknown = await client.post(
        "/api/integrations/modules/accounting/templates/nope/install", headers=headers
    )
    assert unknown.status_code == 404


@pytest.mark.asyncio
async def test_module_template_install_and_runtime_integrity(
    client: AsyncClient, session_override
):
    """With the module installed and connected, the template copies to the
    tenant; when the connection later disappears, the next run pauses with a
    failure decision instead of failing silently."""
    from app.models.auth import Tenant
    from app.models.integration import IntegrationConnection
    from app.models.module_install import ModuleInstall
    from app.services.module_attach import attach_connection_to_module

    headers = await _login(client)
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()

    session_override.add(
        ModuleInstall(
            tenant_id=tenant.id, module_slug="accounting", install_state="installed"
        )
    )
    conn = IntegrationConnection(
        tenant_id=tenant.id, provider="moneybird", display_name="Moneybird"
    )
    session_override.add(conn)
    await session_override.commit()
    await attach_connection_to_module(session_override, tenant.id, conn.id, "accounting")

    listed = await client.get(
        "/api/integrations/modules/accounting/templates", headers=headers
    )
    vat = next(r for r in listed.json()["items"] if r["slug"] == "vat-filing-prep")
    assert vat["installable"] is True

    installed = await client.post(
        "/api/integrations/modules/accounting/templates/vat-filing-prep/install",
        headers=headers,
    )
    assert installed.status_code == 200
    ws = installed.json()["workstream"]
    assert ws["module_slug"] == "accounting"
    assert ws["template_slug"] == "vat-filing-prep"

    detail = await client.get(f"{API}/{ws['id']}", headers=headers)
    steps = detail.json()["steps"]
    assert [s["kind"] for s in steps] == ["agent", "wait", "gate", "agent"]

    # Second list marks it as already installed.
    listed2 = await client.get(
        "/api/integrations/modules/accounting/templates", headers=headers
    )
    vat2 = next(r for r in listed2.json()["items"] if r["slug"] == "vat-filing-prep")
    assert vat2["already_installed"] is True

    # A healthy run parks on the wait step (first agent step executes).
    run_ok = await client.post(f"{API}/{ws['id']}/runs", headers=headers, json={})
    assert run_ok.status_code == 200
    assert run_ok.json()["status"] == "waiting"

    # Kill the module connection: the runtime integrity check pauses the next
    # run with an error instead of executing.
    conn.status = "revoked"
    session_override.add(conn)
    await session_override.commit()

    run_blocked = await client.post(f"{API}/{ws['id']}/runs", headers=headers, json={})
    assert run_blocked.status_code == 200
    body = run_blocked.json()
    assert body["status"] == "failed"
    assert "integrity" in body["error"].lower()


@pytest.mark.asyncio
async def test_promote_completed_run_creates_task(client: AsyncClient):
    headers = await _login(client)
    ws_id = await _make_workstream(
        client,
        headers,
        "Promotable flow",
        [{"name": "Do work", "kind": "agent", "goal": "Do the work."}],
    )
    run = await client.post(f"{API}/{ws_id}/runs", headers=headers, json={})
    body = run.json()
    assert body["status"] == "completed"

    promoted = await client.post(f"{API}/runs/{body['id']}/promote", headers=headers)
    assert promoted.status_code == 200
    assert promoted.json()["task_id"]
