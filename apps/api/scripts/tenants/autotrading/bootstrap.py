"""Ops-only autotrading tenant bootstrap (not imported by runtime routers)."""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Membership, Tenant, User, UserPreference
from app.models.integration import McpServer
from app.models.orchestra import Workstream, WorkstreamStep
from app.models.project import Project
from app.models.signal import Signal
from app.models.trigger import Trigger
from app.services.tenant_bootstrap import serialize_settings
from app.services.triggers import compute_next_run, next_cron_run

MMXM_TRADER_NAME = "MMXM Trader"
MMXM_TRADER_SLUG = "mmxm-trader"
STRATEGY_OPTIMIZER_NAME = "Strategy Optimizer"
STRATEGY_OPTIMIZER_SLUG = "strategy-optimizer"
MMXM_PROJECT_NAME = "MMXM Trading"
MMXM_PROJECT_SLUG = "mmxm-trading"
TRADING_MCP_NAME = "Trading pipeline MCP"
STRATEGY_WORKSTREAM_NAME = "MMXM strategy review"
INTRADAY_WORKSTREAM_NAME = "MMXM intraday cycle"
SESSION_DIGEST_TRIGGER = "Trading session digest"
WEEKLY_REVIEW_TRIGGER = "Weekly strategy review"
DEFAULT_OPERATIONS_SIGNAL_ID = "847c0b0e-6bd3-440b-a352-bd1c32701667"

# MCP reads auto; mutating execution stays ask until operator promotes live.
TRADING_MCP_READ_TOOLS = (
    "risk_status",
    "list_setups",
    "get_setup",
    "get_trade_plan",
    "get_market_context",
    "get_positions",
    "execution_status",
    "list_positions",
    "get_account",
    "kill_switch_status",
    "check_live_order",
)
TRADING_MCP_ASK_TOOLS = (
    "place_live_order",
    "update_stop",
    "flatten",
    "cancel_order",
    "submit_order",
)

RETIRED_MODEL_IDS = {
    "claude-sonnet-4-20250514": "claude-sonnet-4-6",
    "claude-haiku-4-20250514": "claude-haiku-4-5-20251001",
    "claude-opus-4-20250514": "claude-opus-4-8",
}

MMXM_TRADER_PROMPT = """You are MMXM Trader, the autotrading execution agent for this workspace.

Trading MCP server name (always use in call_mcp_tool): Trading pipeline MCP

Strategy context (read before inventing rules):
- strategy/mmxm-comprehensive.md — ICT/MMXM process, checklist v2, gates, windows
- strategy/lessons-setup-scans.md — AM bias, no_macro gate, PM vetoes
- strategy/promote-ladder.md — when to stay shadow vs promote
- memory.md — short operational rules

Checklist Q1–Q10 and entry gates are enforced by the deterministic engine (/opt/trading).
Your job: validate via MCP (risk_status first), enter or skip with reason, manage open risk,
and report execution_mode + blockers. Do not rewrite strategy docs; escalate structural changes
to Strategy Optimizer / Govern.

Live DeGiro when risk_status reports execution_mode live and degiro_allow_live_orders true.
AM window NY 09:45-11:15 when session_window_only is true. Max trades/day and SMT from risk_status.
Never bypass kill_switch. Be concise and operational."""

STRATEGY_OPTIMIZER_PROMPT = """You are Strategy Optimizer for the MMXM Autotrading desk.

You own the outer learning loop (Notion §20 / strategy docs):
1. Read Trading pipeline MCP risk_status, positions, and outcome summaries.
2. Compare adherence to strategy/mmxm-comprehensive.md and lessons-setup-scans.md.
3. Update strategy/mmxm-review.md with win/loss patterns, blockers, and proposals.
4. Structural changes (am_only_hard promote, risk caps, live ladder) go through Govern /
   create_decision_request — never silent config edits.
5. Engine inner loop (learned_rules.py) may veto/caution; you document and escalate promotes.

Follow strategy/promote-ladder.md. Prefer shadow until evidence thresholds are met.
Chat commands from the operator in the operations thread: status, freeze ladder, approve promote."""

TRADER_EMAIL = "trader@bokito.ai"

