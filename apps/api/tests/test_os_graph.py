import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.notification import DecisionRequest


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _seed_project(session_override, tenant_id) -> Project:
    po = Agent(
        tenant_id=tenant_id,
        name="Test Orchestrator",
        role="orchestrator",
        slug="orchestrator",
        runtime_status="standby",
        system_prompt="Orchestrator",
    )
    session_override.add(po)
    await session_override.flush()
    project = Project(
        tenant_id=tenant_id,
        name="OS Graph Project",
        slug="os-graph",
        autonomous_scope="Test scope for graph",
        po_agent_id=po.id,
        github_repo_full_name="test/repo",
        repo_index_status="ready",
    )
    session_override.add(project)
    await session_override.flush()
    session_override.add(
        Workstream(
            tenant_id=tenant_id,
            project_id=project.id,
            name="Build",
            description="Build pipeline",
            enabled=True,
        )
    )
    session_override.add(
        DecisionRequest(
            tenant_id=tenant_id,
            project_id=project.id,
            title="Approve change",
            summary="Approve change",
            status="awaiting_human",
            options_json="[]",
        )
    )
    await session_override.commit()
    return project


@pytest.mark.asyncio
async def test_canvas_graph_auto_seed(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    await _seed_project(session_override, tenant.id)

    res = await client.get("/api/workforce/os/graph", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert "nodes" in body
    assert "edges" in body
    assert isinstance(body["nodes"], list)
    assert len(body["nodes"]) >= 2
    types = {n["node_type"] for n in body["nodes"]}
    assert "orchestrator" in types
    assert "workstream" in types


@pytest.mark.asyncio
async def test_canvas_node_patch_and_edge_crud(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    await _seed_project(session_override, tenant.id)

    graph = (await client.get("/api/workforce/os/graph", headers=headers)).json()
    nodes = graph["nodes"]
    assert len(nodes) >= 2
    orch = next(n for n in nodes if n["node_type"] == "orchestrator")
    ws = next(n for n in nodes if n["node_type"] == "workstream")

    patch = await client.patch(
        f"/api/workforce/os/nodes/{orch['id']}",
        headers=headers,
        json={"x": 400.0, "y": 120.0},
    )
    assert patch.status_code == 200
    assert patch.json()["x"] == 400.0

    # Remove seeded edge then recreate
    existing = graph["edges"]
    if existing:
        del_res = await client.delete(
            f"/api/workforce/os/edges/{existing[0]['id']}",
            headers=headers,
        )
        assert del_res.status_code == 200

    edge_res = await client.post(
        "/api/workforce/os/edges",
        headers=headers,
        json={
            "source_node_id": ws["id"],
            "target_node_id": orch["id"],
            "relation": "routed_by",
        },
    )
    assert edge_res.status_code == 200
    assert edge_res.json()["relation"] == "routed_by"

    bad_edge = await client.post(
        "/api/workforce/os/edges",
        headers=headers,
        json={
            "source_node_id": orch["id"],
            "target_node_id": ws["id"],
            "relation": "uses_repo",
        },
    )
    assert bad_edge.status_code == 400


@pytest.mark.asyncio
async def test_project_graph_legacy_still_available(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    project = await _seed_project(session_override, tenant.id)

    res = await client.get(f"/api/workforce/os/graph/{project.id}", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert "nodes" in body
    assert body["project"]["id"] == str(project.id)
