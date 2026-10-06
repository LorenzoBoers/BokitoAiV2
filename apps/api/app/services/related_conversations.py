"""Other conversations with the same person.

Conversations stay one per channel (an email thread, a WhatsApp chat, a
widget session), but they must see each other: the thread header shows that
the customer also wrote via WhatsApp yesterday, the AI keeps one live proposal
per person, and the inbound prompt knows about recent contact elsewhere.

"Same person" follows the identity system in ``contact_identity``: the
canonical ``Contact`` plus every identity row merged into it, with a fallback
on the plain email address for threads that were never linked.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Contact
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage

# Conversation kinds that belong to a customer or partner, never to agents.
_EXTERNAL_STATUSES = ("open", "pending", "closed")


async def person_contact_ids(session: AsyncSession, signal: Signal) -> list[UUID]:
    """Every Contact id that resolves to the same person as this thread."""
    if not signal.contact_id:
        return []
    from app.services.contact_identity import canonical

    person = await canonical(session, await session.get(Contact, signal.contact_id))
    if person is None:
        return [signal.contact_id]
    rows = (
        await session.execute(
            select(Contact.id).where(
                Contact.tenant_id == signal.tenant_id,
                or_(Contact.id == person.id, Contact.merged_into_id == person.id),
            )
        )
    ).scalars().all()
    ids = {person.id, *rows}
    ids.add(signal.contact_id)
    return list(ids)


async def sibling_signals(
    session: AsyncSession,
    signal: Signal,
    *,
    since: datetime | None = None,
    limit: int = 10,
) -> list[Signal]:
    """Other external conversations with this person, newest first."""
    from app.services.agent.reply_mode import INTERNAL_CHANNELS

    conditions = []
    contact_ids = await person_contact_ids(session, signal)
    if contact_ids:
        conditions.append(Signal.contact_id.in_(contact_ids))
    email = (signal.contact_email or "").strip().lower()
    if email:
        conditions.append(func.lower(Signal.contact_email) == email)
    phone = (signal.contact_phone or "").strip()
    if phone:
        conditions.append(Signal.contact_phone == phone)
    if not conditions:
        return []
    stmt = (
        select(Signal)
        .where(
            Signal.tenant_id == signal.tenant_id,
            Signal.id != signal.id,
            Signal.superseded_by_id.is_(None),
            Signal.status.in_(_EXTERNAL_STATUSES),
            Signal.channel.not_in(tuple(INTERNAL_CHANNELS)),
            or_(*conditions),
        )
        .order_by(Signal.last_message_at.desc().nullslast(), Signal.created_at.desc())
        .limit(limit)
    )
    if since is not None:
        stmt = stmt.where(Signal.last_message_at >= since)
    return list((await session.execute(stmt)).scalars().all())


async def _last_message(session: AsyncSession, signal_id: UUID) -> SignalMessage | None:
    return (
        await session.execute(
            select(SignalMessage)
            .where(
                SignalMessage.signal_id == signal_id,
                SignalMessage.kind.in_(("user_message", "agent_message")),
                SignalMessage.direction.in_(("inbound", "outbound")),
            )
            .order_by(SignalMessage.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _has_open_proposal(session: AsyncSession, signal_id: UUID) -> bool:
    from app.services.signal_threads import REPLY_SUGGESTION_TITLES

    row = (
        await session.execute(
            select(DecisionRequest.id)
            .where(
                DecisionRequest.signal_id == signal_id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.title.in_(REPLY_SUGGESTION_TITLES),
            )
            .limit(1)
        )
    ).first()
    return row is not None


async def related_conversations(
    session: AsyncSession, signal: Signal, *, limit: int = 5
) -> list[dict[str, Any]]:
    """Compact rows for the thread payload: where else this person is talking."""
    from app.services.signal_threads import _iso

    rows: list[dict[str, Any]] = []
    for other in await sibling_signals(session, signal, limit=limit):
        last = await _last_message(session, other.id)
        rows.append(
            {
                "id": str(other.id),
                "channel": other.channel,
                "subject": other.subject or "",
                "status": other.status,
                "last_message_at": _iso(other.last_message_at or other.created_at),
                "last_message_direction": last.direction if last is not None else "",
                "last_message_preview": (last.body_preview or "")[:160] if last is not None else "",
                "has_open_proposal": await _has_open_proposal(session, other.id),
            }
        )
    return rows


async def recent_contact_context(
    session: AsyncSession, signal: Signal, *, days: int = 7, limit: int = 4
) -> str:
    """Prompt block: recent contact with this person on other channels."""
    since = datetime.utcnow() - timedelta(days=days)
    others = await sibling_signals(session, signal, since=since, limit=limit)
    if not others:
        return ""
    lines = [f"Recent contact with this person on other channels (last {days} days):"]
    for other in others:
        last = await _last_message(session, other.id)
        when = (other.last_message_at or other.created_at).strftime("%Y-%m-%d %H:%M")
        who = "customer wrote" if last is not None and last.direction == "inbound" else "we replied"
        preview = (last.body_preview or "").strip()[:140] if last is not None else ""
        subject = f" '{other.subject}'" if other.subject else ""
        lines.append(f"- {other.channel}{subject}, {when} UTC, {who}: {preview}")
    lines.append(
        "Do not repeat what was already answered elsewhere; refer to it briefly when relevant."
    )
    return "\n".join(lines)
