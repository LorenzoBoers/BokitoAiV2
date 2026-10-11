"""Trigger scheduling and firing: cron, interval, heartbeat, webhook.

One model wakes agents proactively. Heartbeat triggers read the tenant
heartbeat checklist doc; an agent reply of HEARTBEAT_OK is suppressed
(nothing surfaces in Messages), anything else is posted to an internal
Signal thread so humans see it.
"""

from __future__ import annotations

import json
import re
import secrets
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun
from app.models.auth import Tenant
from app.models.trigger import TRIGGER_KINDS, Trigger

HEARTBEAT_OK = "HEARTBEAT_OK"

SCHEDULED_WAKE_PREAMBLE = (
    "This is a scheduled wake. You work inside this task's own conversation: "
    "whatever you write lands there and is read by {recipient}. Write to them "
    "directly, most important first, at most three points. Use your tools to "
    "check what you need before you write.\n"
    "Propose, do not act: before you set anything up (a flow, project, rule, "
    "integration, agent), ask with create_decision_request so they can approve "
    "in the conversation. When a question concerns another conversation, pass "
    "its subject as thread_subject so the card lands there.\n"
    "Report only what changed since the previous report: new conversations, "
    "decisions, finished work. Never repeat a point or proposal that is still "
    "open or was declined, and do not restate open counts.\n"
    f"If there is nothing new worth their attention, reply with exactly {HEARTBEAT_OK} "
    "and nothing else."
)

# A report that reads the same as the previous one (counts aside) is noise:
# one tenant received 193 near-identical half-hourly posts in four days.
HEARTBEAT_SIMILARITY_SUPPRESS = 0.85
_DIGITS_RE = re.compile(r"\d+")
_WS_RE = re.compile(r"\s+")


def _normalize_report(text: str) -> str:
    lowered = _DIGITS_RE.sub("#", (text or "").lower())
    return _WS_RE.sub(" ", lowered).strip()


def heartbeat_report_similarity(previous: str, current: str) -> float:
    """0..1 similarity between two check-in reports, ignoring numbers and spacing."""
    a, b = _normalize_report(previous), _normalize_report(current)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def is_repeat_heartbeat_report(previous: str | None, current: str) -> bool:
    if not previous:
        return False
    return heartbeat_report_similarity(previous, current) >= HEARTBEAT_SIMILARITY_SUPPRESS


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def serialize_trigger(row: Trigger) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "kind": row.kind,
        "cron_expr": row.cron_expr,
        "interval_minutes": row.interval_minutes,
        "agent_id": str(row.agent_id) if row.agent_id else None,
        "agent_role": row.agent_role,
        "workstream_id": str(row.workstream_id) if row.workstream_id else None,
        "signal_id": str(row.signal_id) if row.signal_id else None,
        "recipient_kind": row.recipient_kind or None,
        "recipient_id": str(row.recipient_user_id or row.recipient_team_id or "") or None,
        "purpose": row.purpose or None,
        "instructions": row.instructions,
        "has_webhook_secret": bool(row.webhook_secret),
        "enabled": row.enabled,
        "last_run_at": _iso(row.last_run_at),
        "next_run_at": _iso(row.next_run_at),
        "last_status": row.last_status,
        "created_at": _iso(row.created_at),
    }


# ── cron (minimal 5-field: minute hour day-of-month month day-of-week) ──


def _parse_cron_field(field: str, lo: int, hi: int) -> set[int]:
    values: set[int] = set()
    for part in field.split(","):
        part = part.strip()
        step = 1
        if "/" in part:
            part, step_s = part.split("/", 1)
            step = max(1, int(step_s))
        if part in ("*", ""):
            start, end = lo, hi
        elif "-" in part:
            a, b = part.split("-", 1)
            start, end = int(a), int(b)
        else:
            start = end = int(part)
        for v in range(start, end + 1, step):
            if lo <= v <= hi:
                values.add(v)
    return values


