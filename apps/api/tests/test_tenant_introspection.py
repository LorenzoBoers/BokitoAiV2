"""Tenant snapshot + read-only introspection tools."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.project import Project
from app.models.trigger import Trigger
from app.services.agent.tools import execute_tool
from app.services.tenant_introspection import (
    build_tenant_snapshot_prompt,
    collect_tenant_snapshot,
    format_tenant_snapshot_prompt,
)
from app.services.workspace import build_workspace_context


@pytest.mark.asyncio
async def test_collect_tenant_snapshot_includes_agents_projects(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    session_override.add(
        Project(
            tenant_id=tenant.id,
            name="MMXM Trading",
            slug="mmxm-trading",
            description="Automatic trading pipeline",
        )
    )
    session_override.add(
        Trigger(
            tenant_id=tenant.id,
            name="Pipeline scan",
            kind="interval",
            interval_minutes=15,
            enabled=True,
            last_status="ok",
        )
    )
    await session_override.commit()

    snapshot = await collect_tenant_snapshot(session_override, tenant.id)
    assert any(a["name"] for a in snapshot["agents"])
    assert any(p["name"] == "MMXM Trading" for p in snapshot["projects"])
    assert any(t["name"] == "Pipeline scan" for t in snapshot["triggers"])
    assert "open_decisions" in snapshot
    assert "running_tasks" in snapshot

    prompt = format_tenant_snapshot_prompt(snapshot)
    assert "## Tenant snapshot" in prompt
    assert "MMXM Trading" in prompt
    assert "Pipeline scan" in prompt
    assert "Modules:" in prompt
    assert "accounting — not connected" in prompt
    assert len(prompt) < 1800

    live_prompt = await build_tenant_snapshot_prompt(session_override, tenant.id)
    assert "## Tenant snapshot" in live_prompt


@pytest.mark.asyncio
async def test_get_tenant_overview_tool(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id).limit(1)
        )
    ).scalar_one()
    agent.tools_json = json.dumps(
        [
            "get_tenant_overview",
            "list_recent_activity",
            "list_tasks",
            "list_threads",
            "get_usage_summary",
        ]
    )
    await session_override.commit()

    overview = await execute_tool(
        session_override,
        tenant.id,
        None,
        "get_tenant_overview",
        {},
        agent=agent,
    )
    assert "error" not in overview
    assert "agents" in overview
    assert "projects" in overview
    assert "triggers" in overview
    assert "usage" in overview

    activity = await execute_tool(
        session_override,
        tenant.id,
        None,
        "list_recent_activity",
        {"limit": 5},
        agent=agent,
    )
    assert "error" not in activity
    assert "items" in activity

    tasks = await execute_tool(
        session_override,
        tenant.id,
        None,
        "list_tasks",
        {"limit": 5},
        agent=agent,
    )
    assert "error" not in tasks
    assert "tasks" in tasks


@pytest.mark.asyncio
async def test_workspace_context_includes_tenant_snapshot(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    ctx = await build_workspace_context(session_override, tenant.id)
    assert "## Tenant snapshot" in ctx
