"""Ops-only autotrading tenant bootstrap (not imported by runtime routers)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.integration import McpServer
from app.models.orchestra import Workstream, WorkstreamStep
from app.models.project import Project, ProjectOrchestration
from app.models.signal import Signal
from app.models.trigger import Trigger
from app.services.orchestration.bootstrap import seed_tenant_runtime_profiles
from app.services.tenant_bootstrap import serialize_settings
from app.services.triggers import compute_next_run, next_cron_run

MMXM_TRADER_NAME = "MMXM Trader"
MMXM_TRADER_SLUG = "mmxm-trader"
MMXM_PROJECT_NAME = "MMXM Trading"
MMXM_PROJECT_SLUG = "mmxm-trading"
TRADING_MCP_NAME = "Trading pipeline MCP"
STRATEGY_WORKSTREAM_NAME = "MMXM strategy review"
SESSION_DIGEST_TRIGGER = "Trading session digest"
WEEKLY_REVIEW_TRIGGER = "Weekly strategy review"
DEFAULT_OPERATIONS_SIGNAL_ID = "847c0b0e-6bd3-440b-a352-bd1c32701667"

RETIRED_MODEL_IDS = {
    "claude-sonnet-4-20250514": "claude-sonnet-4-6",
    "claude-haiku-4-20250514": "claude-haiku-4-5-20251001",
    "claude-opus-4-20250514": "claude-opus-4-8",
}

MMXM_TRADER_PROMPT = """You are MMXM Trader, the autotrading execution agent for this workspace.

Trading MCP server name (always use in call_mcp_tool): Trading pipeline MCP

You monitor trading setups, trade plans, and pipeline state. When MCP trading tools are connected,
use them to read setup state, validate entries, and report execution status clearly.

