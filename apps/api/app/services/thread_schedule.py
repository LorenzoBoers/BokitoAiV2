"""A thread with a date is an agenda item; a thread with a repeat rule recurs.

Dates live on the thread (`Signal.next_at`, `ends_at`, `schedule_json`). The
conversation's owner is who the moment is for: a person or team gets the
thread back unread, an agent owner runs the task in the thread. A repeat rule
or an agent wake is a `Trigger` bound to the thread: it writes its next run
into `next_at`. Without a rule the scheduler reopens the thread once its
moment passed and clears the date. A hidden (snoozed) thread stays out of the
open lists until `hidden_until` or a new inbound message. Closing a thread
lasts until its next moment; pausing turns the rule off.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any, Iterable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.exceptions import NotFoundError
from app.models.agent import Agent
from app.models.signal import Signal, SignalEvent
from app.models.trigger import Trigger

# Internal threads that exist for their schedule (tasks, appointments).
SCHEDULE_SOURCE = "schedule"
REOPEN_FROM = ("closed", "pending", "snoozed")
_DETAIL_KEYS = ("note", "location", "attendees", "html_link", "all_day", "calendar_event_id", "surfaced", "notify")
SURFACE_BEFORE_MINUTES = (0, 15, 30, 60, 1440)
DEFAULT_SURFACE_BEFORE_MINUTES = 30


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def naive_utc(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is None:
        return value
    from datetime import timezone

    return value.astimezone(timezone.utc).replace(tzinfo=None)


def thread_details(signal: Signal) -> dict[str, Any]:
    try:
        raw = json.loads(signal.schedule_json or "{}")
    except (TypeError, json.JSONDecodeError):
        raw = {}
    return raw if isinstance(raw, dict) else {}


def _details_json(details: dict[str, Any] | None) -> str:
    clean = {k: v for k, v in (details or {}).items() if k in _DETAIL_KEYS and v not in (None, "", [])}
    return json.dumps(clean)


def _alive_rule(signal_id_col):
    return and_(
        Trigger.signal_id == signal_id_col,
        Trigger.deleted_at.is_(None),
        Trigger.purpose == "",
    )


async def thread_rule(session: AsyncSession, signal_id: UUID) -> Trigger | None:
    """The repeat rule / agent wake of a thread (stage check-ups excluded)."""
    return (
        await session.execute(
            select(Trigger).where(_alive_rule(signal_id)).order_by(Trigger.created_at).limit(1)
        )
    ).scalars().first()


async def rules_by_signal(
    session: AsyncSession, tenant_id: UUID, signal_ids: Iterable[UUID]
) -> dict[UUID, Trigger]:
    """Thread id -> its rule; a stage check-up stands in when there is no rule."""
    ids = list({sid for sid in signal_ids if sid})
    if not ids:
        return {}
    rows = (
        await session.execute(
            select(Trigger)
            .where(
                Trigger.tenant_id == tenant_id,
                Trigger.signal_id.in_(ids),
                Trigger.deleted_at.is_(None),
            )
            .order_by(Trigger.created_at)
        )
    ).scalars().all()
    out: dict[UUID, Trigger] = {}
    for row in rows:
        current = out.get(row.signal_id)
        if current is None or (current.purpose and not row.purpose):
            out[row.signal_id] = row
    return out


def repeat_payload(trigger: Trigger) -> dict[str, Any] | None:
    if trigger.kind == "cron" and trigger.cron_expr:
        return {"kind": "cron", "cron": trigger.cron_expr}
    if trigger.kind in ("interval", "heartbeat"):
        return {"kind": "interval", "every_minutes": max(1, trigger.interval_minutes or 60)}
    return None


def schedule_payload(trigger: Trigger | None) -> dict[str, Any] | None:
    if trigger is None:
        return None
    return {
        "trigger_id": str(trigger.id),
        "name": trigger.name,
        "kind": trigger.kind,
        "purpose": trigger.purpose or "",
        "repeat": repeat_payload(trigger),
        "enabled": bool(trigger.enabled),
        "next_run_at": _iso(trigger.next_run_at),
        "last_run_at": _iso(trigger.last_run_at),
        "last_status": trigger.last_status or "",
        "agent_id": str(trigger.agent_id) if trigger.agent_id else None,
        "instructions": trigger.instructions or "",
        "webhook": trigger.kind == "webhook",
    }


def mirror_next_at(signal: Signal, trigger: Trigger) -> None:
    """A rule owns its thread's date; check-ups leave the ticket's date alone."""
    if trigger.purpose:
        return
    signal.next_at = trigger.next_run_at if trigger.enabled else None


def _new_thread_owner(trigger: Trigger) -> tuple[str, UUID] | None:
    if trigger.created_by_user_id:
        return "user", trigger.created_by_user_id
    if trigger.agent_id:
        return "agent", trigger.agent_id
    return None


def runner_agent_id(signal: Signal) -> UUID | None:
    """The agent that works a planned moment: the agent owner, or the chat's own
    agent in a personal assistant chat. None means the moment is a reminder."""
    if signal.assignee_kind == "agent":
        return signal.assignee_id or signal.agent_id
    if signal.channel == "assistant":
        return signal.agent_id
    return None


async def sync_rule_runner(session: AsyncSession, signal: Signal) -> None:
    """After an owner change: the thread's rule runs for the new owner. Caller commits."""
    rule = await thread_rule(session, signal.id)
    if rule is None or rule.kind in ("webhook", "heartbeat"):
        return
    agent_id = runner_agent_id(signal)
    if rule.agent_id != agent_id:
        rule.agent_id = agent_id
        rule.updated_at = utcnow()
        session.add(rule)


