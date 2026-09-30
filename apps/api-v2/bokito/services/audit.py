"""Append-only audit log."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.base import utcnow
from bokito.domain.govern import AuditEvent


async def record(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    actor: str,
    trust: str,
    action: str,
    target_kind: str = "",
    target_id: str | uuid.UUID | None = "",
    conversation_id: uuid.UUID | None = None,
    run_id: uuid.UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        tenant_id=tenant_id,
        actor=actor,
        trust=trust,
        action=action,
        target_kind=target_kind,
        target_id=str(target_id or ""),
        conversation_id=conversation_id,
        run_id=run_id,
        payload=payload or {},
        created_at=utcnow(),
    )
    session.add(event)
    await session.flush()
    return event


async def list_events(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    action: str | None = None,
    conversation_id: uuid.UUID | None = None,
    limit: int = 100,
    before: uuid.UUID | None = None,
) -> list[AuditEvent]:
    stmt = select(AuditEvent).where(AuditEvent.tenant_id == tenant_id)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    if conversation_id:
        stmt = stmt.where(AuditEvent.conversation_id == conversation_id)
    if before:
        anchor = await session.get(AuditEvent, before)
        if anchor:
            stmt = stmt.where(AuditEvent.created_at < anchor.created_at)
    stmt = stmt.order_by(AuditEvent.created_at.desc()).limit(limit)
    return list((await session.scalars(stmt)).all())
