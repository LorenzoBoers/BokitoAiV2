"""What an agent pays attention to: ``Agent.settings_json["awareness"]``.

Three lenses drive every orientation: the role (what the agent is for in this
workspace), the state (how everything in that role stands) and improvements
(what could be better). The configuration says which thread events wake the
agent (``follows``), how much an event wake may cost per day, how many
improvement proposals one orientation may make, and any explicit scope on top
of what the departments give. The orientation stores a standing ``brief``; the
brief and the role go into every run (``aware_context``).
"""

from __future__ import annotations

from app.core.time import utcnow

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent

# Followable kinds and the SignalEvent types behind each.
FOLLOWABLE: dict[str, frozenset[str]] = {
    "inbound": frozenset({"signal_created", "message_added", "reopened"}),
    "stage_change": frozenset({"ticket_stage_changed"}),
    "deadline": frozenset({"due"}),
    "decision": frozenset({"decision_approved", "decision_rejected", "decision_dismissed", "client_verdict"}),
    "assignment": frozenset({"assigned", "auto_assigned", "unassigned"}),
    "escalation": frozenset({"escalated", "callback_requested"}),
    "delivery": frozenset({"delivered"}),
}
EVENT_KIND: dict[str, str] = {etype: kind for kind, types in FOLLOWABLE.items() for etype in types}
DEFAULT_FOLLOWS = ("stage_change", "deadline", "decision", "escalation")
DEFAULT_DAILY_COST_CENTS = 300
DEFAULT_MAX_PROPOSALS = 3
MAX_DAILY_COST_CENTS = 100_000
BRIEF_CHARS = 1200


def _settings(agent: Agent) -> dict[str, Any]:
    try:
        data = json.loads(agent.settings_json or "{}")
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _ids(raw: Any) -> list[str]:
    out: list[str] = []
    for value in raw if isinstance(raw, list) else []:
        try:
            out.append(str(UUID(str(value))))
        except ValueError:
            continue
    return list(dict.fromkeys(out))


def awareness_config(agent: Agent) -> dict[str, Any]:
    """The stored configuration with defaults filled in."""
    raw = _settings(agent).get("awareness")
    raw = raw if isinstance(raw, dict) else {}
    stored = raw.get("follows", DEFAULT_FOLLOWS)
    follows = [k for k in stored if k in FOLLOWABLE] if isinstance(stored, (list, tuple)) else list(DEFAULT_FOLLOWS)
    scope = raw.get("scope") if isinstance(raw.get("scope"), dict) else {}
    try:
        cost = int(raw.get("daily_cost_cents", DEFAULT_DAILY_COST_CENTS))
    except (TypeError, ValueError):
        cost = DEFAULT_DAILY_COST_CENTS
    try:
        proposals = int(raw.get("max_proposals", DEFAULT_MAX_PROPOSALS))
    except (TypeError, ValueError):
        proposals = DEFAULT_MAX_PROPOSALS
    brief = raw.get("brief") if isinstance(raw.get("brief"), dict) else None
    return {
        "follows": follows,
        "daily_cost_cents": max(0, min(cost, MAX_DAILY_COST_CENTS)),
        "max_proposals": max(0, min(proposals, 10)),
        "scope": {
            "flows": _ids(scope.get("flows")),
            "folders": _ids(scope.get("folders")),
            "organizations": _ids(scope.get("organizations")),
        },
        "brief": brief,
    }


def set_awareness(agent: Agent, patch: dict[str, Any]) -> dict[str, Any]:
    """Merge a patch (follows, daily_cost_cents, max_proposals, scope). Caller commits."""
    data = _settings(agent)
    current = data.get("awareness") if isinstance(data.get("awareness"), dict) else {}
    if "follows" in patch:
        follows = patch["follows"]
        if not isinstance(follows, list) or any(k not in FOLLOWABLE for k in follows):
            raise ValueError(f"follows must be a list of: {', '.join(FOLLOWABLE)}")
        current["follows"] = list(dict.fromkeys(follows))
    for key, top in (("daily_cost_cents", MAX_DAILY_COST_CENTS), ("max_proposals", 10)):
        if key in patch:
            try:
                value = int(patch[key])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{key} must be a number") from exc
            if value < 0 or value > top:
                raise ValueError(f"{key} must be between 0 and {top}")
            current[key] = value
    if isinstance(patch.get("scope"), dict):
        scope = current.get("scope") if isinstance(current.get("scope"), dict) else {}
        for key in ("flows", "folders", "organizations"):
            if key in patch["scope"]:
                scope[key] = _ids(patch["scope"][key])
        current["scope"] = scope
    data["awareness"] = current
    agent.settings_json = json.dumps(data)
    return awareness_config(agent)


