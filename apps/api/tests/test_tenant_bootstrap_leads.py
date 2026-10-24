"""Bootstrap backfill: purge Front desk, keep the lead agent reachable."""

from app.models.agent import Agent
from app.models.auth import Tenant
from app.services.tenant_bootstrap import (
    ONBOARDING_SYSTEM_PROMPT,
    ensure_front_desks,
    purge_front_desk_agents,
)


async def test_purge_front_desk_archives_it(session_override):
    tenant = Tenant(slug="fd", name="FD")
    session_override.add(tenant)
    await session_override.flush()
    front = Agent(
        tenant_id=tenant.id,
        name="Front desk",
        role="assistant",
        kind="company",
        slug="front-desk",
        system_prompt="x",
        chat_access="everyone",
        is_active=True,
    )
    keep = Agent(
        tenant_id=tenant.id,
        name="Kantoor AI",
        role="assistant",
        kind="company",
        slug="kantoor-ai",
        system_prompt="x",
        chat_access="everyone",
        is_active=True,
    )
    session_override.add_all([front, keep])
    await session_override.commit()

    n = await purge_front_desk_agents(session_override, commit=True)
    assert n == 1
    await session_override.refresh(front)
    assert front.kind == "archived"
    assert front.is_active is False


async def test_backfill_opens_unreachable_leads_and_purges_front_desk(session_override):
    tenant = Tenant(slug="lead", name="Lead")
    session_override.add(tenant)
    await session_override.flush()
    lead = Agent(
        tenant_id=tenant.id,
        name="Kantoor AI",
        role="assistant",
        kind="company",
        slug="kantoor-ai",
        system_prompt="x",
        chat_access="nobody",
    )
    worker = Agent(
        tenant_id=tenant.id,
        name="Worker",
        role="assistant",
        kind="company",
        slug="worker",
        system_prompt="x",
        chat_access="nobody",
    )
    front = Agent(
        tenant_id=tenant.id,
        name="Front desk",
        role="assistant",
        kind="company",
        slug="front-desk",
        system_prompt="x",
        chat_access="everyone",
    )
    session_override.add_all([lead, worker, front])
    await session_override.commit()

    await ensure_front_desks(session_override)

    await session_override.refresh(lead)
    await session_override.refresh(worker)
    await session_override.refresh(front)
    assert lead.chat_access == "everyone"
    assert worker.chat_access == "nobody"
    assert front.kind == "archived"
    assert front.is_active is False


def test_onboarding_prompt_asks_for_a_brief():
    assert "update_agent" in ONBOARDING_SYSTEM_PROMPT
    assert "description" in ONBOARDING_SYSTEM_PROMPT
    assert "Govern" in ONBOARDING_SYSTEM_PROMPT
