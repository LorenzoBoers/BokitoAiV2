"""A ticket that comes back every period: monthly content, a weekly report.

A trigger with ``purpose = "recurring_ticket"`` opens one new conversation per
period, files it on the flow label of ``trigger.workstream_id`` and in the
folder ``trigger.project_id``, and names it from ``trigger.title_template``.
The agent of the trigger owns the conversation and, when the trigger has
instructions, starts on it right away. One conversation per period: a second
fire in the same period returns the one that exists.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.exceptions import AppError
from app.models.signal import Signal, SignalTag
from app.models.trigger import Trigger

RECURRING_TICKET = "recurring_ticket"

MONTHS_EN = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
MONTHS_NL = ("januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december")


def render_title(template: str, now: datetime) -> str:
    week = now.isocalendar()[1]
    values = {
        "month": f"{MONTHS_EN[now.month - 1]} {now.year}",
        "maand": f"{MONTHS_NL[now.month - 1]} {now.year}",
        "year": str(now.year),
        "week": f"{now.isocalendar()[0]}-W{week:02d}",
        "date": now.date().isoformat(),
    }
    out = template or "{date}"
    for key, value in values.items():
        out = out.replace("{" + key + "}", value)
    return out[:200]


def period_key(trigger: Trigger, now: datetime) -> str:
    """Daily rules repeat per day, weekly per ISO week, the rest per month."""
    fields = (trigger.cron_expr or "").split()
    if len(fields) == 5 and fields[2] == "*" and fields[4] != "*" and "," not in fields[4] and "-" not in fields[4]:
        return f"{now.isocalendar()[0]}-W{now.isocalendar()[1]:02d}"
    if len(fields) == 5 and fields[2] == "*":
        return now.date().isoformat()
    return f"{now.year}-{now.month:02d}"


async def flow_label(session: AsyncSession, trigger: Trigger) -> SignalTag:
    if trigger.workstream_id is None:
        raise AppError("A recurring ticket needs a flow", code="app_error", status_code=400)
    label = (
        await session.execute(
            select(SignalTag).where(
                SignalTag.tenant_id == trigger.tenant_id,
                SignalTag.workstream_id == trigger.workstream_id,
            )
        )
    ).scalars().first()
    if label is None:
        raise AppError("The flow has no label", code="app_error", status_code=400)
    return label


async def open_recurring_ticket(session: AsyncSession, trigger: Trigger, *, now: datetime | None = None) -> dict[str, Any]:
    from app.services.agent_turns import enqueue_turn
    from app.services.ownership import apply_owner
    from app.services.tickets import file_ticket

    now = now or utcnow()
    label = await flow_label(session, trigger)
    external_id = f"recurring:{trigger.id}:{period_key(trigger, now)}"
    existing = (
        await session.execute(
            select(Signal).where(
                Signal.tenant_id == trigger.tenant_id,
                Signal.source == RECURRING_TICKET,
                Signal.external_id == external_id,
            )
        )
    ).scalars().first()
    if existing is not None:
        return {"status": "exists", "signal_id": str(existing.id)}

    signal = Signal(
        tenant_id=trigger.tenant_id,
        channel="internal",
        source=RECURRING_TICKET,
        external_id=external_id,
        subject=render_title(trigger.title_template, now),
        status="open",
        agent_id=trigger.agent_id,
        created_at=now,
        updated_at=now,
        last_message_at=now,
    )
    session.add(signal)
    await session.flush()
    if trigger.agent_id:
        await apply_owner(session, signal, "agent", trigger.agent_id)
    elif trigger.created_by_user_id:
        await apply_owner(session, signal, "user", trigger.created_by_user_id)
    await session.flush()
    await file_ticket(
        session,
        trigger.tenant_id,
        signal_id=signal.id,
        tag_id=label.id,
        project_id=trigger.project_id,
        certainty=10,
        actor="rule",
        created_by_type="trigger",
        created_by_id=str(trigger.id),
        reason=trigger.name,
    )
    turn = None
    if trigger.agent_id and trigger.instructions.strip():
        turn = await enqueue_turn(
            session,
            signal,
            agent_id=trigger.agent_id,
            cause_kind="handoff",
            requested_by_kind="system",
            prompt=trigger.instructions.strip(),
            idempotency_key=f"{external_id}:start",
        )
        await session.commit()
    return {"status": "opened", "signal_id": str(signal.id), "turn": turn}


async def upsert_recurring_ticket(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    flow: str,
    cron: str,
    folder: str = "",
    title: str = "",
    instructions: str = "",
    name: str = "",
    agent_id: UUID | None = None,
    user_id: UUID | None = None,
) -> dict[str, Any]:
    """One rule per flow and folder: a second call with the same pair updates it."""
    from app.services.projects import resolve_folder_ref
    from app.services.tickets import find_category
    from app.services.triggers import (
        compute_next_run,
        create_trigger,
        next_cron_run,
        serialize_trigger,
    )

    label = await find_category(session, tenant_id, flow)
    if label is None or label.workstream_id is None:
        return {"error": "flow_not_found", "message": "Pass the label name of a flow (list_flows), without a leading #."}
    cron = (cron or "").strip()
    if next_cron_run(cron, utcnow()) is None:
        return {"error": "cron_required", "message": "Pass cron, for example '0 7 1 * *' for the first of the month."}
    folder_id = None
    if (folder or "").strip():
        found, err = await resolve_folder_ref(session, tenant_id, folder.strip())
        if err or found is None:
            return {"error": "folder_not_found", "message": err or "Folder not found. Call list_folders."}
        folder_id = found.id
    title = (title or f"{label.name} {{month}}")[:200]
    name = name or title.replace("{month}", "").replace("{maand}", "").strip() or label.name
    existing = (
        await session.execute(
            select(Trigger).where(
                Trigger.tenant_id == tenant_id,
                Trigger.purpose == RECURRING_TICKET,
                Trigger.workstream_id == label.workstream_id,
                Trigger.project_id == folder_id if folder_id else Trigger.project_id.is_(None),
                Trigger.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if existing is not None:
        existing.cron_expr = cron
        existing.title_template = title
        existing.instructions = instructions
        existing.agent_id = agent_id
        existing.name = name
        existing.enabled = True
        existing.next_run_at = compute_next_run(existing)
        existing.updated_at = utcnow()
        session.add(existing)
        await session.commit()
        return {"ok": True, "updated": True, "trigger": serialize_trigger(existing)}
    row = await create_trigger(
        session,
        tenant_id,
        name=name,
        kind="cron",
        cron_expr=cron,
        agent_id=agent_id,
        workstream_id=label.workstream_id,
        instructions=instructions,
        created_by_user_id=user_id,
        purpose=RECURRING_TICKET,
        project_id=folder_id,
        title_template=title,
    )
    return {"ok": True, "created": True, "trigger": serialize_trigger(row)}


async def fire_recurring_ticket(session: AsyncSession, trigger: Trigger, *, manual: bool = False) -> dict[str, Any]:
    from app.services.triggers import compute_next_run

    now = utcnow()
    try:
        result = await open_recurring_ticket(session, trigger, now=now)
        trigger.last_status = result["status"]
    except (HTTPException, AppError) as exc:
        result = {"status": "error", "error": str(exc.detail)}
        trigger.last_status = "error"
    trigger.last_run_at = now
    if not manual:
        trigger.next_run_at = compute_next_run(trigger, now)
    trigger.updated_at = now
    session.add(trigger)
    await session.commit()
    return result
