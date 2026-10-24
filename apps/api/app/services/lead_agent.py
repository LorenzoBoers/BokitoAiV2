"""Lead agent: the point of contact of the organization root.

The lead is an ordinary company agent that sits on the root department with
duty primary. Every implicit "pick some assistant" fallback in routing,
triggers, orchestration and threads resolves here so the whole platform shares
one mental model: binding on the item wins, otherwise the organization's point
of contact.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.exceptions import NotFoundError, status_error
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
    """Best agent to act as lead when the root has none: oldest active company
    assistant, else oldest active company agent."""
    base = (
        Agent.tenant_id == tenant_id,
        Agent.kind == "company",
        Agent.is_active.is_(True),
        Agent.acts_for_user.is_(False),
    )
    agent = (
        await session.execute(
            select(Agent).where(*base, Agent.role == "assistant").order_by(Agent.created_at).limit(1)
        )
    ).scalars().first()
    if agent:
        return agent
    return (
        await session.execute(select(Agent).where(*base).order_by(Agent.created_at).limit(1))
    ).scalars().first()


async def lead_agent_id(session: AsyncSession, tenant_id: UUID) -> UUID | None:
    lead = await get_lead_agent(session, tenant_id)
    return lead.id if lead else None


async def get_lead_agent(session: AsyncSession, tenant_id: UUID) -> Agent | None:
    """The organization's point of contact (falls back to the best candidate).

    Returns None only for tenants without any active company agent.
    """
    from app.services.department_access import department_contact
    from app.services.teams import ensure_org_root

    root = await ensure_org_root(session, tenant_id)
    lead, _implicit = await department_contact(session, tenant_id, root.id)
    if lead is not None:
        return lead
    return await _lead_candidate(session, tenant_id)


async def set_lead_agent(
    session: AsyncSession, tenant_id: UUID, agent_id: UUID, *, commit: bool = True
) -> Agent:
    """Make `agent_id` the organization's point of contact (one per tenant)."""
    from app.services.teams import edit_department_crew, ensure_org_root, with_member

    agent = (
        await session.execute(select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if not agent or agent.kind != "company":
        raise NotFoundError("Agent not found")
    if agent.acts_for_user:
        raise status_error(status_code=409, detail="The Bokito helper cannot be the lead agent")
    if not agent.is_active:
        raise status_error(status_code=409, detail="A paused agent cannot become the lead agent")

    root = await ensure_org_root(session, tenant_id)
    await edit_department_crew(session, root, lambda crew: with_member(crew, "agent", agent.id, "contact"))
    agent.updated_at = utcnow()
    session.add(agent)
    await session.flush()
    if commit:
        await session.commit()
        await session.refresh(agent)
    return agent


async def ensure_lead_agents(session: AsyncSession) -> None:
    """Startup backfill: every tenant with company agents has an organization point of contact."""
    from app.models.auth import Tenant
    from app.services.department_access import department_roles
    from app.services.teams import ensure_org_root
    from app.services.workspaces_portal import parse_settings

    tenants = (await session.execute(select(Tenant))).scalars().all()
    changed = False
    for tenant in tenants:
        root = await ensure_org_root(session, tenant.id)
        roles = await department_roles(session, tenant.id, root.id)
        lead = await session.get(Agent, roles["contact_agent_id"]) if roles["contact_agent_id"] else None
        if lead is None or roles["contact_implicit"]:
            lead = lead or await _lead_candidate(session, tenant.id)
            if lead is None:
                continue
            await set_lead_agent(session, tenant.id, lead.id, commit=False)
            changed = True
        language = str(parse_settings(tenant).get("ai_workspace_language") or "")
        if (lead.job_title or "").strip().lower() == "onboarding specialist":
            lead.job_title = company_assistant_job_title(language)
            session.add(lead)
            changed = True
    if changed:
        await session.commit()