def next_cron_run(expr: str, after: datetime) -> datetime | None:
    """Next datetime strictly after `after` matching a 5-field cron expression."""
    parts = expr.split()
    if len(parts) != 5:
        return None
    try:
        minutes = _parse_cron_field(parts[0], 0, 59)
        hours = _parse_cron_field(parts[1], 0, 23)
        days = _parse_cron_field(parts[2], 1, 31)
        months = _parse_cron_field(parts[3], 1, 12)
        weekdays = _parse_cron_field(parts[4], 0, 6)  # 0 = Sunday
    except ValueError:
        return None
    cursor = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    # Scan up to ~366 days of minutes; cheap enough for a 60s scheduler tick.
    for _ in range(527040):
        if (
            cursor.minute in minutes
            and cursor.hour in hours
            and cursor.day in days
            and cursor.month in months
            and (cursor.weekday() + 1) % 7 in weekdays
        ):
            return cursor
        cursor += timedelta(minutes=1)
    return None


def compute_next_run(trigger: Trigger, now: datetime | None = None) -> datetime | None:
    now = now or datetime.utcnow()
    if not trigger.enabled:
        return None
    if trigger.kind == "cron":
        return next_cron_run(trigger.cron_expr, now)
    if trigger.kind in ("interval", "heartbeat"):
        minutes = max(1, trigger.interval_minutes or 60)
        return now + timedelta(minutes=minutes)
    # webhook: fired externally; once/event: one-shot, next_run_at is set at
    # creation and cleared after firing.
    return None


# ── CRUD helpers ─────────────────────────────────────────────────────


async def rotate_webhook_secret(
    session: AsyncSession, tenant_id: UUID, trigger_id: UUID
) -> tuple[Trigger, str]:
    trigger = await get_trigger(session, tenant_id, trigger_id)
    if trigger.kind != "webhook":
        raise HTTPException(status_code=400, detail="Only webhook triggers have secrets")
    new_secret = secrets.token_urlsafe(24)
    trigger.webhook_secret = new_secret
    trigger.updated_at = datetime.utcnow()
    session.add(trigger)
    await session.commit()
    await session.refresh(trigger)
    return trigger, new_secret


async def test_webhook_trigger(
    session: AsyncSession, tenant_id: UUID, trigger_id: UUID
) -> dict[str, Any]:
    trigger = await get_trigger(session, tenant_id, trigger_id)
    if trigger.kind != "webhook":
        raise HTTPException(status_code=400, detail="Only webhook triggers can be tested")
    if not trigger.webhook_secret:
        raise HTTPException(status_code=400, detail="Webhook secret is not configured")
    result = await fire_trigger(
        session,
        trigger,
        payload={"source": "bokito_test_ping", "test": True},
    )
    return {
        "ok": True,
        "status": result.get("status"),
        "run_id": result.get("run_id"),
        "task_id": result.get("task_id"),
    }


async def get_trigger(
    session: AsyncSession, tenant_id: UUID, trigger_id: UUID, *, include_deleted: bool = False
) -> Trigger:
    from app.services.trash import alive

    query = select(Trigger).where(Trigger.id == trigger_id, Trigger.tenant_id == tenant_id)
    if not include_deleted:
        query = query.where(alive(Trigger))
    result = await session.execute(query)
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Trigger not found")
    return row


async def create_trigger(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    name: str,
    kind: str,
    cron_expr: str = "",
    interval_minutes: int = 0,
    agent_id: UUID | None = None,
    agent_role: str = "orchestra",
    workstream_id: UUID | None = None,
    instructions: str = "",
    enabled: bool = True,
    run_at: datetime | None = None,
    signal_id: UUID | None = None,
    created_by_user_id: UUID | None = None,
    recipient: tuple[str, UUID] | None = None,
) -> Trigger:
    """A rule always runs in a thread: ``signal_id`` or a new agenda thread.

    ``event`` (a person's moment) is not a rule; it becomes a date on the thread.
    """
    from app.services.thread_schedule import convert_event_trigger, ensure_trigger_thread

    if kind not in TRIGGER_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid trigger kind: {kind}")
    if kind == "cron" and next_cron_run(cron_expr, datetime.utcnow()) is None:
        raise HTTPException(status_code=400, detail="Invalid cron expression")
    if kind in ("once", "event") and run_at is None:
        raise HTTPException(status_code=400, detail=f"run_at is required for kind={kind}")
    trigger = Trigger(
        tenant_id=tenant_id,
        name=name,
        kind=kind,
        cron_expr=cron_expr,
        interval_minutes=interval_minutes,
        agent_id=agent_id,
        agent_role=agent_role,
        workstream_id=workstream_id,
        instructions=instructions,
        webhook_secret=secrets.token_urlsafe(24) if kind == "webhook" else "",
        enabled=enabled,
        signal_id=signal_id,
        created_by_user_id=created_by_user_id,
    )
    if recipient is not None:
        trigger.recipient_kind = recipient[0]
        trigger.recipient_user_id = recipient[1] if recipient[0] == "user" else None
        trigger.recipient_team_id = recipient[1] if recipient[0] == "team" else None
    if kind in ("once", "event"):
        trigger.next_run_at = run_at
    else:
        trigger.next_run_at = compute_next_run(trigger)
    session.add(trigger)
    await session.flush()
    if kind == "event":
        await convert_event_trigger(session, trigger)
    else:
        await ensure_trigger_thread(session, trigger)
    await session.commit()
    await session.refresh(trigger)
    return trigger


