"""One department at a glance: who is responsible, and how the work runs.

The department page reads this in one call: the lead and the person
accountable with presence, what asks attention today, the lead's improvement
proposals, the work per flow and stage, the people and agents, the lead's
awareness, what the department can reach, the folders its work lands in, the
pushes and calls, the domain questions, the outcomes, and the Grid link.
Per flow (``Workstream.department_id``) it counts open, waiting and overdue
tickets and attaches the latest label scorecard (services/learning.py).
"""

from __future__ import annotations

from app.core.time import utcnow

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Membership, User
from app.models.learning import EvalScore
from app.models.orchestra import Workstream
from app.models.signal import Signal, SignalTag
from app.models.team import Department, DepartmentMember
from app.services.department_access import department_leads
from app.services.flow_proposals import open_proposals
from app.services.trash import alive


async def latest_scorecards(session: AsyncSession, tenant_id: UUID, label_ids: list[str]) -> dict[str, dict]:
    from app.services.learning import LABEL_SCORECARD

    if not label_ids:
        return {}
    rows = (
        await session.execute(
            select(EvalScore)
            .where(
                EvalScore.tenant_id == tenant_id,
                EvalScore.scope == "label",
                EvalScore.metric == LABEL_SCORECARD,
                EvalScore.scope_id.in_(label_ids),
            )
            .order_by(EvalScore.created_at.desc())
        )
    ).scalars().all()
    out: dict[str, dict] = {}
    for row in rows:
        if row.scope_id in out:
            continue
        try:
            card = json.loads(row.details_json or "{}")
        except json.JSONDecodeError:
            card = {}
        out[row.scope_id] = card if isinstance(card, dict) else {}
    return out


async def _hours(session: AsyncSession, tenant_id: UUID, user_ids: list[UUID]) -> dict[UUID, int | None]:
    if not user_ids:
        return {}
    rows = (
        await session.execute(
            select(Membership.user_id, Membership.hours_per_week).where(
                Membership.tenant_id == tenant_id, Membership.user_id.in_(user_ids)
            )
        )
    ).all()
    return {uid: hours for uid, hours in rows}


