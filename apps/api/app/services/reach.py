"""The reach ladder: whether and how an agent's question reaches a person.

1. Silent, always: the card or note sits in the thread and shows live in the app.
2. Push: for the person asked by name or holding the thread, and for urgent work
   (deadline, a consequential decision, a long wait) further up the ladder.
   Never in the person's quiet hours, never past their daily maximum.
3. Call: only for a decision card, only when the person is available, not on
   another call, and allows agents to call (``services/agent_calls.py``).

Who: the addressee; for a department the person accountable, then the backup,
then a member; a thread an agent owns falls back on its department the same way.
Every push and call is a ``SignalEvent`` (``reach_attempt``) on the thread with
the department, channel, recipient, agent, deliveries and status. The thread
timeline, the department page and Govern read those events.
"""

from __future__ import annotations

import json
from datetime import datetime, time, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalEvent

REACH_EVENT = "reach_attempt"
URGENT = 0.6
REACH_TIMEZONE = "Europe/Amsterdam"
DEFAULT_REACH = {"quiet_from": "22:00", "quiet_to": "07:00", "max_per_day": 12, "agents_may_call": True}
CONSEQUENTIAL_ACTIONS = frozenset(
    {
        "send_reply",
        "banking_propose_payment",
        "investing_propose_order",
        "accounting_propose_send",
        "accounting_apply_booking",
        "close_threads",
        "delete_folder",
        "set_posture",
    }
)


def parse_reach(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    out = dict(DEFAULT_REACH)
    for key in ("quiet_from", "quiet_to"):
        if key in raw:
            value = raw[key]
            out[key] = value if (value is None or _clock(value) is not None) else out[key]
    if isinstance(raw.get("max_per_day"), int) and 0 <= raw["max_per_day"] <= 200:
        out["max_per_day"] = raw["max_per_day"]
    if isinstance(raw.get("agents_may_call"), bool):
        out["agents_may_call"] = raw["agents_may_call"]
    return out


def _clock(value: Any) -> time | None:
    try:
        hours, minutes = str(value).split(":")
        return time(int(hours), int(minutes))
    except (ValueError, TypeError):
        return None


def _local(now: datetime) -> datetime:
    try:
        from zoneinfo import ZoneInfo

        return now.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(REACH_TIMEZONE)).replace(tzinfo=None)
    except Exception:  # noqa: BLE001 — no tz database: UTC
        return now


def in_quiet_hours(reach: dict[str, Any], now: datetime) -> bool:
    start, end = _clock(reach.get("quiet_from")), _clock(reach.get("quiet_to"))
    if start is None or end is None or start == end:
        return False
    at = _local(now).time()
    return start <= at < end if start < end else (at >= start or at < end)


def _options(decision: DecisionRequest) -> list[dict[str, Any]]:
    try:
        rows = json.loads(decision.options_json or "[]")
    except json.JSONDecodeError:
        return []
    return [r for r in rows if isinstance(r, dict)]


def urgency(decision: DecisionRequest | None, signal: Signal | None, now: datetime) -> float:
    """0..1 from the deadline, how consequential the decision is, and how long it waits."""
    score = 0.0
    due = signal.due_at if signal is not None else None
    if due is not None:
        left = due - now
        if left <= timedelta(0):
            score += 0.6
        elif left <= timedelta(hours=24):
            score += 0.45
        elif left <= timedelta(days=3):
            score += 0.2
    if decision is not None:
        if decision.platform_change_id or any(
            str(o.get("action_type") or "") in CONSEQUENTIAL_ACTIONS for o in _options(decision)
        ):
            score += 0.3
        waited = now - (decision.created_at or now)
        if waited >= timedelta(hours=24):
            score += 0.4
        elif waited >= timedelta(hours=4):
            score += 0.2
    return round(min(score, 1.0), 2)


async def pushes_today(session: AsyncSession, tenant_id: UUID, user_id: UUID, now: datetime) -> int:
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    rows = (
        await session.execute(
            select(SignalEvent.payload_json).where(
                SignalEvent.tenant_id == tenant_id,
                SignalEvent.event_type == REACH_EVENT,
                SignalEvent.created_at >= start,
            )
        )
    ).scalars().all()
    count = 0
    for raw in rows:
        try:
            data = json.loads(raw or "{}")
        except json.JSONDecodeError:
            continue
        if data.get("recipient_user_id") == str(user_id) and data.get("channel") == "push" and data.get("delivered"):
            count += 1
    return count


async def ladder(
    session: AsyncSession, decision: DecisionRequest, signal: Signal | None
) -> tuple[list[UUID], set[UUID], UUID | None]:
    """(people in order, those asked directly, department) for one decision."""
    from app.services.addressee import addressee_user_ids
    from app.services.department_domain import department_of_signal, reach_people
    from app.services.push import resolve_thread_recipient_ids

    department_id: UUID | None = None
    if decision.addressee_kind == "user" and decision.addressee_user_id:
        return [decision.addressee_user_id], {decision.addressee_user_id}, None
    if decision.addressee_kind == "department" and decision.addressee_department_id:
        department_id = decision.addressee_department_id
        people = await reach_people(session, decision.tenant_id, department_id)
        return people or await addressee_user_ids(session, decision), set(), department_id
    if signal is None:
        return [], set(), None
    holder = [signal.assigned_user_id] if signal.assigned_user_id else []
    if signal.owner_user_id and signal.owner_user_id not in holder:
        holder.append(signal.owner_user_id)
    if holder:
        return holder, set(holder), await department_of_signal(session, signal)
    department_id = await department_of_signal(session, signal)
    if department_id is not None:
        people = await reach_people(session, decision.tenant_id, department_id)
        if people:
            return people, set(), department_id
    return await resolve_thread_recipient_ids(session, signal), set(), department_id


