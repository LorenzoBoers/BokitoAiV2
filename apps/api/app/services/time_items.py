"""One time model for everything that happens over time.

Agenda, the agent activity timeline and the agent detail strip all read
``list_time_items``. Every row has the same shape:

``{id, kind, trigger_kind, run_type, start, end, title, status, agent_id, agent_name,
agent_role, actor_kind, actor_id, actor_name, owner_kind, owner_id, owner_name,
project_id, series_id, instructions, enabled, trigger_id, run_id, signal_id, source}``
plus calendar and check-up extras.

``kind`` is one of:

- ``session``: an ``AgentRun`` (past or running work).
- ``wake``: a planned trigger moment, or a fired one-shot without a run
  (shown on Agenda under the Tasks layer).
- ``checkup``: a stage follow-up trigger (``Trigger.purpose=stage_checkup``);
  Agenda folds it into Tasks — same concept as a recurring task.
- ``task``: an ``AgentTask`` with ``scheduled_for`` (human or agent).
- ``calendar``: an external calendar event (merged across connections).
- ``activity``: something that happened (ticket filed or moved, owner
  changed, conversation closed, decision asked or answered). Only returned
  when asked for, so planning views stay calm.

Look-ats (``Signal.follow_up_at``) are retired: create a human ``AgentTask``
instead. The Agenda UI no longer has separate reminder/checkup/routine layers.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun
from app.models.trigger import Trigger

TIME_KINDS = frozenset({"session", "wake", "checkup", "task", "calendar", "activity"})
DEFAULT_KINDS = TIME_KINDS - {"activity"}

MAX_SESSIONS = 400
MAX_ACTIVITY = 400

# On-demand runs whose ``trigger_id`` is the conversation they answered.
_CONVERSATION_TRIGGERS = frozenset(
    {"chat", "email", "widget", "inbound", "webchat", "whatsapp", "customer_widget"}
)

# Conversation events worth a row on the Agenda, with the status they carry.
_ACTIVITY_EVENTS = {
    "category_set": "filed",
    "ticket_stage_changed": "stage",
    "assigned": "assigned",
    "thread_updated": "closed",
}


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(microsecond=0).isoformat()


def _uuid(value: str | None) -> UUID | None:
    if not value:
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _row(
    *,
    id: str,
    kind: str,
    start: datetime | str | None,
    title: str,
    status: str,
    end: datetime | str | None = None,
    trigger_kind: str | None = None,
    agent_id: UUID | str | None = None,
    agent_name: str | None = None,
    agent_role: str = "",
    actor_kind: str = "agent",
    actor_id: UUID | str | None = None,
    actor_name: str | None = None,
    owner: tuple[str | None, str | None, str | None] = (None, None, None),
    project_id: UUID | str | None = None,
    series_id: str | None = None,
    instructions: str = "",
    enabled: bool = True,
    trigger_id: str | None = None,
    run_id: str | None = None,
    signal_id: str | None = None,
    source: str | None = None,
    run_type: str | None = None,
) -> dict[str, Any]:
    agent = str(agent_id) if agent_id else None
    actor = str(actor_id) if actor_id else (agent if actor_kind == "agent" else None)
    return {
        "id": id,
        "kind": kind,
        "trigger_kind": trigger_kind,
        "start": start if isinstance(start, str) or start is None else _iso(start),
        "end": end if isinstance(end, str) or end is None else _iso(end),
        "title": title,
        "status": status,
        "agent_id": agent,
        "agent_name": agent_name,
        "agent_role": agent_role,
        "actor_kind": actor_kind,
        "actor_id": actor,
        "actor_name": actor_name or agent_name,
        "owner_kind": owner[0],
        "owner_id": owner[1],
        "owner_name": owner[2],
        "project_id": str(project_id) if project_id else None,
        "series_id": series_id,
        "instructions": instructions,
        "enabled": enabled,
        "trigger_id": trigger_id,
        "run_id": run_id,
        "signal_id": signal_id,
        "source": source or kind,
        "run_type": run_type,
    }


def _is_runnable_company(agent: Agent) -> bool:
    return (
        agent.kind == "company"
        and bool(agent.is_active)
        and not bool(agent.acts_for_user)
    )


def _lead_agent(agents: list[Agent]) -> Agent | None:
    """Same fallback as ``lead_agent.get_lead_agent``, from agents already loaded."""
    company = [a for a in agents if _is_runnable_company(a)]
    leads = [a for a in company if a.is_lead]
    if leads:
        return min(leads, key=lambda a: a.created_at or datetime.min)
    assistants = [a for a in company if (a.role or "") == "assistant"]
    pool = assistants or company
    if not pool:
        return None
    return min(pool, key=lambda a: a.created_at or datetime.min)


def _agent_for_trigger(trigger: Trigger, agents: list[Agent]) -> Agent | None:
    """Who actually fires the trigger — never a role slug such as ``orchestrator``."""
    by_id = {a.id: a for a in agents}
    if trigger.agent_id:
        bound = by_id.get(trigger.agent_id)
        if bound is not None:
            return bound if _is_runnable_company(bound) else None
    role = (trigger.agent_role or "orchestra").strip()
    roles = ("orchestra", "orchestrator") if role in ("orchestra", "orchestrator") else (role,)
    for agent in agents:
        if _is_runnable_company(agent) and (agent.role or "") in roles:
            return agent
    return _lead_agent(agents)


def _wake_who(
    trigger: Trigger, agents: list[Agent]
) -> tuple[str, UUID | None, str | None]:
    """Actor kind, agent id and display name for a planned wake."""
    if trigger.kind == "event":
        return "person", None, None
    agent = _agent_for_trigger(trigger, agents)
    if agent is None:
        return "agent", None, None
    return "agent", agent.id, agent.name


class _Names:
    """Display names for the people, agents and teams of one workspace."""

    def __init__(self, agents: dict[UUID, str], users: dict[UUID, str], teams: dict[UUID, str]):
        self.agents, self.users, self.teams = agents, users, teams

    def owner(self, signal: Any) -> tuple[str | None, str | None, str | None]:
        kind = getattr(signal, "assignee_kind", "") or ""
        if kind == "user" and signal.assigned_user_id:
            return "user", str(signal.assigned_user_id), self.users.get(signal.assigned_user_id)
        if kind == "agent" and signal.agent_id:
            return "agent", str(signal.agent_id), self.agents.get(signal.agent_id)
        if kind == "team" and signal.assignee_team_id:
            return "team", str(signal.assignee_team_id), self.teams.get(signal.assignee_team_id)
        return None, None, None

    def payload_owner(self, raw: Any) -> str:
        """Name in an ``owner_payload`` dict (``assigned`` events)."""
        if not isinstance(raw, dict):
            return ""
        kind = raw.get("kind")
        table = {"user": self.users, "agent": self.agents, "team": self.teams}.get(kind or "", {})
        ref = _uuid(raw.get(f"{kind}_id"))
        return table.get(ref, "") if ref else ""

    def actor(self, actor_type: str, actor_id: str) -> tuple[str, str | None, str | None]:
        ref = _uuid(actor_id)
        if actor_type in ("agent", "workstream_run") and ref in self.agents:
            return "agent", str(ref), self.agents[ref]
        if actor_type == "user" and ref in self.users:
            return "person", str(ref), self.users[ref]
        if ref in self.users:
            return "person", str(ref), self.users[ref]
        if ref in self.agents:
            return "agent", str(ref), self.agents[ref]
        return "system", None, None


async def _names(session: AsyncSession, tenant_id: UUID, agents: Iterable[Agent]) -> _Names:
    from app.models.auth import Membership, User
    from app.models.team import Team

    users = {
        uid: (name or email)
        for uid, name, email in (
            await session.execute(
                select(User.id, User.display_name, User.email)
                .join(Membership, Membership.user_id == User.id)
                .where(Membership.tenant_id == tenant_id)
            )
        ).all()
    }
    teams = {
        tid: name
        for tid, name in (
            await session.execute(select(Team.id, Team.name).where(Team.tenant_id == tenant_id))
        ).all()
    }
    return _Names({a.id: a.name for a in agents}, users, teams)


async def _session_signal_ids(
    session: AsyncSession, runs: Iterable[AgentRun], triggers: dict[str, Trigger]
) -> dict[UUID, str]:
    """One resolution order: trigger thread, then task thread, then the
    conversation an on-demand run answered."""
    from app.models.orchestration import AgentTask

    runs = list(runs)
    task_ids = {run.task_id for run in runs if run.task_id}
    task_signal: dict[UUID, str] = {}
    if task_ids:
        rows = await session.execute(
            select(AgentTask.id, AgentTask.signal_id).where(AgentTask.id.in_(task_ids))
        )
        task_signal = {tid: str(sid) for tid, sid in rows.all() if sid}
    out: dict[UUID, str] = {}
    for run in runs:
        trigger = triggers.get(run.trigger_id or "")
        if trigger is not None and trigger.signal_id:
            out[run.id] = str(trigger.signal_id)
        elif run.task_id and run.task_id in task_signal:
            out[run.id] = task_signal[run.task_id]
        elif run.trigger_type in _CONVERSATION_TRIGGERS and _uuid(run.trigger_id):
            out[run.id] = str(run.trigger_id)
    return out


async def _signals(session: AsyncSession, tenant_id: UUID, ids: Iterable[UUID]) -> dict[UUID, Any]:
    from app.models.signal import Signal

    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    rows = await session.execute(
        select(Signal).where(Signal.tenant_id == tenant_id, Signal.id.in_(wanted))
    )
    return {s.id: s for s in rows.scalars().all()}


def merge_calendar_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per real meeting: the same event synced through two connections
    (or listed in two calendars) collapses into the first, which keeps every
    calendar name in ``calendars``."""
    merged: dict[tuple[str, str, str], dict[str, Any]] = {}
    out: list[dict[str, Any]] = []
    for event in events:
        key = (
            (event.get("title") or "").strip().lower(),
            str(event.get("start") or ""),
            str(event.get("end") or ""),
        )
        name = event.get("calendar_name") or event.get("provider_label") or ""
        first = merged.get(key)
        if first is None:
            event = dict(event)
            event["calendars"] = [name] if name else []
            merged[key] = event
            out.append(event)
        elif name and name not in first["calendars"]:
            first["calendars"].append(name)
    return out


