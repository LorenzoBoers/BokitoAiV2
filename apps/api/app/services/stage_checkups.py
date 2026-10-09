"""Stage owner and check-up: who holds a ticket in a stage, and how often it is looked at.

A flow stage may name an ``owner`` (person, agent or team) and a
``checkup_minutes`` rhythm. Entering the stage hands the conversation to that
owner. While the ticket stays in the stage, one interval ``Trigger``
(``purpose="stage_checkup"``) fires on the rhythm and goes to whoever owns the
conversation at that moment:

- agent: a run on the conversation; its findings land as an internal note.
- person: the conversation turns unread and the person is notified.
- team or nobody: the conversation turns unread.

Because the check-up is a Trigger it shows on the Agenda like any other wake.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestra import Workstream
from app.models.signal import Signal, SignalEvent, SignalTag
from app.models.trigger import Trigger

CHECKUP = "stage_checkup"
_QUIET_STATUSES = ("closed", "spam", "archived")


def _stage(stages: list[dict[str, Any]], key: str | None) -> dict[str, Any] | None:
    return next((s for s in stages if s["key"] == key), None) if key else None


async def checkup_trigger(session: AsyncSession, signal: Signal) -> Trigger | None:
    return (
        await session.execute(
            select(Trigger).where(
                Trigger.tenant_id == signal.tenant_id,
                Trigger.signal_id == signal.id,
                Trigger.purpose == CHECKUP,
                Trigger.deleted_at.is_(None),
            )
        )
    ).scalars().first()


async def remove_checkup(session: AsyncSession, signal: Signal) -> None:
    row = await checkup_trigger(session, signal)
    if row is not None:
        await session.delete(row)


async def sync_checkup(
    session: AsyncSession,
    signal: Signal,
    *,
    tag: SignalTag | None,
    stage: dict[str, Any] | None,
    restart: bool,
) -> Trigger | None:
    """Keep one check-up trigger per ticket in line with its stage. Flushes.

    ``restart`` sets the next moment a full rhythm from now (stage entry);
    otherwise a changed rhythm keeps the last fire as its anchor.
    """
    minutes = int((stage or {}).get("checkup_minutes") or 0)
    row = await checkup_trigger(session, signal)
    if tag is None or stage is None or minutes <= 0 or signal.ticket_status == "proposed":
        if row is not None:
            await session.delete(row)
            await session.flush()
        return None
    now = datetime.utcnow()
    name = f"Check-up #{tag.name} · {stage.get('name') or stage['key']}"
    if row is None:
        row = Trigger(
            tenant_id=signal.tenant_id,
            name=name,
            kind="interval",
            purpose=CHECKUP,
            signal_id=signal.id,
            agent_role="",
        )
        restart = True
    changed = row.interval_minutes != minutes or row.stage_key != stage["key"]
    row.name = name[:200]
    row.interval_minutes = minutes
    row.stage_key = stage["key"]
    row.enabled = True
    if restart or row.next_run_at is None:
        row.next_run_at = now + timedelta(minutes=minutes)
    elif changed:
        anchor = row.last_run_at or now
        row.next_run_at = max(now, anchor + timedelta(minutes=minutes))
    row.updated_at = now
    session.add(row)
    await session.flush()
    return row


def apply_stage_owner(
    session: AsyncSession, signal: Signal, stage: dict[str, Any], *, actor_type: str, actor_id: str
) -> bool:
    """Hand the conversation to the stage owner on entry. Returns whether it changed."""
    from app.services.ownership import owner_payload, set_owner

    owner = stage.get("owner")
    if not owner:
        return False
    kind, owner_id = owner["kind"], UUID(owner["id"])
    current = {
        "user": signal.assigned_user_id,
        "agent": signal.agent_id,
        "team": signal.assignee_team_id,
    }.get(kind)
    if signal.assignee_kind == kind and current == owner_id:
        return False
    before = owner_payload(signal)
    set_owner(signal, kind, owner_id)
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="assigned",
            actor_type=actor_type or "system",
            actor_id=actor_id or "",
            payload_json=json.dumps(
                {"before": before, "after": owner_payload(signal), "via": "stage", "stage": stage.get("name")}
            ),
        )
    )
    return True


async def on_stage_entered(
    session: AsyncSession,
    signal: Signal,
    stage: dict[str, Any],
    *,
    actor_type: str,
    actor_id: str,
) -> None:
    tag = await session.get(SignalTag, signal.ticket_tag_id) if signal.ticket_tag_id else None
    apply_stage_owner(session, signal, stage, actor_type=actor_type, actor_id=actor_id)
    await sync_checkup(session, signal, tag=tag, stage=stage, restart=True)


async def resync_flow(session: AsyncSession, ws: Workstream) -> int:
    """After a flow's stages change: align every live ticket's check-up. Flushes."""
    from app.services.tickets import workstream_stages

    stages = workstream_stages(ws)
    tags = (
        await session.execute(select(SignalTag).where(SignalTag.workstream_id == ws.id))
    ).scalars().all()
    count = 0
    for tag in tags:
        signals = (
            await session.execute(
                select(Signal).where(
                    Signal.tenant_id == ws.tenant_id,
                    Signal.ticket_tag_id == tag.id,
                    Signal.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        for signal in signals:
            await sync_checkup(
                session, signal, tag=tag, stage=_stage(stages, signal.stage_key), restart=False
            )
            count += 1
    return count


async def validate_stage_owners(session: AsyncSession, tenant_id: UUID, stages_json: str) -> None:
    """Every stage owner must be a person, agent or team of this workspace."""
    from fastapi import HTTPException

    from app.models.agent import Agent
    from app.models.auth import Membership
    from app.models.team import Team

    for stage in json.loads(stages_json or "[]"):
        owner = stage.get("owner")
        if not owner:
            continue
        owner_id = UUID(owner["id"])
        if owner["kind"] == "user":
            stmt = select(Membership.id).where(
                Membership.tenant_id == tenant_id,
                Membership.user_id == owner_id,
                Membership.is_active.is_(True),
            )
        elif owner["kind"] == "agent":
            stmt = select(Agent.id).where(Agent.tenant_id == tenant_id, Agent.id == owner_id)
        else:
            stmt = select(Team.id).where(Team.tenant_id == tenant_id, Team.id == owner_id)
        if (await session.execute(stmt)).first() is None:
            raise HTTPException(
                status_code=400, detail=f"Stage '{stage.get('name')}' has an unknown owner"
            )


def checkup_payload(row: Trigger | None) -> dict[str, Any] | None:
    if row is None or not row.enabled:
        return None
    return {
        "trigger_id": str(row.id),
        "every_minutes": row.interval_minutes,
        "next_at": row.next_run_at.replace(microsecond=0).isoformat() if row.next_run_at else None,
        "last_at": row.last_run_at.replace(microsecond=0).isoformat() if row.last_run_at else None,
        "last_status": row.last_status or None,
    }


def _brief(signal: Signal, tag: SignalTag, stage: dict[str, Any]) -> str:
    from app.services.tickets import parse_ticket_fields

    fields = parse_ticket_fields(signal.ticket_fields_json)
    lines = [
        f"Scheduled check-up of the #{tag.name} ticket \"{signal.subject or tag.name}\".",
        f"It is in stage \"{stage.get('name') or stage['key']}\" and you own it.",
        "Read the conversation, decide whether it can move on, and act through your tools "
        "(reply draft, move the stage, ask a person). Finish with a two-line status for the team.",
    ]
    if fields:
        lines.append("Ticket fields: " + "; ".join(f"{k}={v}" for k, v in fields.items()))
    return "\n".join(lines)


async def _note(session: AsyncSession, signal: Signal, text: str, *, agent_id: UUID, agent_name: str) -> None:
    from app.gateway.publish import publish_signal_message
    from app.models.signal import SignalMessage

    now = datetime.utcnow()
    note = SignalMessage(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        kind="internal_note",
        direction="internal",
        role="assistant",
        author_agent_id=agent_id,
        subject=signal.subject,
        body_text=text,
        body_preview=text[:200],
        body_html="",
        metadata_json=json.dumps({"agent_name": agent_name, "checkup": True}),
        received_at=now,
    )
    session.add(note)
    await session.commit()
    await session.refresh(note)
    await publish_signal_message(signal, note)


async def fire_checkup(session: AsyncSession, trigger: Trigger) -> dict[str, Any]:
    """One check-up moment. Drops itself when the ticket left the stage."""
    from app.gateway.publish import publish_thread_update
    from app.services.tickets import workstream_stages

    now = datetime.utcnow()
    signal = await session.get(Signal, trigger.signal_id) if trigger.signal_id else None
    tag = await session.get(SignalTag, signal.ticket_tag_id) if signal and signal.ticket_tag_id else None
    ws = await session.get(Workstream, tag.workstream_id) if tag and tag.workstream_id else None
    stage = _stage(workstream_stages(ws), signal.stage_key) if signal and ws else None
    if (
        signal is None
        or tag is None
        or stage is None
        or signal.stage_key != trigger.stage_key
        or not stage.get("checkup_minutes")
    ):
        await session.delete(trigger)
        await session.commit()
        return {"status": "removed"}

    trigger.last_run_at = now
    trigger.next_run_at = now + timedelta(minutes=max(1, trigger.interval_minutes))
    trigger.updated_at = now
    if signal.status in _QUIET_STATUSES:
        trigger.last_status = "skipped"
        session.add(trigger)
        await session.commit()
        return {"status": "skipped"}

    if signal.assignee_kind == "agent" and signal.agent_id:
        from app.models.agent import Agent, AgentRun
        from app.services.agent.loop import AgentLoop

        agent = await session.get(Agent, signal.agent_id)
        if agent is not None and agent.is_active and agent.tenant_id == signal.tenant_id:
            run = AgentRun(
                tenant_id=signal.tenant_id,
                agent_id=agent.id,
                trigger_type="trigger_interval",
                trigger_id=str(trigger.id),
                subject=trigger.name[:120],
            )
            session.add(run)
            trigger.last_status = "started"
            session.add(trigger)
            await session.flush()
            loop = AgentLoop(
                session,
                signal.tenant_id,
                None,
                agent=agent,
                run=run,
                signal_id=signal.id,
                tool_signal_id=signal.id,
            )
            text, _tokens = await loop.run_chat([{"role": "user", "content": _brief(signal, tag, stage)}])
            run.status = "completed"
            run.completed_at = datetime.utcnow()
            trigger.last_status = "reported"
            session.add(run)
            session.add(trigger)
            await session.commit()
            if text.strip():
                await _note(session, signal, text.strip(), agent_id=agent.id, agent_name=agent.name)
            return {"status": "reported", "run_id": str(run.id)}

    signal.has_unread = True
    signal.updated_at = now
    session.add(signal)
    trigger.last_status = "due"
    session.add(trigger)
    await session.commit()
    if signal.assignee_kind == "user" and signal.assigned_user_id:
        from app.services.notify import TIER_LATER, notify

        await notify(
            session,
            signal.tenant_id,
            kind="assignment",
            recipients=[signal.assigned_user_id],
            title=f"Check-up: {signal.subject or '#' + tag.name}",
            body=f"#{tag.name} is in {stage.get('name') or stage['key']}. Time to look at it.",
            tier=TIER_LATER,
            category="assigned-to-me",
            signal_id=signal.id,
        )
    await publish_thread_update(signal)
    return {"status": "due"}
