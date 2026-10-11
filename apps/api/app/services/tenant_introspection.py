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


async def collect_tenant_snapshot(
    session: AsyncSession, tenant_id: UUID, *, agent_id: UUID | None = None
) -> dict[str, Any]:
    """Structured snapshot used by tools and the compact prompt block.

    With ``agent_id``, module context is scoped to that agent's roster:
    accounting connections disappear when the agent is not rostered, and the
    per-agent company scope + write flag are included.
    """
    from app.models.agent import Agent, AgentRun
    from app.models.integration import IntegrationConnection, McpServer
    from app.models.notification import DecisionRequest
    from app.models.orchestration import AgentTask
    from app.models.project import Project
    from app.models.signal import Signal, SignalTag
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
                AgentTask.status.in_(("queued", "running", "paused", "awaiting_human", "analyzing", "planned", "verifying")),
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
    for m in mcp_rows:
        # Module-package connections (native:// or Bokito-hosted partner MCP)
        # are surfaced as module capacity below, not as MCP servers with vendor
        # tool names that would confuse agents.
        from app.services.partner_mcp import is_partner_mcp_url

        if m.server_url.startswith("native://") or is_partner_mcp_url(m.server_url):
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

    recent_runs_count = (
        await session.execute(
            select(func.count())
            .select_from(AgentRun)
            .where(AgentRun.tenant_id == tenant_id)
        )
    ).scalar_one()

    from app.modules.catalog import MODULES, serialize_modules_for_tenant

    modules = await serialize_modules_for_tenant(session, tenant_id)

    # Per-module connection names (cheap, via the module's snapshot hook) and
    # the agent's roster scope. Modules where the agent is not rostered
    # contribute nothing: the agent has no capability there at all.
    module_connections: dict[str, list[dict[str, Any]]] = {}
    module_scopes: dict[str, dict[str, Any]] = {}
    if agent_id is not None:
        from app.services.module_agents import module_agent_access, parse_company_scope

    for module in MODULES:
        if module.status != "available":
            continue
        access = None
        if agent_id is not None:
            access = await module_agent_access(
                session, tenant_id, agent_id, module.slug
            )
            if access is None:
                continue
            module_scopes[module.slug] = {
                "company_ids": parse_company_scope(access),
                "can_write": bool(access.can_write),
            }
        rows = await _module_snapshot_rows(session, tenant_id, module.slug)
        if rows:
            module_connections[module.slug] = rows

    tag_rows = (
        await session.execute(
            select(SignalTag)
            .where(SignalTag.tenant_id == tenant_id)
            .order_by(SignalTag.name)
            .limit(40)
        )
    ).scalars().all()
    tags = [
        {
            "id": str(tag.id),
            "name": tag.name,
            "kind": "action_tag" if tag.workstream_id else "tag",
        }
        for tag in tag_rows
    ]

    return {
        "agents": agents,
        "projects": projects,
        "triggers": triggers,
        "tags": tags,
        "open_decisions": int(open_decisions or 0),
        "running_tasks": int(running_tasks or 0),
        "open_internal_threads": int(open_internal_threads or 0),
        "integrations": integrations,
        "mcp_servers": mcp_servers,
        "module_connections": module_connections,
        "module_scopes": module_scopes,
        "modules": modules,
        "agent_runs_total": int(recent_runs_count or 0),
    }


async def _module_snapshot_rows(
    session: AsyncSession, tenant_id: UUID, slug: str
) -> list[dict[str, Any]]:
    """Connection names for one module: hook first, generic rows otherwise."""
    import importlib

    try:
        mod = importlib.import_module(f"app.modules.{slug}.connections")
    except ModuleNotFoundError:
        mod = None
    hook = getattr(mod, "snapshot_rows", None) if mod else None
    if callable(hook):
        return await hook(session, tenant_id)
    from app.modules.catalog import active_module_connections

    return [
        {"name": c.display_name or c.provider, "vendor": c.provider}
        for c in await active_module_connections(session, tenant_id, slug)
    ]


def _module_has_verb(slug: str, verb: str) -> bool:
    from app.modules.catalog import MODULE_BY_SLUG

    spec = MODULE_BY_SLUG.get(slug)
    return spec is not None and any(c.verb == verb for c in spec.tool_cards)


