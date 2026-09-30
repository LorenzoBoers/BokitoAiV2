"""Outcomes: what agents resolved, what was handed off, what it saved.

Resolved by agent = closed without handoff and without a human outbound
message, and not reopened within 72 hours of closing. Time saved is a
heuristic: 4 minutes per agent reply, refined later from feedback.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.base import utcnow
from bokito.domain.conversation import (
    Conversation,
    ConversationStatus,
    Direction,
    Message,
    MessageKind,
)
from bokito.domain.metering import Outcome, UsageEvent

REOPEN_WINDOW = timedelta(hours=72)
SECONDS_SAVED_PER_AGENT_REPLY = 240


async def compute_for_conversation(session: AsyncSession, conv: Conversation) -> Outcome:
    msgs = list(
        (
            await session.scalars(
                select(Message)
                .where(Message.conversation_id == conv.id, Message.kind == MessageKind.message)
                .order_by(Message.created_at)
            )
        ).all()
    )
    agent_msgs = [m for m in msgs if m.direction == Direction.outbound and m.ai_generated]
    human_msgs = [m for m in msgs if m.direction == Direction.outbound and not m.ai_generated]
    inbound = [m for m in msgs if m.direction == Direction.inbound]

    first_response = None
    if inbound and (agent_msgs or human_msgs):
        first_out = min((agent_msgs + human_msgs), key=lambda m: m.created_at)
        first_response = max(0, int((first_out.created_at - inbound[0].created_at).total_seconds()))
    resolution = None
    if conv.closed_at and inbound:
        resolution = max(0, int((conv.closed_at - inbound[0].created_at).total_seconds()))

    reopened = bool((conv.meta or {}).get("reopened"))
    resolved_by_agent = (
        conv.status == ConversationStatus.closed
        and not conv.handoff
        and not human_msgs
        and bool(agent_msgs)
        and not reopened
    )
    cost = await session.scalar(
        select(func.coalesce(func.sum(UsageEvent.cost_eur), 0)).where(
            UsageEvent.conversation_id == conv.id
        )
    )
    outcome = await session.scalar(select(Outcome).where(Outcome.conversation_id == conv.id))
    if outcome is None:
        outcome = Outcome(tenant_id=conv.tenant_id, conversation_id=conv.id, computed_at=utcnow())
        session.add(outcome)
    outcome.resolved_by_agent = resolved_by_agent
    outcome.handoff = conv.handoff
    outcome.reopened = reopened
    outcome.agent_messages = len(agent_msgs)
    outcome.human_messages = len(human_msgs)
    outcome.first_response_seconds = first_response
    outcome.resolution_seconds = resolution
    outcome.time_saved_seconds = (
        len(agent_msgs) * SECONDS_SAVED_PER_AGENT_REPLY if resolved_by_agent else 0
    )
    outcome.cost_eur = float(cost or 0)
    outcome.signal_type_id = conv.signal_type_id
    outcome.computed_at = utcnow()
    await session.flush()
    return outcome


async def compute_all(session: AsyncSession, *, tenant_id: uuid.UUID | None = None) -> int:
    cutoff = utcnow() - REOPEN_WINDOW
    stmt = select(Conversation).where(
        Conversation.status == ConversationStatus.closed,
        Conversation.closed_at.is_not(None),
        Conversation.closed_at <= cutoff,
    )
    if tenant_id:
        stmt = stmt.where(Conversation.tenant_id == tenant_id)
    stmt = stmt.outerjoin(Outcome, Outcome.conversation_id == Conversation.id).where(
        (Outcome.id.is_(None)) | (Outcome.computed_at < Conversation.closed_at)
    )
    convs = list((await session.scalars(stmt)).all())
    for conv in convs:
        await compute_for_conversation(session, conv)
    return len(convs)


async def summary(
    session: AsyncSession, tenant_id: uuid.UUID, *, since: datetime | None = None
) -> dict[str, Any]:
    since = since or (utcnow() - timedelta(days=30))
    rows = list(
        (
            await session.scalars(
                select(Outcome).where(Outcome.tenant_id == tenant_id, Outcome.computed_at >= since)
            )
        ).all()
    )
    total = len(rows)
    resolved = sum(1 for o in rows if o.resolved_by_agent)
    handoffs = sum(1 for o in rows if o.handoff)
    saved = sum(o.time_saved_seconds for o in rows)
    cost = sum(float(o.cost_eur or 0) for o in rows)
    first = [o.first_response_seconds for o in rows if o.first_response_seconds is not None]
    return {
        "since": since.isoformat(),
        "conversations": total,
        "resolved_by_agent": resolved,
        "resolution_rate": round(resolved / total, 3) if total else 0.0,
        "handoffs": handoffs,
        "time_saved_hours": round(saved / 3600, 2),
        "cost_eur": round(cost, 4),
        "median_first_response_seconds": sorted(first)[len(first) // 2] if first else None,
    }
