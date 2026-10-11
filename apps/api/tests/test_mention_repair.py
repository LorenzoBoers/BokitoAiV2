"""Agent speech: mention chips are repaired before the bubble is stored."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.services.agent.mention_repair import repair_mentions


async def _tenant_agent(session) -> tuple[Tenant, Agent]:
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (await session.execute(select(Agent).where(Agent.tenant_id == tenant.id))).scalars().first()
    assert agent is not None
    return tenant, agent


@pytest.mark.asyncio
async def test_invented_id_and_brackets_become_a_real_chip(client, session_override):
    tenant, agent = await _tenant_agent(session_override)
    text = f"**{agent.name}** [@[{agent.name}](agent:made_up_slug)] helps you."
    out = await repair_mentions(session_override, tenant.id, text)
    assert out == f"@[{agent.name}](agent:{agent.id}) helps you."


@pytest.mark.asyncio
async def test_unknown_agent_degrades_to_plain_name(client, session_override):
    tenant, _ = await _tenant_agent(session_override)
    out = await repair_mentions(session_override, tenant.id, "Ask @[Nobody Here](agent:nobody).")
    assert out == "Ask Nobody Here."


@pytest.mark.asyncio
async def test_valid_chips_stay_untouched(client, session_override):
    tenant, agent = await _tenant_agent(session_override)
    text = f"Ask @[{agent.name}](agent:{agent.id}) or @[Sanne](user:12345)."
    assert await repair_mentions(session_override, tenant.id, text) == text
