"""Lead agent: exactly one company agent per tenant is the default fallback.

The lead agent is an ordinary company agent with a flag — no special slug or
role. Every implicit "pick some assistant" fallback in routing, triggers,
orchestration and threads resolves here so the whole platform shares one
mental model: binding on the item wins, otherwise the lead agent.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.exceptions import NotFoundError
from app.models.agent import Agent

# Titles the wizard used before the company assistant had a fixed function name.
LEGACY_LEAD_JOB_TITLES = frozenset({"", "onboarding specialist", "assistant", "assistent"})


def company_assistant_job_title(language: str | None) -> str:
    """Function line under the lead's name. The display name stays the owner's."""
    lang = (language or "").strip().lower()
    if lang.startswith("en"):
        return "Company assistant"
    return "Bedrijfsassistent"


async def _lead_candidate(session: AsyncSession, tenant_id: UUID) -> Agent | None:
    """Best agent to act as lead when no flag is set: oldest active company
    assistant, else oldest active company agent."""
    result = await session.execute(
        select(Agent)
        .where(
            Agent.tenant_id == tenant_id,
            Agent.kind == "company",
            Agent.role == "assistant",
            Agent.is_active.is_(True),
            Agent.acts_for_user.is_(False),
        )
        .order_by(Agent.is_lead.desc(), Agent.created_at)
        .limit(1)
    )
    agent = result.scalars().first()
    if agent:
        return agent
    result = await session.execute(
        select(Agent)
        .where(
            Agent.tenant_id == tenant_id,
            Agent.kind == "company",
            Agent.is_active.is_(True),
            Agent.acts_for_user.is_(False),
        )
        .order_by(Agent.created_at)
        .limit(1)
    )
    return result.scalars().first()


async def get_lead_agent(session: AsyncSession, tenant_id: UUID) -> Agent | None:
    """The tenant's lead agent (read-only; falls back to the best candidate).

    Returns None only for tenants without any active company agent.
    """
    result = await session.execute(
        select(Agent)
        .where(
            Agent.tenant_id == tenant_id,
            Agent.kind == "company",
            Agent.is_lead.is_(True),
            Agent.is_active.is_(True),
            Agent.acts_for_user.is_(False),
        )
        .order_by(Agent.created_at)
        .limit(1)
    )
    lead = result.scalars().first()
    if lead:
        return lead
    return await _lead_candidate(session, tenant_id)


async def set_lead_agent(
    session: AsyncSession, tenant_id: UUID, agent_id: UUID, *, commit: bool = True
) -> Agent:
    """Move the lead flag to `agent_id` atomically (exactly one lead per tenant)."""
    result = await session.execute(
        select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
    )
    agent = result.scalar_one_or_none()
    if not agent or agent.kind != "company":
        raise NotFoundError("Agent not found")
    if agent.acts_for_user:
        raise HTTPException(status_code=409, detail="The Bokito helper cannot be the lead agent")
    if not agent.is_active:
        raise HTTPException(status_code=409, detail="A paused agent cannot become the lead agent")

    now = utcnow()
    current = await session.execute(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.is_lead.is_(True),
            Agent.id != agent.id,
        )
    )
    for row in current.scalars().all():
        row.is_lead = False
        row.updated_at = now
        session.add(row)
    if not agent.is_lead:
        agent.is_lead = True
        agent.updated_at = now
    session.add(agent)
    if commit:
        await session.commit()
        await session.refresh(agent)
    return agent


async def _settle_company_assistant(session: AsyncSession, agent: Agent, language: str | None) -> bool:
    """Give the lead the company-assistant title when it still has a wizard default, and a seat on All."""
    from app.services.teams import ensure_agent_on_all

    changed = False
    if (agent.job_title or "").strip().lower() == "onboarding specialist":
        agent.job_title = company_assistant_job_title(language)
        session.add(agent)
        changed = True
    if await ensure_agent_on_all(session, agent.tenant_id, agent.id):
        changed = True
    return changed


async def ensure_lead_agents(session: AsyncSession) -> None:
    """Startup backfill: every tenant with company agents gets exactly one lead."""
    from app.models.auth import Tenant
    from app.services.workspaces_portal import parse_settings

    tenants = (await session.execute(select(Tenant))).scalars().all()
    changed = False
    for tenant in tenants:
        language = str(parse_settings(tenant).get("ai_workspace_language") or "")
        leads = (
            await session.execute(
                select(Agent)
                .where(
                    Agent.tenant_id == tenant.id,
                    Agent.kind == "company",
                    Agent.is_lead.is_(True),
                    Agent.is_active.is_(True),
                )
                .order_by(Agent.created_at)
            )
        ).scalars().all()
        lead: Agent | None = None
        if len(leads) > 1:
            for extra in leads[1:]:
                extra.is_lead = False
                session.add(extra)
            changed = True
            lead = leads[0]
        elif len(leads) == 1:
            lead = leads[0]
        else:
            lead = await _lead_candidate(session, tenant.id)
            if lead:
                lead.is_lead = True
                session.add(lead)
                changed = True
        if lead is not None and await _settle_company_assistant(session, lead, language):
            changed = True
    if changed:
        await session.commit()