def format_tenant_snapshot_prompt(snapshot: dict[str, Any], *, max_chars: int = 2000) -> str:
    """Compact markdown for the agent system prompt."""
    lines: list[str] = ["## Tenant snapshot"]

    agents = snapshot.get("agents") or []
    if agents:
        bits = []
        for a in agents[:12]:
            flag = "active" if a.get("is_active") else "paused"
            bits.append(f"@[{a.get('name')}](agent:{a.get('id')}) ({a.get('role')}/{a.get('kind')}, {flag})")
        lines.append("Agents (copy the @[Name](agent:id) chip exactly): " + "; ".join(bits))
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

    tags = snapshot.get("tags") or []
    if tags:
        bits = []
        for tag in tags[:20]:
            name = str(tag.get("name") or "").strip()
            if not name:
                continue
            kind = "actietag" if tag.get("kind") == "action_tag" else "tag"
            bits.append(f"#{name} ({kind})")
        if bits:
            lines.append(
                "Tags: "
                + "; ".join(bits)
                + " — call list_tags for the full list; do not invent tags from search."
            )
    else:
        lines.append("Tags: none — call list_tags before claiming there are no tags.")

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

    module_connections = snapshot.get("module_connections") or {}
    module_scopes = snapshot.get("module_scopes") or {}
    for slug, conns in list(module_connections.items())[:6]:
        if not conns:
            continue
        names = ", ".join(str(c.get("name") or "") for c in conns[:4])
        lines.append(
            f"{slug.capitalize()}: {len(conns)} connection(s) ({names}) — use the "
            f"{slug}_* tools; start with {slug}_list_companies."
            if _module_has_verb(slug, "list_companies")
            else f"{slug.capitalize()}: {len(conns)} connection(s) ({names}) — use the {slug}_* tools."
        )
        scope = module_scopes.get(slug)
        if isinstance(scope, dict):
            company_ids = scope.get("company_ids")
            if isinstance(company_ids, list) and company_ids:
                lines.append(
                    f"Your {slug} scope is limited to administration id(s): "
                    + ", ".join(str(c) for c in company_ids[:6])
                    + "."
                )
            if not scope.get("can_write"):
                lines.append(
                    f"You have read-only {slug} access; you cannot propose "
                    f"or apply {slug} writes."
                )

    modules = snapshot.get("modules") or []
    if modules:
        lines.append("Modules:")
        coming: list[str] = []
        for module in modules:
            slug = str(module.get("slug") or "")
            status = str(module.get("tenant_status") or module.get("status") or "")
            setup = str(module.get("setup_path") or f"/connections/{slug}")
            when = str(module.get("needs_when") or "").strip()
            if status == "coming_soon":
                coming.append(slug)
                continue
            if status in ("connected",):
                lines.append(
                    f"- {slug} — connected — use {slug}_* tools"
                    + (
                        f"; start with {slug}_list_companies"
                        if _module_has_verb(slug, "list_companies")
                        else ""
                    )
                    + "."
                )
            elif status in ("installed", "on"):
                lines.append(
                    f"- {slug} — installed"
                    + (
                        f" — use when {when or 'this work comes up'}. Setup: {setup}"
                        if status == "on" or not module.get("connected")
                        else " — use module tools."
                    )
                )
            elif status == "setup":
                lines.append(
                    f"- {slug} — setup in progress — finish at {setup}"
                    + (f" ({when})" if when else "")
                    + "."
                )
            else:
                lines.append(
                    f"- {slug} — not installed — install at {setup}"
                    + (f" when {when}" if when else "")
                    + "."
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


async def build_tenant_snapshot_prompt(
    session: AsyncSession, tenant_id: UUID, *, agent_id: UUID | None = None
) -> str:
    snapshot = await collect_tenant_snapshot(session, tenant_id, agent_id=agent_id)
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
    from app.services.work_items import serialize_work_item

    items: list[dict[str, Any]] = [serialize_work_item(t) for t in rows]
    items.sort(key=lambda row: row.get("created_at") or "", reverse=True)
    return items[:limit]


def _signal_activity_expr():
    """Last meaningful activity for age filters (message, else updated/created)."""
    from app.models.signal import Signal

    return func.coalesce(Signal.last_message_at, Signal.updated_at, Signal.created_at)


async def list_threads_summary(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    status: str | None = "open",
    channel: str | None = None,
    older_than_days: int | None = None,
    limit: int = 25,
    scheduled_from: datetime | None = None,
    scheduled_to: datetime | None = None,
) -> dict[str, Any]:
    """Summarize threads for agents/MCP.

    Returns ``threads`` plus ``matched`` (total rows matching the filter) so
    callers know when ``limit`` truncated the page. ``older_than_days`` filters
    on last message / update time. ``scheduled_from`` / ``scheduled_to`` keep
    threads whose date (``next_at``) falls in that window, earliest first,
    whatever their status.
    """
    from datetime import timedelta

    from app.models.signal import Signal

    limit = max(1, min(int(limit or 25), 200))
    filters = [Signal.tenant_id == tenant_id, Signal.deleted_at.is_(None)]
    scheduled = scheduled_from is not None or scheduled_to is not None
    if scheduled:
        filters.append(Signal.next_at.is_not(None))
        if scheduled_from is not None:
            filters.append(Signal.next_at >= scheduled_from)
        if scheduled_to is not None:
            filters.append(Signal.next_at <= scheduled_to)
        status = None
    if status:
        if status == "open":
            filters.append(Signal.status.in_(("open", "pending")))
        else:
            filters.append(Signal.status == status)
    if channel:
        filters.append(Signal.channel == channel)
    cutoff = None
    if older_than_days is not None:
        days = max(1, min(int(older_than_days), 3650))
        cutoff = datetime.utcnow() - timedelta(days=days)
        filters.append(_signal_activity_expr() < cutoff)

    matched = int(
        (await session.execute(select(func.count()).select_from(Signal).where(*filters))).scalar_one()
        or 0
    )

    if scheduled:
        order = Signal.next_at.asc()
    else:
        order = _signal_activity_expr().asc() if cutoff else Signal.updated_at.desc()
    rows = (
        await session.execute(select(Signal).where(*filters).order_by(order).limit(limit))
    ).scalars().all()
    threads = [
        {
            "id": str(s.id),
            "subject": s.subject or "",
            "channel": s.channel,
            "status": s.status,
            "folder": getattr(s, "folder", None) or "",
            "next_at": _iso(s.next_at),
            "last_message_at": _iso(s.last_message_at),
            "project_id": str(s.project_id) if s.project_id else None,
            "agent_id": str(s.agent_id) if getattr(s, "agent_id", None) else None,
            # In-app chip: [Subject](/communication/inbox/open/t/{id}).
            "path": f"/communication/inbox/open/t/{s.id}",
        }
        for s in rows
    ]
    payload: dict[str, Any] = {
        "threads": threads,
        "returned": len(threads),
        "matched": matched,
        "limit": limit,
    }
    if older_than_days is not None:
        payload["older_than_days"] = max(1, min(int(older_than_days), 3650))
        payload["cutoff"] = _iso(cutoff)
    return payload
