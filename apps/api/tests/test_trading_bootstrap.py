"""Tests for autotrading workspace bootstrap."""

import json

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.trigger import Trigger
from app.services.workspace import get_doc_by_path
from scripts.tenants.autotrading.bootstrap import (
    INTRADAY_WORKSTREAM_NAME,
    MMXM_PROJECT_SLUG,
    MMXM_TRADER_SLUG,
    STRATEGY_OPTIMIZER_SLUG,
    STRATEGY_WORKSTREAM_NAME,
    TRADING_MCP_NAME,
    seed_trading_stack,
)


@pytest.mark.asyncio
async def test_seed_trading_stack_idempotent(session_override):
    tenant = Tenant(slug="trading-test", name="Trading Test")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    first = await seed_trading_stack(session_override, tenant.id)
    second = await seed_trading_stack(session_override, tenant.id)

    assert first["trader_id"] == second["trader_id"]
    assert first["project_id"] == second["project_id"]
    assert first["intraday_workstream_id"] == second["intraday_workstream_id"]

    trader = (
        await session_override.execute(
            select(Agent).where(
                Agent.tenant_id == tenant.id,
                Agent.slug == MMXM_TRADER_SLUG,
            )
        )
    ).scalar_one()
    assert trader.model == "claude-haiku-4-5-20251001"
    assert trader.chat_access == "everyone"
    assert "strategy/mmxm-comprehensive.md" in trader.system_prompt

    optimizer = (
        await session_override.execute(
            select(Agent).where(
                Agent.tenant_id == tenant.id,
                Agent.slug == STRATEGY_OPTIMIZER_SLUG,
            )
        )
    ).scalar_one()
    assert optimizer.is_active is True
    assert str(optimizer.id) == first["orchestrator_id"]

    project = (
        await session_override.execute(
            select(Project).where(
                Project.tenant_id == tenant.id,
                Project.slug == MMXM_PROJECT_SLUG,
            )
        )
    ).scalar_one()
    assert project.po_agent_id is not None
    assert str(project.po_agent_id) == first["orchestrator_id"]

    ws_names = {
        w.name
        for w in (
            await session_override.execute(
                select(Workstream).where(Workstream.tenant_id == tenant.id)
            )
        ).scalars()
    }
    assert STRATEGY_WORKSTREAM_NAME in ws_names
    assert INTRADAY_WORKSTREAM_NAME in ws_names

    weekly = (
        await session_override.execute(
            select(Trigger).where(
                Trigger.tenant_id == tenant.id,
                Trigger.name == "Weekly strategy review",
            )
        )
    ).scalar_one()
    assert weekly.agent_id == optimizer.id
    assert weekly.enabled is True

    comprehensive = await get_doc_by_path(session_override, tenant.id, "strategy/mmxm-comprehensive.md")
    assert comprehensive is not None
    promote = await get_doc_by_path(session_override, tenant.id, "strategy/promote-ladder.md")
    assert promote is not None

    await session_override.refresh(tenant)
    settings = json.loads(tenant.settings_json or "{}")
    overrides = settings.get("tool_overrides") or {}
    assert overrides.get(f"mcp:{TRADING_MCP_NAME}:risk_status") == "allow"
    assert overrides.get(f"mcp:{TRADING_MCP_NAME}:place_live_order") == "ask"
    assert settings.get("trading_ops", {}).get("session_filter_mode") == "bias"