# ── firing ───────────────────────────────────────────────────────────


async def resolve_trigger_agent(session: AsyncSession, trigger: Trigger) -> Agent | None:
    """Resolve the agent for a trigger. Archived / inactive agents never fire.

    Public because the seeded check-in binds its thread to the same agent that
    will run it (`platform_watch`); two resolutions would fight over the row.
    """
    if trigger.agent_id:
        result = await session.execute(
            select(Agent).where(Agent.id == trigger.agent_id, Agent.tenant_id == trigger.tenant_id)
        )
        agent = result.scalar_one_or_none()
        if agent:
            return agent if agent.is_active and agent.kind == "company" else None
    role = trigger.agent_role or "orchestra"
    roles = ("orchestra", "orchestrator") if role in ("orchestra", "orchestrator") else (role,)
    result = await session.execute(
        select(Agent)
        .where(
            Agent.tenant_id == trigger.tenant_id,
            Agent.kind == "company",
            Agent.role.in_(roles),
            Agent.is_active == True,  # noqa: E712
        )
        .limit(1)
    )
    agent = result.scalar_one_or_none()
    if agent:
        return agent
    from app.services.lead_agent import get_lead_agent

    return await get_lead_agent(session, trigger.tenant_id)


async def _heartbeat_checklist(session: AsyncSession, tenant_id: UUID) -> str:
    from app.services.workspace import list_docs

    docs = await list_docs(session, tenant_id, kind="heartbeat")
    from app.modules.catalog import with_heartbeat_module_hint

    parts = [d.content for d in docs if d.content.strip()]
    if not parts:
        return with_heartbeat_module_hint("")
    return "\n\n".join(with_heartbeat_module_hint(part) for part in parts)


async def previous_heartbeat_report(
    session: AsyncSession, trigger: Trigger
) -> tuple[str, datetime | None]:
    """The last report this trigger posted, so the next run can diff against it."""
    from app.models.signal import SignalMessage

    if not trigger.signal_id:
        return "", None
    rows = (
        await session.execute(
            select(SignalMessage)
            .where(
                SignalMessage.signal_id == trigger.signal_id,
                SignalMessage.tenant_id == trigger.tenant_id,
                SignalMessage.kind == "agent_message",
            )
            .order_by(SignalMessage.received_at.desc())
            .limit(20)
        )
    ).scalars().all()
    for row in rows:
        try:
            meta = json.loads(row.metadata_json or "{}")
        except (TypeError, json.JSONDecodeError):
            meta = {}
        if str(meta.get("trigger_id") or "") == str(trigger.id):
            return row.body_text or "", row.received_at
    return "", None


async def _recipient_label(session: AsyncSession, signal: Any) -> str:
    """Who the wake writes to, for the prompt: a person, a team, or the team at large."""
    from app.models.auth import User
    from app.models.team import Team

    if signal.assignee_kind == "user" and signal.assigned_user_id:
        user = await session.get(User, signal.assigned_user_id)
        if user is not None:
            return f"{user.display_name or user.email} (a person)"
    if signal.assignee_kind == "team" and signal.assignee_team_id:
        team = await session.get(Team, signal.assignee_team_id)
        if team is not None:
            return f"the team {team.name}"
    return "the people of this workspace"