TRADING_WORKSPACE_DOCS: list[tuple[str, str, str]] = [
    (
        "company.md",
        "doc",
        """# MMXM Autotrading

Autonomous ICT/MMXM trading lab: deterministic engine (/opt/trading) + Bokito agent layer.
Operator: Trading Operator (`trader@bokito.ai`).

## Operations
- Symbol focus: NQ (ES/YM for SMT)
- Entry gate default: no_macro (checklist v2; Q7 logged as context)
- Session filter: bias (AM preferred; PM PurgeLunch/PurgeAm auto-veto in policy)
- AM entry window: 09:45-11:15 America/New_York (primary)
- Execution ladder: virtual → shadow → live
- Risk caps and blockers from Trading pipeline MCP `risk_status`
- Operations thread: Messages hub for digests, decisions, and chat commands

## Integrations
- MCP: Trading pipeline MCP (setups, positions, risk_status, execution)
- Bokito bridge webhooks from /opt/trading post decide/manage/report to MMXM Trader

## Agents
- MMXM Trader — execution (webhooks + scans)
- Strategy Optimizer — weekly review + Govern drafts
""",
    ),
    (
        "persona.md",
        "persona",
        """You are MMXM Trader — the autotrading execution specialist for this workspace.

Speak in short, operational sentences. Lead with execution_mode, blockers, and next actions.
Use Trading pipeline MCP before guessing portfolio or setup state. Respect AM window and risk caps.
Escalate structural strategy changes via Govern / human_gate; routine scans and digests post to Messages.
""",
    ),
    (
        "memory.md",
        "memory",
        """## Execution ladder
virtual < shadow < live. Live orders only when `risk_status` allows and AM window is open.

## Risk and caps
Always read `risk_status` from Trading pipeline MCP before entries. Honor max position size and daily loss caps.

## Strategy rules (baseline)
- Symbol: NQ; peers ES/YM for SMT
- Gate: no_macro (do not hard-require Q7)
- session_filter_mode: bias until Govern promotes am_only_hard
- Primary window: AM 09:45-11:15 ET; lunch no trade
- Min RR 1:3; targets T1 internal OC, T2 external draw
- SMT alignment + session context required before entry
- Weekly Strategy Optimizer updates strategy/mmxm-review.md via workstream + human_gate for MEDIUM/HIGH

## Operator chat commands (operations thread)
- status — execution_mode, caps, open risk, blockers
- freeze ladder — hold at shadow; no new live entries
- approve promote — resolve open Govern draft for am_only_hard / live
""",
    ),
    (
        "heartbeat.md",
        "heartbeat",
        """# Trading heartbeat checklist

Keep disabled until pipeline webhooks are live again. When enabled:

- Confirm Trading pipeline MCP risk_status responds without human gate
- Note last webhook decide/manage age; alert if silent > 1 trading day
- Check open positions vs stops
- Surface kill_switch or daily loss blockers in the operations thread
- Reply HEARTBEAT_OK only when nothing needs operator attention
""",
    ),
    (
        "strategy/mmxm-comprehensive.md",
        "doc",
        """# MMXM Comprehensive Strategy Reference (operator digest)

Mirror of Notion MMXM Comprehensive Strategy Reference (§1–§18). Full detail lives in
/opt/trading/context/strategy/mmxm-comprehensive.md. This digest is what agents use.

## Philosophy
- Process over outcome — grade adherence, not PnL (~20–50 trades to optimize)
- Fractal MMXM — OC → sweep → SMR → return to OC on every timeframe
- Liquidity is engineered — purge then revert; trade M+D, avoid accumulation
- Top-down, time-cycle driven; edge = CSD at POI during TOI

## Main drive
- Fractals: week → day → hour → minute
- PXH/PXL purge-and-revert (bearish: purge PXH then PXL; bullish: run PXL then PXH)
- Checklist gate before every entry

## 5-step buy model
1. Bullish HTF order flow + DOL higher (Q2, Q9)
2. LTF sell program into HTF bullish PD array (Q3)
3. MSS + SMT at POI — both required (Q5, Q6)
4. Buy retrace into FVG below MSS, inside macro (Q7, Q8)
5. Stop ~25 pts NQ below SMT low; trail at invalidation

SMT rule: primary need not purge its own low if ES/YM do.

## Decision flow
Environment (Q1 news) → HTF (Q2 flow, Q3 POI, Q4 session+TOI) → LTF (Q5 purge, Q6 CSD, Q7 macro, Q8 gap, Q9 draw, Q10 orderflow) → Execute → Journal

## Sessions (NY)
- AM 9:45–11:15 primary
- Lunch 11:30–13:00 no trades
- PM 12:45–15:15 afternoon scenarios only with caution
- London index 2:30–7:00

## Checklist v2 (engine default)
Q1–Q9 as classic 9Q; Q4 requires mentorship TOI (9:30–10:30 / 13:30–14:30).
Q10 feeling orderflow (bodies hold S/R; delivery matches scenario; SMT agrees).
Entry gates: full (all 10) · no_macro (skip Q7) · core (Q1–Q6). Live default: no_macro.

## Execution
Entry after CSD inside macro. Min RR 1:3. T1 internal OC · T2 external draw.

## Engine
Deterministic path in /opt/trading (app/engine/ict/, strategies/mmxm_nq.yaml).
Bokito agents do not re-implement checklist logic — they call Trading pipeline MCP.
""",
    ),
    (
        "strategy/lessons-setup-scans.md",
        "doc",
        """# Setup-scan lessons and A/B validation

Source: Notion Setup scan lessons + /opt/trading/context/strategy/lessons-setup-scans.md.
Live config: session_filter_mode bias; gate no_macro. Not yet am_only_hard.

## Kernlessen (1 month sample — bias, not hard law)
- AM >> PM (AM strong expectancy; PM PurgeLunch/PurgeAm weak → veto in policy)
- London purge-revert wins; prioritize London scenarios when in window
- Hard-requiring Q7 (strict_full) underperformed → keep no_macro
- 10/10 score is a gate, not a ranking
- Edge in the right tail: losers ~-1R, winners +2–3R → filter bad environments, run winners to T2
- AM-only edge week-stable in W20–W22; flat W23–W24 where baseline failed

## A/B (30d replay NQ+ES+YM)
- baseline loose/no_macro: +2.85R / 11 trades
- am_only: +9.17R / 3 trades (100% win) — sample too small to promote
- strict_full: -2.81R
- am_london: same as am_only on that sample

## 60d validation
First run 2026-06-10: no promote (am_only had 3 trades, minimum 5).
Engine scheduler: run_60d_validation Sundays 20:00 NY. Positive verdict → Govern draft for am_only_hard.

## Agent bias rules (policy)
- Auto-veto PM PurgeLunch / PurgeAm* setups in bias mode
- Prefer AM window entries
- Log Q7 as context; do not hard-fail on Q7 alone
""",
    ),
    (
        "strategy/promote-ladder.md",
        "doc",
        """# Promote ladder (strategy evolution)

Governed path from research → shadow → hard filter → live.

## Levels
1. bias + no_macro (current) — agents weigh lessons; engine soft-vetoes weak PM setups
2. am_only_hard — hard AM window filter in config.yaml after 60d validation passes
3. live ladder — DeGiro live orders when risk_status allows

## Promote bias → am_only_hard
Requires all of:
- Engine run_60d_validation positive (min 5 AM trades, expectancy above baseline)
- Strategy Optimizer Govern draft approved by operator
- No open kill_switch / daily loss breach

## Promote shadow → live
Requires all of:
- Webhooks live (decide/manage firing on trading days)
- Zero rule violations on AM window / SMT / kill_switch during shadow observation
- Explicit operator enable via ops (vps-enable-trading-live) or approved Govern draft
- place_live_order remains ask until posture and overrides say otherwise

## Never silent
Param changes other than trading_windows proposals always need Govern.
Optimizer writes strategy/mmxm-review.md drafts; engine learned_rules may VETO/CAUTION immediately.
""",
    ),
    (
        "strategy/mmxm-review.md",
        "doc",
        """# MMXM Strategy Review

## Purpose
Weekly governed review of win/loss patterns, rule violations, and proposed doc updates.
Author: Strategy Optimizer. MEDIUM/HIGH changes require human_gate.

## Baseline rules (effective)
- Entries inside AM window with MCP-confirmed setup state when session_window_only
- Gate no_macro; session_filter_mode bias until promote
- Shadow default; live only per strategy/promote-ladder.md
- Document material rule changes here; apply via Govern draft

## Operator backlog (superseded acknowledgment)
Historical weekly-review tasks queued 2026-06-27 through 2026-08-30 without gate resolution
are superseded. New reviews start clean from the next Sunday cron. Open MCP decisions for
routine reads should be allowed via tool_overrides (bootstrap).

## Last review
Bootstrap refresh applied — awaiting next Sunday 18:00 Strategy Optimizer run after pipeline liveness.
""",
    ),
]


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
    """Strategy Optimizer (orchestrator) — weekly review + Govern drafts.

    Managed by the trading stack. Archive is respected: seed proposes restore
    via PlatformChange instead of silently reactivating.
    """
    from app.services.managed_resources import ensure_managed_agent

    tenant = await session.get(Tenant, tenant_id)
    if not tenant:
        raise ValueError(f"tenant {tenant_id} not found")

    tools = [
        "list_docs",
        "read_doc",
        "write_doc",
        "search_index",
        "call_mcp_tool",
        "create_decision_request",
        "create_task",
    ]
    fields = {
        "name": STRATEGY_OPTIMIZER_NAME,
        "slug": STRATEGY_OPTIMIZER_SLUG,
        "role": "orchestrator",
        "model": "claude-sonnet-4-6",
        "runtime_status": "standby",
        "chat_access": "everyone",
        "autonomy_level": "assisted",
        "system_prompt": STRATEGY_OPTIMIZER_PROMPT,
        "tools": tools,
    }
    result = await ensure_managed_agent(
        session,
        tenant,
        managed_origin="stack",
        managed_ref="trading",
        template_slug=STRATEGY_OPTIMIZER_SLUG,
        display_label="Trading",
        create_fields=fields,
        patch_fields=fields,
        match_slugs=[STRATEGY_OPTIMIZER_SLUG],
    )
    orchestrator = result.agent
    if orchestrator.model in RETIRED_MODEL_IDS:
        orchestrator.model = RETIRED_MODEL_IDS[orchestrator.model]
        session.add(orchestrator)
        await session.flush()
    return orchestrator


