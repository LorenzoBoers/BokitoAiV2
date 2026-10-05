"""Split a conversation when a second intent shows up in it.

A conversation has one category. When a customer raises something new in an
old thread, the messages from that point on move into a new conversation with
the same contact and channel. The two are linked both ways: the new one keeps
``parent_signal_id``, the old one points forward with ``superseded_by_id`` so
replies on the same email thread or chat land in the newest conversation.

Who may split follows the conversation's AI handling: autonomous splits right
away, assisted asks with an inline decision, manual leaves it to a person
("Split from here" on a message).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.case import CaseType
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalEvent, SignalMessage

SPLIT_DECISION_SOURCE = "conversation_split"
UNSPLITTABLE_CHANNELS = ("internal", "assistant", "team")
_CHAIN_LIMIT = 20

# Carried over so the new conversation is the same customer on the same
# channel, under the same owner and hold, and replies keep the provider thread.
_COPIED_FIELDS = (
    "channel",
    "source",
    "external_id",
    "connection_id",
    "channel_account_id",
    "contact_id",
    "contact_name",
    "contact_email",
    "contact_phone",
    "contact_basis",
    "assigned_user_id",
    "assignee_kind",
    "assignee_team_id",
    "agent_id",
    "ai_handling",
    "ai_handling_reason",
    "assurance_level",
    "assurance_contact_id",
    "assurance_email",
    "assurance_expires_at",
)


async def active_conversation(session: AsyncSession, signal: Signal | None) -> Signal | None:
    """Follow ``superseded_by_id`` to the conversation inbound mail belongs in now."""
    seen: set[UUID] = set()
    current = signal
    while current is not None and current.superseded_by_id and len(seen) < _CHAIN_LIMIT:
        seen.add(current.id)
        if current.superseded_by_id in seen:
            break
        newer = await session.get(Signal, current.superseded_by_id)
        if newer is None or newer.tenant_id != current.tenant_id or newer.deleted_at is not None:
            break
        current = newer
    return current


async def _load_signal(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> Signal:
    signal = (
        await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if signal is None or signal.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if signal.channel in UNSPLITTABLE_CHANNELS:
        raise HTTPException(status_code=400, detail="Only customer conversations can be split")
    return signal


async def _anchor_message(
    session: AsyncSession, signal: Signal, from_message_id: UUID | None
) -> SignalMessage:
    if from_message_id is not None:
        message = await session.get(SignalMessage, from_message_id)
        if message is None or message.signal_id != signal.id:
            raise HTTPException(status_code=404, detail="Message not found in this conversation")
        return message
    message = (
        await session.execute(
            select(SignalMessage)
            .where(SignalMessage.signal_id == signal.id, SignalMessage.direction == "inbound")
            .order_by(SignalMessage.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=400, detail="No customer message to split from")
    return message


async def resolve_category(
    session: AsyncSession, tenant_id: UUID, value: str | None
) -> CaseType | None:
    """A category by id or slug; ``None`` when no value is given."""
    raw = (value or "").strip()
    if not raw:
        return None
    from app.services.cases import slugify

    query = select(CaseType).where(CaseType.tenant_id == tenant_id)
    try:
        query = query.where(CaseType.id == UUID(raw))
    except ValueError:
        query = query.where(CaseType.slug == slugify(raw))
    row = (await session.execute(query)).scalar_one_or_none()
    if row is None or not row.enabled:
        raise HTTPException(status_code=404, detail=f"Category '{raw}' not found")
    return row


def _split_event(
    signal: Signal, other: Signal, *, direction: str, category: str, moved: int,
    actor_type: str, actor_id: str,
) -> SignalEvent:
    return SignalEvent(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        event_type="split",
        actor_type=actor_type,
        actor_id=actor_id,
        payload_json=json.dumps(
            {
                "direction": direction,
                "other_signal_id": str(other.id),
                "other_subject": other.subject,
                "category": category,
                "moved": moved,
            }
        ),
    )


async def split_conversation(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    from_message_id: UUID | None = None,
    case_type: CaseType | None = None,
    actor_type: str = "user",
    actor_id: str = "",
) -> Signal:
    """Move messages from ``from_message_id`` on into a new linked conversation.

    Without a message id the newest customer message starts the new
    conversation. The source keeps at least one message. Commits, then files
    ``case_type`` (if any) as the new conversation's category.
    """
    from app.gateway.publish import publish_thread_update
    from app.services.audit import record_audit
    from app.services.ownership import _apply_turn

    source = await _load_signal(session, tenant_id, signal_id)
    anchor = await _anchor_message(session, source, from_message_id)
    earlier = (
        await session.execute(
            select(func.count())
            .select_from(SignalMessage)
            .where(
                SignalMessage.signal_id == source.id,
                SignalMessage.created_at < anchor.created_at,
            )
        )
    ).scalar_one()
    if not earlier:
        raise HTTPException(
            status_code=400,
            detail="Split from a later message: the first message starts this conversation",
        )
    split_cards = select(DecisionRequest.id).where(
        DecisionRequest.signal_id == source.id,
        DecisionRequest.source_type == SPLIT_DECISION_SOURCE,
    )
    moving = list(
        (
            await session.execute(
                select(SignalMessage)
                .where(
                    SignalMessage.signal_id == source.id,
                    SignalMessage.created_at >= anchor.created_at,
                    (SignalMessage.decision_id.is_(None))
                    | (SignalMessage.decision_id.not_in(split_cards)),
                )
                .order_by(SignalMessage.created_at)
            )
        ).scalars()
    )

    now = datetime.utcnow()
    child = Signal(
        tenant_id=tenant_id,
        subject=(anchor.subject or "").strip() or source.subject,
        status="open",
        priority="normal",
        has_unread=True,
        parent_signal_id=source.id,
        last_message_at=max(m.created_at for m in moving),
        created_at=now,
        updated_at=now,
        **{name: getattr(source, name) for name in _COPIED_FIELDS},
    )
    session.add(child)
    await session.flush()

    decision_ids = [m.decision_id for m in moving if m.decision_id]
    for message in moving:
        message.signal_id = child.id
        session.add(message)
    if decision_ids:
        for decision in (
            await session.execute(
                select(DecisionRequest).where(DecisionRequest.id.in_(decision_ids))
            )
        ).scalars():
            decision.signal_id = child.id
            session.add(decision)

    source.superseded_by_id = child.id
    source.last_message_at = (
        await session.execute(
            select(func.max(SignalMessage.created_at)).where(
                SignalMessage.signal_id == source.id,
                SignalMessage.created_at < anchor.created_at,
            )
        )
    ).scalar_one()
    source.updated_at = now
    session.add(source)

    category = case_type.name if case_type else ""
    session.add(
        _split_event(
            source, child, direction="out", category=category, moved=len(moving),
            actor_type=actor_type, actor_id=actor_id,
        )
    )
    session.add(
        _split_event(
            child, source, direction="in", category=category, moved=len(moving),
            actor_type=actor_type, actor_id=actor_id,
        )
    )
    await session.flush()
    await session.run_sync(lambda sync: (_apply_turn(sync, source), _apply_turn(sync, child)))
    await record_audit(
        session,
        tenant_id,
        action="conversation:split",
        actor_type=actor_type,
        actor_id=actor_id,
        resource_type="conversation",
        resource_id=str(source.id),
        summary=f"Split {len(moving)} message(s) into a new conversation",
        after={"signal_id": str(child.id), "category": category},
        commit=False,
    )
    await session.commit()
    await session.refresh(source)
    await session.refresh(child)

    if case_type is not None:
        from app.services.cases import create_case

        await create_case(
            session,
            tenant_id,
            case_type_id=case_type.id,
            signal_id=child.id,
            title=case_type.name,
            actor="operator" if actor_type == "user" else "agent",
            created_by_type=actor_type,
            created_by_id=actor_id,
        )
        await session.refresh(child)

    await publish_thread_update(source)
    await publish_thread_update(child)
    return child


async def _pending_split_decision(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID
) -> DecisionRequest | None:
    return (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.signal_id == signal_id,
                DecisionRequest.source_type == SPLIT_DECISION_SOURCE,
                DecisionRequest.status == "awaiting_human",
            )
        )
    ).scalars().first()


async def split_or_propose(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    case_type: CaseType,
    from_message_id: UUID | None = None,
    agent_id: UUID | None = None,
    reason: str = "",
) -> dict[str, Any]:
    """The AI's way to split: the conversation's AI handling decides how far it goes."""
    from app.services.ai_handling import resolve_for_signal

    tenant = await session.get(Tenant, tenant_id)
    mode = (await resolve_for_signal(session, tenant, signal)).effective
    if mode == "manual":
        return {
            "status": "manual",
            "detail": "AI handling is manual here; a teammate decides whether to split.",
        }
    anchor = await _anchor_message(session, signal, from_message_id)
    actor_id = str(agent_id) if agent_id else ""
    if mode == "autonomous":
        child = await split_conversation(
            session,
            tenant_id,
            signal.id,
            from_message_id=anchor.id,
            case_type=case_type,
            actor_type="agent",
            actor_id=actor_id,
        )
        return {"status": "split", "signal_id": str(child.id), "category": case_type.name}

    pending = await _pending_split_decision(session, tenant_id, signal.id)
    if pending is not None:
        return {"status": "pending", "decision_id": str(pending.id)}
    from app.services.signal_decisions import create_decision

    payload = {
        "signal_id": str(signal.id),
        "from_message_id": str(anchor.id),
        "category": str(case_type.id),
    }
    decision, _ = await create_decision(
        session,
        tenant_id,
        title=f"Split into new conversation: {case_type.name}",
        summary=reason.strip()
        or (
            f"The customer started a new request ({case_type.name}). Move it and the "
            "messages after it into its own conversation?"
        ),
        options=[
            {
                "id": "split",
                "label": "Split",
                "action_type": "split_conversation",
                "payload": payload,
            },
            {"id": "keep", "label": "Keep here", "action_type": "reject"},
        ],
        user_id=signal.assigned_user_id,
        agent_id=agent_id,
        signal_id=signal.id,
        project_id=signal.project_id,
        source_type=SPLIT_DECISION_SOURCE,
        source_id=str(anchor.id),
    )
    await session.commit()
    return {"status": "proposed", "decision_id": str(decision.id)}
