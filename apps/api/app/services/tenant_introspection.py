"""Read-only tenant introspection for agent system prompts and tools.

Agents need a live view of the tenant (agents, projects, triggers, open work)
without inventing parallel query stacks — this module reuses existing models
and cockpit helpers.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _schedule_label(kind: str, cron_expr: str, interval_minutes: int) -> str:
    if kind == "cron" and cron_expr:
        return f"cron {cron_expr}"
    if kind in ("interval", "heartbeat") and interval_minutes:
        return f"every {interval_minutes}m"
    if kind == "webhook":
        return "webhook"
    return kind or "schedule"


async def collect_tenant_snapshot(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    """Structured snapshot used by tools and the compact prompt block."""
    from app.models.agent import Agent, AgentRun
    from app.models.integration import IntegrationConnection, McpServer
    from app.models.notification import DecisionRequest
    from app.models.orchestration import AgentTask
    from app.models.project import Project
    from app.models.signal import Signal
    from app.models.trigger import Trigger

    agents_rows = (
        await session.execute(
            select(Agent)
            .where(Agent.tenant_id == tenant_id)
            .order_by(Agent.name)
            .limit(40)
        )
    ).scalars().all()
    agents = [
        {
            "id": str(a.id),
            "name": a.name,
            "role": a.role,
            "kind": a.kind,
            "is_active": bool(a.is_active),
            "slug": getattr(a, "slug", None) or "",
        }
        for a in agents_rows
    ]

    projects_rows = (
        await session.execute(
            select(Project)
            .where(Project.tenant_id == tenant_id)
            .order_by(Project.name)
            .limit(20)
        )
    ).scalars().all()
    projects = [
        {
            "id": str(p.id),
            "name": p.name,
            "slug": p.slug,
            "description": (p.description or "")[:160],
        }
        for p in projects_rows
    ]

    triggers_rows = (
        await session.execute(
            select(Trigger)
            .where(Trigger.tenant_id == tenant_id, Trigger.enabled.is_(True))
            .order_by(Trigger.name)
            .limit(30)
        )
    ).scalars().all()
    triggers = [
        {
            "id": str(t.id),
            "name": t.name,
            "kind": t.kind,
            "schedule": _schedule_label(t.kind, t.cron_expr, t.interval_minutes),
            "last_status": t.last_status or "",
            "last_run_at": _iso(t.last_run_at),
            "next_run_at": _iso(t.next_run_at),
        }
        for t in triggers_rows
    ]

    open_decisions = (
        await session.execute(
            select(func.count())
            .select_from(DecisionRequest)
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.status == "awaiting_human",
            )
        )
    ).scalar_one()

    running_tasks = (
        await session.execute(
            select(func.count())
            .select_from(AgentTask)
            .where(
                AgentTask.tenant_id == tenant_id,
                AgentTask.status.in_(("queued", "running", "paused", "awaiting_decision")),
            )
        )
    ).scalar_one()

    open_internal_threads = (
        await session.execute(
            select(func.count())
            .select_from(Signal)
            .where(
                Signal.tenant_id == tenant_id,
                Signal.channel == "internal",
                Signal.status.in_(("open", "pending")),
            )
        )
    ).scalar_one()

    integrations_rows = (
        await session.execute(
            select(IntegrationConnection)
            .where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.status == "active",
            )
            .order_by(IntegrationConnection.provider)
            .limit(20)
        )
    ).scalars().all()
    integrations = [
        {
            "provider": c.provider,
            "display_name": c.display_name or c.provider,
            "status": c.status,
        }
        for c in integrations_rows
    ]

    mcp_rows = (
        await session.execute(
            select(McpServer)
            .where(McpServer.tenant_id == tenant_id, McpServer.is_active.is_(True))
            .order_by(McpServer.name)
            .limit(20)
        )
    ).scalars().all()
    mcp_servers = []
    accounting_connections: list[dict[str, Any]] = []
    for m in mcp_rows:
        # Accounting-module connections are surfaced as module capacity, not as
        # MCP servers with vendor tool names (agents use accounting_* tools).
        if m.server_url.startswith(("native://king-accountancy", "native://bjorn-lunden")):
            accounting_connections.append({"name": m.name, "server_url": m.server_url})
            continue
        try:
            cached_tools = json.loads(m.tools_json or "[]")
        except (json.JSONDecodeError, TypeError):
            cached_tools = []
        tool_names = [
            str(t.get("name"))
            for t in cached_tools
            if isinstance(t, dict) and t.get("name")
        ]
        mcp_servers.append(
            {"name": m.name, "server_url": m.server_url, "tools": tool_names[:40]}
        )
    for c in integrations_rows:
        if c.provider == "moneybird":
            accounting_connections.append(
                {"name": c.display_name or "Moneybird", "server_url": "native://moneybird"}
            )

    recent_runs_count = (
        await session.execute(
            select(func.count())
            .select_from(AgentRun)
            .where(AgentRun.tenant_id == tenant_id)
        )
    ).scalar_one()

    from app.modules.catalog import serialize_modules_for_tenant

    modules = await serialize_modules_for_tenant(session, tenant_id)

    return {
        "agents": agents,
        "projects": projects,
        "triggers": triggers,
        "open_decisions": int(open_decisions or 0),
        "running_tasks": int(running_tasks or 0),
        "open_internal_threads": int(open_internal_threads or 0),
        "integrations": integrations,
        "mcp_servers": mcp_servers,
        "accounting_connections": accounting_connections,
        "modules": modules,
        "agent_runs_total": int(recent_runs_count or 0),
    }


def format_tenant_snapshot_prompt(snapshot: dict[str, Any], *, max_chars: int = 2000) -> str:
    """Compact markdown for the agent system prompt."""
    lines: list[str] = ["## Tenant snapshot"]

    agents = snapshot.get("agents") or []
    if agents:
        bits = []
        for a in agents[:12]:
            flag = "active" if a.get("is_active") else "paused"
            bits.append(f"{a.get('name')} ({a.get('role')}/{a.get('kind')}, {flag})")
        lines.append("Agents: " + "; ".join(bits))
    else:
        lines.append("Agents: none")

    projects = snapshot.get("projects") or []
    if projects:
        bits = []
        for p in projects[:8]:
            desc = (p.get("description") or "").strip()
            bits.append(f"{p.get('name')}" + (f" — {desc[:60]}" if desc else ""))
        lines.append("Projects: " + "; ".join(bits))
    else:
        lines.append("Projects: none")

    triggers = snapshot.get("triggers") or []
    if triggers:
        bits = []
        for t in triggers[:10]:
            status = t.get("last_status") or "n/a"
            last = (t.get("last_run_at") or "")[:16]
            bits.append(
                f"{t.get('name')} [{t.get('schedule')}, last={status}"
                + (f" @{last}" if last else "")
                + "]"
            )
        lines.append("Triggers: " + "; ".join(bits))
    else:
        lines.append("Triggers: none")

    lines.append(
        "Open: "
        f"{snapshot.get('open_decisions', 0)} decisions, "
        f"{snapshot.get('running_tasks', 0)} tasks, "
        f"{snapshot.get('open_internal_threads', 0)} internal threads"
    )

    integ = [i.get("display_name") or i.get("provider") for i in (snapshot.get("integrations") or [])]
    mcp = [m.get("name") for m in (snapshot.get("mcp_servers") or [])]
    connected = [n for n in [*integ, *mcp] if n]
    lines.append("Connected: " + (", ".join(connected[:12]) if connected else "none"))

    accounting = snapshot.get("accounting_connections") or []
    if accounting:
        names = ", ".join(str(c.get("name") or "") for c in accounting[:4])
        lines.append(
            f"Accounting: {len(accounting)} connection(s) ({names}) — use the "
            "accounting_* tools; start with accounting_list_companies."
        )

    modules = snapshot.get("modules") or []
    if modules:
        lines.append("Modules:")
        coming: list[str] = []
        for module in modules:
            slug = str(module.get("slug") or "")
            status = str(module.get("tenant_status") or module.get("status") or "")
            setup = str(module.get("setup_path") or f"/settings/modules/{slug}")
            when = str(module.get("needs_when") or "").strip()
            if status == "coming_soon":
                coming.append(slug)
                continue
            if status == "connected":
                lines.append(
                    f"- {slug} — connected — use {slug}_* tools"
                    + ("; start with accounting_list_companies" if slug == "accounting" else "")
                    + "."
                )
            else:
                lines.append(
                    f"- {slug} — not connected — use when {when or 'this work comes up'}. "
                    f"Setup: {setup}"
                )
        if coming:
            lines.append(
                "- prepared, not connectable: " + ", ".join(coming)
            )

    mcp_servers = snapshot.get("mcp_servers") or []
    mcp_with_tools = [m for m in mcp_servers if m.get("tools")]
    if mcp_with_tools:
        lines.append(
            "MCP servers (query with call_mcp_tool(server_name, tool_name, arguments)):"
        )
        for m in mcp_with_tools[:6]:
            tool_list = ", ".join(m.get("tools", [])[:20])
            lines.append(f"- {m.get('name')}: {tool_list}")

    text = "\n".join(lines)
    if len(text) > max_chars:
        return text[: max_chars - 3] + "..."
    return text


async def build_tenant_snapshot_prompt(session: AsyncSession, tenant_id: UUID) -> str:
    snapshot = await collect_tenant_snapshot(session, tenant_id)
    return format_tenant_snapshot_prompt(snapshot)


async def list_recent_activity(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Recent agent runs, trigger firings, and operational outcomes."""
    from app.models.agent import Agent, AgentRun
    from app.models.outcome import OperationalOutcome
    from app.models.trigger import Trigger

    limit = max(1, min(int(limit or 20), 50))
    events: list[dict[str, Any]] = []

    runs = (
        await session.execute(
            select(AgentRun, Agent.name)
            .outerjoin(Agent, Agent.id == AgentRun.agent_id)
            .where(AgentRun.tenant_id == tenant_id)
            .order_by(AgentRun.started_at.desc())
            .limit(limit)
        )
    ).all()
    for run, agent_name in runs:
        subject = (run.subject or "")[:200]
        events.append(
            {
                "kind": "agent_run",
                "id": str(run.id),
                "status": run.status,
                "agent_name": agent_name or "",
                "trigger_type": getattr(run, "trigger_type", "") or "",
                "subject": subject,
                "created_at": _iso(run.started_at),
            }
        )

    triggers = (
        await session.execute(
            select(Trigger)
            .where(Trigger.tenant_id == tenant_id, Trigger.last_run_at.is_not(None))
            .order_by(Trigger.last_run_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    for t in triggers:
        events.append(
            {
                "kind": "trigger",
                "id": str(t.id),
                "name": t.name,
                "status": t.last_status or "",
                "schedule": _schedule_label(t.kind, t.cron_expr, t.interval_minutes),
                "created_at": _iso(t.last_run_at),
            }
        )

    outcomes = (
        await session.execute(
            select(OperationalOutcome)
            .where(OperationalOutcome.tenant_id == tenant_id)
            .order_by(OperationalOutcome.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    for o in outcomes:
        events.append(
            {
                "kind": "outcome",
                "id": str(o.id),
                "source": o.source,
                "outcome_kind": o.kind,
                "subtype": o.subtype,
                "created_at": _iso(o.created_at),
            }
        )

    events.sort(key=lambda e: e.get("created_at") or "", reverse=True)
    return events[:limit]


async def list_tasks(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    status: str | None = None,
    project_id: str | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    from app.models.orchestration import AgentTask

    limit = max(1, min(int(limit or 30), 100))
    stmt = select(AgentTask).where(AgentTask.tenant_id == tenant_id)
    if status:
        stmt = stmt.where(AgentTask.status == status)
    if project_id:
        try:
            pid = UUID(project_id)
            stmt = stmt.where(AgentTask.project_id == pid)
        except (TypeError, ValueError):
            pass
    stmt = stmt.order_by(AgentTask.created_at.desc()).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    return [
        {
            "id": str(t.id),
            "title": t.title,
            "status": t.status,
            "project_id": str(t.project_id) if t.project_id else None,
            "signal_id": str(t.signal_id) if t.signal_id else None,
            "trigger_type": t.trigger_type,
            "created_at": _iso(t.created_at),
            "completed_at": _iso(t.completed_at),
        }
        for t in rows
    ]


async def list_threads_summary(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    status: str | None = "open",
    channel: str | None = None,
    limit: int = 25,
) -> list[dict[str, Any]]:
    from app.models.signal import Signal

    limit = max(1, min(int(limit or 25), 50))
    stmt = select(Signal).where(Signal.tenant_id == tenant_id)
    if status:
        if status == "open":
            stmt = stmt.where(Signal.status.in_(("open", "pending")))
        else:
            stmt = stmt.where(Signal.status == status)
    if channel:
        stmt = stmt.where(Signal.channel == channel)
    stmt = stmt.order_by(Signal.updated_at.desc()).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    return [
        {
            "id": str(s.id),
            "subject": s.subject or "",
            "channel": s.channel,
            "status": s.status,
            "folder": getattr(s, "folder", None) or "",
            "last_message_at": _iso(s.last_message_at),
            "project_id": str(s.project_id) if s.project_id else None,
            "agent_id": str(s.agent_id) if getattr(s, "agent_id", None) else None,
        }
        for s in rows
    ]
