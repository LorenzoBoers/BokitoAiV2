"""One time model for everything that happens over time.

Agenda, the agent activity timeline and the agent detail strip all read
``list_time_items``. Every row has the same shape:

``{id, kind, trigger_kind, run_type, start, end, title, status, agent_id, agent_name,
agent_role, actor_kind, actor_id, actor_name, instructions, enabled,
trigger_id, run_id, signal_id, source}`` plus calendar extras.

``kind`` is one of:

- ``session``: an ``AgentRun`` (past or running work).
- ``wake``: a planned trigger moment, or a fired one-shot without a run.
- ``calendar``: an external calendar event.
- ``follow_up``: a conversation look-at (``Signal.follow_up_at``).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun
from app.models.trigger import Trigger

TIME_KINDS = frozenset({"session", "wake", "calendar", "follow_up"})

MAX_SESSIONS = 400

# On-demand runs whose ``trigger_id`` is the conversation they answered.
_CONVERSATION_TRIGGERS = frozenset(
    {"chat", "email", "widget", "inbound", "webchat", "whatsapp", "customer_widget"}
)


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
    actor_name: str | None = None,
    instructions: str = "",
    enabled: bool = True,
    trigger_id: str | None = None,
    run_id: str | None = None,
    signal_id: str | None = None,
    source: str | None = None,
    run_type: str | None = None,
) -> dict[str, Any]:
    agent = str(agent_id) if agent_id else None
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
        "actor_id": agent if actor_kind == "agent" else None,
        "actor_name": actor_name or agent_name,
        "instructions": instructions,
        "enabled": enabled,
        "trigger_id": trigger_id,
        "run_id": run_id,
        "signal_id": signal_id,
        "source": source or kind,
        "run_type": run_type,
    }


def _trigger_actor(trigger: Trigger, agent_name: str | None) -> tuple[str, str]:
    actor_kind = "person" if trigger.kind == "event" else "agent"
    actor_name = agent_name or (trigger.agent_role if actor_kind == "agent" else "Person")
    return actor_kind, actor_name


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


async def list_time_items(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    start: datetime,
    end: datetime,
    agent_id: UUID | None = None,
    sources: Iterable[str] | None = None,
    scheduled_only: bool = False,
) -> list[dict[str, Any]]:
    """Every time item in [start, end], sorted by start.

    ``sources`` limits the kinds returned. ``scheduled_only`` keeps only
    sessions fired by a trigger (planning view); on-demand work such as email
    replies stays on the activity timeline.
    """
    from app.services.triggers import _planned_occurrences

    wanted = TIME_KINDS & set(sources) if sources else set(TIME_KINDS)
    now = datetime.utcnow()

    agents = (await session.execute(select(Agent).where(Agent.tenant_id == tenant_id))).scalars().all()
    agent_names = {a.id: a.name for a in agents}

    trigger_stmt = select(Trigger).where(Trigger.tenant_id == tenant_id, Trigger.deleted_at.is_(None))
    if agent_id:
        trigger_stmt = trigger_stmt.where(Trigger.agent_id == agent_id)
    triggers = list((await session.execute(trigger_stmt)).scalars().all())
    trigger_by_id = {str(t.id): t for t in triggers}

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
                    instructions=trigger.instructions if trigger is not None else "",
                    enabled=trigger.enabled if trigger is not None else True,
                    trigger_id=str(trigger.id) if trigger is not None else None,
                    run_id=str(run.id),
                    signal_id=signals.get(run.id),
                    source="session",
                    run_type=run.trigger_type,
                )
            )

    if "wake" in wanted:
        for trigger in triggers:
            name = agent_names.get(trigger.agent_id) if trigger.agent_id else None
            actor_kind, actor_name = _trigger_actor(trigger, name)
            base = dict(
                kind="wake",
                trigger_kind=trigger.kind,
                title=trigger.name,
                agent_id=trigger.agent_id,
                agent_name=name,
                agent_role=trigger.agent_role,
                actor_kind=actor_kind,
                actor_name=actor_name,
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

    if "calendar" in wanted and agent_id is None:
        from app.services.calendar_sync import calendar_events_in_window

        for event in await calendar_events_in_window(session, tenant_id, start=start, end=end):
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
                "location",
                "html_link",
                "all_day",
                "connection_id",
                "external_id",
            ):
                row[key] = event.get(key)
            items.append(row)

    if "follow_up" in wanted:
        from app.models.signal import Signal

        follow_stmt = select(Signal).where(
            Signal.tenant_id == tenant_id,
            Signal.follow_up_at.is_not(None),
            Signal.follow_up_at >= start,
            Signal.follow_up_at <= end,
            Signal.status.notin_(("spam", "archived")),
        )
        if agent_id:
            follow_stmt = follow_stmt.where(Signal.agent_id == agent_id)
        for signal in (await session.execute(follow_stmt)).scalars().all():
            at = signal.follow_up_at
            assert at is not None
            title = (signal.follow_up_title or "").strip() or signal.subject or "Follow up"
            owner = signal.agent_id if agent_id else None
            items.append(
                _row(
                    id=f"follow_up:{signal.id}",
                    kind="follow_up",
                    start=at,
                    title=title,
                    status="due" if at <= now else "planned",
                    agent_id=owner,
                    agent_name=agent_names.get(owner) if owner else None,
                    actor_kind="person",
                    actor_name=signal.contact_name or signal.contact_email or "You",
                    signal_id=str(signal.id),
                    source="follow_up",
                )
            )

    items.sort(key=lambda item: item["start"] or "")
    return items
