"""A wake that is not an agenda item.

The agent looks at its own open work and logs one activity row. A check-in
lands on the thread the item belongs to, and a recent check-in in that thread
is left alone.
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.agent import Agent, AgentRun
from app.models.signal import SignalEvent
from app.models.workspace import DocSection, KnowledgeEvidence
from app.services.agent_awareness import CHECKIN_MODES, awareness_config

logger = logging.getLogger(__name__)

CHECKIN_EVENT = "checkin"
RECENT_CHECKIN = timedelta(hours=1)


def _parse_settings(agent: Agent) -> dict[str, Any]:
    try:
        data = json.loads(agent.settings_json or "{}")
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def next_wake_at(agent: Agent):
    raw = _parse_settings(agent).get("awareness")
    raw = raw if isinstance(raw, dict) else {}
    text = str(raw.get("next_wake_at") or "")
    if not text:
        return None
    try:
        from datetime import datetime

        return datetime.fromisoformat(text)
    except ValueError:
        return None


def compute_ambient_wake(cron: str, now):
    """Next wake from the agent's cron. No trigger row."""
    from app.services.triggers import next_cron_run

    return next_cron_run(cron or "30 7 * * 1-5", now)


def store_next_wake(agent: Agent, when) -> None:
    data = _parse_settings(agent)
    block = data.get("awareness") if isinstance(data.get("awareness"), dict) else {}
    block["next_wake_at"] = when.isoformat() if when else ""
    data["awareness"] = block
    agent.settings_json = json.dumps(data)


