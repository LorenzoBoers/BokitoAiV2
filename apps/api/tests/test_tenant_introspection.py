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
    assert all(a.get("name") != "Bokito" for a in snapshot["agents"])
    assert any(t.get("system") for t in snapshot.get("teams") or [])
    assert any(p["name"] == "MMXM Trading" for p in snapshot["projects"])
    assert any(t["name"] == "Pipeline scan" for t in snapshot["triggers"])
    assert "open_decisions" in snapshot
    assert "decisions" in snapshot
    assert isinstance(snapshot["decisions"], list)
    assert "running_tasks" in snapshot

    prompt = format_tenant_snapshot_prompt(snapshot)
    assert "## Tenant snapshot" in prompt
    assert "MMXM Trading" in prompt
    assert "Pipeline scan" in prompt
    assert "Modules:" in prompt
    assert "accounting — not installed" in prompt
    assert "Teams" in prompt
    assert "@[Bokito](agent:" not in prompt
    assert len(prompt) < 2200

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


@pytest.mark.asyncio
async def test_list_threads_summary_filters_by_ticket_tag(client: AsyncClient, session_override):
    from app.models.orchestra import Workstream
    from app.models.signal import Signal, SignalTag
    from app.services.tenant_introspection import list_threads_summary

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    flow = Workstream(tenant_id=tenant.id, name="Bugs")
    session_override.add(flow)
    await session_override.flush()
    bug = SignalTag(tenant_id=tenant.id, name="bug", workstream_id=flow.id)
    feature = SignalTag(tenant_id=tenant.id, name="feature", workstream_id=flow.id)
    session_override.add(bug)
    session_override.add(feature)
    await session_override.flush()
    session_override.add(
        Signal(
            tenant_id=tenant.id,
            channel="internal",
            status="open",
            subject="Login broken",
            ticket_tag_id=bug.id,
            stage_key="open",
        )
    )
    session_override.add(
        Signal(
            tenant_id=tenant.id,
            channel="internal",
            status="open",
            subject="Dark mode",
            ticket_tag_id=feature.id,
            stage_key="open",
        )
    )
    session_override.add(
        Signal(
            tenant_id=tenant.id,
            channel="internal",
            status="open",
            subject="Unrelated chat",
        )
    )
    await session_override.commit()

    bugs = await list_threads_summary(session_override, tenant.id, tag="bug")
    assert bugs["matched"] == 1
    assert bugs["threads"][0]["subject"] == "Login broken"
    assert bugs["threads"][0]["ticket_tag"] == "bug"

    both = await list_threads_summary(session_override, tenant.id, tag="bug,feature")
    assert both["matched"] == 2
    subjects = {row["subject"] for row in both["threads"]}
    assert subjects == {"Login broken", "Dark mode"}

    missing = await list_threads_summary(session_override, tenant.id, tag="no_such_label")
    assert missing["matched"] == 0
    assert missing["unknown_tags"] == ["no_such_label"]
