"""One connection per vendor account, project links and connection access."""

import json
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.integration import IntegrationConnection
from app.models.project import Project
from app.services.connection_instance import (
    claim_instance_key,
    converge_duplicate_instances,
    instance_key_for,
)
from app.services.module_attach import attach_connection_to_module


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = Tenant(slug=f"scope-{uuid4().hex[:8]}", name="Scope")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


async def _moneybird(
    session: AsyncSession, tenant: Tenant, *, name: str = "Moneybird", key: str = ""
) -> IntegrationConnection:
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="moneybird",
        display_name=name,
        status="active",
        instance_key=key,
        credentials_json='{"access_token":"tok"}',
        metadata_json=json.dumps({"last_verified_at": "2026-01-01T00:00:00+00:00"}),
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return conn


async def _project(session: AsyncSession, tenant: Tenant, name: str) -> Project:
    project = Project(tenant_id=tenant.id, name=name, slug=name.lower().replace(" ", "-"))
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


async def _agent(session: AsyncSession, tenant: Tenant) -> Agent:
    agent = Agent(tenant_id=tenant.id, name=f"Agent {uuid4().hex[:4]}")
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return agent


def test_instance_key_is_lowest_vendor_id():
    admins = [{"id": "424242424242424242"}, {"id": "9"}, {"id": ""}]
    assert instance_key_for("moneybird", administrations=admins) == "9"
    assert instance_key_for("moneybird", administrations=[]) == ""
    assert instance_key_for("github", administrations=admins) == ""


