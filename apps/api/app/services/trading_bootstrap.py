"""Bootstrap MMXM autotrading workspace: trader agent, project, model refresh."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.project import Project, ProjectOrchestration
from app.models.signal import Signal

MMXM_TRADER_NAME = "MMXM Trader"
MMXM_TRADER_SLUG = "mmxm-trader"
MMXM_PROJECT_NAME = "MMXM Trading"
MMXM_PROJECT_SLUG = "mmxm-trading"

RETIRED_MODEL_IDS = {
    "claude-sonnet-4-20250514": "claude-sonnet-4-6",
    "claude-haiku-4-20250514": "claude-haiku-4-5-20251001",
    "claude-opus-4-20250514": "claude-opus-4-8",
}

MMXM_TRADER_PROMPT = """You are MMXM Trader, the autotrading execution agent for this workspace.

You monitor trading setups, trade plans, and pipeline state. When MCP trading tools are connected,
use them to read setup state, validate entries, and report execution status clearly.

Default posture is shadow (dry-run) until the operator explicitly approves live execution.
Always state execution_mode, blockers, and what is needed to go live. Be concise and operational."""


async def refresh_retired_agent_models(session: AsyncSession, tenant_id: UUID) -> int:
    """Replace retired Anthropic model ids on tenant agents."""
    agents = (
        await session.execute(select(Agent).where(Agent.tenant_id == tenant_id))
    ).scalars().all()
    updated = 0
    for agent in agents:
        replacement = RETIRED_MODEL_IDS.get(agent.model or "")
        if replacement:
            agent.model = replacement
            session.add(agent)
            updated += 1
    return updated


async def get_or_create_orchestrator(session: AsyncSession, tenant_id: UUID) -> Agent:
    result = await session.execute(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.role.in_(("orchestrator", "po", "manager")),
        )
    )
    orchestrator = result.scalars().first()
    if orchestrator:
        return orchestrator
    orchestrator = Agent(
        tenant_id=tenant_id,
        name="Demo Project Orchestrator",
        role="orchestrator",
        slug="orchestrator",
        model="claude-sonnet-4-6",
        runtime_status="standby",
        chat_access="everyone",
        system_prompt=(
            "You are the orchestrator for trading operations. Route work to specialists, "
            "track project state, and escalate decisions to the operator."
        ),
    )
    session.add(orchestrator)
    await session.flush()
    return orchestrator


async def get_or_create_mmxm_trader(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    orchestrator_id: UUID | None = None,
) -> Agent:
    result = await session.execute(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.kind == "company",
            Agent.slug == MMXM_TRADER_SLUG,
        )
    )
    trader = result.scalar_one_or_none()
    if not trader:
        by_name = await session.execute(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.name == MMXM_TRADER_NAME,
            )
        )
        trader = by_name.scalar_one_or_none()
    if trader:
        if not trader.slug:
            trader.slug = MMXM_TRADER_SLUG
        if orchestrator_id and trader.parent_agent_id != orchestrator_id:
            trader.parent_agent_id = orchestrator_id
        if not trader.system_prompt.strip():
            trader.system_prompt = MMXM_TRADER_PROMPT
        trader.chat_access = trader.chat_access or "everyone"
        trader.is_active = True
        session.add(trader)
        return trader

    trader = Agent(
        tenant_id=tenant_id,
        name=MMXM_TRADER_NAME,
        role="assistant",
        kind="company",
        slug=MMXM_TRADER_SLUG,
        model="claude-haiku-4-5-20251001",
        runtime_status="standby",
        chat_access="everyone",
        autonomy_level="auto",
        parent_agent_id=orchestrator_id,
        system_prompt=MMXM_TRADER_PROMPT,
        is_active=True,
    )
    session.add(trader)
    await session.flush()
    return trader


async def get_or_create_mmxm_project(
    session: AsyncSession,
    tenant_id: UUID,
    orchestrator_id: UUID,
) -> Project:
    result = await session.execute(
        select(Project).where(
            Project.tenant_id == tenant_id,
            Project.slug == MMXM_PROJECT_SLUG,
        )
    )
    project = result.scalar_one_or_none()
    if project:
        if project.po_agent_id != orchestrator_id:
            project.po_agent_id = orchestrator_id
            session.add(project)
        return project

    project = Project(
        tenant_id=tenant_id,
        name=MMXM_PROJECT_NAME,
        slug=MMXM_PROJECT_SLUG,
        description="Live MMXM autotrading operations.",
        autonomous_scope="Trading pipeline, setups, and execution governance.",
        po_agent_id=orchestrator_id,
    )
    session.add(project)
    await session.flush()
    orch_row = await session.execute(
        select(ProjectOrchestration).where(ProjectOrchestration.project_id == project.id)
    )
    if not orch_row.scalar_one_or_none():
        session.add(ProjectOrchestration(tenant_id=tenant_id, project_id=project.id))
    return project


async def link_signal_to_trading(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    project_id: UUID,
    trader_id: UUID,
) -> Signal | None:
    signal = await session.get(Signal, signal_id)
    if not signal or signal.tenant_id != tenant_id:
        return None
    signal.project_id = project_id
    if not signal.agent_id:
        signal.agent_id = trader_id
    session.add(signal)
    return signal


async def seed_trading_stack(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    link_signal_id: UUID | None = None,
) -> dict[str, str]:
    """Idempotent autotrading bootstrap for staging and production ops."""
    models_updated = await refresh_retired_agent_models(session, tenant_id)
    orchestrator = await get_or_create_orchestrator(session, tenant_id)
    trader = await get_or_create_mmxm_trader(
        session, tenant_id, orchestrator_id=orchestrator.id
    )
    project = await get_or_create_mmxm_project(session, tenant_id, orchestrator.id)
    linked = False
    if link_signal_id:
        linked = (
            await link_signal_to_trading(
                session,
                tenant_id,
                link_signal_id,
                project_id=project.id,
                trader_id=trader.id,
            )
            is not None
        )
    await session.commit()
    return {
        "orchestrator_id": str(orchestrator.id),
        "trader_id": str(trader.id),
        "project_id": str(project.id),
        "models_updated": str(models_updated),
        "signal_linked": str(linked).lower(),
    }