async def get_or_create_mmxm_trader(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    orchestrator_id: UUID | None = None,
) -> Agent:
    """MMXM Trader — managed by the trading stack (archive → Decision, not force)."""
    from app.services.managed_resources import ensure_managed_agent

    tenant = await session.get(Tenant, tenant_id)
    if not tenant:
        raise ValueError(f"tenant {tenant_id} not found")

    fields: dict = {
        "name": MMXM_TRADER_NAME,
        "slug": MMXM_TRADER_SLUG,
        "role": "assistant",
        "model": "claude-haiku-4-5-20251001",
        "runtime_status": "standby",
        "chat_access": "everyone",
        "autonomy_level": "autonomous",
        "system_prompt": MMXM_TRADER_PROMPT,
        "tools": ["call_mcp_tool", "read_doc", "list_docs", "search_index"],
    }
    if orchestrator_id:
        fields["parent_agent_id"] = orchestrator_id

    result = await ensure_managed_agent(
        session,
        tenant,
        managed_origin="stack",
        managed_ref="trading",
        template_slug=MMXM_TRADER_SLUG,
        display_label="Trading",
        create_fields=fields,
        patch_fields=fields,
        match_slugs=[MMXM_TRADER_SLUG],
    )
    trader = result.agent
    if trader.model in RETIRED_MODEL_IDS:
        trader.model = RETIRED_MODEL_IDS[trader.model]
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
        if server_url and server_url != "mock://trading" and server.server_url != server_url:
            server.server_url = server_url
            session.add(server)
        return server

    from app.services.integrations_platform import register_mcp_server

    server, _conn, _binding = await register_mcp_server(
        session,
        tenant_id,
        name=TRADING_MCP_NAME,
        server_url=server_url,
    )
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
        "Run the MMXM intraday cycle via MCP server "
        f'"{TRADING_MCP_NAME}": risk_status first, then list_setups / get_market_context. '
        "Apply lessons (AM bias, veto PM PurgeLunch/PurgeAm). Enter or skip with reason. "
        "Report execution_mode, caps, blockers. Prefer the operations thread for the summary."
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
    "Start the weekly MMXM strategy review workstream (Strategy Optimizer). "
    "Call Trading pipeline MCP risk_status and positions (reads are allow-listed). "
    "Compare outcomes to strategy/mmxm-comprehensive.md and strategy/lessons-setup-scans.md. "
    "Update strategy/mmxm-review.md. Follow strategy/promote-ladder.md for any promote proposals. "
    "MEDIUM/HIGH changes via create_decision_request / human_gate — never silent config edits."
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
    *,
    project_id: UUID | None = None,
) -> Workstream:
    result = await session.execute(
        select(Workstream).where(
            Workstream.tenant_id == tenant_id,
            Workstream.name == STRATEGY_WORKSTREAM_NAME,
        )
    )
    ws = result.scalar_one_or_none()

    if not ws:
        ws = Workstream(
            tenant_id=tenant_id,
            name=STRATEGY_WORKSTREAM_NAME,
            description="Collect outcomes, analyze performance, propose strategy doc updates.",
            enabled=True,
            project_id=project_id,
        )
        session.add(ws)
        await session.flush()
    elif project_id and ws.project_id != project_id:
        ws.project_id = project_id
        session.add(ws)

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
                name=name,
                step_kind=kind,
                handoff_template=template,
                success_criteria_json=json.dumps({"min_length": 20}) if kind == "agent" else "{}",
                eval_kind="rubric" if kind == "agent" else "none",
            )
        )
    await session.flush()
    return ws