async def create_schedule_thread(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    subject: str,
    agent: Agent | None = None,
    project_id: UUID | None = None,
) -> Signal:
    now = utcnow()
    signal = Signal(
        tenant_id=tenant_id,
        channel="internal",
        source=SCHEDULE_SOURCE,
        subject=(subject or "Agenda").strip()[:200] or "Agenda",
        contact_name=agent.name if agent else "Agenda",
        agent_id=agent.id if agent else None,
        project_id=project_id,
        status="open",
        priority="normal",
        has_unread=False,
        last_message_at=now,
    )
    session.add(signal)
    await session.flush()
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="signal_created",
            actor_type="system",
            payload_json=json.dumps({"source": SCHEDULE_SOURCE}),
        )
    )
    return signal


async def ensure_trigger_thread(
    session: AsyncSession,
    trigger: Trigger,
    *,
    agent: Agent | None = None,
    detach_assistant: bool = True,
) -> Signal:
    """The thread this rule is the schedule of; created when missing.

    A legacy check-in that still points at an assistant chat moves to its own
    thread so that chat stays a chat. An operator (or tool) that already chose
    this conversation passes ``detach_assistant=False`` and the wake stays here.
    Caller commits.
    """
    from app.services.ownership import set_owner

    signal = await session.get(Signal, trigger.signal_id) if trigger.signal_id else None
    if signal is not None and (
        signal.tenant_id != trigger.tenant_id
        or signal.deleted_at is not None
        or (detach_assistant and not trigger.purpose and signal.channel == "assistant")
    ):
        signal = None
    created = signal is None
    if signal is None:
        if agent is None and trigger.agent_id:
            agent = await session.get(Agent, trigger.agent_id)
        signal = await create_schedule_thread(
            session, trigger.tenant_id, subject=trigger.name, agent=agent
        )
        trigger.signal_id = signal.id
        session.add(trigger)
    if trigger.purpose:
        return signal
    if signal.source == SCHEDULE_SOURCE and signal.subject != trigger.name and trigger.name:
        signal.subject = trigger.name[:200]
    target = _new_thread_owner(trigger) if created else None
    if target is not None:
        set_owner(signal, target[0], target[1], by_user_id=trigger.created_by_user_id)
    mirror_next_at(signal, trigger)
    session.add(signal)
    return signal


