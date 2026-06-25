"""Tests for autotrading workspace bootstrap."""

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.project import Project
from scripts.tenants.autotrading.bootstrap import (
    MMXM_PROJECT_SLUG,
    MMXM_TRADER_SLUG,
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