async def _surface_result(
    session: AsyncSession, trigger: Trigger, agent: Agent, loop: Any, text: str
) -> None:
    """The wake had something to say: save the turn in the thread and bring it back."""
    from app.models.signal import Signal
    from app.services.thread_schedule import ensure_trigger_thread, notify_moment, reopen_for_moment

    signal = await ensure_trigger_thread(session, trigger, agent=agent)
    meta = {"trigger_id": str(trigger.id), "trigger_kind": trigger.kind}
    if loop is not None and loop.turn is not None and loop.turn.segments:
        await loop.persist_turn(signal, metadata=meta, fallback_text=text)
    else:
        from app.services.assistant_threads import append_signal_chat_message

        await append_signal_chat_message(
            session, signal, role="assistant", content=text, author_agent_id=agent.id, metadata=meta
        )
    reopen_for_moment(signal)
    session.add(signal)
    await session.commit()
    refreshed = await session.get(Signal, signal.id)
    if refreshed is not None:
        await notify_moment(
            session, refreshed, title=refreshed.subject or trigger.name, body=text[:300]
        )


async def _wake_event(
    session: AsyncSession, signal: Any, event_type: str, trigger: Trigger, agent: Agent | None
) -> None:
    from app.models.signal import SignalEvent

    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type=event_type,
            actor_type="agent" if agent else "system",
            actor_id=str(agent.id) if agent else "",
            payload_json=json.dumps(
                {
                    "trigger_id": str(trigger.id),
                    "name": trigger.name,
                    "agent_name": agent.name if agent else "",
                }
            ),
        )
    )