DUE_WINDOW_DAYS = 30


async def due_for_user(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> int:
    """Agenda items waiting on this person now: due human tasks and due
    stage follow-ups on open conversations assigned to them (last 30 days)."""
    from datetime import timedelta

    from sqlalchemy import func

    from app.models.orchestration import AgentTask
    from app.models.signal import Signal

    now = datetime.utcnow()
    mine = (
        Signal.tenant_id == tenant_id,
        Signal.assignee_kind == "user",
        Signal.assigned_user_id == user_id,
        Signal.status == "open",
    )
    tasks = (
        await session.execute(
            select(func.count()).select_from(AgentTask).where(
                AgentTask.tenant_id == tenant_id,
                AgentTask.assignee_kind == "human",
                AgentTask.assignee_user_id == user_id,
                AgentTask.deleted_at.is_(None),
                AgentTask.status.in_(("queued", "awaiting_human")),
                AgentTask.scheduled_for.is_not(None),
                AgentTask.scheduled_for <= now,
                AgentTask.scheduled_for >= now - timedelta(days=DUE_WINDOW_DAYS),
            )
        )
    ).scalar_one()
    checkups = (
        await session.execute(
            select(func.count(func.distinct(Trigger.signal_id)))
            .select_from(Trigger)
            .join(Signal, Signal.id == Trigger.signal_id)
            .where(
                *mine,
                Trigger.tenant_id == tenant_id,
                Trigger.purpose == "stage_checkup",
                Trigger.deleted_at.is_(None),
                Trigger.enabled.is_(True),
                Trigger.next_run_at.is_not(None),
                Trigger.next_run_at <= now,
            )
        )
    ).scalar_one()
    return int(tasks or 0) + int(checkups or 0)


async def list_time_items(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    start: datetime,
    end: datetime,
    agent_id: UUID | None = None,
    sources: Iterable[str] | None = None,
    scheduled_only: bool = False,
    project_id: UUID | None = None,
    connection_ids: Iterable[str] | None = None,
) -> list[dict[str, Any]]:
    """Every time item in [start, end], sorted by start.

    ``sources`` limits the kinds returned (``activity`` only when listed).
    ``scheduled_only`` keeps only sessions fired by a trigger (planning view);
    on-demand work such as email replies stays on the activity timeline.
    ``project_id`` keeps items tied to that project's conversations or runs.
    ``connection_ids`` limits calendar events to those connections (None = all).
    """
    from app.services.triggers import _planned_occurrences

    # Legacy clients may still ask for follow_up; map to task.
    raw_sources = set(sources) if sources else None
    if raw_sources and "follow_up" in raw_sources:
        raw_sources = (raw_sources - {"follow_up"}) | {"task"}
    wanted = TIME_KINDS & raw_sources if raw_sources else set(DEFAULT_KINDS)
    calendar_filter = {str(x) for x in connection_ids} if connection_ids is not None else None
    now = datetime.utcnow()

    agents = (await session.execute(select(Agent).where(Agent.tenant_id == tenant_id))).scalars().all()
    names = await _names(session, tenant_id, agents)
    agent_names = names.agents

    trigger_stmt = select(Trigger).where(Trigger.tenant_id == tenant_id, Trigger.deleted_at.is_(None))
    triggers = list((await session.execute(trigger_stmt)).scalars().all())
    trigger_by_id = {str(t.id): t for t in triggers}
    checkups = [t for t in triggers if t.purpose == "stage_checkup"]
    wakes = [t for t in triggers if t.purpose != "stage_checkup"]
    if agent_id:
        wakes = [t for t in wakes if t.agent_id == agent_id]

    linked = await _signals(
        session, tenant_id, [t.signal_id for t in triggers if t.signal_id]
    )

    items: list[dict[str, Any]] = []
    session_trigger_ids: set[str] = set()

    if "session" in wanted:
        run_stmt = select(AgentRun).where(
            AgentRun.tenant_id == tenant_id,
            AgentRun.started_at <= end,
            or_(AgentRun.completed_at.is_(None), AgentRun.completed_at >= start),
        )
        if agent_id:
            run_stmt = run_stmt.where(AgentRun.agent_id == agent_id)
        if project_id:
            run_stmt = run_stmt.where(AgentRun.project_id == project_id)
        if scheduled_only:
            if not trigger_by_id:
                run_stmt = None
            else:
                run_stmt = run_stmt.where(AgentRun.trigger_id.in_(list(trigger_by_id)))
        runs: list[AgentRun] = []
        if run_stmt is not None:
            run_stmt = run_stmt.order_by(AgentRun.started_at.desc()).limit(MAX_SESSIONS)
            runs = list((await session.execute(run_stmt)).scalars().all())
        signals = await _session_signal_ids(session, runs, trigger_by_id)
        for run in runs:
            trigger = trigger_by_id.get(run.trigger_id or "")
            if trigger is not None:
                session_trigger_ids.add(str(trigger.id))
            ended = run.completed_at or (now if run.status == "running" else run.started_at)
            name = agent_names.get(run.agent_id)
            items.append(
                _row(
                    id=f"session:{run.id}",
                    kind="session",
                    trigger_kind=trigger.kind if trigger is not None else None,
                    start=run.started_at,
                    end=ended,
                    title=(trigger.name if trigger is not None else run.subject) or name or "Session",
                    status=run.status,
                    agent_id=run.agent_id,
                    agent_name=name,
                    agent_role=trigger.agent_role if trigger is not None else "",
                    owner=("agent", str(run.agent_id), name),
                    project_id=run.project_id,
                    series_id=str(trigger.id) if trigger is not None else None,
                    instructions=trigger.instructions if trigger is not None else "",
                    enabled=trigger.enabled if trigger is not None else True,
                    trigger_id=str(trigger.id) if trigger is not None else None,
                    run_id=str(run.id),
                    signal_id=signals.get(run.id),
                    source="session",
                    run_type=run.trigger_type,
                )
            )

    if "wake" in wanted and not project_id:
        for trigger in wakes:
            actor_kind, resolved_id, resolved_name = _wake_who(trigger, agents)
            base = dict(
                kind="wake",
                trigger_kind=trigger.kind,
                title=trigger.name,
                agent_id=resolved_id,
                agent_name=resolved_name,
                agent_role=trigger.agent_role,
                actor_kind=actor_kind,
                actor_name=resolved_name,
                owner=(
                    ("agent", str(resolved_id), resolved_name)
                    if resolved_id
                    else (None, None, None)
                ),
                series_id=str(trigger.id),
                instructions=trigger.instructions,
                enabled=trigger.enabled,
                trigger_id=str(trigger.id),
                signal_id=str(trigger.signal_id) if trigger.signal_id else None,
                source="wake",
            )
            for moment in _planned_occurrences(trigger, max(start, now), end):
                items.append(_row(id=f"{trigger.id}:{moment.isoformat()}", start=moment, status="planned", **base))
            # A fired one-shot without a run keeps its place (person events,
            # or when sessions are filtered out).
            if (
                trigger.kind in ("once", "event")
                and trigger.last_run_at
                and start <= trigger.last_run_at <= end
                and str(trigger.id) not in session_trigger_ids
            ):
                items.append(
                    _row(
                        id=f"{trigger.id}:done",
                        start=trigger.last_run_at,
                        status=trigger.last_status or "done",
                        **base,
                    )
                )

    if "checkup" in wanted:
        for trigger in checkups:
            signal = linked.get(trigger.signal_id) if trigger.signal_id else None
            if signal is None:
                continue
            if project_id and signal.project_id != project_id:
                continue
            owner = names.owner(signal)
            if agent_id and owner[1] != str(agent_id):
                continue
            base = dict(
                kind="checkup",
                trigger_kind="interval",
                title=signal.subject or trigger.name,
                agent_id=_uuid(owner[1]) if owner[0] == "agent" else None,
                agent_name=owner[2] if owner[0] == "agent" else None,
                actor_kind="agent" if owner[0] == "agent" else "person",
                actor_name=owner[2],
                owner=owner,
                project_id=signal.project_id,
                series_id=str(trigger.id),
                instructions=trigger.name,
                enabled=trigger.enabled,
                trigger_id=str(trigger.id),
                signal_id=str(signal.id),
                source="checkup",
            )
            moments = _planned_occurrences(trigger, max(start, now), end)
            # An overdue check-up (scheduler not yet run) shows at now, once.
            if trigger.enabled and trigger.next_run_at and trigger.next_run_at < now <= end:
                moments = [now, *[m for m in moments if m > now]]
            for moment in moments:
                status = "due" if moment <= now else "planned"
                items.append(_row(id=f"{trigger.id}:{moment.isoformat()}", start=moment, status=status, **base))
            if trigger.last_run_at and start <= trigger.last_run_at <= min(end, now):
                items.append(
                    _row(
                        id=f"{trigger.id}:last",
                        start=trigger.last_run_at,
                        status=trigger.last_status or "done",
                        **base,
                    )
                )

    if "calendar" in wanted and agent_id is None and not project_id:
        from app.services.calendar_sync import calendar_events_in_window

        events = merge_calendar_events(
            await calendar_events_in_window(session, tenant_id, start=start, end=end)
        )
        for event in events:
            conn_id = str(event.get("connection_id") or "")
            if calendar_filter is not None and conn_id not in calendar_filter:
                continue
            row = _row(
                id=event["id"],
                kind="calendar",
                start=event["start"],
                end=event.get("end"),
                title=event["title"],
                status="calendar",
                actor_kind="person",
                actor_name=event.get("calendar_name") or event.get("provider_label") or "Person",
                instructions=event.get("instructions") or "",
                source="calendar",
            )
            for key in (
                "provider",
                "provider_label",
                "calendar_id",
                "calendar_name",
                "calendars",
                "location",
                "html_link",
                "all_day",
                "connection_id",
                "external_id",
            ):
                row[key] = event.get(key)
            items.append(row)

    if "task" in wanted:
        from app.models.orchestration import AgentTask

        task_stmt = select(AgentTask).where(
            AgentTask.tenant_id == tenant_id,
            AgentTask.deleted_at.is_(None),
            AgentTask.scheduled_for.is_not(None),
            AgentTask.scheduled_for >= start,
            AgentTask.scheduled_for <= end,
            AgentTask.status.notin_(("completed", "cancelled", "rejected", "failed")),
        )
        if agent_id:
            task_stmt = task_stmt.where(AgentTask.assignee_agent_id == agent_id)
        if project_id:
            task_stmt = task_stmt.where(AgentTask.project_id == project_id)
        for task in (await session.execute(task_stmt)).scalars().all():
            at = task.scheduled_for
            assert at is not None
            is_human = task.assignee_kind == "human"
            if is_human:
                uid = task.assignee_user_id
                owner = ("user", str(uid) if uid else None, names.users.get(uid) if uid else None)
            else:
                aid = task.assignee_agent_id
                owner = ("agent", str(aid) if aid else None, names.agents.get(aid) if aid else None)
            items.append(
                _row(
                    id=f"task:{task.id}",
                    kind="task",
                    start=at,
                    title=task.title,
                    status="due" if at <= now else "planned",
                    agent_id=task.assignee_agent_id if not is_human else None,
                    agent_name=owner[2] if not is_human else None,
                    actor_kind="person" if is_human else "agent",
                    actor_name=owner[2],
                    owner=owner,
                    project_id=task.project_id,
                    signal_id=str(task.signal_id) if task.signal_id else None,
                    instructions=task.description or "",
                    source="task",
                    run_type=task.kind,
                )
            )

    if "activity" in wanted:
        items.extend(
            await _activity(
                session,
                tenant_id,
                names,
                start=start,
                end=min(end, now),
                agent_id=agent_id,
                project_id=project_id,
            )
        )

    items.sort(key=lambda item: item["start"] or "")
    return items


async def _activity(
    session: AsyncSession,
    tenant_id: UUID,
    names: _Names,
    *,
    start: datetime,
    end: datetime,
    agent_id: UUID | None,
    project_id: UUID | None,
) -> list[dict[str, Any]]:
    """What happened: ticket and ownership changes, closes, and decisions."""
    from app.models.notification import DecisionRequest
    from app.models.signal import SignalEvent

    if end <= start:
        return []
    events = list(
        (
            await session.execute(
                select(SignalEvent)
                .where(
                    SignalEvent.tenant_id == tenant_id,
                    SignalEvent.event_type.in_(list(_ACTIVITY_EVENTS)),
                    SignalEvent.created_at >= start,
                    SignalEvent.created_at <= end,
                )
                .order_by(SignalEvent.created_at.desc())
                .limit(MAX_ACTIVITY)
            )
        ).scalars()
    )
    decisions = list(
        (
            await session.execute(
                select(DecisionRequest)
                .where(
                    DecisionRequest.tenant_id == tenant_id,
                    or_(
                        (DecisionRequest.created_at >= start) & (DecisionRequest.created_at <= end),
                        (DecisionRequest.resolved_at >= start) & (DecisionRequest.resolved_at <= end),
                    ),
                )
                .order_by(DecisionRequest.created_at.desc())
                .limit(MAX_ACTIVITY)
            )
        ).scalars()
    )
    signals = await _signals(
        session,
        tenant_id,
        [e.signal_id for e in events] + [d.signal_id for d in decisions if d.signal_id],
    )

    out: list[dict[str, Any]] = []
    for event in events:
        try:
            payload = json.loads(event.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        if event.event_type == "thread_updated" and payload.get("status") != "closed":
            continue
        signal = signals.get(event.signal_id)
        if signal is None or (project_id and signal.project_id != project_id):
            continue
        actor_kind, actor_id, actor_name = names.actor(event.actor_type, event.actor_id)
        if agent_id and actor_id != str(agent_id):
            continue
        status = _ACTIVITY_EVENTS[event.event_type]
        detail = {
            "filed": f"#{payload.get('category')}" if payload.get("category") else "",
            "stage": payload.get("to_stage") or "",
            "assigned": names.payload_owner(payload.get("after")),
            "closed": "",
        }[status]
        row = _row(
            id=f"activity:{event.id}",
            kind="activity",
            start=event.created_at,
            title=signal.subject or "Conversation",
            status=status,
            actor_kind=actor_kind,
            actor_id=actor_id,
            actor_name=actor_name,
            agent_id=actor_id if actor_kind == "agent" else None,
            agent_name=actor_name if actor_kind == "agent" else None,
            owner=names.owner(signal),
            project_id=signal.project_id,
            signal_id=str(signal.id),
            source="activity",
        )
        row["detail"] = detail
        out.append(row)

    for decision in decisions:
        signal = signals.get(decision.signal_id) if decision.signal_id else None
        dec_project = decision.project_id or (signal.project_id if signal else None)
        if project_id and dec_project != project_id:
            continue
        moments: list[tuple[str, datetime, tuple[str, str | None, str | None]]] = []
        if start <= decision.created_at <= end:
            moments.append(("asked", decision.created_at, ("system", None, None)))
        if decision.resolved_at and start <= decision.resolved_at <= end:
            resolver = decision.resolved_by_user_id
            moments.append(
                (
                    "answered",
                    decision.resolved_at,
                    ("person", str(resolver), names.users.get(resolver)) if resolver else ("system", None, None),
                )
            )
        for status, at, actor in moments:
            if agent_id:
                continue
            row = _row(
                id=f"decision:{decision.id}:{status}",
                kind="activity",
                start=at,
                title=decision.title,
                status=f"decision_{status}",
                actor_kind=actor[0],
                actor_id=actor[1],
                actor_name=actor[2],
                owner=(
                    ("user", str(decision.addressee_user_id), names.users.get(decision.addressee_user_id))
                    if decision.addressee_user_id
                    else (None, None, None)
                ),
                project_id=dec_project,
                signal_id=str(decision.signal_id) if decision.signal_id else None,
                source="activity",
            )
            row["detail"] = decision.status if status == "answered" else ""
            out.append(row)
    return out