async def get_or_create_intraday_workstream(
    session: AsyncSession,
    tenant_id: UUID,
    trader_id: UUID,
    *,
    project_id: UUID | None = None,
) -> Workstream:
    """Intraday cycle playbook: risk → setup → decide → manage → report."""
    result = await session.execute(
        select(Workstream).where(
            Workstream.tenant_id == tenant_id,
            Workstream.name == INTRADAY_WORKSTREAM_NAME,
        )
    )
    ws = result.scalar_one_or_none()
    if not ws:
        ws = Workstream(
            tenant_id=tenant_id,
            name=INTRADAY_WORKSTREAM_NAME,
            description="Risk check, setup validation, enter/skip, manage open risk, report.",
            enabled=True,
            project_id=project_id,
        )
        session.add(ws)
        await session.flush()
    elif project_id and ws.project_id != project_id:
        ws.project_id = project_id
        session.add(ws)

    existing_steps = (
        await session.execute(select(WorkstreamStep).where(WorkstreamStep.workstream_id == ws.id))
    ).scalars().all()
    if existing_steps:
        return ws

    steps_spec = [
        (
            0,
            "Risk status",
            "Call Trading pipeline MCP risk_status. Report execution_mode, caps, kill_switch, blockers.\n\n{{task_description}}",
        ),
        (
            1,
            "Setup scan",
            "list_setups / get_setup / get_market_context. Filter with lessons (AM bias, PM PurgeLunch veto).\n\nPrior:\n{{step_outputs}}",
        ),
        (
            2,
            "Decide",
            "Enter or skip with reason. place_live_order only when risk_status and AM window allow; else shadow/skip.\n\nPrior:\n{{step_outputs}}",
        ),
        (
            3,
            "Manage and report",
            "If open risk: update_stop or flatten when warranted. Post concise status to operations thread.\n\nPrior:\n{{step_outputs}}",
        ),
    ]
    for order, name, template in steps_spec:
        session.add(
            WorkstreamStep(
                tenant_id=tenant_id,
                workstream_id=ws.id,
                order=order,
                agent_id=trader_id,
                name=name,
                step_kind="agent",
                handoff_template=template,
                success_criteria_json=json.dumps({"min_length": 20}),
                eval_kind="rubric",
            )
        )
    await session.flush()
    return ws


