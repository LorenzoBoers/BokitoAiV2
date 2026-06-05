"""Agenda calendars, events, recurrence expansion, and orchestrator wake triggers."""

from __future__ import annotations

import calendar as cal_mod
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun
from app.models.agenda import AgendaCalendar, AgendaEvent
from app.models.orchestra import Task
from app.services.agent.loop import AgentLoop

SYSTEM_CALENDARS = (
    {"name": "My agenda", "kind": "user", "color": "#6366f1"},
    {"name": "Orchestrator", "kind": "orchestrator", "color": "#8b5cf6"},
)

RECURRENCE_FREQS = frozenset({"none", "hourly", "daily", "weekly", "monthly"})


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat() + ("Z" if dt.tzinfo is None else "")


def serialize_calendar(row: AgendaCalendar) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "tenant_id": str(row.tenant_id),
        "name": row.name,
        "kind": row.kind,
        "color": row.color,
        "is_system": row.is_system,
        "external_provider": row.external_provider,
        "external_connection_id": str(row.external_connection_id)
        if row.external_connection_id
        else None,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


def serialize_event(
    row: AgendaEvent,
    *,
    occurrence_id: str | None = None,
    occurrence_starts_at: datetime | None = None,
    occurrence_ends_at: datetime | None = None,
    read_only: bool = False,
) -> dict[str, Any]:
    starts = occurrence_starts_at or row.starts_at
    ends = occurrence_ends_at if occurrence_ends_at is not None else row.ends_at
    oid = occurrence_id or str(row.id)
    return {
        "id": oid,
        "master_id": str(row.id),
        "tenant_id": str(row.tenant_id),
        "calendar_id": str(row.calendar_id),
        "kind": row.kind,
        "title": row.title,
        "description": row.description,
        "location": row.location,
        "starts_at": _iso(starts),
        "ends_at": _iso(ends),
        "all_day": row.all_day,
        "timezone": row.timezone,
        "status": row.status,
        "priority": row.priority,
        "assigned_to_user_id": str(row.assigned_to_user_id) if row.assigned_to_user_id else None,
        "recurrence_freq": row.recurrence_freq,
        "recurrence_interval": row.recurrence_interval,
        "recurrence_until": _iso(row.recurrence_until),
        "prompt": row.prompt,
        "agent_role": row.agent_role,
        "enabled": row.enabled,
        "next_run_at": _iso(row.next_run_at),
        "last_run_at": _iso(row.last_run_at),
        "read_only": read_only,
        "is_occurrence": occurrence_id is not None and occurrence_id != str(row.id),
    }


def _add_months(dt: datetime, months: int) -> datetime:
    month_index = dt.month - 1 + months
    year = dt.year + month_index // 12
    month = month_index % 12 + 1
    last_day = cal_mod.monthrange(year, month)[1]
    day = min(dt.day, last_day)
    return dt.replace(year=year, month=month, day=day)


def compute_next_run_at(
    from_dt: datetime,
    freq: str,
    interval: int = 1,
    until: datetime | None = None,
) -> datetime | None:
    """Return the next run time strictly after from_dt, or None if past until."""
    if freq not in RECURRENCE_FREQS or freq == "none":
        return None
    interval = max(1, interval)
    cursor = from_dt
    for _ in range(500):
        if freq == "hourly":
            cursor = cursor + timedelta(hours=interval)
        elif freq == "daily":
            cursor = cursor + timedelta(days=interval)
        elif freq == "weekly":
            cursor = cursor + timedelta(weeks=interval)
        elif freq == "monthly":
            cursor = _add_months(cursor, interval)
        else:
            return None
        if until and cursor > until:
            return None
        if cursor > from_dt:
            return cursor
    return None


def _event_duration(row: AgendaEvent) -> timedelta:
    if row.ends_at and row.starts_at:
        return row.ends_at - row.starts_at
    if row.all_day:
        return timedelta(days=1)
    return timedelta(hours=1)


def _overlaps_range(starts: datetime, ends: datetime | None, window_start: datetime, window_end: datetime) -> bool:
    event_end = ends or (starts + timedelta(hours=1))
    return starts < window_end and event_end > window_start


