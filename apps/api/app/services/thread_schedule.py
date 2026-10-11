"""A thread with a date is an agenda item; a thread with a repeat rule recurs.

Dates live on the thread (`Signal.next_at`, `ends_at`, `schedule_json`). A
repeat rule or an agent wake is a `Trigger` bound to the thread: it writes its
next run into `next_at`, runs its agent in the thread, and reopens the thread
only when it has something to say. Without a rule the scheduler reopens the
thread once its moment passed and clears the date. Closing a thread lasts
until its next moment; pausing turns the rule off.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Iterable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.signal import Signal, SignalEvent
from app.models.trigger import Trigger

# Internal threads that exist for their schedule (tasks, appointments).
SCHEDULE_SOURCE = "schedule"
REOPEN_FROM = ("closed", "pending")
_DETAIL_KEYS = ("note", "location", "attendees", "html_link", "all_day", "calendar_event_id")
RECIPIENT_KINDS = ("user", "team")


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
    recipient = None
    if trigger.recipient_kind == "user" and trigger.recipient_user_id:
        recipient = {"kind": "user", "id": str(trigger.recipient_user_id)}
    elif trigger.recipient_kind == "team" and trigger.recipient_team_id:
        recipient = {"kind": "team", "id": str(trigger.recipient_team_id)}
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
        "recipient": recipient,
        "webhook": trigger.kind == "webhook",
    }


def mirror_next_at(signal: Signal, trigger: Trigger) -> None:
    """A rule owns its thread's date; check-ups leave the ticket's date alone."""
    if trigger.purpose:
        return
    signal.next_at = trigger.next_run_at if trigger.enabled else None


def _owner_target(trigger: Trigger) -> tuple[str, UUID] | None:
    if trigger.recipient_kind == "user" and trigger.recipient_user_id:
        return "user", trigger.recipient_user_id
    if trigger.recipient_kind == "team" and trigger.recipient_team_id:
        return "team", trigger.recipient_team_id
    if trigger.created_by_user_id:
        return "user", trigger.created_by_user_id
    return None


async def create_schedule_thread(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    subject: str,
    agent: Agent | None = None,
    project_id: UUID | None = None,
) -> Signal:
    now = datetime.utcnow()
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
    session: AsyncSession, trigger: Trigger, *, agent: Agent | None = None
) -> Signal:
    """The thread this rule is the schedule of; created when missing.

    A rule that still points at an assistant chat (the old check-in) moves to
    its own thread so the chat stays a chat. Caller commits.
    """
    from app.services.ownership import set_owner

    signal = await session.get(Signal, trigger.signal_id) if trigger.signal_id else None
    if signal is not None and (
        signal.tenant_id != trigger.tenant_id
        or signal.deleted_at is not None
        or (not trigger.purpose and signal.channel == "assistant")
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
    target = _owner_target(trigger)
    if target is not None:
        kind, owner_id = target
        current = signal.assigned_user_id if kind == "user" else signal.assignee_team_id
        if created or signal.assignee_kind != kind or current != owner_id:
            set_owner(signal, kind, owner_id, by_user_id=trigger.created_by_user_id)
    mirror_next_at(signal, trigger)
    session.add(signal)
    return signal


async def resolve_recipient(
    session: AsyncSession, tenant_id: UUID, raw: Any
) -> tuple[str, UUID] | None:
    """A person or team by id, email or name. None clears to the creator.

    Accepts ``{"kind": "user"|"team", "id": ...}`` or a plain string.
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
    if kind in ("", "team"):
        for team in teams:
            if as_id and team.id == as_id:
                return "team", team.id
            if (team.name or "").lower() == lowered:
                return "team", team.id
    if kind in ("", "user") and not as_id:
        matches = [u for u in members if lowered and lowered in (u.display_name or "").lower()]
        if len(matches) == 1:
            return "user", matches[0].id
    raise HTTPException(status_code=422, detail=f"Recipient not found: {text}")


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
    agent_id: UUID | None = None,
    instructions: str | None = None,
    recipient: tuple[str, UUID] | None | object = ...,
    details: dict[str, Any] | None = None,
    created_by_user_id: UUID | None = None,
    project_id: UUID | None = None,
    actor_type: str = "user",
    actor_id: str = "",
    enabled: bool = True,
) -> tuple[Signal, Trigger | None]:
    """Put a date and/or repeat rule on a thread (a new thread when none given).

    One moment without an agent is just ``next_at``. A repeat, or an agent
    with instructions, is a rule bound to the thread. Caller commits.
    """
    from app.services.triggers import compute_next_run, next_cron_run

    at, ends_at = naive_utc(at), naive_utc(ends_at)
    repeat = _repeat_from(cron=cron, every_minutes=every_minutes)
    if repeat and repeat[0] == "cron" and next_cron_run(repeat[1], datetime.utcnow()) is None:
        raise HTTPException(status_code=422, detail="Invalid cron expression")
    if ends_at and at and ends_at < at:
        raise HTTPException(status_code=422, detail="ends_at is before the start")

    agent: Agent | None = None
    if agent_id:
        agent = (
            await session.execute(
                select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if agent is None:
            raise HTTPException(status_code=404, detail="Agent not found")

    if signal is None:
        if not (title or "").strip():
            raise HTTPException(status_code=422, detail="A title is required for a new agenda item")
        if at is None and repeat is None:
            raise HTTPException(status_code=422, detail="Give a moment or a repeat")
        signal = await create_schedule_thread(
            session, tenant_id, subject=title, agent=agent, project_id=project_id
        )
    elif title and signal.source == SCHEDULE_SOURCE:
        signal.subject = title.strip()[:200]

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
        if agent is not None:
            rule.agent_id = agent.id
            if signal.agent_id is None:
                signal.agent_id = agent.id
        if instructions is not None:
            rule.instructions = instructions
        if recipient is not ...:
            if recipient is None:
                rule.recipient_kind, rule.recipient_user_id, rule.recipient_team_id = "", None, None
            else:
                kind, rid = recipient  # type: ignore[misc]
                rule.recipient_kind = kind
                rule.recipient_user_id = rid if kind == "user" else None
                rule.recipient_team_id = rid if kind == "team" else None
        rule.enabled = enabled
        if not enabled:
            rule.next_run_at = None
        elif rule.kind == "once":
            rule.next_run_at = at or rule.next_run_at or datetime.utcnow()
        else:
            rule.next_run_at = at if at and at > datetime.utcnow() else compute_next_run(rule)
        rule.updated_at = datetime.utcnow()
        session.add(rule)
        await session.flush()
        await ensure_trigger_thread(session, rule, agent=agent)
    else:
        if rule is not None and rule.kind != "webhook":
            rule.deleted_at = datetime.utcnow()
            rule.enabled = False
            session.add(rule)
            rule = None
        if recipient is not ... and recipient is not None:
            from app.services.ownership import set_owner

            kind, rid = recipient  # type: ignore[misc]
            set_owner(signal, kind, rid, by_user_id=created_by_user_id)
        elif signal.source == SCHEDULE_SOURCE and not signal.assignee_kind and created_by_user_id:
            from app.services.ownership import set_owner

            set_owner(signal, "user", created_by_user_id, by_user_id=created_by_user_id)
        signal.next_at = at

    signal.ends_at = ends_at
    if details is not None:
        signal.schedule_json = _details_json({**thread_details(signal), **details})
    signal.updated_at = datetime.utcnow()
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
        rule.deleted_at = datetime.utcnow()
        rule.enabled = False
        session.add(rule)
    signal.next_at = None
    signal.ends_at = None
    signal.updated_at = datetime.utcnow()
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
        raise HTTPException(status_code=404, detail="This thread has no repeat")
    rule.enabled = enabled
    if not enabled:
        rule.next_run_at = None
    elif rule.kind == "once":
        rule.next_run_at = rule.next_run_at or datetime.utcnow()
    else:
        rule.next_run_at = compute_next_run(rule)
    rule.updated_at = datetime.utcnow()
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


async def owner_recipients(session: AsyncSession, signal: Signal) -> list[UUID]:
    """People to notify when the thread comes up: its person or team owner."""
    if signal.assignee_kind == "user" and signal.assigned_user_id:
        return [signal.assigned_user_id]
    if signal.assignee_kind == "team" and signal.assignee_team_id:
        from app.models.team import Team
        from app.services.teams import team_members

        team = await session.get(Team, signal.assignee_team_id)
        if team is not None:
            return [m.id for m in await team_members(session, team) if m.kind == "user"]
    return []


def reopen_for_moment(signal: Signal, now: datetime | None = None) -> bool:
    """Bring a thread back to the list: open and unread. True when it was parked."""
    now = now or datetime.utcnow()
    parked = signal.status in REOPEN_FROM
    if parked:
        signal.status = "open"
    signal.has_unread = True
    signal.updated_at = now
    return parked


async def notify_moment(
    session: AsyncSession, signal: Signal, *, title: str, body: str = ""
) -> None:
    recipients = await owner_recipients(session, signal)
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

    now = datetime.utcnow()
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
    for signal in rows:
        due_at = signal.next_at
        reopen_for_moment(signal, now)
        signal.next_at = None
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="due",
                actor_type="system",
                actor_id="",
                payload_json=json.dumps({"at": _iso(due_at), "note": thread_details(signal).get("note") or ""}),
            )
        )
    if rows:
        await session.commit()
        for signal in rows:
            await notify_moment(session, signal, title=signal.subject or "Agenda")
            await publish_thread_update(signal)
    return len(rows)


async def convert_event_trigger(session: AsyncSession, trigger: Trigger) -> Signal:
    """A person event (kind ``event``) becomes a thread with a date. Caller commits."""
    signal = await ensure_trigger_thread(session, trigger)
    if trigger.next_run_at and trigger.enabled:
        signal.next_at = trigger.next_run_at
    if trigger.instructions:
        signal.schedule_json = _details_json({**thread_details(signal), "note": trigger.instructions})
    trigger.deleted_at = datetime.utcnow()
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
    for trigger in rows:
        if trigger.kind == "event":
            await convert_event_trigger(session, trigger)
        else:
            await ensure_trigger_thread(session, trigger)
    if rows:
        await session.commit()
    return len(rows)