async def configure_trading_tool_overrides(session: AsyncSession, tenant_id: UUID) -> int:
    """Allow routine trading MCP reads; keep order mutations on ask."""
    tenant = await session.get(Tenant, tenant_id)
    if not tenant:
        return 0
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    overrides = settings.get("tool_overrides")
    if not isinstance(overrides, dict):
        overrides = {}
    count = 0
    for tool in TRADING_MCP_READ_TOOLS:
        key = f"mcp:{TRADING_MCP_NAME}:{tool}"
        if overrides.get(key) != "allow":
            overrides[key] = "allow"
            count += 1
    for tool in TRADING_MCP_ASK_TOOLS:
        key = f"mcp:{TRADING_MCP_NAME}:{tool}"
        if overrides.get(key) != "ask":
            overrides[key] = "ask"
            count += 1
    # Workspace doc writes for Optimizer and digests.
    for name in ("write_doc", "read_doc", "list_docs", "search_index"):
        if overrides.get(name) != "allow":
            overrides[name] = "allow"
            count += 1
    settings["tool_overrides"] = overrides
    settings.setdefault("autonomy_posture", "assisted")
    tenant.settings_json = serialize_settings(settings)
    session.add(tenant)
    return count


async def supersede_stale_strategy_tasks(
    session: AsyncSession,
    tenant_id: UUID,
    workstream_id: UUID,
) -> int:
    """Cancel queued/stalled weekly review jobs so the backlog does not compound."""
    from app.models.orchestration import AgentTask

    open_statuses = (
        "proposed",
        "queued",
        "analyzing",
        "planned",
        "running",
        "verifying",
        "paused",
        "awaiting_human",
    )
    rows = (
        await session.execute(
            select(AgentTask).where(
                AgentTask.tenant_id == tenant_id,
                AgentTask.workstream_id == workstream_id,
                AgentTask.status.in_(open_statuses),
            )
        )
    ).scalars().all()
    # Also match by title when workstream_id was never set.
    by_title = (
        await session.execute(
            select(AgentTask).where(
                AgentTask.tenant_id == tenant_id,
                AgentTask.status.in_(open_statuses),
                AgentTask.title.ilike("%strategy review%"),
            )
        )
    ).scalars().all()
    seen: set[UUID] = set()
    cancelled = 0
    for task in (*rows, *by_title):
        if task.id in seen:
            continue
        seen.add(task.id)
        task.status = "cancelled"
        task.pause_reason = "superseded_by_mmxm_autonomy_bootstrap"
        session.add(task)
        cancelled += 1
    return cancelled