def expand_event_occurrences(
    row: AgendaEvent,
    window_start: datetime,
    window_end: datetime,
) -> list[tuple[str, datetime, datetime | None]]:
    """Return list of (occurrence_id, starts_at, ends_at) within the window."""
    duration = _event_duration(row)
    results: list[tuple[str, datetime, datetime | None]] = []

    if row.recurrence_freq == "none" or row.recurrence_freq not in RECURRENCE_FREQS:
        end_at = row.ends_at or (row.starts_at + duration)
        if _overlaps_range(row.starts_at, end_at, window_start, window_end):
            results.append((str(row.id), row.starts_at, row.ends_at))
        return results

    cursor = row.starts_at
    interval = max(1, row.recurrence_interval)
    freq = row.recurrence_freq
    safety = 0
    while cursor < window_end and safety < 500:
        safety += 1
        if row.recurrence_until and cursor > row.recurrence_until:
            break
        occ_end = cursor + duration if row.ends_at else None
        if _overlaps_range(cursor, occ_end, window_start, window_end):
            occ_id = f"{row.id}:{cursor.isoformat()}"
            results.append((occ_id, cursor, occ_end))
        if freq == "hourly":
            cursor = cursor + timedelta(hours=interval)
        elif freq == "daily":
            cursor = cursor + timedelta(days=interval)
        elif freq == "weekly":
            cursor = cursor + timedelta(weeks=interval)
        elif freq == "monthly":
            cursor = _add_months(cursor, interval)
        else:
            break
        if row.recurrence_until and cursor > row.recurrence_until:
            break
    return results


async def ensure_system_calendars(session: AsyncSession, tenant_id: UUID) -> list[AgendaCalendar]:
    result = await session.execute(select(AgendaCalendar).where(AgendaCalendar.tenant_id == tenant_id))
    existing = {c.kind: c for c in result.scalars().all() if c.is_system}
    created: list[AgendaCalendar] = []
    for spec in SYSTEM_CALENDARS:
        if spec["kind"] not in existing:
            cal = AgendaCalendar(
                tenant_id=tenant_id,
                name=spec["name"],
                kind=spec["kind"],
                color=spec["color"],
                is_system=True,
            )
            session.add(cal)
            created.append(cal)
    if created:
        await session.flush()
    result = await session.execute(
        select(AgendaCalendar).where(AgendaCalendar.tenant_id == tenant_id).order_by(AgendaCalendar.name)
    )
    return list(result.scalars().all())


def _implementation_status(task: Task) -> str:
    if not task.enabled and task.schedule_kind != "on_demand":
        return "done"
    if task.enabled and task.schedule_kind != "on_demand":
        return "planned"
    if task.enabled:
        return "in_progress"
    return "idea"