async def fire_trigger(
    session: AsyncSession,
    trigger: Trigger,
    *,
    payload: dict[str, Any] | None = None,
    manual: bool = False,
) -> dict[str, Any]:
    """Run one moment of a thread's rule. The agent works live in the thread.

    ``manual`` (Run now) keeps the schedule: the next moment stays where it was.
    """
    from app.gateway.publish import publish_thread_update
    from app.services.agent.loop import AgentLoop
    from app.services.thread_schedule import convert_event_trigger, ensure_trigger_thread, mirror_next_at

    now = datetime.utcnow()

    if trigger.kind == "event":
        # A person moment is a date on its thread, not a rule.
        signal = await convert_event_trigger(session, trigger)
        await session.commit()
        await publish_thread_update(signal)
        return {"status": "converted", "signal_id": str(signal.id)}

    if trigger.purpose == "stage_checkup":
        from app.services.stage_checkups import fire_checkup

        return await fire_checkup(session, trigger)

    def _advance() -> None:
        if manual:
            return
        trigger.next_run_at = compute_next_run(trigger, now)
        if trigger.kind == "once":
            trigger.enabled = False
            trigger.next_run_at = None

    if trigger.workstream_id:
        from app.services.outcomes import list_recent_outcomes, summarize_outcomes
        from app.services.workstreams import start_run

        input_text = trigger.instructions
        recent = await list_recent_outcomes(session, trigger.tenant_id, days=7)
        if recent:
            input_text += f"\n\n## Recent operational outcomes\n{summarize_outcomes(recent)}"

        trigger.last_run_at = now
        trigger.last_status = "started"
        _advance()
        trigger.updated_at = now
        session.add(trigger)
        signal = await ensure_trigger_thread(session, trigger)
        await session.commit()
        run = await start_run(
            session,
            trigger.tenant_id,
            trigger.workstream_id,
            input_kind="trigger",
            input_text=input_text,
            input_ref=str(trigger.id),
            triggered_by_type="trigger",
            triggered_by_id=str(trigger.id),
        )
        return {"run_id": str(run.id), "status": "started", "signal_id": str(signal.id)}

    agent = await resolve_trigger_agent(session, trigger)
    if not agent:
        status = "no_agent"
        if trigger.agent_id:
            bound = (
                await session.execute(
                    select(Agent).where(
                        Agent.id == trigger.agent_id, Agent.tenant_id == trigger.tenant_id
                    )
                )
            ).scalar_one_or_none()
            if bound and (not bound.is_active or bound.kind != "company"):
                status = "agent_archived"
        trigger.last_status = status
        if not manual:
            trigger.next_run_at = compute_next_run(trigger, now)
        session.add(trigger)
        signal = await ensure_trigger_thread(session, trigger)
        await session.commit()
        return {"status": status, "signal_id": str(signal.id)}

    # Workspace LLM block (credits, key, spend cap): skip the run instead of
    # logging one more identical failure; the trigger simply fires next time.
    from app.services.run_errors import active_workspace_block

    tenant = await session.get(Tenant, trigger.tenant_id)
    blocked = active_workspace_block(tenant) if tenant is not None else None
    if blocked:
        trigger.last_status = f"blocked:{blocked.get('kind')}"
        if not manual:
            trigger.next_run_at = compute_next_run(trigger, now)
        session.add(trigger)
        signal = await ensure_trigger_thread(session, trigger, agent=agent)
        mirror_next_at(signal, trigger)
        await session.commit()
        return {"status": "blocked", "block": blocked.get("kind")}

    # The wake happens in its thread: a line marks the start, the agent's
    # turn streams there, and the report (if any) is saved there.
    signal = await ensure_trigger_thread(session, trigger, agent=agent)
    await _wake_event(session, signal, "wake_started", trigger, agent)
    await session.commit()
    await publish_thread_update(signal)

    recurring = trigger.kind in ("cron", "interval", "heartbeat")
    prompt_parts = [
        SCHEDULED_WAKE_PREAMBLE.format(recipient=await _recipient_label(session, signal)),
    ]
    if trigger.kind == "heartbeat":
        checklist = await _heartbeat_checklist(session, trigger.tenant_id)
        if checklist:
            prompt_parts.append(f"## Checklist\n{checklist}")
    if trigger.instructions.strip():
        prompt_parts.append(f"## Your task\n{trigger.instructions.strip()}")
    elif trigger.kind != "heartbeat":
        prompt_parts.append("## Your task\nExecute the scheduled wake.")
    previous_report = ""
    if recurring:
        previous_report, previous_at = await previous_heartbeat_report(session, trigger)
        if previous_report:
            stamp = previous_at.strftime("%Y-%m-%d %H:%M UTC") if previous_at else "earlier"
            prompt_parts.append(
                f"## Previous report ({stamp})\n"
                "Already said; mention only what is new or resolved since.\n\n"
                f"{previous_report[:4000]}"
            )
    prompt = "\n\n".join(prompt_parts)
    if payload:
        if payload.get("kind") == "report":
            from app.services.outcomes import ingest_trading_report

            outcome = await ingest_trading_report(
                session,
                trigger.tenant_id,
                payload,
                source="trading_webhook",
                signal_id=signal.id,
            )
            prompt += (
                f"\n\nStructured report ingested (outcome_id={outcome.id}, kind={outcome.kind})."
                f"\nSummarize for the operator and note any follow-up actions."
            )
        prompt += f"\n\nWebhook payload:\n{json.dumps(payload)[:4000]}"

    run = AgentRun(
        tenant_id=trigger.tenant_id,
        agent_id=agent.id,
        trigger_type=f"trigger_{trigger.kind}",
        trigger_id=str(trigger.id),
        subject=trigger.name[:120],
        signal_id=signal.id,
    )
    session.add(run)
    await session.flush()
    await session.refresh(run)

    # Scheduled jobs always land on the Task ledger. Recurring wakes stay
    # lazy: an all-clear moment is not work, so the loop only promotes it
    # when it actually does something.
    if not recurring:
        from app.services.task_ledger import promote_run_to_task

        await promote_run_to_task(session, run, title=trigger.name)

    loop = AgentLoop(
        session,
        trigger.tenant_id,
        None,
        agent=agent,
        run=run,
        signal_id=signal.id,
    )
    try:
        text, _tokens = await loop.run_chat([{"role": "user", "content": prompt}])
    except Exception as exc:
        # Record the failure on the run itself (a bare rollback left runs
        # with no error text), then open the workspace block when the cause
        # is a credits / key / spend-cap problem that will hit every run.
        from app.services.run_errors import open_workspace_block, record_run_error, workspace_block

        run.status = "failed"
        run.completed_at = datetime.utcnow()
        record_run_error(run, exc)
        session.add(run)
        block = workspace_block(exc)
        if block and tenant is not None:
            open_workspace_block(tenant, kind=block, error=exc)
            session.add(tenant)
        trigger.last_status = f"blocked:{block}" if block else "error"
        if not manual:
            trigger.next_run_at = compute_next_run(trigger, now)
        session.add(trigger)
        mirror_next_at(signal, trigger)
        session.add(signal)
        await session.commit()
        if block:
            from app.services.ops_alerts import alert_workspace_block

            await alert_workspace_block(session, trigger.tenant_id, block=block, error=exc)
            return {"run_id": str(run.id), "status": "blocked", "block": block}
        raise
    run.status = "completed"
    run.completed_at = datetime.utcnow()

    from app.services.task_ledger import settle_run_task

    await settle_run_task(session, run)

    # A completed model turn ends any recorded block; deferred inbound
    # threads get re-queued.
    from app.workers.tasks import release_workspace_block

    await release_workspace_block(session, tenant)

    suppressed = text.strip().rstrip(".") == HEARTBEAT_OK
    repeated = recurring and not suppressed and is_repeat_heartbeat_report(previous_report, text)
    if not suppressed and not repeated and text.strip():
        await _surface_result(session, trigger, agent, loop, text)
    else:
        await _wake_event(session, signal, "wake_quiet", trigger, agent)

    trigger.last_run_at = now
    trigger.last_status = "ok" if suppressed else "unchanged" if repeated else "reported"
    _advance()
    trigger.updated_at = now
    session.add(trigger)
    from app.models.signal import Signal

    current = await session.get(Signal, signal.id)
    if current is not None:
        mirror_next_at(current, trigger)
        session.add(current)
    await session.commit()
    if current is not None:
        await publish_thread_update(current)
    return {
        "run_id": str(run.id),
        "status": trigger.last_status,
        "suppressed": suppressed or repeated,
        "signal_id": str(signal.id),
    }


