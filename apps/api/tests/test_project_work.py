"""Conversation-driven project work: queue lifecycle, doc sections, resources."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.audit import AuditEvent
from app.models.auth import Tenant
from app.models.project import Project
from app.models.project_work import ProjectDocSection
from app.models.signal import Signal, SignalEvent
from app.services import project_work as svc
from app.services.workspace import upsert_doc
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

API = "/api/workforce/projects"


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


async def _project(session, tenant_id, slug="work", autonomous=False) -> Project:
    project = Project(
        tenant_id=tenant_id,
        name=f"Work {slug}",
        slug=slug,
        autonomous_scope="test",
        autonomous_mode=autonomous,
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


DOC = """# Product

## Login flow

Users sign in with email.

## Billing export

Invoices export to the accounting package.
"""


@pytest.mark.asyncio
async def test_doc_section_sync_and_rename(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    project = await _project(session_override, tenant.id, "docs")

    doc = await upsert_doc(
        session_override,
        tenant.id,
        path=f"projects/{project.slug}/product.md",
        content=DOC,
        project_id=project.id,
    )
    assert doc.kind == "project_doc"
    sections = await svc.list_doc_sections(session_override, tenant.id, doc.id)
    assert [s.heading for s in sections] == ["Login flow", "Billing export"]
    assert all(s.status == "open" for s in sections)

    # Mark one section planned, then drop it from the doc: it deprecates, the
    # other keeps its status.
    await svc.set_section_status(
        session_override, tenant.id, sections[1].id, "planned", actor_type="user"
    )
    await upsert_doc(
        session_override,
        tenant.id,
        path=doc.path,
        content="# Product\n\n## Login flow\n\nStill here.\n",
        project_id=project.id,
    )
    rows = (
        await session_override.execute(
            select(ProjectDocSection).where(ProjectDocSection.doc_id == doc.id)
        )
    ).scalars().all()
    by_anchor = {s.anchor: s for s in rows}
    assert by_anchor["login-flow"].status == "open"
    assert by_anchor["billing-export"].status == "deprecated"


@pytest.mark.asyncio
async def test_queue_item_lifecycle_and_audit(client: AsyncClient, session_override, monkeypatch):
    tenant = await _tenant(session_override)
    project = await _project(session_override, tenant.id, "queue")
    signal = Signal(tenant_id=tenant.id, channel="email", subject="Bug report")
    session_override.add(signal)
    await session_override.commit()

    started = []

    async def fake_analysis(session, tenant_id, item):
        started.append(item.id)

    monkeypatch.setattr(svc, "start_queue_item_analysis", fake_analysis)

    item = await svc.create_queue_item(
        session_override,
        tenant.id,
        project.id,
        kind="bug",
        title="Export breaks on VAT",
        body="Customer reported broken export.",
        origin_type="conversation",
        signal_id=signal.id,
        created_by_type="agent",
    )
    assert item.status == "proposed"

    # Thread echo on creation.
    events = (
        await session_override.execute(
            select(SignalEvent).where(SignalEvent.signal_id == signal.id)
        )
    ).scalars().all()
    assert any(e.event_type == "queue_item_created" for e in events)

    # Invalid jump is rejected.
    with pytest.raises(Exception):
        await svc.transition_queue_item(session_override, tenant.id, item.id, "completed")

    item = await svc.transition_queue_item(session_override, tenant.id, item.id, "queued")
    assert item.status == "queued"
    assert started == [item.id]

    for status in ("analyzing", "planned", "running", "verifying", "completed"):
        item = await svc.transition_queue_item(session_override, tenant.id, item.id, status)
    assert item.status == "completed"
    assert item.completed_at is not None

    audits = (
        await session_override.execute(
            select(AuditEvent).where(AuditEvent.resource_id == str(item.id))
        )
    ).scalars().all()
    actions = {a.action for a in audits}
    assert "queue_item:create" in actions
    assert "queue_item:status" in actions


@pytest.mark.asyncio
async def test_autonomous_project_auto_accepts(client: AsyncClient, session_override, monkeypatch):
    tenant = await _tenant(session_override)
    project = await _project(session_override, tenant.id, "auto", autonomous=True)

    started = []

    async def fake_analysis(session, tenant_id, item):
        started.append(item.id)

    monkeypatch.setattr(svc, "start_queue_item_analysis", fake_analysis)

    item = await svc.create_queue_item(
        session_override,
        tenant.id,
        project.id,
        kind="feature",
        title="Add CSV export",
        origin_type="conversation",
        created_by_type="agent",
    )
    refreshed = await svc.get_queue_item(session_override, tenant.id, item.id)
    assert refreshed.status == "queued"
    assert started == [item.id]


@pytest.mark.asyncio
async def test_links_and_section_rollup(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    project = await _project(session_override, tenant.id, "links")
    doc = await upsert_doc(
        session_override,
        tenant.id,
        path=f"projects/{project.slug}/product.md",
        content=DOC,
        project_id=project.id,
    )
    sections = await svc.list_doc_sections(session_override, tenant.id, doc.id)
    item = await svc.create_queue_item(
        session_override, tenant.id, project.id, kind="feature", title="Improve login"
    )
    await svc.link_item_to_section(
        session_override, tenant.id, item.id, sections[0].id, relation="modifies"
    )
    detail = await svc.get_queue_item_detail(session_override, tenant.id, item.id)
    assert detail["links"][0]["heading"] == "Login flow"
    assert detail["links"][0]["relation"] == "modifies"

    rollup = await svc.links_for_sections(session_override, tenant.id, [sections[0].id])
    assert rollup[sections[0].id][0]["title"] == "Improve login"

    await svc.unlink_item_section(session_override, tenant.id, item.id, sections[0].id)
    detail = await svc.get_queue_item_detail(session_override, tenant.id, item.id)
    assert detail["links"] == []


@pytest.mark.asyncio
async def test_project_queue_api_and_resources(client: AsyncClient, session_override):
    headers = await _login(client)
    created = await client.post(
        API,
        headers=headers,
        json={"name": "API Queue", "slug": "api-queue", "autonomous_scope": "ops"},
    )
    assert created.status_code == 200
    project_id = created.json()["id"]

    # Queue endpoints.
    res = await client.post(
        f"{API}/{project_id}/queue",
        headers=headers,
        json={"kind": "feature", "title": "Widget theming", "body": "Allow brand colors."},
    )
    assert res.status_code == 200
    item_id = res.json()["id"]
    assert res.json()["status"] == "proposed"

    listed = await client.get(f"{API}/{project_id}/queue", headers=headers)
    assert listed.status_code == 200
    assert any(i["id"] == item_id for i in listed.json()["items"])

    patched = await client.patch(
        f"{API}/{project_id}/queue/{item_id}",
        headers=headers,
        json={"priority": "high"},
    )
    assert patched.status_code == 200
    assert patched.json()["priority"] == "high"

    rejected = await client.patch(
        f"{API}/{project_id}/queue/{item_id}",
        headers=headers,
        json={"status": "rejected"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"

    # Resource endpoints (generic slot; connectors come later).
    res = await client.post(
        f"{API}/{project_id}/resources",
        headers=headers,
        json={
            "resource_type": "drive",
            "provider": "google_drive",
            "label": "Shared drive",
            "external_ref": "folder-123",
        },
    )
    assert res.status_code == 200
    resource_id = res.json()["id"]
    assert res.json()["status"] == "linked"

    listed = await client.get(f"{API}/{project_id}/resources", headers=headers)
    assert any(r["id"] == resource_id for r in listed.json()["items"])

    removed = await client.delete(
        f"{API}/{project_id}/resources/{resource_id}", headers=headers
    )
    assert removed.status_code == 200

    # Project docs endpoint returns docs plus their section statuses.
    res = await client.post(
        f"{API}/{project_id}/docs",
        headers=headers,
        json={"path": "product", "content": DOC, "title": "Product"},
    )
    assert res.status_code == 200
    docs = await client.get(f"{API}/{project_id}/docs", headers=headers)
    assert docs.status_code == 200
    payload = docs.json()["docs"]
    assert payload and payload[0]["sections"][0]["status"] == "open"


@pytest.mark.asyncio
async def test_document_level_queue_link_and_shared_doc(client: AsyncClient, session_override):
    """Same WorkspaceDoc via project + workspace APIs; document-level TaskDocLink."""
    tenant = await _tenant(session_override)
    project = await _project(session_override, tenant.id, "hub-docs")
    headers = await _login(client)

    created = await client.post(
        f"{API}/{project.id}/docs",
        headers=headers,
        json={
            "path": "overview",
            "content": "# Overview\n\n## Scope\n\nShared knowledge.\n",
            "title": "Overview",
        },
    )
    assert created.status_code == 200
    doc = created.json()
    doc_id = doc["id"]
    assert doc["project_id"] == str(project.id)
    assert "linked_requests" in doc

    via_workspace = await client.get(f"/api/workspace/docs/{doc_id}", headers=headers)
    assert via_workspace.status_code == 200
    assert via_workspace.json()["content"].startswith("# Overview")
    assert via_workspace.json()["project_id"] == str(project.id)

    listed_project = await client.get(
        "/api/workspace/docs",
        headers=headers,
        params={"project_id": str(project.id)},
    )
    assert listed_project.status_code == 200
    assert any(d["id"] == doc_id for d in listed_project.json()["docs"])

    org_only = await client.get("/api/workspace/docs", headers=headers)
    assert org_only.status_code == 200
    assert all(d["id"] != doc_id for d in org_only.json()["docs"])

    queue = await client.post(
        f"{API}/{project.id}/queue",
        headers=headers,
        json={"title": "Clarify scope", "kind": "task", "body": "Update overview."},
    )
    assert queue.status_code == 200
    item_id = queue.json()["id"]

    link = await client.post(
        f"{API}/{project.id}/docs/{doc_id}/links",
        headers=headers,
        json={"queue_item_id": item_id, "relation": "modifies"},
    )
    assert link.status_code == 200
    assert link.json()["doc_id"] == doc_id

    refreshed = await client.get(f"/api/workspace/docs/{doc_id}", headers=headers)
    assert refreshed.status_code == 200
    requests = refreshed.json().get("linked_requests") or []
    assert any(r["id"] == item_id for r in requests)

    project_docs = await client.get(f"{API}/{project.id}/docs", headers=headers)
    assert project_docs.status_code == 200
    match = next(d for d in project_docs.json()["docs"] if d["id"] == doc_id)
    assert any(r["id"] == item_id for r in match.get("linked_requests") or [])


@pytest.mark.asyncio
async def test_agent_scoped_workspace_doc(client: AsyncClient, session_override):
    from app.models.agent import Agent

    tenant = await _tenant(session_override)
    headers = await _login(client)
    agent = Agent(tenant_id=tenant.id, name="Scoped Agent", role="assistant")
    session_override.add(agent)
    await session_override.commit()
    await session_override.refresh(agent)

    created = await client.post(
        "/api/workspace/docs",
        headers=headers,
        json={
            "path": f"agents/{str(agent.id)[:8]}/notes.md",
            "content": "# Agent notes\n\nPersonal scratch.\n",
            "kind": "doc",
            "agent_id": str(agent.id),
        },
    )
    assert created.status_code == 200
    doc = created.json()
    assert doc["agent_id"] == str(agent.id)
    assert doc["project_id"] is None

    listed = await client.get(
        "/api/workspace/docs",
        headers=headers,
        params={"agent_id": str(agent.id)},
    )
    assert listed.status_code == 200
    assert any(d["id"] == doc["id"] for d in listed.json()["docs"])

    org = await client.get("/api/workspace/docs", headers=headers)
    assert all(d["id"] != doc["id"] for d in org.json()["docs"])
