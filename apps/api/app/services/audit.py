"""Audit recording and search for the GOVERN & ASSURE layer."""

import json
from typing import Any, Optional, Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEvent


async def record_audit(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    action: str,
    actor_type: str = "agent",
    actor_id: Any = "",
    agent_id: Optional[UUID] = None,
    run_id: Optional[UUID] = None,
    resource_type: str = "",
    resource_id: Any = "",
    outcome: str = "executed",
    summary: str = "",
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    payload: Optional[dict] = None,
    commit: bool = True,
) -> AuditEvent:
    event = AuditEvent(
        tenant_id=tenant_id,
        action=action,
        actor_type=actor_type,
        actor_id=str(actor_id or ""),
        agent_id=agent_id,
        run_id=run_id,
        resource_type=resource_type or (action.split(":", 1)[-1] if ":" in action else action),
        resource_id=str(resource_id or ""),
        outcome=outcome,
        summary=(summary or "")[:1000],
        before_json=json.dumps(before or {}, default=str),
        after_json=json.dumps(after or {}, default=str),
        payload_json=json.dumps(payload or {}, default=str),
    )
    session.add(event)
    if commit:
        await session.commit()
        await session.refresh(event)
    else:
        await session.flush()
    return event


async def search_audit(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    action: Optional[str] = None,
    actor_type: Optional[str] = None,
    agent_id: Optional[UUID] = None,
    outcome: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> Sequence[AuditEvent]:
    stmt = select(AuditEvent).where(AuditEvent.tenant_id == tenant_id)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    if actor_type:
        stmt = stmt.where(AuditEvent.actor_type == actor_type)
    if agent_id:
        stmt = stmt.where(AuditEvent.agent_id == agent_id)
    if outcome:
        stmt = stmt.where(AuditEvent.outcome == outcome)
    if q:
        stmt = stmt.where(AuditEvent.summary.ilike(f"%{q}%"))
    stmt = stmt.order_by(AuditEvent.created_at.desc()).limit(min(limit, 500)).offset(offset)
    result = await session.execute(stmt)
    return result.scalars().all()


def serialize_audit(event: AuditEvent) -> dict[str, Any]:
    return {
        "id": str(event.id),
        "actor_type": event.actor_type,
        "actor_id": event.actor_id,
        "agent_id": str(event.agent_id) if event.agent_id else None,
        "run_id": str(event.run_id) if event.run_id else None,
        "action": event.action,
        "resource_type": event.resource_type,
        "resource_id": event.resource_id,
        "outcome": event.outcome,
        "summary": event.summary,
        "before": json.loads(event.before_json or "{}"),
        "after": json.loads(event.after_json or "{}"),
        "payload": json.loads(event.payload_json or "{}"),
        "created_at": event.created_at.isoformat(),
    }
