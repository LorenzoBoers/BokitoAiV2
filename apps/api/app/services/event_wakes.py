"""Wake an agent when something it follows happens on a thread.

A new ``SignalEvent`` whose type maps to a followable kind
(``agent_awareness.FOLLOWABLE``) is matched after commit. The thread resolves
to a department (``department_of_signal``); the agent that owns the thread
(the stage owner) goes first, then the department lead. The first one that
follows the kind gets a queued turn (``agent_turns.enqueue_turn``). One turn
per thread, agent and half hour (the idempotency key), never for an event the
agent caused itself, and never past the agent's daily cost cap.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any
from uuid import UUID

from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.signal import Signal, SignalEvent

logger = logging.getLogger(__name__)

WINDOW_MINUTES = 30
SELF_HANDLED = frozenset({"inbound", "decision"})
_PENDING = "bokito_event_wakes"
KIND_LABEL = {
    "inbound": "a new message",
    "stage_change": "a stage change",
    "deadline": "a deadline that is due",
    "decision": "a decision that was settled",
    "assignment": "a change of owner",
    "escalation": "an escalation",
    "delivery": "a delivered result",
}


def _enabled() -> bool:
    return os.environ.get("BOKITO_EVENT_WAKES", "1") != "0"


@event.listens_for(Session, "before_flush")
def _collect(session: Session, _ctx, _instances) -> None:
    from app.services.agent_awareness import EVENT_KIND

    try:
        for obj in session.new:
            if isinstance(obj, SignalEvent) and obj.event_type in EVENT_KIND:
                session.info.setdefault(_PENDING, set()).add(obj.id)
    except Exception:  # noqa: BLE001 — a wake never breaks a write
        logger.exception("event wake collection failed")


@event.listens_for(Session, "after_commit")
def _dispatch(session: Session) -> None:
    pending = session.info.pop(_PENDING, None)
    if not pending or not _enabled():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(_run(list(pending)))


@event.listens_for(Session, "after_rollback")
def _drop(session: Session) -> None:
    session.info.pop(_PENDING, None)


async def _run(event_ids: list[UUID]) -> None:
    from app.db.session import async_session_factory

    try:
        async with async_session_factory() as session:
            rows = (
                await session.execute(select(SignalEvent).where(SignalEvent.id.in_(event_ids)))
            ).scalars().all()
            if rows:
                await wake_for_events(session, list(rows))
                await session.commit()
    except Exception:  # noqa: BLE001
        logger.exception("event wake dispatch failed")


async def wake_for_events(session: AsyncSession, events: list[SignalEvent]) -> list[dict[str, Any]]:
    """Queue a turn for the first agent that follows each event. Caller commits."""
    from app.models.agent import Agent
    from app.services.agent_awareness import (
        EVENT_KIND,
        awareness_config,
        event_window_key,
        spent_today_cents,
    )
    from app.services.agent_turns import enqueue_turn
    from app.services.department_access import department_leads
    from app.services.department_domain import department_of_signal

    out: list[dict[str, Any]] = []
    now = utcnow()
    for ev in events:
        kind = EVENT_KIND.get(ev.event_type)
        if kind is None:
            continue
        signal = await session.get(Signal, ev.signal_id)
        if signal is None or signal.deleted_at is not None or signal.source == "department":
            continue
        department_id = await department_of_signal(session, signal)
        if department_id is None:
            continue
        # The thread's own agent already answers inbound mail and resumes on its own cards.
        handled = kind in SELF_HANDLED
        candidates: list[UUID] = []
        if signal.assignee_kind == "agent" and signal.agent_id and not handled:
            candidates.append(signal.agent_id)
        lead = (await department_leads(session, signal.tenant_id, department_id))["lead_agent_id"]
        if lead and lead not in candidates and not (handled and lead == signal.agent_id):
            candidates.append(lead)
        for agent_id in candidates:
            if ev.actor_type == "agent" and ev.actor_id == str(agent_id):
                continue
            agent = await session.get(Agent, agent_id)
            if agent is None or not agent.is_active:
                continue
            config = awareness_config(agent)
            if kind not in config["follows"]:
                continue
            cap = config["daily_cost_cents"]
            if cap <= 0 or await spent_today_cents(session, signal.tenant_id, agent_id) >= cap:
                out.append({"event_id": str(ev.id), "agent_id": str(agent_id), "outcome": "cost_cap"})
                break
            prompt = (
                f"You follow {KIND_LABEL[kind]} in conversations of your department, and this conversation "
                f"just had one ({ev.event_type}). Check whether it needs you now: act within your tools, or "
                "post a short note for whoever picks it up. If nothing is needed, reply with exactly: pass"
            )
            result = await enqueue_turn(
                session,
                signal,
                agent_id=agent_id,
                cause_kind="event",
                requested_by_kind="system",
                prompt=prompt,
                idempotency_key=f"event:{signal.id}:{agent_id}:{event_window_key(now, WINDOW_MINUTES)}",
            )
            out.append({
                "event_id": str(ev.id),
                "agent_id": str(agent_id),
                "department_id": str(department_id),
                "outcome": result.get("outcome") or ("queued" if result.get("ok") else "refused"),
            })
            break
    return out


def install() -> None:
    """Listeners register on import; calling this keeps the import explicit."""
