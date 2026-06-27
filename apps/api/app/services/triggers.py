"""Trigger scheduling and firing: cron, interval, heartbeat, webhook.

One model wakes agents proactively. Heartbeat triggers read the tenant
heartbeat checklist doc; an agent reply of HEARTBEAT_OK is suppressed
(nothing surfaces in Messages), anything else is posted to an internal
Signal thread so humans see it.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun
from app.models.trigger import TRIGGER_KINDS, Trigger

HEARTBEAT_OK = "HEARTBEAT_OK"

HEARTBEAT_PROMPT = (
    "This is a scheduled heartbeat wake. Work through the checklist below. "
    "Use your tools to check on anything that needs attention. "
    f"If everything is fine and there is nothing to report, reply with exactly {HEARTBEAT_OK} "
    "and nothing else. Otherwise describe what needs attention or what you did."
)


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


async def get_trigger(session: AsyncSession, tenant_id: UUID, trigger_id: UUID) -> Trigger:
    result = await session.execute(
        select(Trigger).where(Trigger.id == trigger_id, Trigger.tenant_id == tenant_id)
    )
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
) -> Trigger:
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
    )
    if kind in ("once", "event"):
        trigger.next_run_at = run_at
    else:
        trigger.next_run_at = compute_next_run(trigger)
    session.add(trigger)
    await session.commit()
    await session.refresh(trigger)
    return trigger


# ── firing ───────────────────────────────────────────────────────────


async def _resolve_agent(session: AsyncSession, trigger: Trigger) -> Agent | None:
    if trigger.agent_id:
        result = await session.execute(
            select(Agent).where(Agent.id == trigger.agent_id, Agent.tenant_id == trigger.tenant_id)
        )
        agent = result.scalar_one_or_none()
        if agent:
            return agent
    role = trigger.agent_role or "orchestra"
    roles = ("orchestra", "orchestrator") if role in ("orchestra", "orchestrator") else (role,)
    result = await session.execute(
        select(Agent).where(Agent.tenant_id == trigger.tenant_id, Agent.role.in_(roles)).limit(1)
    )
    return result.scalar_one_or_none()


async def _heartbeat_checklist(session: AsyncSession, tenant_id: UUID) -> str:
    from app.services.workspace import list_docs

    docs = await list_docs(session, tenant_id, kind="heartbeat")
    return "\n\n".join(d.content for d in docs if d.content.strip())


async def _operations_signal_id(session: AsyncSession, tenant_id: UUID) -> UUID | None:
    from app.dependencies import tenant_settings
    from app.models.auth import Tenant

    tenant = await session.get(Tenant, tenant_id)
    if not tenant:
        return None
    raw = tenant_settings(tenant).get("operations_signal_id")
    if not raw:
        return None
    try:
        return UUID(str(raw))
    except ValueError:
        return None


async def _surface_result(
    session: AsyncSession, trigger: Trigger, agent: Agent, text: str
) -> None:
    """Post a non-OK trigger result into an internal Signal thread (Messages)."""
    from app.models.signal import Signal
    from app.services.assistant_threads import append_signal_chat_message
    from app.services.signal_decisions import get_or_create_internal_thread

    ops_signal_id = await _operations_signal_id(session, trigger.tenant_id)
    signal: Signal | None = None
    if ops_signal_id:
        signal = await session.get(Signal, ops_signal_id)
        if signal and signal.tenant_id != trigger.tenant_id:
            signal = None
    if not signal:
        signal = await get_or_create_internal_thread(
            session,
            trigger.tenant_id,
            subject=trigger.name,
            contact_name=agent.name,
            agent_id=agent.id,
        )
    await append_signal_chat_message(
        session,
        signal,
        role="assistant",
        content=text,
        author_agent_id=agent.id,
        metadata={"trigger_id": str(trigger.id), "trigger_kind": trigger.kind},
    )


async def _fire_event(session: AsyncSession, trigger: Trigger, now: datetime) -> dict[str, Any]:
    """Calendar events do not run agents; they surface a notification and complete."""
    from app.gateway.publish import publish_notification
    from app.models.notification import Notification

    notification = Notification(
        tenant_id=trigger.tenant_id,
        kind="status_update",
        title=trigger.name,
        body=trigger.instructions or "Scheduled event",
        payload_json=json.dumps({"trigger_id": str(trigger.id), "trigger_kind": "event"}),
    )
    session.add(notification)
    trigger.last_run_at = now
    trigger.last_status = "done"
    trigger.next_run_at = None
    trigger.enabled = False
    trigger.updated_at = now
    session.add(trigger)
    await session.commit()
    await session.refresh(notification)
    await publish_notification(
        trigger.tenant_id,
        notification_id=notification.id,
        kind="status_update",
        title=trigger.name,
    )
    return {"status": "done"}


async def fire_trigger(
    session: AsyncSession,
    trigger: Trigger,
    *,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.services.agent.loop import AgentLoop

    now = datetime.utcnow()

    if trigger.kind == "event":
        return await _fire_event(session, trigger, now)

    if trigger.workstream_id:
        from app.services.orchestration.dispatcher import create_agent_task
        from app.services.outcomes import list_recent_outcomes, summarize_outcomes

        description = trigger.instructions
        recent = await list_recent_outcomes(session, trigger.tenant_id, days=7)
        if recent:
            description += f"\n\n## Recent operational outcomes\n{summarize_outcomes(recent)}"

        task = await create_agent_task(
            session,
            trigger.tenant_id,
            title=trigger.name,
            description=description,
            workstream_id=trigger.workstream_id,
            trigger_type="trigger",
            trigger_id=str(trigger.id),
            auto_start=True,
        )
        trigger.last_run_at = now
        trigger.last_status = "started"
        trigger.next_run_at = compute_next_run(trigger, now)
        if trigger.kind == "once":
            trigger.enabled = False
        trigger.updated_at = now
        session.add(trigger)
        await session.commit()
        return {"task_id": str(task.id), "status": "started"}

    agent = await _resolve_agent(session, trigger)
    if not agent:
        trigger.last_status = "no_agent"
        trigger.next_run_at = compute_next_run(trigger, now)
        session.add(trigger)
        await session.commit()
        return {"status": "no_agent"}

    if trigger.kind == "heartbeat":
        checklist = await _heartbeat_checklist(session, trigger.tenant_id)
        prompt_parts = [HEARTBEAT_PROMPT]
        if checklist:
            prompt_parts.append(f"## Checklist\n{checklist}")
        if trigger.instructions.strip():
            prompt_parts.append(trigger.instructions)
        prompt = "\n\n".join(prompt_parts)
    else:
        prompt = trigger.instructions.strip() or "Execute the scheduled wake."
        if payload:
            if payload.get("kind") == "report":
                from app.services.outcomes import ingest_trading_report

                ops_signal_id = await _operations_signal_id(session, trigger.tenant_id)
                outcome = await ingest_trading_report(
                    session,
                    trigger.tenant_id,
                    payload,
                    source="trading_webhook",
                    signal_id=ops_signal_id,
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
    )
    session.add(run)
    await session.flush()
    await session.refresh(run)

    loop = AgentLoop(session, trigger.tenant_id, None, agent=agent, run=run)
    text, _tokens = await loop.run_chat([{"role": "user", "content": prompt}])
    run.status = "completed"
    run.completed_at = datetime.utcnow()

    suppressed = trigger.kind == "heartbeat" and text.strip().rstrip(".") == HEARTBEAT_OK
    if not suppressed and text.strip():
        await _surface_result(session, trigger, agent, text)

    trigger.last_run_at = now
    trigger.last_status = "ok" if suppressed else "reported"
    trigger.next_run_at = compute_next_run(trigger, now)
    if trigger.kind == "once":
        trigger.enabled = False
    trigger.updated_at = now
    session.add(trigger)
    await session.commit()
    return {"run_id": str(run.id), "status": trigger.last_status, "suppressed": suppressed}


# ── agenda (calendar occurrences) ────────────────────────────────────

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


async def agenda_occurrences(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    start: datetime,
    end: datetime,
    agent_id: UUID | None = None,
) -> list[dict[str, Any]]:
    """Calendar items in [start, end]: planned trigger expansions + run history."""
    stmt = select(Trigger).where(Trigger.tenant_id == tenant_id)
    if agent_id:
        stmt = stmt.where(Trigger.agent_id == agent_id)
    result = await session.execute(stmt)
    triggers = list(result.scalars().all())

    agents_result = await session.execute(select(Agent).where(Agent.tenant_id == tenant_id))
    agent_names = {a.id: a.name for a in agents_result.scalars().all()}

    items: list[dict[str, Any]] = []
    now = datetime.utcnow()

    for trigger in triggers:
        agent_name = agent_names.get(trigger.agent_id) if trigger.agent_id else None
        base = {
            "trigger_id": str(trigger.id),
            "name": trigger.name,
            "kind": trigger.kind,
            "agent_id": str(trigger.agent_id) if trigger.agent_id else None,
            "agent_role": trigger.agent_role,
            "agent_name": agent_name,
            "instructions": trigger.instructions,
            "enabled": trigger.enabled,
        }
        for moment in _planned_occurrences(trigger, max(start, now), end):
            items.append({**base, "id": f"{trigger.id}:{moment.isoformat()}", "at": _iso(moment), "status": "planned", "run_id": None})
        # Completed one-shot items keep their place on the calendar via last_run_at.
        if (
            trigger.kind in ("once", "event")
            and trigger.last_run_at
            and start <= trigger.last_run_at <= end
        ):
            items.append(
                {
                    **base,
                    "id": f"{trigger.id}:done",
                    "at": _iso(trigger.last_run_at),
                    "status": trigger.last_status or "done",
                    "run_id": None,
                }
            )

    # Run history for recurring triggers (cron/interval/heartbeat/webhook fires).
    trigger_by_id = {str(t.id): t for t in triggers}
    runs_result = await session.execute(
        select(AgentRun).where(
            AgentRun.tenant_id == tenant_id,
            AgentRun.trigger_id.is_not(None),
            AgentRun.started_at >= start,
            AgentRun.started_at <= end,
        )
    )
    for run in runs_result.scalars().all():
        trigger = trigger_by_id.get(run.trigger_id or "")
        if trigger and trigger.kind in ("once", "event"):
            continue  # already represented by the one-shot done item
        if agent_id and run.agent_id != agent_id:
            continue
        items.append(
            {
                "id": f"run:{run.id}",
                "trigger_id": run.trigger_id,
                "name": trigger.name if trigger else (run.subject or "Agent run"),
                "kind": trigger.kind if trigger else run.trigger_type.removeprefix("trigger_"),
                "agent_id": str(run.agent_id),
                "agent_role": trigger.agent_role if trigger else "",
                "agent_name": agent_names.get(run.agent_id),
                "instructions": trigger.instructions if trigger else "",
                "enabled": trigger.enabled if trigger else False,
                "at": _iso(run.started_at),
                "status": run.status,
                "run_id": str(run.id),
            }
        )

    items.sort(key=lambda item: item["at"] or "")
    return items


async def process_due_triggers(session: AsyncSession, tenant_id: UUID | None = None) -> int:
    now = datetime.utcnow()
    conditions = [
        Trigger.enabled.is_(True),
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
        except Exception:
            await session.rollback()
            trigger.last_status = "error"
            trigger.next_run_at = compute_next_run(trigger, now)
            session.add(trigger)
            await session.commit()
    return count
