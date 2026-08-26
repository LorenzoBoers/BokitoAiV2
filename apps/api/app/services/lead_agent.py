"""Lead agent: exactly one company agent per tenant is the default fallback.

The lead agent is an ordinary company agent with a flag — no special slug or
role. Every implicit "pick some assistant" fallback in routing, triggers,
orchestration and threads resolves here so the whole platform shares one
mental model: binding on the item wins, otherwise the lead agent.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent


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
        )
        .order_by(Agent.created_at)
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
        raise HTTPException(status_code=404, detail="Agent not found")
    if not agent.is_active:
        raise HTTPException(status_code=409, detail="A paused agent cannot become the lead agent")

    now = datetime.utcnow()
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


async def ensure_lead_agents(session: AsyncSession) -> None:
    """Startup backfill: every tenant with company agents gets exactly one lead."""
    from app.models.auth import Tenant

    tenant_ids = (await session.execute(select(Tenant.id))).scalars().all()
    changed = False
    for tenant_id in tenant_ids:
        leads = (
            await session.execute(
                select(Agent)
                .where(
                    Agent.tenant_id == tenant_id,
                    Agent.kind == "company",
                    Agent.is_lead.is_(True),
                    Agent.is_active.is_(True),
                )
                .order_by(Agent.created_at)
            )
        ).scalars().all()
        if len(leads) == 1:
            continue
        if len(leads) > 1:
            for extra in leads[1:]:
                extra.is_lead = False
                session.add(extra)
            changed = True
            continue
        candidate = await _lead_candidate(session, tenant_id)
        if candidate:
            candidate.is_lead = True
            session.add(candidate)
            changed = True
    if changed:
        await session.commit()