async def resolve_owner(
    session: AsyncSession, tenant_id: UUID, raw: Any
) -> tuple[str, UUID] | None:
    """A person, agent or team by id, email or name. None means the creator.

    Accepts ``{"kind": "user"|"agent"|"team"|"department", "id": ...}`` or a
    plain string. Returns an owner kind (``user``, ``agent``, ``department``).
    """
    from app.models.auth import Membership, User
    from app.models.team import Team

    if raw in (None, "", {}):
        return None
    kind = ""
    value: Any = raw
    if isinstance(raw, dict):
        kind = str(raw.get("kind") or "")
        value = raw.get("id") if raw.get("id") not in (None, "") else raw.get("name")
    if kind == "team":
        kind = "department"
    text = str(value or "").strip()
    if not text:
        return None
    if text.lower() in ("me", "ik", "self"):
        return None

    members = (
        await session.execute(
            select(User)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.tenant_id == tenant_id, Membership.is_active.is_(True))
        )
    ).scalars().all()
    teams = (await session.execute(select(Team).where(Team.tenant_id == tenant_id))).scalars().all()

    def _as_uuid(v: str) -> UUID | None:
        try:
            return UUID(v)
        except ValueError:
            return None

    as_id = _as_uuid(text)
    lowered = text.lower().lstrip("@")
    if kind in ("", "user"):
        for user in members:
            if as_id and user.id == as_id:
                return "user", user.id
            names = {(user.email or "").lower(), (user.display_name or "").lower()}
            if lowered in names:
                return "user", user.id
    if kind in ("", "agent"):
        agents = (
            await session.execute(
                select(Agent).where(
                    Agent.tenant_id == tenant_id,
                    Agent.kind == "company",
                    Agent.is_active.is_(True),
                )
            )
        ).scalars().all()
        for agent in agents:
            if as_id and agent.id == as_id:
                return "agent", agent.id
            if (agent.name or "").lower() == lowered:
                return "agent", agent.id
    if kind in ("", "department"):
        for team in teams:
            if as_id and team.id == as_id:
                return "department", team.id
            if (team.name or "").lower() == lowered:
                return "department", team.id
    if kind in ("", "user") and not as_id:
        matches = [u for u in members if lowered and lowered in (u.display_name or "").lower()]
        if len(matches) == 1:
            return "user", matches[0].id
    raise HTTPException(status_code=422, detail=f"Owner not found: {text}")


def _repeat_from(
    *, cron: str | None, every_minutes: int | None
) -> tuple[str, str, int] | None:
    cron = (cron or "").strip()
    if cron:
        return "cron", cron, 0
    if every_minutes:
        return "interval", "", max(5, int(every_minutes))
    return None


