"""Bootstrap backfill: the lead agent is always reachable by the team."""

from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.services.tenant_bootstrap import ONBOARDING_SYSTEM_PROMPT, ensure_front_desk, ensure_front_desks


async def test_front_desk_has_description_and_is_reachable(session_override):
    tenant = Tenant(slug="fd", name="FD")
    session_override.add(tenant)
    await session_override.commit()

    agent = await ensure_front_desk(session_override, tenant.id, commit=True)
    assert agent.is_lead is True
    assert agent.chat_access == "everyone"
    assert "First reply" in agent.description


async def test_backfill_opens_unreachable_leads(session_override):
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
        is_lead=True,
        chat_access="nobody",
    )
    worker = Agent(
        tenant_id=tenant.id,
        name="Worker",
        role="assistant",
        kind="company",
        slug="worker",
        system_prompt="x",
        is_lead=False,
        chat_access="nobody",
    )
    session_override.add_all([lead, worker])
    await session_override.commit()

    await ensure_front_desks(session_override)

    await session_override.refresh(lead)
    await session_override.refresh(worker)
    assert lead.chat_access == "everyone"
    assert worker.chat_access == "nobody"
    # Front desk was added next to the existing lead without taking the flag.
    front_desk = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.slug == "front-desk")
        )
    ).scalar_one()
    assert front_desk.is_lead is False


def test_onboarding_prompt_asks_for_a_brief():
    assert "update_agent" in ONBOARDING_SYSTEM_PROMPT
    assert "description" in ONBOARDING_SYSTEM_PROMPT
    assert "Govern" in ONBOARDING_SYSTEM_PROMPT
