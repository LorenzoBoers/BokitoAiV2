"""What a department lead needs to know this morning, in one snapshot.

``department_snapshot`` reads the department's flows (``Workstream.department_id``)
and lists what asks for action: tickets past their deadline, tickets waiting on
the customer longer than the stage check-up, required stage fields or checklist
items still open, hours planned per person against their weekly hours, bad
connections, and how the label scorecard moved. ``render_snapshot`` turns it
into the prompt block for the orientation wake (``Trigger.purpose ==
"orientation"``), which runs in the department room.

``ensure_orientations`` sets one orientation per department that has a lead
agent; ``platform_watch`` uses it instead of the general check-in for
workspaces with departments. A department with the outward lens (Research)
gets a weekly trend orientation instead (``services/trends.py``).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership, User
from app.models.integration import IntegrationConnection
from app.models.orchestra import Workstream
from app.models.signal import Signal, SignalEvent, SignalTag
from app.models.team import Department
from app.models.trigger import Trigger
from app.services.trash import alive

ORIENTATION = "orientation"
ORIENTATION_CRON = "30 7 * * 1-5"
MAX_ITEMS = 12
BAD_HEALTH = ("error", "needs_reconnect")


def _json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _hours_field(fields: dict[str, Any]) -> float:
    try:
        return max(0.0, float(str(fields.get("hours") or 0).replace(",", ".")))
    except ValueError:
        return 0.0


async def _stage_entered(session: AsyncSession, signal_ids: list[UUID]) -> dict[UUID, datetime]:
    if not signal_ids:
        return {}
    rows = (
        await session.execute(
            select(SignalEvent.signal_id, func.max(SignalEvent.created_at))
            .where(SignalEvent.signal_id.in_(signal_ids), SignalEvent.event_type == "ticket_stage_changed")
            .group_by(SignalEvent.signal_id)
        )
    ).all()
    return {sid: at for sid, at in rows if at}


async def _scorecard_shift(session: AsyncSession, tenant_id: UUID, label_ids: list[str]) -> list[dict[str, Any]]:
    from app.models.learning import EvalScore
    from app.services.learning import LABEL_SCORECARD

    if not label_ids:
        return []
    rows = (
        await session.execute(
            select(EvalScore)
            .where(
                EvalScore.tenant_id == tenant_id,
                EvalScore.scope == "label",
                EvalScore.metric == LABEL_SCORECARD,
                EvalScore.scope_id.in_(label_ids),
                EvalScore.created_at >= datetime.utcnow() - timedelta(days=8),
            )
            .order_by(EvalScore.created_at.asc())
        )
    ).scalars().all()
    by_label: dict[str, list[Any]] = {}
    for row in rows:
        by_label.setdefault(row.scope_id, []).append(row)
    out = []
    for label_id, items in by_label.items():
        if len(items) < 2:
            continue
        first, last = items[0], items[-1]
        out.append({
            "label_id": label_id,
            "autonomous_from": round(first.value or 0, 1),
            "autonomous_to": round(last.value or 0, 1),
            "corrected_to": _json(last.details_json).get("corrected_pct"),
        })
    return out


async def department_snapshot(
    session: AsyncSession, tenant_id: UUID, department_id: UUID, *, extended: bool = False
) -> dict[str, Any]:
    from app.services.tickets import workstream_stages

    now = datetime.utcnow()
    dept = await session.get(Department, department_id)
    flows = (
        await session.execute(
            select(Workstream).where(Workstream.tenant_id == tenant_id, Workstream.department_id == department_id)
        )
    ).scalars().all()
    tags = (
        await session.execute(
            select(SignalTag).where(SignalTag.tenant_id == tenant_id, SignalTag.workstream_id.in_([f.id for f in flows]))
        )
    ).scalars().all() if flows else []
    flow_by_tag = {t.id: next(f for f in flows if f.id == t.workstream_id) for t in tags}
    tickets = (
        await session.execute(
            select(Signal).where(
                Signal.tenant_id == tenant_id,
                alive(Signal),
                Signal.ticket_tag_id.in_(list(flow_by_tag)),
                Signal.ticket_status.in_(("open", "waiting")),
            )
        )
    ).scalars().all() if flow_by_tag else []
    entered = await _stage_entered(session, [s.id for s in tickets])

    overdue: list[dict[str, Any]] = []
    waiting_long: list[dict[str, Any]] = []
    incomplete: list[dict[str, Any]] = []
    planned_hours: dict[UUID, float] = {}
    for signal in tickets:
        flow = flow_by_tag[signal.ticket_tag_id]
        stages = workstream_stages(flow)
        stage = next((s for s in stages if s["key"] == signal.stage_key), None)
        ref = {"signal_id": str(signal.id), "subject": signal.subject or "", "flow": flow.name, "stage": stage["name"] if stage else signal.stage_key}
        if signal.due_at and signal.due_at < now:
            overdue.append({**ref, "due_at": signal.due_at.isoformat() + "Z"})
        if stage and signal.ticket_status == "waiting" and stage.get("waiting_on") == "customer":
            since = entered.get(signal.id) or signal.ticket_filed_at or signal.created_at
            limit = int(stage.get("checkup_minutes") or 0) or 3 * 24 * 60
            if since and now - since > timedelta(minutes=limit):
                waiting_long.append({**ref, "waiting_days": round((now - since).total_seconds() / 86400, 1)})
        fields = _json(signal.ticket_fields_json)
        if stage:
            done = _json(signal.ticket_checklist_json)
            missing = [f["name"] for f in stage.get("fields") or [] if f.get("required") and not str(fields.get(f["key"]) or "").strip()]
            missing += [c["label"] for c in stage.get("checklist") or [] if c.get("required") and (done.get(c["key"]) or {}).get("status") != "done"]
            if missing:
                incomplete.append({**ref, "missing": missing[:6]})
        if signal.assignee_kind == "user" and signal.assignee_id:
            planned_hours[signal.assignee_id] = planned_hours.get(signal.assignee_id, 0.0) + _hours_field(fields)

    capacity = []
    if planned_hours:
        rows = (
            await session.execute(
                select(User, Membership.hours_per_week)
                .join(Membership, Membership.user_id == User.id)
                .where(Membership.tenant_id == tenant_id, User.id.in_(list(planned_hours)))
            )
        ).all()
        for user, hours in rows:
            capacity.append({
                "name": user.display_name or user.email,
                "planned_hours": round(planned_hours.get(user.id, 0.0), 1),
                "hours_per_week": hours,
                "over": hours is not None and planned_hours.get(user.id, 0.0) > hours,
            })

    connections = []
    for conn in (
        await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.department_id == department_id,
            )
        )
    ).scalars().all():
        health = str((_json(conn.metadata_json).get("health") or {}).get("status") or "")
        if health in BAD_HEALTH:
            connections.append({"name": conn.display_name or conn.provider, "health": health})

    shift = await _scorecard_shift(session, tenant_id, [str(t.id) for t in tags]) if extended else []
    names = {str(t.id): t.name for t in tags}
    for row in shift:
        row["label"] = names.get(row["label_id"], "")

    from app.services.flow_proposals import open_proposals

    proposals = await open_proposals(session, tenant_id, department_id)
    from app.services.department_domain import open_domain_questions

    return {
        "department": dept.name if dept else "",
        "domain_questions": [
            {"key": q["key"], "question": q["question"], "asked_at": q.get("asked_at")}
            for q in open_domain_questions(dept)
        ][:MAX_ITEMS],
        "extended": extended,
        "open_tickets": len(tickets),
        "overdue": overdue[:MAX_ITEMS],
        "waiting_on_customer": waiting_long[:MAX_ITEMS],
        "incomplete": incomplete[:MAX_ITEMS],
        "capacity": capacity,
        "connections": connections,
        "scorecard_shift": shift,
        "proposals": proposals,
    }


def render_snapshot(snap: dict[str, Any]) -> str:
    lines = [f"## Orientation snapshot: {snap['department']}", f"Open tickets: {snap['open_tickets']}."]

    def block(title: str, rows: list[dict[str, Any]], fmt) -> None:
        if rows:
            lines.append(f"\n### {title}")
            lines.extend(f"- {fmt(r)}" for r in rows)

    block("Past the deadline", snap["overdue"], lambda r: f"{r['subject']} ({r['flow']}, {r['stage']}), due {r['due_at'][:10]} [signal {r['signal_id']}]")
    block("Waiting on the customer longer than the check-up", snap["waiting_on_customer"], lambda r: f"{r['subject']} ({r['flow']}, {r['stage']}), {r['waiting_days']} days [signal {r['signal_id']}]")
    block("Required fields or checklist still open", snap["incomplete"], lambda r: f"{r['subject']} ({r['flow']}, {r['stage']}): {', '.join(r['missing'])} [signal {r['signal_id']}]")
    block("Hours planned against hours available", snap["capacity"], lambda r: f"{r['name']}: {r['planned_hours']} h planned, {r['hours_per_week'] if r['hours_per_week'] is not None else 'unknown'} h a week{' (over)' if r['over'] else ''}")
    block("Connections that need attention", snap["connections"], lambda r: f"{r['name']}: {r['health']}")
    block("Scorecard over the last week", snap["scorecard_shift"], lambda r: f"#{r['label']}: autonomous {r['autonomous_from']}% to {r['autonomous_to']}%")
    block("Your improvements still waiting for a decision", snap.get("proposals") or [], lambda r: f"{r['summary']} [decision {r['decision_id']}]")
    block("Domain questions the person accountable has not answered", snap.get("domain_questions") or [], lambda r: f"{r['question']} (asked {str(r.get('asked_at') or '')[:10]})")
    if len(lines) == 2:
        lines.append("Nothing asks for action.")
    return "\n".join(lines)


ORIENTATION_TASK = (
    "You lead this department. Look through three lenses. Role: your standing brief says what you are "
    "for here; if the snapshot shows a new flow, member or autonomy, say so in one line. State: post one "
    "short briefing in this conversation: what is late, what waits too long on a customer, what is "
    "incomplete, and who is over capacity. Name who picks each item up. For an item that needs work in "
    "its own conversation, post there or assign it; do not repeat items that did not change since your "
    "last briefing. Improvements: propose at most {max_proposals} concrete improvements through "
    "propose_agent_rule, suggest_inbox_rule, update_flow, suggest_integration, or ask_domain_question "
    "when only the person accountable knows the answer. Never repeat a proposal that is still waiting "
    "or was rejected. When nothing asks for action, reply with exactly HEARTBEAT_OK."
)
ORIENTATION_TASK_MONDAY = (
    " It is the start of the week: also look at the scorecard shift and name one improvement to try."
)


async def department_for_trigger(session: AsyncSession, trigger: Trigger) -> UUID | None:
    if trigger.signal_id:
        signal = await session.get(Signal, trigger.signal_id)
        if signal is not None and signal.assignee_kind == "department" and signal.assignee_id:
            return signal.assignee_id
    return None


async def orientation_prompt(session: AsyncSession, trigger: Trigger, now: datetime) -> str | None:
    from app.services.trends import OUTWARD, department_lens, outward_prompt

    department_id = await department_for_trigger(session, trigger)
    if department_id is None:
        return None
    if department_lens(await session.get(Department, department_id)) == OUTWARD:
        return await outward_prompt(session, trigger.tenant_id)
    from app.models.agent import Agent
    from app.services.agent_awareness import DEFAULT_MAX_PROPOSALS, awareness_config

    extended = now.weekday() == 0
    snap = await department_snapshot(session, trigger.tenant_id, department_id, extended=extended)
    agent = await session.get(Agent, trigger.agent_id) if trigger.agent_id else None
    max_proposals = awareness_config(agent)["max_proposals"] if agent else DEFAULT_MAX_PROPOSALS
    task = ORIENTATION_TASK.format(max_proposals=max_proposals) + (ORIENTATION_TASK_MONDAY if extended else "")
    return f"{render_snapshot(snap)}\n\n## Your task\n{task}"


async def record_orientation(
    session: AsyncSession, trigger: Trigger, agent: Any, text: str, *, quiet: bool
) -> None:
    """After an orientation: the standing brief on the agent. Caller commits."""
    from app.services.agent_awareness import store_brief

    department_id = await department_for_trigger(session, trigger)
    snap = (
        await department_snapshot(session, trigger.tenant_id, department_id)
        if department_id is not None
        else None
    )
    await store_brief(session, agent, department_id=department_id, text=text, quiet=quiet, snapshot=snap)


async def ensure_orientations(session: AsyncSession, tenant_id: UUID) -> list[Trigger]:
    """One orientation per department with a lead agent, in the department room."""
    from app.services.department_access import department_leads
    from app.services.teams import get_or_create_team_room
    from app.services.thread_schedule import mirror_next_at
    from app.services.trends import OUTWARD, OUTWARD_CRON, department_lens
    from app.services.triggers import compute_next_run

    out: list[Trigger] = []
    departments = (
        await session.execute(
            select(Department).where(
                Department.tenant_id == tenant_id,
                Department.deleted_at.is_(None),
                Department.parent_id.is_not(None),
            )
        )
    ).scalars().all()
    for dept in departments:
        lead = (await department_leads(session, tenant_id, dept.id))["lead_agent_id"]
        if lead is None:
            continue
        room = await get_or_create_team_room(session, tenant_id, dept)
        await session.flush()
        existing = (
            await session.execute(
                select(Trigger).where(
                    Trigger.tenant_id == tenant_id,
                    Trigger.purpose == ORIENTATION,
                    Trigger.signal_id == room.id,
                    Trigger.deleted_at.is_(None),
                )
            )
        ).scalars().first()
        cron = OUTWARD_CRON if department_lens(dept) == OUTWARD else ORIENTATION_CRON
        row = existing or Trigger(
            tenant_id=tenant_id,
            name=f"Orientation {dept.name}",
            kind="cron",
            cron_expr=cron,
            purpose=ORIENTATION,
            signal_id=room.id,
        )
        row.agent_id = lead
        row.enabled = True
        if row.cron_expr != cron:
            row.cron_expr = cron
            row.next_run_at = None
        if row.next_run_at is None:
            row.next_run_at = compute_next_run(row)
        session.add(row)
        await session.flush()
        mirror_next_at(room, row)
        session.add(room)
        out.append(row)
    return out