async def apply_thread_schedule(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    signal: Signal | None = None,
    title: str = "",
    at: datetime | None = None,
    ends_at: datetime | None = None,
    cron: str | None = None,
    every_minutes: int | None = None,
    instructions: str | None = None,
    owner: tuple[str, UUID] | None | object = ...,
    hide: bool = False,
    surface_before_minutes: int = 0,
    details: dict[str, Any] | None = None,
    created_by_user_id: UUID | None = None,
    project_id: UUID | None = None,
    actor_type: str = "user",
    actor_id: str = "",
    enabled: bool = True,
) -> tuple[Signal, Trigger | None]:
    """Put a date and/or repeat rule on a thread (a new thread when none given).

    The conversation's owner is who the moment is for. ``owner`` (already
    validated) replaces it; ``None`` makes the creator the owner; omitted
    keeps the current owner. One moment for a person is just ``next_at``. A
    repeat, or an agent owner with instructions, is a rule bound to the
    thread. ``hide`` keeps a one-moment thread out of the open lists until
    ``surface_before_minutes`` before the moment. Caller commits.
    """
    from app.services.ownership import set_owner
    from app.services.triggers import compute_next_run, next_cron_run

    at, ends_at = naive_utc(at), naive_utc(ends_at)
    repeat = _repeat_from(cron=cron, every_minutes=every_minutes)
    if repeat and repeat[0] == "cron" and next_cron_run(repeat[1], utcnow()) is None:
        raise HTTPException(status_code=422, detail="Invalid cron expression")
    if ends_at and at and ends_at < at:
        raise HTTPException(status_code=422, detail="ends_at is before the start")
    if surface_before_minutes not in SURFACE_BEFORE_MINUTES:
        raise HTTPException(status_code=422, detail="surface_before_minutes must be 0, 15, 30, 60 or 1440")

    target: tuple[str, UUID] | None = None
    if owner is not ...:
        target = owner if owner is not None else (  # type: ignore[assignment]
            ("user", created_by_user_id) if created_by_user_id else None
        )

    agent: Agent | None = None
    agent_id = target[1] if target and target[0] == "agent" else None
    if agent_id is None and signal is not None and (target is None or signal.channel == "assistant"):
        agent_id = runner_agent_id(signal)
    if agent_id:
        agent = (
            await session.execute(
                select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if agent is None:
            raise NotFoundError("Agent not found")

    if signal is None:
        if not (title or "").strip():
            raise HTTPException(status_code=422, detail="A title is required for a new agenda item")
        if at is None and repeat is None:
            raise HTTPException(status_code=422, detail="Give a moment or a repeat")
        signal = await create_schedule_thread(
            session, tenant_id, subject=title, agent=agent, project_id=project_id
        )
        if target is None and created_by_user_id:
            target = ("user", created_by_user_id)
    elif title and signal.source == SCHEDULE_SOURCE:
        signal.subject = title.strip()[:200]
    if target is not None:
        set_owner(signal, target[0], target[1], by_user_id=created_by_user_id)

    rule = await thread_rule(session, signal.id)
    wants_rule = bool(repeat) or bool(agent and (instructions or "").strip())
    if wants_rule:
        if rule is None:
            rule = Trigger(
                tenant_id=tenant_id,
                name=(title or signal.subject or "Agenda")[:200],
                kind="once",
                agent_role="assistant",
                signal_id=signal.id,
                created_by_user_id=created_by_user_id,
            )
        if title:
            rule.name = title.strip()[:200]
        if repeat:
            rule.kind, rule.cron_expr, rule.interval_minutes = repeat
        else:
            rule.kind, rule.cron_expr, rule.interval_minutes = "once", "", 0
        rule.agent_id = agent.id if agent is not None else None
        if instructions is not None:
            rule.instructions = instructions
        rule.enabled = enabled
        if not enabled:
            rule.next_run_at = None
        elif rule.kind == "once":
            rule.next_run_at = at or rule.next_run_at or utcnow()
        else:
            rule.next_run_at = at if at and at > utcnow() else compute_next_run(rule)
        rule.updated_at = utcnow()
        session.add(rule)
        await session.flush()
        # The caller already picked this conversation (Plan, or a tool with a
        # signal id). Keep the wake here, including on an assistant chat.
        await ensure_trigger_thread(session, rule, agent=agent, detach_assistant=False)
    else:
        if rule is not None and rule.kind != "webhook":
            rule.deleted_at = utcnow()
            rule.enabled = False
            session.add(rule)
            rule = None
        if signal.source == SCHEDULE_SOURCE and not signal.assignee_kind and created_by_user_id:
            set_owner(signal, "user", created_by_user_id, by_user_id=created_by_user_id)
        signal.next_at = at

    if hide and not repeat and at is not None and at > utcnow():
        signal.hidden_until = at - timedelta(minutes=surface_before_minutes)
        if signal.hidden_until > utcnow():
            signal.status = "snoozed"
        else:
            signal.hidden_until = None
    elif signal.hidden_until is not None or signal.status == "snoozed":
        signal.hidden_until = None
        if signal.status == "snoozed":
            signal.status = "open"

    signal.ends_at = ends_at
    merged = {**thread_details(signal), **(details or {})}
    merged.pop("surfaced", None)
    signal.schedule_json = _details_json(merged)
    signal.updated_at = utcnow()
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="scheduled",
            actor_type=actor_type,
            actor_id=actor_id,
            payload_json=json.dumps(
                {
                    "at": _iso(signal.next_at),
                    "repeat": repeat_payload(rule) if rule else None,
                    "agent_id": str(rule.agent_id) if rule and rule.agent_id else None,
                    "hidden_until": _iso(signal.hidden_until),
                }
            ),
        )
    )
    return signal, rule


async def clear_thread_schedule(
    session: AsyncSession, signal: Signal, *, actor_type: str = "user", actor_id: str = ""
) -> None:
    """Drop the date and the rule (webhook intake stays). Caller commits."""
    rule = await thread_rule(session, signal.id)
    if rule is not None and rule.kind != "webhook":
        rule.deleted_at = utcnow()
        rule.enabled = False
        session.add(rule)
    signal.next_at = None
    signal.ends_at = None
    signal.hidden_until = None
    if signal.status == "snoozed":
        signal.status = "open"
    signal.updated_at = utcnow()
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="schedule_cleared",
            actor_type=actor_type,
            actor_id=actor_id,
            payload_json="{}",
        )
    )