async def recent_checkins(
    session: AsyncSession,
    signal_id: UUID,
    subject: str,
    *,
    within: timedelta = RECENT_CHECKIN,
) -> list[SignalEvent]:
    since = utcnow() - within
    rows = (
        await session.execute(
            select(SignalEvent)
            .where(
                SignalEvent.signal_id == signal_id,
                SignalEvent.event_type == CHECKIN_EVENT,
                SignalEvent.created_at >= since,
            )
            .order_by(SignalEvent.created_at.desc())
        )
    ).scalars().all()
    out = []
    for row in rows:
        try:
            payload = json.loads(row.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        if payload.get("subject") == subject:
            out.append(row)
    return out


async def ambient_snapshot(session: AsyncSession, agent: Agent) -> dict[str, Any]:
    lessons = (
        await session.execute(
            select(DocSection, KnowledgeEvidence)
            .join(KnowledgeEvidence, KnowledgeEvidence.section_id == DocSection.id)
            .where(
                DocSection.tenant_id == agent.tenant_id,
                DocSection.status.in_(("draft", "review")),
                KnowledgeEvidence.agent_id == agent.id,
            )
        )
    ).all()
    seen: set[UUID] = set()
    lesson_rows = []
    for section, evidence in lessons:
        if section.id in seen:
            continue
        if evidence.deferred_until and evidence.deferred_until > utcnow():
            continue
        seen.add(section.id)
        lesson_rows.append(
            {
                "section_id": str(section.id),
                "heading": section.heading,
                "signal_id": str(evidence.signal_id) if evidence.signal_id else None,
            }
        )
    return {
        "tasks": 0,
        "threads": len({row["signal_id"] for row in lesson_rows if row["signal_id"]}),
        "lessons": len(lesson_rows),
        "items": lesson_rows[: awareness_config(agent)["max_proposals"]],
    }


async def log_ambient_run(session: AsyncSession, agent: Agent, snap: dict[str, Any]) -> AgentRun:
    run = AgentRun(
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        status="completed",
        trigger_type="ambient",
        subject=(
            f"Omgeving bekeken: {snap['tasks']} taken, {snap['threads']} threads, "
            f"{snap['lessons']} conceptles"
        )[:200],
        result_json=json.dumps(snap),
        completed_at=utcnow(),
    )
    session.add(run)
    await session.flush()
    return run


def _age(event: SignalEvent):
    created = event.created_at or utcnow()
    if getattr(created, "tzinfo", None) is not None:
        created = created.replace(tzinfo=None)
    return utcnow() - created


def prior_outcome(event: SignalEvent) -> str:
    return str(_payload(event).get("outcome") or "")


def _payload(event: SignalEvent) -> dict[str, Any]:
    try:
        data = json.loads(event.payload_json or "{}")
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def _checkin_event(agent: Agent, signal_id: UUID, subject: str, outcome: str) -> SignalEvent:
    return SignalEvent(
        signal_id=signal_id,
        tenant_id=agent.tenant_id,
        event_type=CHECKIN_EVENT,
        actor_type="agent",
        actor_id=str(agent.id),
        payload_json=json.dumps(
            {
                "agent_id": str(agent.id),
                "subject": subject,
                "channel": "thread",
                "outcome": outcome,
            }
        ),
    )


async def _checkin_line(session: AsyncSession, agent: Agent, signal_id: UUID, text: str) -> None:
    from app.models.signal import SignalMessage

    session.add(
        SignalMessage(
            signal_id=signal_id,
            tenant_id=agent.tenant_id,
            kind="system_event",
            direction="internal",
            role="assistant",
            author_agent_id=agent.id,
            body_text=text[:240],
            body_preview=text[:200],
        )
    )


async def _lesson_card(
    session: AsyncSession,
    agent: Agent,
    signal_id: UUID,
    item: dict[str, Any],
    *,
    announce: bool,
) -> None:
    from app.services.signal_decisions import create_decision

    section_id = item["section_id"]
    heading = str(item.get("heading") or "Les")
    await create_decision(
        session,
        agent.tenant_id,
        title=f"Conceptles: {heading[:80]}",
        summary="Bewaar deze les, stel hem uit, of verwijder hem.",
        options=[
            {
                "id": "promote",
                "label": "Definitief",
                "action_type": "promote_lesson",
                "payload": {"section_id": section_id},
            },
            {
                "id": "defer",
                "label": "Later",
                "action_type": "defer_lesson",
                "payload": {"section_id": section_id},
            },
            {
                "id": "discard",
                "label": "Niet bewaren",
                "action_type": "discard_lesson",
                "payload": {"section_id": section_id},
            },
        ],
        agent_id=agent.id,
        signal_id=signal_id,
        source_type="knowledge_lesson",
        source_id=section_id,
        announce=announce,
        bundle_id=f"lessons:{agent.id}",
    )


async def _close_confirmed(session: AsyncSession, agent: Agent, now) -> None:
    """A lesson that was asked and is now final gets one closing line."""
    since = now - timedelta(hours=24)
    events = (
        await session.execute(
            select(SignalEvent)
            .where(
                SignalEvent.tenant_id == agent.tenant_id,
                SignalEvent.event_type == CHECKIN_EVENT,
                SignalEvent.actor_id == str(agent.id),
                SignalEvent.created_at >= since,
            )
            .order_by(SignalEvent.created_at.desc())
        )
    ).scalars().all()
    seen: set[str] = set()
    for event in events:
        payload = _payload(event)
        subject = str(payload.get("subject") or "")
        if not subject.startswith("lesson:") or subject in seen:
            continue
        seen.add(subject)
        if payload.get("outcome") in {"confirmed", "reminded"}:
            continue
        if _age(event) < RECENT_CHECKIN:
            continue
        try:
            section_id = UUID(subject.split(":", 1)[1])
        except (ValueError, IndexError):
            continue
        section = await session.get(DocSection, section_id)
        if section is None or section.status != "final" or event.signal_id is None:
            continue
        session.add(_checkin_event(agent, event.signal_id, subject, "confirmed"))
        await _checkin_line(session, agent, event.signal_id, "De les is al bevestigd.")


async def process_ambient_wakes(session: AsyncSession, *, now=None) -> int:
    """Due agents get one activity row. No trigger, no model call."""
    now = now or utcnow()
    agents = (
        await session.execute(select(Agent).where(Agent.is_active.is_(True)))
    ).scalars().all()
    fired = 0
    fired_schedule = False
    for agent in agents:
        config = awareness_config(agent)
        if config["mode"] not in CHECKIN_MODES or config["mode"] in {"off", "on_conversation"}:
            continue
        due = next_wake_at(agent)
        if due is None:
            when = compute_ambient_wake(config["cron"], now)
            if when is not None:
                store_next_wake(agent, when)
                session.add(agent)
                fired_schedule = True
            continue
        if due > now:
            continue
        snap = await ambient_snapshot(session, agent)
        await log_ambient_run(session, agent, snap)
        announced = False
        for item in snap["items"]:
            if not item.get("signal_id"):
                continue
            signal_id = UUID(item["signal_id"])
            subject = f"lesson:{item['section_id']}"
            history = await recent_checkins(
                session, signal_id, subject, within=timedelta(hours=24)
            )
            if history and _age(history[0]) < RECENT_CHECKIN:
                continue
            section = await session.get(DocSection, UUID(item["section_id"]))
            if section is not None and section.status == "final":
                if not history or prior_outcome(history[0]) == "confirmed":
                    continue
                session.add(_checkin_event(agent, signal_id, subject, "confirmed"))
                await _checkin_line(session, agent, signal_id, "De les is al bevestigd.")
                continue
            prior = _payload(history[0]) if history else {}
            if prior.get("outcome") == "reminded":
                continue
            if prior.get("outcome") in {"seen_no_action", "rang_no_answer", "posted"}:
                await _checkin_line(
                    session,
                    agent,
                    signal_id,
                    "Eerder gevraagd; ik wacht tot de volgende keer.",
                )
                session.add(_checkin_event(agent, signal_id, subject, "reminded"))
                continue
            session.add(_checkin_event(agent, signal_id, subject, "posted"))
            try:
                await _lesson_card(session, agent, signal_id, item, announce=not announced)
                announced = True
            except Exception:
                logger.exception("lesson check-in card skipped")
        await _close_confirmed(session, agent, now)
        store_next_wake(agent, compute_ambient_wake(config["cron"], now) or (now + timedelta(days=1)))
        session.add(agent)
        fired += 1
        fired_schedule = True
    if fired_schedule:
        await session.commit()
    return fired