async def spent_today_cents(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> int:
    from app.models.usage import UsageLedger

    start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    total = (
        await session.execute(
            select(func.coalesce(func.sum(UsageLedger.cost_cents), 0)).where(
                UsageLedger.tenant_id == tenant_id,
                UsageLedger.agent_id == agent_id,
                UsageLedger.created_at >= start,
            )
        )
    ).scalar_one()
    return int(total or 0)


async def role_line(session: AsyncSession, agent: Agent) -> str:
    """One sentence: which departments, which duty, which flows, which stages."""
    from app.models.orchestra import Workstream
    from app.services.department_domain import agent_departments
    from app.services.tickets import workstream_stages

    depts = await agent_departments(session, agent.tenant_id, agent.id)
    led = [d for d, duty in depts if duty == "primary" and d.parent_id is not None]
    other = [d for d, duty in depts if d.parent_id is not None and d not in led]
    parts: list[str] = []
    if led:
        flows = (
            await session.execute(
                select(Workstream.name).where(
                    Workstream.tenant_id == agent.tenant_id,
                    Workstream.department_id.in_([d.id for d in led]),
                    Workstream.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        line = f"Lead of {', '.join(d.name for d in led)}"
        if flows:
            line += f": flows {', '.join(sorted(flows)[:8])}"
        parts.append(line)
    if other:
        parts.append(f"member of {', '.join(d.name for d in other)}")
    owned: list[str] = []
    for flow in (
        await session.execute(
            select(Workstream).where(Workstream.tenant_id == agent.tenant_id, Workstream.deleted_at.is_(None))
        )
    ).scalars().all():
        for stage in workstream_stages(flow):
            owner = stage.get("owner") or {}
            if owner.get("kind") == "agent" and owner.get("id") == str(agent.id):
                owned.append(f"{stage.get('name')} ({flow.name})")
    if owned:
        parts.append(f"owns the stages {', '.join(owned[:8])}")
    if not parts:
        return ""
    title = (agent.job_title or "").strip()
    head = f"{agent.name}{f', {title}' if title else ''}"
    return f"{head}. " + "; ".join(parts) + "."


async def store_brief(
    session: AsyncSession,
    agent: Agent,
    *,
    department_id: UUID | None,
    text: str,
    quiet: bool,
    snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Save the standing brief after an orientation. A quiet run keeps the summary. Caller commits."""
    data = _settings(agent)
    current = data.get("awareness") if isinstance(data.get("awareness"), dict) else {}
    previous = current.get("brief") if isinstance(current.get("brief"), dict) else {}
    snap = snapshot or {}
    brief = {
        "role": await role_line(session, agent),
        "summary": previous.get("summary", "") if quiet else text.strip()[:BRIEF_CHARS],
        "department_id": str(department_id) if department_id else previous.get("department_id"),
        "open_tickets": snap.get("open_tickets"),
        "bottlenecks": {
            key: len(snap.get(key) or [])
            for key in ("overdue", "waiting_on_customer", "incomplete")
        } if snap else previous.get("bottlenecks"),
        "open_proposals": len(snap.get("proposals") or []) if snap else previous.get("open_proposals"),
        "open_questions": len(snap.get("domain_questions") or []) if snap else previous.get("open_questions"),
        "at": utcnow().isoformat() + "Z",
        "quiet": quiet,
    }
    current["brief"] = brief
    data["awareness"] = current
    agent.settings_json = json.dumps(data)
    session.add(agent)
    return brief


async def aware_context(session: AsyncSession, agent: Agent) -> str:
    """The prompt block every run of an aware agent carries: role, brief, domain facts."""
    from app.models.team import Department
    from app.services.department_domain import domain_facts

    config = awareness_config(agent)
    brief = config["brief"] or {}
    role = brief.get("role") or await role_line(session, agent)
    if not role and not brief:
        return ""
    lines = ["## Your standing brief"]
    if role:
        lines.append(f"Role: {role}")
    if brief.get("summary"):
        stamp = str(brief.get("at") or "")[:16].replace("T", " ")
        lines.append(f"Last orientation ({stamp} UTC):\n{brief['summary']}")
    from app.services.department_domain import agent_departments

    dept = None
    if brief.get("department_id"):
        try:
            dept = await session.get(Department, UUID(str(brief["department_id"])))
        except ValueError:
            dept = None
    if dept is None:
        led = [d for d, duty in await agent_departments(session, agent.tenant_id, agent.id) if duty == "primary"]
        dept = led[0] if led else None
    facts = domain_facts(dept)
    if facts:
        lines.append("Domain facts from the person accountable:")
        lines.extend(f"- {f['question']} {f['answer']}" for f in facts[:20])
    return "\n".join(lines)


async def awareness_view(session: AsyncSession, agent: Agent) -> dict[str, Any]:
    """The configuration as the department page shows it."""
    from app.models.trigger import Trigger
    from app.services.awareness import ORIENTATION

    config = awareness_config(agent)
    orientation = (
        await session.execute(
            select(Trigger).where(
                Trigger.tenant_id == agent.tenant_id,
                Trigger.agent_id == agent.id,
                Trigger.purpose == ORIENTATION,
                Trigger.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    return {
        "agent_id": str(agent.id),
        "agent_name": agent.name,
        "role": (config["brief"] or {}).get("role") or await role_line(session, agent),
        "follows": config["follows"],
        "followable": list(FOLLOWABLE),
        "daily_cost_cents": config["daily_cost_cents"],
        "spent_today_cents": await spent_today_cents(session, agent.tenant_id, agent.id),
        "max_proposals": config["max_proposals"],
        "cadence": orientation.cron_expr if orientation else None,
        "next_wake_at": orientation.next_run_at.isoformat() + "Z" if orientation and orientation.next_run_at else None,
        "last_orientation_at": orientation.last_run_at.isoformat() + "Z" if orientation and orientation.last_run_at else None,
        "brief": config["brief"],
        "scope": config["scope"],
    }


def event_window_key(now: datetime, minutes: int) -> int:
    return int(now.timestamp() // (minutes * 60))


__all__ = [
    "DEFAULT_FOLLOWS",
    "EVENT_KIND",
    "FOLLOWABLE",
    "aware_context",
    "awareness_config",
    "awareness_view",
    "event_window_key",
    "role_line",
    "set_awareness",
    "spent_today_cents",
    "store_brief",
]
