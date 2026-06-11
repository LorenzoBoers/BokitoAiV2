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
    return None  # webhook: fired externally


# ── CRUD helpers ─────────────────────────────────────────────────────


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
) -> Trigger:
    if kind not in TRIGGER_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid trigger kind: {kind}")
    if kind == "cron" and next_cron_run(cron_expr, datetime.utcnow()) is None:
        raise HTTPException(status_code=400, detail="Invalid cron expression")
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


async def _surface_result(
    session: AsyncSession, trigger: Trigger, agent: Agent, text: str
) -> None:
    """Post a non-OK trigger result into an internal Signal thread (Messages)."""
    from app.services.assistant_threads import append_signal_chat_message
    from app.services.signal_decisions import get_or_create_internal_thread

    signal = await get_or_create_internal_thread(
        session,
        trigger.tenant_id,
        subject=trigger.name,
        contact_name=agent.name,
    )
    await append_signal_chat_message(
        session,
        signal,
        role="assistant",
        content=text,
        author_agent_id=agent.id,
        metadata={"trigger_id": str(trigger.id), "trigger_kind": trigger.kind},
    )


async def fire_trigger(
    session: AsyncSession,
    trigger: Trigger,
    *,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.services.agent.loop import AgentLoop

    now = datetime.utcnow()

    if trigger.workstream_id:
        from app.services.orchestration.dispatcher import create_agent_task

        task = await create_agent_task(
            session,
            trigger.tenant_id,
            title=trigger.name,
            description=trigger.instructions,
            workstream_id=trigger.workstream_id,
            trigger_type="trigger",
            trigger_id=str(trigger.id),
            auto_start=True,
        )
        trigger.last_run_at = now
        trigger.last_status = "started"
        trigger.next_run_at = compute_next_run(trigger, now)
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
    trigger.updated_at = now
    session.add(trigger)
    await session.commit()
    return {"run_id": str(run.id), "status": trigger.last_status, "suppressed": suppressed}


async def process_due_triggers(session: AsyncSession) -> int:
    now = datetime.utcnow()
    result = await session.execute(
        select(Trigger).where(
            Trigger.enabled.is_(True),
            Trigger.next_run_at.is_not(None),
            Trigger.next_run_at <= now,
        )
    )
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