# ── planned moments (read by services.time_items) ────────────────────

MAX_OCCURRENCES_PER_TRIGGER = 100


def _planned_occurrences(trigger: Trigger, start: datetime, end: datetime) -> list[datetime]:
    """Expand a trigger's schedule into concrete future moments inside [start, end]."""
    if not trigger.enabled or trigger.next_run_at is None:
        return []
    moments: list[datetime] = []
    if trigger.kind in ("once", "event"):
        if start <= trigger.next_run_at <= end:
            moments.append(trigger.next_run_at)
        return moments
    if trigger.kind == "cron":
        cursor = max(start, trigger.next_run_at) - timedelta(minutes=1)
        while len(moments) < MAX_OCCURRENCES_PER_TRIGGER:
            nxt = next_cron_run(trigger.cron_expr, cursor)
            if nxt is None or nxt > end:
                break
            if nxt >= start:
                moments.append(nxt)
            cursor = nxt
        return moments
    if trigger.kind in ("interval", "heartbeat"):
        minutes = max(1, trigger.interval_minutes or 60)
        cursor = trigger.next_run_at
        while cursor <= end and len(moments) < MAX_OCCURRENCES_PER_TRIGGER:
            if cursor >= start:
                moments.append(cursor)
            cursor = cursor + timedelta(minutes=minutes)
        return moments
    return []  # webhook: not plannable


async def process_due_triggers(session: AsyncSession, tenant_id: UUID | None = None) -> int:
    now = datetime.utcnow()
    conditions = [
        Trigger.enabled.is_(True),
        Trigger.deleted_at.is_(None),
        Trigger.next_run_at.is_not(None),
        Trigger.next_run_at <= now,
    ]
    if tenant_id is not None:
        conditions.append(Trigger.tenant_id == tenant_id)
    result = await session.execute(select(Trigger).where(*conditions))
    count = 0
    for trigger in result.scalars().all():
        try:
            await fire_trigger(session, trigger)
            count += 1
        except Exception as exc:  # noqa: BLE001 - isolate per-trigger failures
            await session.rollback()
            trigger.last_status = "error"
            trigger.next_run_at = compute_next_run(trigger, now)
            session.add(trigger)
            await session.commit()

            from app.services.ops_alerts import alert_run_failure

            await alert_run_failure(
                session,
                trigger.tenant_id,
                subject=f"Trigger '{trigger.name}'",
                error=exc,
            )
    return count
