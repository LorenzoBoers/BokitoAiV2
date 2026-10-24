"""What a department (or an unplaced agent) pays attention to: ``settings_json["awareness"]``.

Awareness belongs to the department: ``Department.settings_json["awareness"]``.
Its point of contact runs the orientation and answers the event wakes, so a new
point of contact takes over the schedule and the brief without a copy. Agents
that sit in no department keep their own block on ``Agent.settings_json``.

Three lenses drive every orientation: the role (what the department is for),
the state (how its work stands) and improvements (what could be better). The
configuration says which thread events wake the point of contact
(``follows``), how much an event wake may cost per day, how many improvement
proposals one orientation may make, and any explicit scope. The orientation
stores a standing ``brief``; the briefs of every department an agent is the
point of contact of go into each of its runs (``aware_context``).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
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
CHECKIN_MODES = ("off", "on_conversation", "daily", "custom")
DEFAULT_CHECKIN_CRON = "30 7 * * 1-5"
MAX_DAILY_COST_CENTS = 100_000
BRIEF_CHARS = 1200


def _settings(owner: Any) -> dict[str, Any]:
    try:
        data = json.loads(owner.settings_json or "{}")
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


def awareness_config(owner: Any) -> dict[str, Any]:
    """The stored configuration of a department or agent, with defaults filled in."""
    raw = _settings(owner).get("awareness")
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
    mode = raw.get("mode") if raw.get("mode") in CHECKIN_MODES else "daily"
    return {
        "follows": follows,
        "mode": mode,
        "cron": str(raw.get("cron") or DEFAULT_CHECKIN_CRON),
        "daily_cost_cents": max(0, min(cost, MAX_DAILY_COST_CENTS)),
        "max_proposals": max(0, min(proposals, 10)),
        "scope": {
            "flows": _ids(scope.get("flows")),
            "folders": _ids(scope.get("folders")),
            "organizations": _ids(scope.get("organizations")),
        },
        "brief": brief,
    }


def set_awareness(owner: Any, patch: dict[str, Any]) -> dict[str, Any]:
    """Merge a patch (follows, daily_cost_cents, max_proposals, scope) into a department or agent. Caller commits."""
    data = _settings(owner)
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
    if "mode" in patch:
        if patch["mode"] not in CHECKIN_MODES:
            raise ValueError(f"mode must be one of: {', '.join(CHECKIN_MODES)}")
        current["mode"] = patch["mode"]
    mode = current.get("mode") if current.get("mode") in CHECKIN_MODES else "daily"
    # Dagelijks is the weekday 07:30 cadence. A leftover custom cron must not keep firing.
    if mode == "daily":
        current["cron"] = DEFAULT_CHECKIN_CRON
    elif "cron" in patch and str(patch["cron"] or "").strip():
        current["cron"] = str(patch["cron"]).strip()[:80]
    if isinstance(patch.get("scope"), dict):
        scope = current.get("scope") if isinstance(current.get("scope"), dict) else {}
        for key in ("flows", "folders", "organizations"):
            if key in patch["scope"]:
                scope[key] = _ids(patch["scope"][key])
        current["scope"] = scope
    if mode in {"off", "on_conversation"}:
        current.pop("next_wake_at", None)
    elif "mode" in patch or "cron" in patch or not current.get("next_wake_at"):
        from app.services.triggers import next_cron_run

        when = next_cron_run(str(current.get("cron") or DEFAULT_CHECKIN_CRON), utcnow())
        if when is not None:
            current["next_wake_at"] = when.isoformat()
    data["awareness"] = current
    owner.settings_json = json.dumps(data)
    return awareness_config(owner)


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
    from sqlalchemy import or_, select

    from app.models.orchestra import Workstream
    from app.models.signal import SignalTag
    from app.services.department_domain import agent_departments
    from app.services.tickets import workstream_stages

    depts = await agent_departments(session, agent.tenant_id, agent.id)
    led = [d for d, duty in depts if duty == "primary" and d.parent_id is not None]
    other = [d for d, duty in depts if d.parent_id is not None and d not in led]
    parts: list[str] = []
    if led:
        dept_ids = [d.id for d in led]
        flows = (
            await session.execute(
                select(Workstream.name)
                .outerjoin(SignalTag, SignalTag.workstream_id == Workstream.id)
                .where(
                    Workstream.tenant_id == agent.tenant_id,
                    Workstream.deleted_at.is_(None),
                    or_(
                        SignalTag.department_id.in_(dept_ids),
                        Workstream.department_id.in_(dept_ids),
                    ),
                )
                .distinct()
            )
        ).scalars().all()
        line = f"Point of contact for {', '.join(d.name for d in led)}"
        if flows:
            line += f": flows {', '.join(sorted(flows)[:8])}"
        parts.append(line)
    if other:
        from app.models.team import DepartmentMember

        focus = dict(
            (
                await session.execute(
                    select(DepartmentMember.department_id, DepartmentMember.focus).where(
                        DepartmentMember.agent_id == agent.id,
                        DepartmentMember.department_id.in_([d.id for d in other]),
                    )
                )
            ).all()
        )
        parts.append(
            "member of "
            + ", ".join(f"{d.name} (focus: {focus[d.id]})" if focus.get(d.id) else d.name for d in other)
        )
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
    """Save the standing brief after an orientation. A quiet run keeps the summary. Caller commits.

    With a department the brief lands on the department, so the next point of
    contact reads it too; without one it stays on the agent.
    """
    from app.models.team import Department

    owner: Any = agent
    if department_id is not None:
        owner = await session.get(Department, department_id) or agent
    data = _settings(owner)
    current = data.get("awareness") if isinstance(data.get("awareness"), dict) else {}
    previous = current.get("brief") if isinstance(current.get("brief"), dict) else {}
    snap = snapshot or {}
    brief = {
        "role": await role_line(session, agent),
        "summary": previous.get("summary", "") if quiet else text.strip()[:BRIEF_CHARS],
        "department_id": str(department_id) if department_id else previous.get("department_id"),
        "agent_id": str(agent.id),
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
    owner.settings_json = json.dumps(data)
    session.add(owner)
    return brief


async def aware_context(session: AsyncSession, agent: Agent, *, with_crew: bool = True) -> str:
    """The prompt block every run of an aware agent carries: role, briefs, domain facts, crew.

    ``with_crew=False`` leaves the crew out for a caller that places it itself.
    """
    from app.services.department_domain import agent_departments, domain_facts

    led = [d for d, duty in await agent_departments(session, agent.tenant_id, agent.id) if duty == "primary"]
    role = await role_line(session, agent)
    crew = await crew_context(session, agent, led) if with_crew else ""
    briefs = [(d.name, awareness_config(d)["brief"]) for d in led]
    briefs = [(name, b) for name, b in briefs if b and b.get("summary")]
    own = awareness_config(agent)["brief"]
    if not led and own and own.get("summary"):
        briefs.append(("", own))
    if not role and not briefs and not crew:
        return ""
    lines = ["## Your standing brief"]
    if role:
        lines.append(f"Role: {role}")
    for name, brief in briefs[:4]:
        stamp = str(brief.get("at") or "")[:16].replace("T", " ")
        where = f" of {name}" if name else ""
        lines.append(f"Last orientation{where} ({stamp} UTC):\n{brief['summary']}")
    facts = [(d.name, f) for d in led for f in domain_facts(d)]
    if facts:
        lines.append("Domain facts from the person accountable:")
        many = len({name for name, _ in facts}) > 1
        lines.extend(
            f"- {f'[{name}] ' if many else ''}{f['question']} {f['answer']}" for name, f in facts[:20]
        )
    if crew:
        lines.append(crew)
    return "\n".join(lines)


CREW_INSTRUCTION = (
    "You pick up work that lands on these departments. Delegate down first: ask "
    "the crew member or sub-department whose focus fits with ask_agent and keep "
    "the conversation yourself; use handoff_to when it belongs with that "
    "specialist; do it yourself only when nobody below is available or a person "
    "asks you to. Ask the accountable person with ask_domain_question when a "
    "rule of the department is unclear. Other departments' work belongs to "
    "their point of contact: ask them, do not finish it."
)


async def crew_context(session: AsyncSession, agent: Agent, led: list[Any]) -> str:
    """Who sits on each department this agent is the point of contact of, and how to delegate.

    For the organization (the workspace lead) it lists each department's point
    of contact instead of everyone in the workspace.
    """
    if not led:
        return ""
    from app.models.team import is_root_department
    from app.services.teams import department_tree

    tree = await department_tree(session, agent.tenant_id)
    by_id = {row["id"]: row for row in tree}
    blocks: list[str] = []
    for dept in led:
        row = by_id.get(str(dept.id))
        if row is None:
            continue
        if is_root_department(dept):
            heads = [
                f"- {child['name']}: point of contact "
                + (f"@[{child['contact']['name']}](agent:{child['contact']['id']})" if child["contact"] else "none")
                for child in tree
                if child["depth"] == 1
            ]
            if heads:
                blocks.append(
                    "Organization: you pick up what no department owns. Hand department "
                    "work to its point of contact.\n" + "\n".join(heads)
                )
            continue
        members = [
            "- "
            + (f"@[{m['name']}](agent:{m['id']})" if m["kind"] == "agent" else m["name"])
            + {"accountable": " (accountable)", "contact": " (you)"}.get(m["role"], "")
            + (f": {m['focus']}" if m.get("focus") else "")
            for m in row["crew"]
            if not (m["kind"] == "agent" and m["id"] == str(agent.id) and not m.get("focus"))
        ]
        children = [
            f"- sub-department {child['mention']}: point of contact "
            + (f"@[{child['contact']['name']}](agent:{child['contact']['id']})" if child["contact"] else "none")
            for child in (by_id.get(cid) for cid in row.get("children", []))
            if child is not None
        ]
        lines = members + children
        blocks.append(f"{row['path']}:\n" + ("\n".join(lines) if lines else "- nobody else yet"))
    if not blocks:
        return ""
    return "## Your crew\n" + CREW_INSTRUCTION + "\n" + "\n".join(blocks)


async def awareness_view(session: AsyncSession, agent: Agent) -> dict[str, Any]:
    """The wake stand of an agent as the agent page shows it. Not an agenda item."""
    return await _view(session, agent, agent)


async def department_awareness_view(session: AsyncSession, dept: Any) -> dict[str, Any]:
    """The wake stand of a department, run by its point of contact (None when it has no agent)."""
    from app.services.department_access import department_contact

    contact, _implicit = await department_contact(session, dept.tenant_id, dept.id)
    return await _view(session, dept, contact)


async def _view(session: AsyncSession, owner: Any, agent: Agent | None) -> dict[str, Any]:
    config = awareness_config(owner)
    raw = _settings(owner).get("awareness")
    raw = raw if isinstance(raw, dict) else {}
    next_wake = str(raw.get("next_wake_at") or "") or None
    brief = config["brief"] or {}
    return {
        "agent_id": str(agent.id) if agent else None,
        "agent_name": agent.name if agent else None,
        "role": brief.get("role") or (await role_line(session, agent) if agent else ""),
        "follows": config["follows"],
        "followable": list(FOLLOWABLE),
        "mode": config["mode"],
        "cron": config["cron"],
        "daily_cost_cents": config["daily_cost_cents"],
        "spent_today_cents": await spent_today_cents(session, agent.tenant_id, agent.id) if agent else 0,
        "max_proposals": config["max_proposals"],
        "cadence": config["cron"] if config["mode"] in {"daily", "custom"} else None,
        "next_wake_at": next_wake,
        "last_orientation_at": brief.get("at"),
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
    "department_awareness_view",
    "event_window_key",
    "role_line",
    "set_awareness",
    "spent_today_cents",
    "store_brief",
]