def project_implementation_events(
    tasks: list[Task],
    orchestrator_calendar_id: UUID | None,
    window_start: datetime,
    window_end: datetime,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for task in tasks:
        starts = task.next_run_at or task.last_run_at or task.created_at
        if not _overlaps_range(starts, starts + timedelta(hours=1), window_start, window_end):
            continue
        status = _implementation_status(task)
        items.append(
            {
                "id": f"implementation:{task.id}",
                "master_id": str(task.id),
                "tenant_id": str(task.tenant_id),
                "calendar_id": str(orchestrator_calendar_id) if orchestrator_calendar_id else None,
                "kind": "implementation",
                "title": task.name,
                "description": task.instructions or "",
                "location": "",
                "starts_at": _iso(starts),
                "ends_at": _iso(starts + timedelta(hours=1) if starts else None),
                "all_day": False,
                "timezone": "UTC",
                "status": status,
                "priority": "normal",
                "assigned_to_user_id": None,
                "recurrence_freq": "none",
                "recurrence_interval": 1,
                "recurrence_until": None,
                "prompt": task.instructions or "",
                "agent_role": "orchestra",
                "enabled": task.enabled,
                "next_run_at": _iso(task.next_run_at),
                "last_run_at": _iso(task.last_run_at),
                "read_only": True,
                "is_occurrence": False,
            }
        )
    return items


async def list_events_in_range(
    session: AsyncSession,
    tenant_id: UUID,
    window_start: datetime,
    window_end: datetime,
    calendar_ids: list[UUID] | None = None,
    include_implementation: bool = True,
) -> list[dict[str, Any]]:
    calendars = await ensure_system_calendars(session, tenant_id)
    orch_cal = next((c for c in calendars if c.kind == "orchestrator"), None)

    query = select(AgendaEvent).where(AgendaEvent.tenant_id == tenant_id)
    if calendar_ids:
        query = query.where(AgendaEvent.calendar_id.in_(calendar_ids))
    result = await session.execute(query)
    rows = list(result.scalars().all())

    items: list[dict[str, Any]] = []
    for row in rows:
        if calendar_ids and row.calendar_id not in calendar_ids:
            continue
        for occ_id, occ_start, occ_end in expand_event_occurrences(row, window_start, window_end):
            items.append(serialize_event(row, occurrence_id=occ_id, occurrence_starts_at=occ_start, occurrence_ends_at=occ_end))

    if include_implementation and (not calendar_ids or (orch_cal and orch_cal.id in calendar_ids)):
        task_result = await session.execute(select(Task).where(Task.tenant_id == tenant_id))
        tasks = list(task_result.scalars().all())
        items.extend(
            project_implementation_events(
                tasks,
                orch_cal.id if orch_cal else None,
                window_start,
                window_end,
            )
        )

    items.sort(key=lambda e: e.get("starts_at") or "")
    return items


def init_orchestrator_schedule(row: AgendaEvent) -> None:
    if row.kind == "orchestrator":
        row.next_run_at = row.starts_at
        if row.recurrence_freq == "none":
            row.next_run_at = row.starts_at


async def trigger_orchestrator_event(session: AsyncSession, event: AgendaEvent, tenant_id: UUID) -> dict[str, Any]:
    if event.kind != "orchestrator":
        raise ValueError("Event is not an orchestrator wake")
    role = event.agent_role or "orchestra"
    agent_result = await session.execute(
        select(Agent).where(Agent.tenant_id == tenant_id, Agent.role == role).limit(1)
    )
    agent = agent_result.scalar_one_or_none()
    if not agent:
        agent_result = await session.execute(
            select(Agent).where(Agent.tenant_id == tenant_id, Agent.role == "orchestrator").limit(1)
        )
        agent = agent_result.scalar_one_or_none()
    if not agent:
        raise ValueError(f"No agent with role {role}")

    prompt = (event.prompt or "").strip() or "Execute the scheduled orchestrator wake."
    run = AgentRun(
        tenant_id=tenant_id,
        agent_id=agent.id,
        trigger_type="agenda_orchestrator",
        subject=event.title[:120] or "Orchestrator wake",
    )
    session.add(run)
    await session.flush()
    await session.refresh(run)

    loop = AgentLoop(session, tenant_id, None, agent=agent, run=run)
    await loop.run_chat([{"role": "user", "content": prompt}])
    run.status = "completed"
    run.completed_at = datetime.utcnow()

    now = datetime.utcnow()
    event.last_run_at = now
    if event.recurrence_freq and event.recurrence_freq != "none":
        event.next_run_at = compute_next_run_at(
            now,
            event.recurrence_freq,
            event.recurrence_interval,
            event.recurrence_until,
        )
    else:
        event.next_run_at = None
    event.updated_at = now
    await session.commit()
    return {"run_id": str(run.id), "status": run.status}


async def process_due_orchestrator_events(session: AsyncSession) -> int:
    now = datetime.utcnow()
    result = await session.execute(
        select(AgendaEvent).where(
            AgendaEvent.kind == "orchestrator",
            AgendaEvent.enabled.is_(True),
            AgendaEvent.next_run_at.is_not(None),
            AgendaEvent.next_run_at <= now,
        )
    )
    due = list(result.scalars().all())
    count = 0
    for event in due:
        try:
            await trigger_orchestrator_event(session, event, event.tenant_id)
            count += 1
        except Exception:
            await session.rollback()
            continue
    return count