async def record_reach(
    session: AsyncSession,
    *,
    signal_id: UUID,
    tenant_id: UUID,
    channel: str,
    recipient_user_id: UUID,
    status: str,
    delivered: int = 0,
    department_id: UUID | None = None,
    agent_id: UUID | None = None,
    decision_id: UUID | None = None,
    urgency_score: float | None = None,
) -> SignalEvent:
    from app.models.auth import User

    person = await session.get(User, recipient_user_id)
    row = SignalEvent(
        signal_id=signal_id,
        tenant_id=tenant_id,
        event_type=REACH_EVENT,
        actor_type="agent" if agent_id else "system",
        actor_id=str(agent_id) if agent_id else "",
        payload_json=json.dumps(
            {
                "channel": channel,
                "status": status,
                "delivered": delivered,
                "recipient_user_id": str(recipient_user_id),
                "recipient_name": (person.display_name or person.email) if person else "",
                "department_id": str(department_id) if department_id else None,
                "agent_id": str(agent_id) if agent_id else None,
                "decision_id": str(decision_id) if decision_id else None,
                "urgency": urgency_score,
            }
        ),
    )
    session.add(row)
    return row


async def decision_agent(session: AsyncSession, decision: DecisionRequest, signal: Signal | None) -> Any:
    """The agent that raised the card: the notification's sender, else the thread agent."""
    from app.models.agent import Agent
    from app.models.notification import Notification

    agent_id: UUID | None = None
    if decision.notification_id:
        note = await session.get(Notification, decision.notification_id)
        try:
            payload = json.loads(note.payload_json or "{}") if note else {}
        except json.JSONDecodeError:
            payload = {}
        mark = payload.get("from") if isinstance(payload, dict) else None
        if isinstance(mark, dict) and mark.get("kind") == "agent" and mark.get("id"):
            try:
                agent_id = UUID(str(mark["id"]))
            except ValueError:
                agent_id = None
    if agent_id is None and signal is not None:
        agent_id = signal.agent_id
    if agent_id is None and decision.source_type == "agent" and decision.source_id:
        try:
            agent_id = UUID(str(decision.source_id))
        except ValueError:
            agent_id = None
    agent = await session.get(Agent, agent_id) if agent_id else None
    return agent if agent is not None and agent.tenant_id == decision.tenant_id else None


async def reach_summary(session: AsyncSession, tenant_id: UUID, department_id: UUID, *, days: int = 14) -> dict[str, Any]:
    """Pushes and calls for one department: latest attempts and how often each person was disturbed."""
    from app.models.auth import User

    since = datetime.utcnow() - timedelta(days=days)
    rows = (
        await session.execute(
            select(SignalEvent, Signal.subject)
            .join(Signal, Signal.id == SignalEvent.signal_id)
            .where(
                SignalEvent.tenant_id == tenant_id,
                SignalEvent.event_type == REACH_EVENT,
                SignalEvent.created_at >= since,
            )
            .order_by(SignalEvent.created_at.desc())
        )
    ).all()
    attempts: list[dict[str, Any]] = []
    per_person: dict[str, int] = {}
    for ev, subject in rows:
        try:
            data = json.loads(ev.payload_json or "{}")
        except json.JSONDecodeError:
            continue
        if data.get("department_id") != str(department_id):
            continue
        if data.get("delivered") or data.get("channel") == "call":
            per_person[data.get("recipient_user_id") or ""] = per_person.get(data.get("recipient_user_id") or "", 0) + 1
        if len(attempts) < 20:
            attempts.append({
                "at": ev.created_at.isoformat() + "Z",
                "signal_id": str(ev.signal_id),
                "subject": subject or "",
                "channel": data.get("channel"),
                "status": data.get("status"),
                "recipient_user_id": data.get("recipient_user_id"),
            })
    ids = [UUID(u) for u in {*per_person, *(a["recipient_user_id"] for a in attempts if a["recipient_user_id"])} if u]
    names = {
        str(u.id): u.display_name or u.email
        for u in (await session.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    } if ids else {}
    for row in attempts:
        row["recipient"] = names.get(row["recipient_user_id"] or "", "")
    return {
        "attempts": attempts,
        "per_person": sorted(
            ({"user_id": uid, "name": names.get(uid, ""), "count": n} for uid, n in per_person.items() if uid),
            key=lambda r: -r["count"],
        ),
    }


__all__ = [
    "DEFAULT_REACH",
    "REACH_EVENT",
    "URGENT",
    "decision_agent",
    "in_quiet_hours",
    "ladder",
    "parse_reach",
    "pushes_today",
    "reach_summary",
    "record_reach",
    "urgency",
]