@pytest.mark.asyncio
async def test_reconnect_same_administration_reuses_row(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    first = await _moneybird(session_override, tenant, name="Moneybird", key="123")
    await attach_connection_to_module(session_override, tenant.id, first.id, "accounting")
    second = await _moneybird(session_override, tenant, name="Moneybird (2)")
    second.credentials_json = '{"access_token":"newer"}'

    survivor = await claim_instance_key(session_override, tenant.id, second, "123")
    await session_override.commit()

    assert survivor.id == first.id
    await session_override.refresh(second)
    await session_override.refresh(first)
    assert second.status == "merged"
    assert first.status == "active"
    from app.services.crypto import get_connection_credentials

    assert get_connection_credentials(first)["access_token"] == "newer"


@pytest.mark.asyncio
async def test_converge_collapses_existing_duplicates(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    keep = await _moneybird(session_override, tenant, key="77")
    dupe = await _moneybird(session_override, tenant, name="Moneybird (2)")
    # Simulate a row resolved later to the same administration.
    dupe.instance_key = ""
    await session_override.commit()

    async def fake_live(_session, _tenant_id, conn):
        return "77"

    import app.services.connection_instance as ci

    original = ci._resolve_key_live
    ci._resolve_key_live = fake_live
    try:
        folded = await converge_duplicate_instances(session_override, tenant.id)
    finally:
        ci._resolve_key_live = original
    assert folded == 1
    await session_override.refresh(dupe)
    await session_override.refresh(keep)
    assert dupe.status == "merged"
    assert keep.instance_key == "77"


@pytest.mark.asyncio
async def test_project_link_makes_connection_exclusive(session_override: AsyncSession):
    from app.services.connection_scope import set_connection_projects, usable_connection_ids

    tenant = await _tenant(session_override)
    conn = await _moneybird(session_override, tenant)
    client_a = await _project(session_override, tenant, "Client A")
    client_b = await _project(session_override, tenant, "Client B")
    agent = await _agent(session_override, tenant)
    await set_connection_projects(session_override, tenant.id, conn, [str(client_a.id)])
    await session_override.commit()

    usable, _ = await usable_connection_ids(
        session_override, tenant.id, [conn.id], agent_id=agent.id, project_id=client_a.id
    )
    assert usable == {str(conn.id)}
    usable, denied = await usable_connection_ids(
        session_override, tenant.id, [conn.id], agent_id=agent.id, project_id=client_b.id
    )
    assert usable == set()
    assert "Client A" in denied[str(conn.id)]
    usable, denied = await usable_connection_ids(
        session_override, tenant.id, [conn.id], agent_id=agent.id, project_id=None
    )
    assert usable == set()
    # Operator listings (no agent) still see everything.
    usable, _ = await usable_connection_ids(
        session_override, tenant.id, [conn.id], agent_id=None, project_id=None
    )
    assert usable == {str(conn.id)}


@pytest.mark.asyncio
async def test_project_linked_connection_is_picked_inside_project(session_override: AsyncSession):
    from app.modules.accounting.router import _resolve_connection, scoped_accounting_connections
    from app.services.connection_scope import set_connection_projects

    tenant = await _tenant(session_override)
    shared = await _moneybird(session_override, tenant, name="Shared")
    client = await _moneybird(session_override, tenant, name="Client A books")
    for conn in (shared, client):
        await attach_connection_to_module(session_override, tenant.id, conn.id, "accounting")
    project = await _project(session_override, tenant, "Client A")
    agent = await _agent(session_override, tenant)
    await set_connection_projects(session_override, tenant.id, client, [str(project.id)])
    await session_override.commit()

    usable, denied, linked = await scoped_accounting_connections(
        session_override, tenant.id, agent_id=agent.id, project_id=project.id
    )
    assert {c.id for c in usable} == {str(shared.id), str(client.id)}
    picked = _resolve_connection(usable, {}, project_linked=linked)
    assert getattr(picked, "id", None) == str(client.id)

    usable, denied, linked = await scoped_accounting_connections(
        session_override, tenant.id, agent_id=agent.id, project_id=None
    )
    assert [c.id for c in usable] == [str(shared.id)]
    assert str(client.id) in denied


@pytest.mark.asyncio
async def test_access_list_denies_agent_without_use(session_override: AsyncSession):
    from app.services.connection_access import set_connection_access, user_level
    from app.services.connection_scope import usable_connection_ids

    tenant = await _tenant(session_override)
    conn = await _moneybird(session_override, tenant)
    allowed = await _agent(session_override, tenant)
    other = await _agent(session_override, tenant)
    await set_connection_access(
        session_override, conn, [{"kind": "agent", "id": str(allowed.id), "level": "use"}]
    )
    await session_override.commit()

    usable, denied = await usable_connection_ids(
        session_override, tenant.id, [conn.id], agent_id=allowed.id, project_id=None
    )
    assert usable == {str(conn.id)}
    usable, denied = await usable_connection_ids(
        session_override, tenant.id, [conn.id], agent_id=other.id, project_id=None
    )
    assert usable == set() and str(conn.id) in denied
    assert await user_level(session_override, conn, user_id=uuid4(), role="owner") == "manage"
    assert await user_level(session_override, conn, user_id=uuid4(), role="admin") == "manage"


@pytest.mark.asyncio
async def test_provider_listing_rows_carry_scope(session_override: AsyncSession):
    from app.services.connection_scope import set_connection_projects
    from app.services.provider_connections import list_provider_connections

    tenant = await _tenant(session_override)
    conn = await _moneybird(session_override, tenant, key="555")
    await attach_connection_to_module(session_override, tenant.id, conn.id, "accounting")
    project = await _project(session_override, tenant, "Sales")
    await set_connection_projects(session_override, tenant.id, conn, [str(project.id)])
    await session_override.commit()

    import app.services.connection_instance as ci

    ci._converged_tenants.add(tenant.id)
    rows = await list_provider_connections(
        session_override, tenant.id, "moneybird", user_id=uuid4(), role="owner"
    )
    assert len(rows) == 1
    row = rows[0]
    assert row["status"] == "ready"
    assert row["instance_key"] == "555"
    assert row["attached_modules"] == ["accounting"]
    assert row["projects"] == [{"id": str(project.id), "name": "Sales"}]
    assert row["can_manage"] is True

    member_rows = await list_provider_connections(
        session_override, tenant.id, "moneybird", user_id=uuid4(), role="member"
    )
    assert member_rows[0]["can_manage"] is False
    assert member_rows[0]["can_use"] is True


@pytest.mark.asyncio
async def test_rename_without_module(session_override: AsyncSession):
    from app.services.provider_connections import rename_connection

    tenant = await _tenant(session_override)
    conn = await _moneybird(session_override, tenant)
    result = await rename_connection(session_override, tenant.id, conn, "Client A books")
    assert result["display_name"] == "Client A books"


@pytest.mark.asyncio
async def test_set_connection_scope_tool_asks_and_applies(session_override: AsyncSession):
    from app.tools.registry import ToolContext, get_tool_spec

    spec = get_tool_spec("set_connection_scope")
    assert spec is not None and spec.consequential and spec.gated

    tenant = await _tenant(session_override)
    conn = await _moneybird(session_override, tenant)
    project = await _project(session_override, tenant, "Client B")
    agent = await _agent(session_override, tenant)
    ctx = ToolContext(session=session_override, tenant_id=tenant.id, user_id=None, agent=agent)

    result = await spec.handler(
        ctx,
        {
            "connection_id": str(conn.id),
            "project_ids": [str(project.id)],
            "access": [{"kind": "agent", "id": str(agent.id), "level": "use"}],
        },
    )
    assert result["ok"] is True
    assert result["projects"] == [{"id": str(project.id), "name": "Client B"}]
    assert result["access_default"] is False
    assert result["access"] == [{"kind": "agent", "id": str(agent.id), "level": "use"}]

    missing = await spec.handler(ctx, {"connection_id": str(conn.id)})
    assert "error" in missing