Default posture follows risk_status: shadow until live is enabled; when live, place orders only inside caps and AM window.
Always state execution_mode, blockers, and what is needed to trade. Be concise and operational."""


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


async def get_or_create_trading_mcp(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    server_url: str = "mock://trading",
) -> McpServer:
    """Register tenant-scoped trading MCP (mock locally, real URL in prod ops)."""
    result = await session.execute(
        select(McpServer).where(
            McpServer.tenant_id == tenant_id,
            McpServer.name == TRADING_MCP_NAME,
        )
    )
    server = result.scalar_one_or_none()
    if server:
        if server_url and not server.server_url.startswith("mock://") and server.server_url != server_url:
            server.server_url = server_url
            session.add(server)
        return server

    server = McpServer(
        tenant_id=tenant_id,
        name=TRADING_MCP_NAME,
        server_url=server_url,
        auth_json="{}",
        is_active=True,
    )
    session.add(server)
    await session.flush()
    return server


async def get_or_create_trading_pipeline_trigger(
    session: AsyncSession,
    tenant_id: UUID,
    trader_id: UUID,
) -> Trigger:
    """Background heartbeat: trader scans setups via MCP on an interval."""
    result = await session.execute(
        select(Trigger).where(
            Trigger.tenant_id == tenant_id,
            Trigger.name == "MMXM pipeline scan",
        )
    )
    trigger = result.scalar_one_or_none()
    instructions = (
        "Run a trading pipeline scan. Call MCP server "
        f'"{TRADING_MCP_NAME}" tools: risk_status, list_setups, get_market_context. '
        "Report actionable setups, blockers, and execution_mode. "
        "Use delegate_to_agent only when handing off to another tenant agent."
    )
    if trigger:
        trigger.agent_id = trader_id
        trigger.instructions = instructions
        trigger.enabled = True
        session.add(trigger)
        return trigger

    trigger = Trigger(
        tenant_id=tenant_id,
        name="MMXM pipeline scan",
        kind="interval",
        interval_minutes=15,
        agent_id=trader_id,
        instructions=instructions,
        enabled=True,
        next_run_at=datetime.utcnow() + timedelta(minutes=5),
    )
    session.add(trigger)
    await session.flush()
    return trigger


SESSION_DIGEST_INSTRUCTIONS = (
    "End-of-session trading digest. Always post a summary (never suppress). "
    f'Call MCP "{TRADING_MCP_NAME}" tools: get_positions, risk_status, list_setups (if available), '
    "execution_status or equivalent. Summarize: execution_mode, open positions, trades today, "
    "realized PnL, blockers, and tomorrow prep. Be concise and operational."
)


WEEKLY_REVIEW_INSTRUCTIONS = (
    "Start the weekly MMXM strategy review workstream. Review last 7 days of operational outcomes, "
    "win/loss patterns, rule violations, and MCP risk_status. Propose governed updates via write_doc "
    "to strategy/mmxm-review.md. Escalate material changes through human_gate."
)


async def get_or_create_session_digest_trigger(
    session: AsyncSession,
    tenant_id: UUID,
    trader_id: UUID,
) -> Trigger:
    result = await session.execute(
        select(Trigger).where(
            Trigger.tenant_id == tenant_id,
            Trigger.name == SESSION_DIGEST_TRIGGER,
        )
    )
    trigger = result.scalar_one_or_none()
    if trigger:
        trigger.agent_id = trader_id
        trigger.instructions = SESSION_DIGEST_INSTRUCTIONS
        trigger.kind = "cron"
        trigger.cron_expr = "0 16 * * *"
        trigger.enabled = True
        trigger.next_run_at = compute_next_run(trigger)
        session.add(trigger)
        return trigger

    trigger = Trigger(
        tenant_id=tenant_id,
        name=SESSION_DIGEST_TRIGGER,
        kind="cron",
        cron_expr="0 16 * * *",
        agent_id=trader_id,
        instructions=SESSION_DIGEST_INSTRUCTIONS,
        enabled=True,
        next_run_at=next_cron_run("0 16 * * *", datetime.utcnow()),
    )
    session.add(trigger)
    await session.flush()
    return trigger


async def get_or_create_strategy_workstream(
    session: AsyncSession,
    tenant_id: UUID,
    orchestrator_id: UUID,
) -> Workstream:
    result = await session.execute(
        select(Workstream).where(
            Workstream.tenant_id == tenant_id,
            Workstream.name == STRATEGY_WORKSTREAM_NAME,
        )
    )
    ws = result.scalar_one_or_none()
    profiles = await seed_tenant_runtime_profiles(session, tenant_id)
    executor_profile = profiles.get("executor-standard")

    if not ws:
        ws = Workstream(
            tenant_id=tenant_id,
            name=STRATEGY_WORKSTREAM_NAME,
            description="Collect outcomes, analyze performance, propose strategy doc updates.",
            enabled=True,
        )
        session.add(ws)
        await session.flush()

    existing_steps = (
        await session.execute(
            select(WorkstreamStep).where(WorkstreamStep.workstream_id == ws.id)
        )
    ).scalars().all()
    if existing_steps:
        return ws

    steps_spec = [
        (
            0,
            "Collect outcomes",
            "agent",
            "Gather last 7 days of operational outcomes and MCP risk_status / performance metrics.\n\n{{task_description}}",
        ),
        (
            1,
            "Analyze patterns",
            "agent",
            "Analyze win/loss patterns, rule violations, and recurring blockers from prior step output.\n\n{{step_outputs}}",
        ),
        (
            2,
            "Propose strategy update",
            "agent",
            "Draft strategy/mmxm-review.md updates via write_doc. Default to assisted posture (Govern draft).\n\n{{step_outputs}}",
        ),
        (
            3,
            "Operator approval",
            "human_gate",
            "Review proposed strategy changes and approve or reject before apply.",
        ),
    ]
    for order, name, kind, template in steps_spec:
        session.add(
            WorkstreamStep(
                tenant_id=tenant_id,
                workstream_id=ws.id,
                order=order,
                agent_id=orchestrator_id if kind != "human_gate" else None,
                runtime_profile_id=executor_profile.id if executor_profile and kind == "agent" else None,
                name=name,
                step_kind=kind,
                handoff_template=template,
                success_criteria_json=json.dumps({"min_length": 20}) if kind == "agent" else "{}",
                eval_kind="rubric" if kind == "agent" else "none",
            )
        )
    await session.flush()
    return ws


async def get_or_create_weekly_strategy_trigger(
    session: AsyncSession,
    tenant_id: UUID,
    orchestrator_id: UUID,
    workstream_id: UUID,
) -> Trigger:
    result = await session.execute(
        select(Trigger).where(
            Trigger.tenant_id == tenant_id,
            Trigger.name == WEEKLY_REVIEW_TRIGGER,
        )
    )
    trigger = result.scalar_one_or_none()
    if trigger:
        trigger.agent_id = orchestrator_id
        trigger.workstream_id = workstream_id
        trigger.instructions = WEEKLY_REVIEW_INSTRUCTIONS
        trigger.kind = "cron"
        trigger.cron_expr = "0 18 * * 0"
        trigger.enabled = True
        trigger.next_run_at = compute_next_run(trigger)
        session.add(trigger)
        return trigger

    trigger = Trigger(
        tenant_id=tenant_id,
        name=WEEKLY_REVIEW_TRIGGER,
        kind="cron",
        cron_expr="0 18 * * 0",
        agent_id=orchestrator_id,
        workstream_id=workstream_id,
        instructions=WEEKLY_REVIEW_INSTRUCTIONS,
        enabled=True,
        next_run_at=next_cron_run("0 18 * * 0", datetime.utcnow()),
    )
    session.add(trigger)
    await session.flush()
    return trigger


async def configure_trading_tenant_settings(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    operations_signal_id: UUID | None = None,
    strategy_workstream_id: UUID | None = None,
) -> None:
    tenant = await session.get(Tenant, tenant_id)
    if not tenant:
        return
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    if operations_signal_id:
        settings["operations_signal_id"] = str(operations_signal_id)
    if strategy_workstream_id:
        settings["strategy_workstream_id"] = str(strategy_workstream_id)
    settings["learning_enabled"] = True
    settings.setdefault("autonomy_posture", "assisted")
    tenant.settings_json = serialize_settings(settings)
    session.add(tenant)


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
    mcp = await get_or_create_trading_mcp(session, tenant_id)
    pipeline_trigger = await get_or_create_trading_pipeline_trigger(session, tenant_id, trader.id)
    digest_trigger = await get_or_create_session_digest_trigger(session, tenant_id, trader.id)
    strategy_ws = await get_or_create_strategy_workstream(session, tenant_id, orchestrator.id)
    weekly_trigger = await get_or_create_weekly_strategy_trigger(
        session, tenant_id, orchestrator.id, strategy_ws.id
    )
    linked = False
    ops_signal = link_signal_id
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
        ops_signal = link_signal_id
    elif DEFAULT_OPERATIONS_SIGNAL_ID:
        try:
            ops_signal = UUID(DEFAULT_OPERATIONS_SIGNAL_ID)
        except ValueError:
            ops_signal = None
    await configure_trading_tenant_settings(
        session,
        tenant_id,
        operations_signal_id=ops_signal,
        strategy_workstream_id=strategy_ws.id,
    )
    await session.commit()
    return {
        "orchestrator_id": str(orchestrator.id),
        "trader_id": str(trader.id),
        "project_id": str(project.id),
        "mcp_server_id": str(mcp.id),
        "pipeline_trigger_id": str(pipeline_trigger.id),
        "digest_trigger_id": str(digest_trigger.id),
        "strategy_workstream_id": str(strategy_ws.id),
        "weekly_review_trigger_id": str(weekly_trigger.id),
        "models_updated": str(models_updated),
        "signal_linked": str(linked).lower(),
        "operations_signal_id": str(ops_signal) if ops_signal else "",
    }
