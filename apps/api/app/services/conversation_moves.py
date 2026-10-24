"""Move messages between conversations, merge two, and keep intercom lanes.

One model for people and agents:

- ``move_messages`` puts chosen messages (or a message and everything after
  it) in a new or an existing conversation. A customer conversation moved to
  a new one keeps contact, channel and provider thread (``conversation_split``).
- ``merge_conversations`` moves everything into another conversation and
  points the old one forward with ``superseded_by_id``.
- ``intercom_lane`` is the rolling internal thread one agent keeps with one
  person for what they say over the dock intercom.

Every move and merge writes a ``SignalEvent`` on both sides and an audit row.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.exceptions import NotFoundError, status_error
from app.models.agent import Agent
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalEvent, SignalMessage, SignalTag
from app.services.conversation_split import UNSPLITTABLE_CHANNELS

INTERCOM_SOURCE = "intercom"
BRANCH_SOURCE = "operator"


async def _load(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> Signal:
    signal = await session.get(Signal, signal_id)
    if signal is None or signal.tenant_id != tenant_id or signal.deleted_at is not None:
        raise NotFoundError("Conversation not found")
    return signal


def _is_customer(signal: Signal) -> bool:
    return signal.channel not in UNSPLITTABLE_CHANNELS


def _event(signal: Signal, other: Signal, *, kind: str, direction: str, moved: int, actor_type: str, actor_id: str) -> SignalEvent:
    return SignalEvent(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        event_type=kind,
        actor_type=actor_type,
        actor_id=actor_id,
        payload_json=json.dumps(
            {
                "direction": direction,
                "other_signal_id": str(other.id),
                "other_subject": other.subject,
                "moved": moved,
            }
        ),
    )


async def _messages_to_move(
    session: AsyncSession,
    source: Signal,
    *,
    message_ids: list[UUID] | None,
    from_message_id: UUID | None,
) -> list[SignalMessage]:
    query = select(SignalMessage).where(SignalMessage.signal_id == source.id)
    if message_ids:
        query = query.where(SignalMessage.id.in_(message_ids))
    elif from_message_id is not None:
        anchor = await session.get(SignalMessage, from_message_id)
        if anchor is None or anchor.signal_id != source.id:
            raise NotFoundError("Message not found in this conversation")
        query = query.where(SignalMessage.created_at >= anchor.created_at)
    else:
        raise status_error(status_code=400, detail="Choose the messages to move")
    rows = list((await session.execute(query.order_by(SignalMessage.created_at))).scalars())
    if not rows:
        raise status_error(status_code=400, detail="No messages to move")
    return rows


async def _rehome(session: AsyncSession, rows: list[SignalMessage], target: Signal) -> None:
    """Move rows and their cards and notes. Each row takes the next number in the target."""
    from app.models.voice_note import VoiceNote
    from app.services.message_seq import next_seq

    ids = [row.id for row in rows]
    decision_ids = [row.decision_id for row in rows if row.decision_id]
    for row in rows:
        row.signal_id = target.id
        row.seq = await next_seq(session, target.id)
        session.add(row)
    if decision_ids:
        for decision in (
            await session.execute(select(DecisionRequest).where(DecisionRequest.id.in_(decision_ids)))
        ).scalars():
            decision.signal_id = target.id
            session.add(decision)
    for note in (
        await session.execute(select(VoiceNote).where(VoiceNote.message_id.in_(ids)))
    ).scalars():
        note.signal_id = target.id
        session.add(note)
    await session.flush()


async def _refresh_last(session: AsyncSession, signal: Signal) -> None:
    signal.last_message_at = (
        await session.execute(
            select(func.max(SignalMessage.created_at)).where(SignalMessage.signal_id == signal.id)
        )
    ).scalar_one() or signal.last_message_at
    signal.updated_at = utcnow()
    session.add(signal)


async def _copy_participants(session: AsyncSession, source: Signal, target: Signal) -> None:
    from app.models.signal_participant import SignalParticipant
    from app.services.participants import ensure_participant

    for row in (
        await session.execute(
            select(SignalParticipant).where(
                SignalParticipant.tenant_id == source.tenant_id,
                SignalParticipant.signal_id == source.id,
            )
        )
    ).scalars():
        await ensure_participant(
            session,
            target,
            kind=row.kind,
            ref_id=row.ref_id,
            role=row.role,
            invited_by_kind="system",
            joined_via="move",
        )


async def _new_internal(
    session: AsyncSession,
    source: Signal,
    *,
    title: str,
    actor_type: str,
    actor_id: str,
    user_id: UUID | None,
) -> Signal:
    from app.services.ownership import set_owner

    now = utcnow()
    child = Signal(
        tenant_id=source.tenant_id,
        channel="internal",
        source=BRANCH_SOURCE,
        subject=(title or source.subject or "").strip()[:200] or "Conversation",
        status="open",
        priority="normal",
        has_unread=False,
        agent_id=source.agent_id,
        project_id=source.project_id,
        parent_signal_id=source.id,
        contact_name=source.contact_name if source.source == INTERCOM_SOURCE else "",
        last_message_at=now,
        created_at=now,
        updated_at=now,
    )
    owner = user_id or source.owner_user_id
    if owner is not None:
        set_owner(child, "user", owner, by_user_id=owner)
    session.add(child)
    await session.flush()
    session.add(
        SignalEvent(
            signal_id=child.id,
            tenant_id=child.tenant_id,
            event_type="signal_created",
            actor_type=actor_type,
            actor_id=actor_id,
            payload_json=json.dumps({"source": "move"}),
        )
    )
    await _copy_participants(session, source, child)
    return child


async def move_messages(
    session: AsyncSession,
    tenant_id: UUID,
    source_id: UUID,
    *,
    message_ids: list[UUID] | None = None,
    from_message_id: UUID | None = None,
    target_id: UUID | None = None,
    title: str = "",
    category: SignalTag | None = None,
    actor_type: str = "user",
    actor_id: str = "",
    user_id: UUID | None = None,
) -> Signal:
    """Move messages into ``target_id``, or into a new conversation when it is empty.

    A customer conversation moved to a new one stays on the same contact and
    provider thread. Commits and publishes both sides.
    """
    from app.gateway.publish import publish_thread_update
    from app.services.audit import record_audit
    from app.services.conversation_split import split_conversation

    source = await _load(session, tenant_id, source_id)
    if target_id is None and _is_customer(source):
        anchor = from_message_id
        if anchor is None and message_ids:
            first = (
                await session.execute(
                    select(SignalMessage.id)
                    .where(SignalMessage.signal_id == source.id, SignalMessage.id.in_(message_ids))
                    .order_by(SignalMessage.created_at)
                    .limit(1)
                )
            ).scalar_one_or_none()
            anchor = first
        return await split_conversation(
            session,
            tenant_id,
            source.id,
            from_message_id=anchor,
            category=category,
            actor_type=actor_type,
            actor_id=actor_id,
        )

    rows = await _messages_to_move(session, source, message_ids=message_ids, from_message_id=from_message_id)
    remaining = (
        await session.execute(
            select(func.count())
            .select_from(SignalMessage)
            .where(SignalMessage.signal_id == source.id, SignalMessage.id.not_in([r.id for r in rows]))
        )
    ).scalar_one()
    if target_id is not None:
        target = await _load(session, tenant_id, target_id)
        if target.id == source.id:
            raise status_error(status_code=400, detail="Choose another conversation")
    else:
        if not remaining and source.source != INTERCOM_SOURCE:
            raise status_error(status_code=400, detail="Keep at least one message here")
        target = await _new_internal(
            session,
            source,
            title=title or (rows[0].body_text or "").strip()[:80],
            actor_type=actor_type,
            actor_id=actor_id,
            user_id=user_id,
        )
    await _rehome(session, rows, target)
    await _refresh_last(session, source)
    await _refresh_last(session, target)
    session.add(_event(source, target, kind="moved", direction="out", moved=len(rows), actor_type=actor_type, actor_id=actor_id))
    session.add(_event(target, source, kind="moved", direction="in", moved=len(rows), actor_type=actor_type, actor_id=actor_id))
    await record_audit(
        session,
        tenant_id,
        action="conversation:move",
        actor_type=actor_type,
        actor_id=actor_id,
        resource_type="conversation",
        resource_id=str(source.id),
        summary=f"Moved {len(rows)} message(s) to another conversation",
        after={"signal_id": str(target.id)},
        commit=False,
    )
    await session.commit()
    await session.refresh(source)
    await session.refresh(target)
    if category is not None:
        from app.services.tickets import file_ticket

        await file_ticket(
            session,
            tenant_id,
            signal_id=target.id,
            tag_id=category.id,
            actor="operator" if actor_type == "user" else "agent",
            created_by_type=actor_type,
            created_by_id=actor_id,
        )
        await session.refresh(target)
    await publish_thread_update(source)
    await publish_thread_update(target)
    return target


async def merge_conversations(
    session: AsyncSession,
    tenant_id: UUID,
    source_id: UUID,
    target_id: UUID,
    *,
    actor_type: str = "user",
    actor_id: str = "",
) -> Signal:
    """Everything in ``source`` moves to ``target``; ``source`` closes and points forward."""
    from app.gateway.publish import publish_thread_update
    from app.services.audit import record_audit

    source = await _load(session, tenant_id, source_id)
    target = await _load(session, tenant_id, target_id)
    if source.id == target.id:
        raise status_error(status_code=400, detail="Choose another conversation")
    if _is_customer(source) and _is_customer(target) and (source.contact_id or target.contact_id):
        if source.contact_id != target.contact_id:
            raise status_error(status_code=400, detail="Only conversations with the same contact can be merged")
    rows = list(
        (
            await session.execute(
                select(SignalMessage).where(SignalMessage.signal_id == source.id).order_by(SignalMessage.created_at)
            )
        ).scalars()
    )
    if rows:
        await _rehome(session, rows, target)
    await _copy_participants(session, source, target)
    source.superseded_by_id = target.id
    source.status = "closed"
    await _refresh_last(session, source)
    await _refresh_last(session, target)
    session.add(_event(source, target, kind="merged", direction="out", moved=len(rows), actor_type=actor_type, actor_id=actor_id))
    session.add(_event(target, source, kind="merged", direction="in", moved=len(rows), actor_type=actor_type, actor_id=actor_id))
    await record_audit(
        session,
        tenant_id,
        action="conversation:merge",
        actor_type=actor_type,
        actor_id=actor_id,
        resource_type="conversation",
        resource_id=str(source.id),
        summary=f"Merged into another conversation ({len(rows)} message(s))",
        after={"signal_id": str(target.id)},
        commit=False,
    )
    await session.commit()
    await session.refresh(source)
    await session.refresh(target)
    await publish_thread_update(source)
    await publish_thread_update(target)
    return target


async def intercom_lane(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    agent: Agent,
    *,
    user_name: str = "",
) -> Signal:
    """The rolling thread this agent keeps with this person. Created on first use."""
    from app.services.ownership import set_owner
    from app.services.participants import ensure_participant

    existing = (
        await session.execute(
            select(Signal)
            .where(
                Signal.tenant_id == tenant_id,
                Signal.source == INTERCOM_SOURCE,
                Signal.owner_user_id == user_id,
                Signal.agent_id == agent.id,
                Signal.deleted_at.is_(None),
                Signal.superseded_by_id.is_(None),
            )
            .order_by(Signal.last_message_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    now = utcnow()
    lane = Signal(
        tenant_id=tenant_id,
        channel="internal",
        source=INTERCOM_SOURCE,
        subject=f"Intercom {agent.name}"[:200],
        contact_name=agent.name,
        status="open",
        priority="normal",
        has_unread=False,
        agent_id=agent.id,
        last_message_at=now,
        created_at=now,
        updated_at=now,
    )
    set_owner(lane, "user", user_id, by_user_id=user_id)
    lane.owner_user_id = user_id
    session.add(lane)
    await session.flush()
    session.add(
        SignalEvent(
            signal_id=lane.id,
            tenant_id=tenant_id,
            event_type="signal_created",
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps({"source": INTERCOM_SOURCE, "started_by": user_name}),
        )
    )
    await ensure_participant(session, lane, kind="user", ref_id=user_id, role="owner", invited_by_kind="user", invited_by_id=user_id, joined_via="intercom")
    await ensure_participant(session, lane, kind="agent", ref_id=agent.id, role="member", invited_by_kind="user", invited_by_id=user_id, joined_via="intercom")
    await session.flush()
    return lane


def describe(signal: Signal) -> dict[str, Any]:
    return {"id": str(signal.id), "title": signal.subject or "", "channel": signal.channel}