async def set_rule_enabled(session: AsyncSession, signal: Signal, enabled: bool) -> Trigger:
    from app.services.triggers import compute_next_run

    rule = await thread_rule(session, signal.id)
    if rule is None:
        raise NotFoundError("This thread has no repeat")
    rule.enabled = enabled
    if not enabled:
        rule.next_run_at = None
    elif rule.kind == "once":
        rule.next_run_at = rule.next_run_at or utcnow()
    else:
        rule.next_run_at = compute_next_run(rule)
    rule.updated_at = utcnow()
    session.add(rule)
    mirror_next_at(signal, rule)
    session.add(signal)
    return rule


async def rule_context(session: AsyncSession, signal: Signal) -> str:
    """For a reply in a scheduled thread: what this thread is the schedule of."""
    rule = await thread_rule(session, signal.id)
    if rule is None or rule.kind == "webhook":
        return ""
    repeat = repeat_payload(rule)
    when = (
        f"cron {repeat['cron']}" if repeat and repeat.get("cron")
        else f"every {repeat['every_minutes']} minutes" if repeat
        else "once"
    )
    lines = [
        "## This conversation is a scheduled task",
        f"Repeat: {when}; {'active' if rule.enabled else 'paused'}"
        + (f"; next run {_iso(rule.next_run_at)} UTC" if rule.next_run_at else ""),
    ]
    if rule.instructions.strip():
        lines.append(f"Task: {rule.instructions.strip()[:1500]}")
    lines.append(
        "The person may answer your report or ask to change the task. Change the "
        "schedule or task with set_thread_schedule (this thread), pause it with "
        "enabled=false, or remove it with clear_thread_schedule."
    )
    return "\n".join(lines)


async def owner_recipients(
    session: AsyncSession, signal: Signal, *, fallback_user_id: UUID | None = None
) -> list[UUID]:
    """People to notify when the thread comes up: its person or team owner.

    An agent-owned thread notifies ``fallback_user_id`` (whoever planned it).
    """
    if signal.assignee_kind == "agent":
        return [fallback_user_id] if fallback_user_id else []
    if signal.assignee_kind == "user" and signal.assigned_user_id:
        return [signal.assigned_user_id]
    if signal.assignee_kind == "department" and signal.assignee_team_id:
        from app.models.team import Team
        from app.services.teams import team_members

        team = await session.get(Team, signal.assignee_team_id)
        if team is not None:
            return [m.id for m in await team_members(session, team) if m.kind == "user"]
    return []


def reopen_for_moment(signal: Signal, now: datetime | None = None) -> bool:
    """Bring a thread back to the list: open and unread. True when it was parked."""
    now = now or utcnow()
    parked = signal.status in REOPEN_FROM
    if parked:
        signal.status = "open"
    signal.hidden_until = None
    signal.has_unread = True
    signal.updated_at = now
    return parked


def wants_moment_notify(signal: Signal) -> bool:
    """Whether bringing the thread back should push a notification. Default on."""
    return thread_details(signal).get("notify", True) is not False


async def notify_moment(
    session: AsyncSession,
    signal: Signal,
    *,
    title: str,
    body: str = "",
    fallback_user_id: UUID | None = None,
) -> None:
    if not wants_moment_notify(signal):
        return
    recipients = await owner_recipients(session, signal, fallback_user_id=fallback_user_id)
    if not recipients:
        return
    from app.services.notify import TIER_LATER, notify

    await notify(
        session,
        signal.tenant_id,
        kind="assignment",
        recipients=recipients,
        title=title[:200],
        body=body[:500],
        tier=TIER_LATER,
        category="assigned-to-me",
        signal_id=signal.id,
    )


