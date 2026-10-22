"""OS overlay graph is gone: no HTTP routes, no agent tools. Govern apply stays a no-op."""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.tools.registry import get_tool_spec


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_os_graph_http_is_gone(client: AsyncClient):
    headers = await _auth_headers(client)
    for method, path in (
        ("get", "/api/workforce/os/graph"),
        ("get", f"/api/workforce/os/graph/{uuid4()}"),
        ("post", "/api/workforce/os/nodes"),
        ("post", "/api/workforce/os/edges"),
        ("patch", f"/api/workforce/os/nodes/{uuid4()}"),
        ("delete", f"/api/workforce/os/nodes/{uuid4()}"),
        ("delete", f"/api/workforce/os/edges/{uuid4()}"),
    ):
        res = await getattr(client, method)(path, headers=headers)
        assert res.status_code == 404, f"{method} {path} -> {res.status_code}"


def test_os_graph_tools_are_unregistered():
    for name in ("add_graph_node", "connect_graph_nodes"):
        assert get_tool_spec(name) is None


@pytest.mark.asyncio
async def test_os_graph_govern_apply_is_noop(session_override):
    from app.services.platform_apply import apply_canvas_edge_change, apply_canvas_node_change

    tenant = (await session_override.execute(select(Tenant).limit(1))).scalar_one_or_none()
    if tenant is None:
        tenant = Tenant(slug=f"gapply-{uuid4().hex[:8]}", name="Apply")
        session_override.add(tenant)
        await session_override.commit()
        await session_override.refresh(tenant)

    node = await apply_canvas_node_change(
        session_override, tenant.id, {"node_type": "agent", "ref_id": str(uuid4())}
    )
    edge = await apply_canvas_edge_change(
        session_override,
        tenant.id,
        {"source_node_id": str(uuid4()), "target_node_id": str(uuid4()), "relation": "uses"},
    )
    assert node["status"] == "retired"
    assert edge["status"] == "retired"