async def department_overview(session: AsyncSession, tenant_id: UUID, department_id: UUID) -> dict[str, Any] | None:
    dept = await session.get(Department, department_id)
    if dept is None or dept.tenant_id != tenant_id or dept.deleted_at is not None:
        return None
    leads = await department_leads(session, tenant_id, department_id)
    lead = await session.get(Agent, leads["lead_agent_id"]) if leads["lead_agent_id"] else None
    accountable = await session.get(User, leads["accountable_user_id"]) if leads["accountable_user_id"] else None

    members = (
        await session.execute(
            select(DepartmentMember)
            .where(DepartmentMember.tenant_id == tenant_id, DepartmentMember.department_id == department_id)
            .order_by(DepartmentMember.position)
        )
    ).scalars().all()
    user_ids = [m.user_id for m in members if m.member_kind == "user" and m.user_id]
    hours = await _hours(session, tenant_id, user_ids)
    users = {
        u.id: u for u in (await session.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
    } if user_ids else {}
    agent_ids = [m.agent_id for m in members if m.member_kind == "agent" and m.agent_id]
    agents = {
        a.id: a for a in (await session.execute(select(Agent).where(Agent.id.in_(agent_ids)))).scalars().all()
    } if agent_ids else {}
    open_per_user = dict(
        (
            await session.execute(
                select(Signal.assignee_id, func.count())
                .where(
                    Signal.tenant_id == tenant_id,
                    alive(Signal),
                    Signal.status == "open",
                    Signal.assignee_kind == "user",
                    Signal.assignee_id.in_(user_ids),
                )
                .group_by(Signal.assignee_id)
            )
        ).all()
    ) if user_ids else {}
    from app.services.presence import connected_user_ids_for, visible_user_status

    connected = connected_user_ids_for(tenant_id)
    now = utcnow()
    cost = await _agent_costs(session, tenant_id, agent_ids, days=PERIOD_DAYS)

    def presence(user: User) -> str:
        return visible_user_status(user, connected=str(user.id) in connected, now=now)

    people = []
    for m in members:
        if m.member_kind == "user" and m.user_id in users:
            u = users[m.user_id]
            people.append({
                "kind": "user",
                "id": str(u.id),
                "name": u.display_name or u.email,
                "duty": m.duty,
                "hours_per_week": hours.get(u.id),
                "open_assigned": int(open_per_user.get(u.id, 0)),
                "presence": presence(u),
            })
        elif m.member_kind == "agent" and m.agent_id in agents:
            a = agents[m.agent_id]
            people.append({
                "kind": "agent",
                "id": str(a.id),
                "name": a.name,
                "duty": m.duty,
                "status": a.runtime_status or "standby",
                "doing": a.current_activity_summary or "",
                "cost_cents": cost.get(a.id, 0),
            })

    flows = (
        await session.execute(
            select(Workstream)
            .where(Workstream.tenant_id == tenant_id, Workstream.department_id == department_id)
            .order_by(Workstream.name)
        )
    ).scalars().all()
    tags = {
        t.workstream_id: t
        for t in (
            await session.execute(
                select(SignalTag).where(
                    SignalTag.tenant_id == tenant_id,
                    SignalTag.workstream_id.in_([f.id for f in flows]),
                )
            )
        ).scalars().all()
    } if flows else {}
    tag_ids = [t.id for t in tags.values()]
    counts: dict[UUID, dict[str, int]] = {}
    if tag_ids:
        now = utcnow()
        rows = (
            await session.execute(
                select(
                    Signal.ticket_tag_id,
                    func.count().filter(Signal.ticket_status == "open"),
                    func.count().filter(Signal.ticket_status == "waiting"),
                    func.count().filter(
                        Signal.ticket_status.in_(("open", "waiting")),
                        Signal.due_at.is_not(None),
                        Signal.due_at < now,
                    ),
                )
                .where(Signal.tenant_id == tenant_id, alive(Signal), Signal.ticket_tag_id.in_(tag_ids))
                .group_by(Signal.ticket_tag_id)
            )
        ).all()
        counts = {tid: {"open": int(o or 0), "waiting": int(w or 0), "overdue": int(d or 0)} for tid, o, w, d in rows}
    cards = await latest_scorecards(session, tenant_id, [str(t) for t in tag_ids])
    tickets = (
        await session.execute(
            select(Signal).where(
                Signal.tenant_id == tenant_id,
                alive(Signal),
                Signal.ticket_tag_id.in_(tag_ids),
                Signal.ticket_status.in_(("open", "waiting")),
            )
        )
    ).scalars().all() if tag_ids else []
    flow_rows = []
    for flow in flows:
        tag = tags.get(flow.id)
        c = counts.get(tag.id, {}) if tag else {}
        row = _flow_row(flow, tag, tickets, now)
        row.update({
            "open": c.get("open", 0),
            "waiting": c.get("waiting", 0),
            "overdue": c.get("overdue", 0),
            "scorecard": cards.get(str(tag.id)) if tag else None,
        })
        flow_rows.append(row)

    from app.models.auth import Tenant
    from app.modules.catalog import MODULE_BY_SLUG
    from app.services.agent_avatar import avatar_payload
    from app.services.agent_awareness import awareness_view
    from app.services.ai_handling import resolve_ai_handling
    from app.services.department_domain import domain_questions
    from app.services.flow_proposals import proposal_history
    from app.services.reach import reach_summary
    from app.services.teams import get_or_create_team_room

    tenant = await session.get(Tenant, tenant_id)
    room = await get_or_create_team_room(session, tenant_id, dept)
    await session.flush()
    module = MODULE_BY_SLUG.get(dept.origin_module_slug or "")
    history = await proposal_history(session, tenant_id, dept.id)
    totals = {key: sum(row[key] for row in flow_rows) for key in ("open", "waiting", "overdue")}
    lands = await _lands(session, tenant_id, dept, tickets)

    return {
        "id": str(dept.id),
        "name": dept.name,
        "description": dept.description or "",
        "icon": department_icon(dept),
        "lead": (
            {
                "id": str(lead.id),
                "name": lead.name,
                "status": lead.runtime_status or "standby",
                **{k: v for k, v in avatar_payload(lead).items() if k.startswith("avatar_")},
            }
            if lead
            else None
        ),
        "accountable": (
            {
                "id": str(accountable.id),
                "name": accountable.display_name or accountable.email,
                "presence": presence(accountable),
            }
            if accountable
            else None
        ),
        "autonomy": resolve_ai_handling(tenant, scope="workspace", agent=lead).effective if tenant else None,
        "origin_module": {"slug": module.slug, "name": module.name} if module else None,
        "room_signal_id": str(room.id),
        "pickup": dept.pickup or "people",
        "members": people,
        "flows": flow_rows,
        "totals": totals,
        "today": await _today(session, tenant_id, dept, tickets, lead, room, now),
        "proposals": await open_proposals(session, tenant_id, dept.id),
        "proposal_history": history,
        "awareness": await awareness_view(session, lead) if lead else None,
        "reach": await _reach(session, tenant_id, dept, flow_rows),
        "lands": lands,
        "folders": _folder_scopes(lands, flows, tags, tickets, now),
        "reach_attempts": await reach_summary(session, tenant_id, dept.id),
        "domain_questions": [
            {k: q.get(k) for k in ("key", "question", "answer", "status", "asked_at", "answered_at", "signal_id", "message_id")}
            for q in reversed(domain_questions(dept))
        ],
        "outcomes": await _outcomes(session, tenant_id, flows, history),
        "grid_href": f"/workforce/workflow?department={dept.id}",
    }


PERIOD_DAYS = 7


def _flow_row(flow: Workstream, tag: SignalTag | None, tickets: list[Signal], now: datetime) -> dict[str, Any]:
    """One flow with its stage pipeline, counted over the given open and waiting tickets."""
    from app.services.tickets import workstream_stages

    soon = now + timedelta(days=7)
    mine = [t for t in tickets if tag and t.ticket_tag_id == tag.id]
    stages = []
    for stage in workstream_stages(flow):
        here = [t for t in mine if t.stage_key == stage["key"]]
        stages.append({
            "key": stage["key"],
            "name": stage.get("name") or stage["key"],
            "kind": stage.get("kind") or "open",
            "count": len(here),
            "overdue": sum(1 for t in here if t.due_at and t.due_at < now),
            "soon": sum(1 for t in here if t.due_at and now <= t.due_at < soon),
        })
    return {
        "id": str(flow.id),
        "name": flow.name,
        "label": tag.name if tag else "",
        "label_id": str(tag.id) if tag else None,
        "autonomy": flow.autonomy or "",
        "open": sum(1 for t in mine if t.ticket_status == "open"),
        "waiting": sum(1 for t in mine if t.ticket_status == "waiting"),
        "overdue": sum(1 for t in mine if t.due_at and t.due_at < now),
        "scorecard": None,
        "stages": stages,
        "board_href": f"/flows/{flow.id}",
    }


def _folder_scopes(
    lands: list[dict[str, Any]],
    flows: list[Workstream],
    tags: dict[UUID, SignalTag],
    tickets: list[Signal],
    now: datetime,
) -> list[dict[str, Any]]:
    """The department's work per folder it lands in: totals, flows with tickets there, and what is late."""
    week = now + timedelta(days=7)
    out = []
    for land in lands:
        here = [t for t in tickets if t.project_id and str(t.project_id) == land["id"]]
        rows = [_flow_row(flow, tags.get(flow.id), here, now) for flow in flows]
        rows = [r for r in rows if r["open"] or r["waiting"]]
        out.append({
            **land,
            "totals": {key: sum(r[key] for r in rows) for key in ("open", "waiting", "overdue")},
            "bottlenecks": [
                b
                for b in (
                    {"key": "unassigned", "count": sum(1 for t in here if t.assignee_kind in ("", "department"))},
                    {"key": "overdue", "count": sum(1 for t in here if t.due_at and t.due_at < now)},
                    {"key": "due_this_week", "count": sum(1 for t in here if t.due_at and now <= t.due_at < week)},
                )
                if b["count"]
            ],
            "flows": rows,
        })
    return out


async def folder_departments(
    session: AsyncSession, tenant_id: UUID, folder: Any, subtree_ids: list[UUID]
) -> list[dict[str, Any]]:
    """Who works here: the folder's home department, then every department with open tickets below it."""
    from app.models.team import is_root_department

    rows = (
        await session.execute(
            select(Workstream.department_id, func.count(Signal.id))
            .join(SignalTag, SignalTag.id == Signal.ticket_tag_id)
            .join(Workstream, Workstream.id == SignalTag.workstream_id)
            .where(
                Signal.tenant_id == tenant_id,
                alive(Signal),
                Signal.project_id.in_(subtree_ids),
                Signal.ticket_status.in_(("open", "waiting")),
                Workstream.department_id.is_not(None),
            )
            .group_by(Workstream.department_id)
        )
    ).all()
    counts = {dept_id: int(n or 0) for dept_id, n in rows}
    home = getattr(folder, "department_id", None)
    ids = set(counts) | ({home} if home else set())
    if not ids:
        return []
    depts = (
        await session.execute(
            select(Department).where(
                Department.tenant_id == tenant_id, Department.id.in_(ids), Department.deleted_at.is_(None)
            )
        )
    ).scalars().all()
    out = [
        {
            "id": str(d.id),
            "name": d.name,
            "icon": department_icon(d),
            "home": d.id == home,
            "open": counts.get(d.id, 0),
            "href": f"/departments/{d.id}",
        }
        for d in depts
        if not is_root_department(d)
    ]
    return sorted(out, key=lambda r: (not r["home"], -r["open"], r["name"].lower()))


async def _agent_costs(session: AsyncSession, tenant_id: UUID, agent_ids: list[UUID], *, days: int) -> dict[UUID, int]:
    from app.models.usage import UsageLedger

    if not agent_ids:
        return {}
    rows = (
        await session.execute(
            select(UsageLedger.agent_id, func.coalesce(func.sum(UsageLedger.cost_cents), 0))
            .where(
                UsageLedger.tenant_id == tenant_id,
                UsageLedger.agent_id.in_(agent_ids),
                UsageLedger.created_at >= utcnow() - timedelta(days=days),
            )
            .group_by(UsageLedger.agent_id)
        )
    ).all()
    return {aid: int(total or 0) for aid, total in rows}


async def _today(
    session: AsyncSession,
    tenant_id: UUID,
    dept: Department,
    tickets: list[Signal],
    lead: Agent | None,
    room: Signal,
    now: datetime,
) -> dict[str, Any]:
    """Bottlenecks, waiting decisions and the lead's last orientation."""
    from app.models.notification import DecisionRequest
    from app.services.agent_awareness import awareness_config

    week = now + timedelta(days=7)
    bottlenecks = [
        # Held by a department queue means nobody picked it up yet.
        {"key": "unassigned", "count": sum(1 for t in tickets if t.assignee_kind in ("", "department"))},
        {"key": "overdue", "count": sum(1 for t in tickets if t.due_at and t.due_at < now)},
        {"key": "due_this_week", "count": sum(1 for t in tickets if t.due_at and now <= t.due_at < week)},
    ]
    ids = [t.id for t in tickets] + [room.id]
    decisions = int(
        (
            await session.execute(
                select(func.count(DecisionRequest.id)).where(
                    DecisionRequest.tenant_id == tenant_id,
                    DecisionRequest.status == "awaiting_human",
                    (DecisionRequest.signal_id.in_(ids)) | (DecisionRequest.addressee_department_id == dept.id),
                )
            )
        ).scalar_one()
        or 0
    )
    brief = awareness_config(lead)["brief"] if lead else None
    return {
        "bottlenecks": [b for b in bottlenecks if b["count"]],
        "decisions_waiting": decisions,
        "orientation": (
            {
                "at": brief.get("at"),
                "summary": brief.get("summary") or "",
                "quiet": bool(brief.get("quiet")),
                "signal_id": str(room.id),
            }
            if brief
            else None
        ),
    }


async def _reach(session: AsyncSession, tenant_id: UUID, dept: Department, flow_rows: list[dict]) -> dict[str, Any]:
    """Own flows and labels, the channels and connections it may use, the organizations it owns."""
    from app.models.channel import ChannelAccount, Company, Contact
    from app.models.integration import IntegrationConnection
    from app.models.relations import ResourceGrant

    grants = (
        await session.execute(
            select(ResourceGrant).where(ResourceGrant.tenant_id == tenant_id, ResourceGrant.department_id == dept.id)
        )
    ).scalars().all()
    account_ids = {g.channel_account_id for g in grants if g.channel_account_id}
    connection_ids = {g.connection_id for g in grants if g.connection_id}
    connection_ids |= set(
        (
            await session.execute(
                select(IntegrationConnection.id).where(
                    IntegrationConnection.tenant_id == tenant_id, IntegrationConnection.department_id == dept.id
                )
            )
        ).scalars().all()
    )
    channels = [
        {"id": str(a.id), "name": a.display_name or a.address, "channel": a.channel}
        for a in (
            await session.execute(select(ChannelAccount).where(ChannelAccount.id.in_(account_ids)))
        ).scalars().all()
    ] if account_ids else []
    connections = [
        {"id": str(c.id), "name": c.display_name or c.provider, "provider": c.provider}
        for c in (
            await session.execute(select(IntegrationConnection).where(IntegrationConnection.id.in_(connection_ids)))
        ).scalars().all()
    ] if connection_ids else []
    company_ids = set(
        (
            await session.execute(
                select(Contact.company_id).where(
                    Contact.tenant_id == tenant_id,
                    Contact.owner_department_id == dept.id,
                    Contact.company_id.is_not(None),
                )
            )
        ).scalars().all()
    )
    organizations = [
        {"id": str(c.id), "name": c.name}
        for c in (await session.execute(select(Company).where(Company.id.in_(company_ids)))).scalars().all()
    ] if company_ids else []
    modules = sorted({g.module_slug for g in grants if g.module_slug})
    return {
        "flows": [{"id": f["id"], "name": f["name"], "label": f["label"]} for f in flow_rows],
        "channels": channels,
        "connections": connections,
        "modules": modules,
        "organizations": organizations,
    }


async def _lands(session: AsyncSession, tenant_id: UUID, dept: Department, tickets: list[Signal]) -> list[dict[str, Any]]:
    """Folders the department's open tickets land in, with its home folders first."""
    from app.models.project import Project

    counts: dict[UUID, int] = {}
    for t in tickets:
        if t.project_id:
            counts[t.project_id] = counts.get(t.project_id, 0) + 1
    homes = set(
        (
            await session.execute(
                select(Project.id).where(
                    Project.tenant_id == tenant_id, Project.department_id == dept.id, Project.deleted_at.is_(None)
                )
            )
        ).scalars().all()
    )
    ids = set(counts) | homes
    if not ids:
        return []
    folders = (
        await session.execute(select(Project).where(Project.id.in_(ids), Project.deleted_at.is_(None)))
    ).scalars().all()
    rows = [
        {"id": str(f.id), "name": f.name, "open": counts.get(f.id, 0), "home": f.id in homes, "href": f"/folders/{f.id}"}
        for f in folders
    ]
    return sorted(rows, key=lambda r: (not r["home"], -r["open"], r["name"].lower()))


async def _outcomes(
    session: AsyncSession, tenant_id: UUID, flows: list[Workstream], history: list[dict[str, Any]]
) -> dict[str, Any]:
    """Accepted and rejected proposals, and corrections per flow over the last month."""
    from app.models.learning import Feedback

    since = utcnow() - timedelta(days=30)
    per_flow = []
    for flow in flows:
        down = int(
            (
                await session.execute(
                    select(func.count(Feedback.id)).where(
                        Feedback.tenant_id == tenant_id,
                        Feedback.created_at >= since,
                        Feedback.metadata_json.contains(str(flow.id)),
                    )
                )
            ).scalar_one()
            or 0
        )
        per_flow.append({"id": str(flow.id), "name": flow.name, "feedback": down})
    return {
        "accepted": sum(1 for h in history if h["status"] == "accepted"),
        "rejected": sum(1 for h in history if h["status"] == "rejected"),
        "per_flow": per_flow,
    }


DEFAULT_DEPARTMENT_ICON = "building-2"


def department_icon(dept: Department) -> str:
    try:
        settings = json.loads(dept.settings_json or "{}")
    except (TypeError, ValueError):
        settings = {}
    icon = settings.get("icon") if isinstance(settings, dict) else None
    return icon if isinstance(icon, str) and icon else DEFAULT_DEPARTMENT_ICON


async def nav_departments(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    user_id: UUID | None,
    role: str,
    visible_account_ids: set[UUID] | None,
) -> list[dict[str, Any]]:
    """The departments in the left menu: name, icon and open tickets.

    Owners and admins see every department. Everyone else sees the departments
    they are in and those below them. The All root is never a row. The open
    count is the open and waiting tickets on the department's own flows that
    the caller can see.
    """
    from app.services.counts import OPEN_TICKET_STATUSES, conversation_scope
    from app.services.department_access import accessible_department_ids
    from app.services.teams import list_teams

    depts = await list_teams(session, tenant_id, include_system=False)
    if role not in ("owner", "admin"):
        allowed = await accessible_department_ids(session, tenant_id, user_id) if user_id else set()
        depts = [d for d in depts if d.id in allowed]
    if not depts:
        return []
    dept_ids = [d.id for d in depts]
    rows = (
        await session.execute(
            select(Workstream.department_id, func.count(Signal.id))
            .join(SignalTag, SignalTag.workstream_id == Workstream.id)
            .join(Signal, Signal.ticket_tag_id == SignalTag.id)
            .where(
                Workstream.tenant_id == tenant_id,
                Workstream.department_id.in_(dept_ids),
                Signal.ticket_status.in_(OPEN_TICKET_STATUSES),
                *conversation_scope(tenant_id, user_id, visible_account_ids),
            )
            .group_by(Workstream.department_id)
        )
    ).all()
    counts = {dept_id: int(n or 0) for dept_id, n in rows}
    return [
        {
            "id": str(d.id),
            "name": d.name,
            "icon": department_icon(d),
            "open": counts.get(d.id, 0),
            "href": f"/departments/{d.id}",
        }
        for d in depts
    ]