async def wake_due_threads(session: AsyncSession) -> int:
    """Threads whose date passed and that have no rule of their own come back.

    Rules fire through ``process_due_triggers`` (they run an agent and write
    the next date); this handles plain dates: reopen, unread, notify owner,
    clear the date.
    """
    from app.gateway.publish import publish_thread_update

    now = utcnow()
    surfaced = await surface_hidden_threads(session, now)
    has_rule = exists().where(
        Trigger.signal_id == Signal.id,
        Trigger.deleted_at.is_(None),
        Trigger.purpose == "",
        Trigger.enabled.is_(True),
        Trigger.next_run_at.is_not(None),
    )
    rows = (
        await session.execute(
            select(Signal).where(
                Signal.next_at.is_not(None),
                Signal.next_at <= now,
                Signal.deleted_at.is_(None),
                Signal.status.not_in(("spam", "archived")),
                ~has_rule,
            )
        )
    ).scalars().all()
    notify_rows: list[Signal] = []
    for signal in rows:
        due_at = signal.next_at
        details = thread_details(signal)
        # Already surfaced ahead of the moment: the moment only clears the date.
        if details.pop("surfaced", None) and signal.status == "open":
            signal.schedule_json = _details_json(details)
        else:
            reopen_for_moment(signal, now)
            notify_rows.append(signal)
        signal.next_at = None
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="due",
                actor_type="system",
                actor_id="",
                payload_json=json.dumps({"at": _iso(due_at), "note": details.get("note") or ""}),
            )
        )
    if rows:
        await session.commit()
        for signal in rows:
            if signal in notify_rows:
                await notify_moment(session, signal, title=signal.subject or "Agenda")
            await publish_thread_update(signal)
    return len(rows) + surfaced


async def surface_hidden_threads(session: AsyncSession, now: datetime | None = None) -> int:
    """Snoozed threads whose ``hidden_until`` passed come back: open, unread, notified."""
    from app.gateway.publish import publish_thread_update

    now = now or utcnow()
    rows = (
        await session.execute(
            select(Signal).where(
                Signal.status == "snoozed",
                Signal.hidden_until.is_not(None),
                Signal.hidden_until <= now,
                Signal.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    for signal in rows:
        reopen_for_moment(signal, now)
        signal.hidden_until = None
        if signal.next_at is not None:
            signal.schedule_json = _details_json({**thread_details(signal), "surfaced": True})
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="surfaced",
                actor_type="system",
                actor_id="",
                payload_json=json.dumps({"at": _iso(signal.next_at)}),
            )
        )
    if rows:
        await session.commit()
        for signal in rows:
            await notify_moment(session, signal, title=signal.subject or "Agenda")
            await publish_thread_update(signal)
    return len(rows)


def wake_hidden_on_inbound(signal: Signal) -> SignalEvent | None:
    """A new inbound message ends the snooze; the date stays. Caller adds the event."""
    if signal.status != "snoozed" and signal.hidden_until is None:
        return None
    signal.hidden_until = None
    if signal.status == "snoozed":
        signal.status = "open"
    return SignalEvent(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        event_type="woke_by_reply",
        actor_type="system",
        actor_id="",
        payload_json=json.dumps({"at": _iso(signal.next_at)}),
    )


async def convert_event_trigger(session: AsyncSession, trigger: Trigger) -> Signal:
    """A person event (kind ``event``) becomes a thread with a date. Caller commits."""
    signal = await ensure_trigger_thread(session, trigger)
    if trigger.next_run_at and trigger.enabled:
        signal.next_at = trigger.next_run_at
    if trigger.instructions:
        signal.schedule_json = _details_json({**thread_details(signal), "note": trigger.instructions})
    trigger.deleted_at = utcnow()
    trigger.enabled = False
    session.add(trigger)
    session.add(signal)
    return signal


async def ensure_rule_threads(session: AsyncSession) -> int:
    """Startup backfill: every rule has a thread; person events become dates."""
    rows = (
        await session.execute(
            select(Trigger).where(
                Trigger.deleted_at.is_(None),
                Trigger.purpose == "",
                or_(Trigger.signal_id.is_(None), Trigger.kind == "event"),
            )
        )
    ).scalars().all()
    touched = 0
    for trigger in rows:
        # A check-in the operator never turned on must not appear in the inbox.
        if trigger.kind == "heartbeat" and not trigger.enabled and trigger.signal_id is None:
            continue
        if trigger.kind == "event":
            await convert_event_trigger(session, trigger)
        else:
            await ensure_trigger_thread(session, trigger)
        touched += 1
    if touched:
        await session.commit()
    return touched