async def ensure_heartbeat_disabled(session: AsyncSession, tenant_id: UUID) -> None:
    """Keep platform watch off until webhooks are live (fase 4)."""
    result = await session.execute(
        select(Trigger).where(
            Trigger.tenant_id == tenant_id,
            Trigger.kind == "heartbeat",
        )
    )
    for trigger in result.scalars().all():
        if trigger.enabled:
            trigger.enabled = False
            trigger.next_run_at = None
            session.add(trigger)


async def fail_stuck_trading_runs(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    older_than_minutes: int = 20,
) -> int:
    """Mark orphaned agent runs failed (API restart mid-loop leaves them running)."""
    from app.models.agent import AgentRun

    cutoff = datetime.utcnow() - timedelta(minutes=max(5, older_than_minutes))
    rows = (
        await session.execute(
            select(AgentRun).where(
                AgentRun.tenant_id == tenant_id,
                AgentRun.status == "running",
                AgentRun.started_at < cutoff,
            )
        )
    ).scalars().all()
    count = 0
    for run in rows:
        run.status = "failed"
        run.completed_at = datetime.utcnow()
        run.result_json = json.dumps({"error": "stale_running_cleared_by_bootstrap"})
        session.add(run)
        count += 1
    # Clear stale trigger last_status so the next fire is not masked.
    for name in (WEEKLY_REVIEW_TRIGGER, SESSION_DIGEST_TRIGGER, "MMXM pipeline scan"):
        trig = (
            await session.execute(
                select(Trigger).where(Trigger.tenant_id == tenant_id, Trigger.name == name)
            )
        ).scalar_one_or_none()
        if trig and trig.last_status in ("error", "agent_archived"):
            trig.last_status = "reset"
            session.add(trig)
    return count


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


# Paths that keep operator/agent review history — only seed when missing or stub.
PRESERVE_IF_SUBSTANTIAL = frozenset({"strategy/mmxm-review.md"})


async def seed_trading_workspace_docs(session: AsyncSession, tenant_id: UUID) -> int:
    """Upsert trading workspace docs (company, persona, memory, strategy)."""
    from app.services.workspace import get_doc_by_path, upsert_doc

    count = 0
    for path, kind, content in TRADING_WORKSPACE_DOCS:
        if path in PRESERVE_IF_SUBSTANTIAL:
            existing = await get_doc_by_path(session, tenant_id, path)
            if existing and len((existing.content or "").strip()) > 800:
                continue
        await upsert_doc(
            session,
            tenant_id,
            path=path,
            content=content,
            kind=kind,
            created_by_type="system",
            commit=False,
        )
        count += 1
    return count


async def set_trader_default_chat_agent(
    session: AsyncSession, tenant_id: UUID, trader_agent_id: UUID
) -> bool:
    """Set default chat target to MMXM Trader for the trading operator."""
    result = await session.execute(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.tenant_id == tenant_id, User.email == TRADER_EMAIL)
    )
    user = result.scalar_one_or_none()
    if not user:
        return False

    pref_result = await session.execute(
        select(UserPreference).where(
            UserPreference.tenant_id == tenant_id,
            UserPreference.user_id == user.id,
        )
    )
    pref = pref_result.scalar_one_or_none()
    if pref:
        pref.default_chat_agent_id = trader_agent_id
        session.add(pref)
    else:
        session.add(
            UserPreference(
                tenant_id=tenant_id,
                user_id=user.id,
                default_chat_agent_id=trader_agent_id,
            )
        )
    return True


async def configure_trading_tenant_settings(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    operations_signal_id: UUID | None = None,
    strategy_workstream_id: UUID | None = None,
    intraday_workstream_id: UUID | None = None,
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
    if intraday_workstream_id:
        settings["intraday_workstream_id"] = str(intraday_workstream_id)
    settings["learning_enabled"] = True
    settings["orchestra_enabled"] = True
    settings.setdefault("autonomy_posture", "assisted")
    settings["trading_ops"] = {
        "symbol": "NQ",
        "entry_gate": "no_macro",
        "session_filter_mode": "bias",
        "am_window": "09:45-11:15 America/New_York",
        "chat_commands": ["status", "freeze ladder", "approve promote"],
        "heartbeat_until_webhooks_live": False,
    }
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
    mcp_url = (os.environ.get("TRADING_MCP_URL") or "").strip() or "mock://trading"
    mcp = await get_or_create_trading_mcp(session, tenant_id, server_url=mcp_url)
    pipeline_trigger = await get_or_create_trading_pipeline_trigger(session, tenant_id, trader.id)
    digest_trigger = await get_or_create_session_digest_trigger(session, tenant_id, trader.id)
    strategy_ws = await get_or_create_strategy_workstream(
        session, tenant_id, orchestrator.id, project_id=project.id
    )
    intraday_ws = await get_or_create_intraday_workstream(
        session, tenant_id, trader.id, project_id=project.id
    )
    weekly_trigger = await get_or_create_weekly_strategy_trigger(
        session, tenant_id, orchestrator.id, strategy_ws.id
    )
    overrides_set = await configure_trading_tool_overrides(session, tenant_id)
    cancelled = await supersede_stale_strategy_tasks(session, tenant_id, strategy_ws.id)
    stuck_failed = await fail_stuck_trading_runs(session, tenant_id)
    await ensure_heartbeat_disabled(session, tenant_id)
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
        if ops_signal:
            linked = (
                await link_signal_to_trading(
                    session,
                    tenant_id,
                    ops_signal,
                    project_id=project.id,
                    trader_id=trader.id,
                )
                is not None
            )
    await configure_trading_tenant_settings(
        session,
        tenant_id,
        operations_signal_id=ops_signal,
        strategy_workstream_id=strategy_ws.id,
        intraday_workstream_id=intraday_ws.id,
    )
    docs_seeded = await seed_trading_workspace_docs(session, tenant_id)
    default_set = await set_trader_default_chat_agent(session, tenant_id, trader.id)
    await session.commit()
    return {
        "orchestrator_id": str(orchestrator.id),
        "trader_id": str(trader.id),
        "project_id": str(project.id),
        "mcp_server_id": str(mcp.id),
        "pipeline_trigger_id": str(pipeline_trigger.id),
        "digest_trigger_id": str(digest_trigger.id),
        "strategy_workstream_id": str(strategy_ws.id),
        "intraday_workstream_id": str(intraday_ws.id),
        "weekly_review_trigger_id": str(weekly_trigger.id),
        "models_updated": str(models_updated),
        "tool_overrides_touched": str(overrides_set),
        "strategy_tasks_cancelled": str(cancelled),
        "stuck_runs_failed": str(stuck_failed),
        "signal_linked": str(linked).lower(),
        "operations_signal_id": str(ops_signal) if ops_signal else "",
        "workspace_docs_seeded": str(docs_seeded),
        "trader_default_agent_set": str(default_set).lower(),
    }
