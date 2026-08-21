"""Platform change draft queue: propose, accept, reject, apply, version history."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.platform_change import (
    CHANGE_KINDS,
    PLATFORM_RESOURCE_TYPES,
    PlatformChange,
)
from app.services.audit import record_audit
from app.services.platform_access import agent_can_access_project, require_scope
from app.services.platform_apply import apply_change_to_domain, rollback_change_to_domain

RESOURCE_SCOPE: dict[tuple[str, str], str] = {
    ("workspace_doc", "create"): "platform:doc:write",
    ("workspace_doc", "update"): "platform:doc:write",
    ("agent", "create"): "platform:agent:create",
    ("agent", "update"): "platform:agent:update",
    ("agent", "delete"): "platform:agent:update",
    ("workstream", "create"): "platform:workstream:create",
    ("workstream", "update"): "platform:workstream:update",
    ("workstream", "delete"): "platform:workstream:update",
    ("integration", "create"): "platform:integration:propose",
    ("integration", "update"): "platform:integration:create",
    ("mcp_server", "create"): "platform:mcp:register",
    ("mcp_server", "update"): "platform:mcp:register",
    ("canvas_node", "create"): "platform:graph:edit",
    ("canvas_edge", "connect"): "platform:edge:connect",
    ("agent_passport", "update"): "platform:agent:update",
}


def _enforce_agent_scope(agent: Agent | None, resource_type: str, change_kind: str) -> None:
    if agent is None:
        return
    scope = RESOURCE_SCOPE.get((resource_type, change_kind))
    if scope and not require_scope(agent, scope)[0]:
        raise HTTPException(status_code=403, detail=f"Missing scope: {scope}")


def serialize_change(row: PlatformChange, *, signal_id: UUID | None = None) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "change_kind": row.change_kind,
        "status": row.status,
        "version": row.version,
        "summary": row.summary,
        "before": json.loads(row.before_json or "{}"),
        "after": json.loads(row.after_json or "{}"),
        "proposed_by_type": row.proposed_by_type,
        "proposed_by_id": row.proposed_by_id,
        "agent_id": str(row.agent_id) if row.agent_id else None,
        "run_id": str(row.run_id) if row.run_id else None,
        "decision_id": str(row.decision_id) if row.decision_id else None,
        "signal_id": str(signal_id) if signal_id else None,
        "created_at": row.created_at.isoformat(),
        "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
    }


async def enrich_changes_with_signal_ids(
    session: AsyncSession, rows: list[PlatformChange]
) -> list[dict[str, Any]]:
    """Attach Messages thread ids from linked DecisionRequest rows."""
    from app.models.notification import DecisionRequest

    decision_ids = [r.decision_id for r in rows if r.decision_id]
    signal_by_decision: dict[UUID, UUID] = {}
    if decision_ids:
        decisions = (
            await session.execute(select(DecisionRequest).where(DecisionRequest.id.in_(decision_ids)))
        ).scalars().all()
        for decision in decisions:
            if decision.signal_id:
                signal_by_decision[decision.id] = decision.signal_id
    return [
        serialize_change(row, signal_id=signal_by_decision.get(row.decision_id) if row.decision_id else None)
        for row in rows
    ]


async def _next_version(
    session: AsyncSession, tenant_id: UUID, resource_type: str, resource_id: str
) -> int:
    result = await session.execute(
        select(func.max(PlatformChange.version)).where(
            PlatformChange.tenant_id == tenant_id,
            PlatformChange.resource_type == resource_type,
            PlatformChange.resource_id == resource_id,
            PlatformChange.status.in_(("accepted", "applied_yolo")),
        )
    )
    current = result.scalar_one_or_none()
    return int(current or 0) + 1


async def _supersede_pending(
    session: AsyncSession, tenant_id: UUID, resource_type: str, resource_id: str
) -> None:
    result = await session.execute(
        select(PlatformChange).where(
            PlatformChange.tenant_id == tenant_id,
            PlatformChange.resource_type == resource_type,
            PlatformChange.resource_id == resource_id,
            PlatformChange.status.in_(("draft", "pending_review")),
        )
    )
    for row in result.scalars().all():
        row.status = "superseded"
        row.resolved_at = datetime.utcnow()


async def propose_platform_change(
    session: AsyncSession,
    tenant: Tenant,
    *,
    resource_type: str,
    change_kind: str,
    after: dict[str, Any],
    summary: str,
    before: dict[str, Any] | None = None,
    resource_id: str = "",
    agent: Agent | None = None,
    run_id: UUID | None = None,
    user_id: UUID | None = None,
    tool_name: str | None = None,
    mode: str = "apply",
    signal_id: UUID | None = None,
) -> tuple[PlatformChange, dict[str, Any]]:
    """Record (and apply or queue) a platform mutation.

    The allowance policy engine already decided ``mode``:
    - ``apply``: execute now, record an applied PlatformChange (audit + rollback)
    - ``ask``: record a pending PlatformChange + inline DecisionRequest
    """
    if resource_type not in PLATFORM_RESOURCE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid resource_type: {resource_type}")
    if change_kind not in CHANGE_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid change_kind: {change_kind}")

    _enforce_agent_scope(agent, resource_type, change_kind)

    # Resource-bound enforcement: PO agents may only mutate workstreams in their own project.
    if agent is not None and agent.role == "po" and resource_type == "workstream":
        project_ref = after.get("project_id") or (before or {}).get("project_id")
        if project_ref:
            try:
                allowed = await agent_can_access_project(session, agent, UUID(str(project_ref)))
            except (ValueError, TypeError):
                allowed = False
            if not allowed:
                raise HTTPException(
                    status_code=403,
                    detail="Agent cannot modify workstreams outside its own project",
                )

    proposed_by_type = "agent" if agent else ("user" if user_id else "system")
    proposed_by_id = str(agent.id) if agent else (str(user_id) if user_id else "")

    if mode == "apply":
        change = PlatformChange(
            tenant_id=tenant.id,
            resource_type=resource_type,
            resource_id=resource_id,
            change_kind=change_kind,
            status="applied_yolo",
            version=await _next_version(session, tenant.id, resource_type, resource_id),
            summary=summary,
            before_json=json.dumps(before or {}, default=str),
            after_json=json.dumps(after, default=str),
            proposed_by_type=proposed_by_type,
            proposed_by_id=proposed_by_id,
            agent_id=agent.id if agent else None,
            run_id=run_id,
            resolved_at=datetime.utcnow(),
        )
        session.add(change)
        await session.flush()
        result = await apply_change_to_domain(session, tenant.id, change)
        await record_audit(
            session,
            tenant.id,
            action=f"platform_change:apply:{resource_type}",
            actor_type=proposed_by_type,
            actor_id=proposed_by_id,
            agent_id=agent.id if agent else None,
            run_id=run_id,
            resource_type=resource_type,
            resource_id=resource_id or str(change.id),
            outcome="executed",
            summary=summary,
            after=result,
        )
        await session.commit()
        await session.refresh(change)
        from app.services.webhooks import emit_webhook_event, platform_change_event_data

        await emit_webhook_event(
            session, tenant.id, "platform_change.applied", platform_change_event_data(change)
        )
        return change, {"mode": "apply", "applied": result}

    # mode == "ask": pending change + inline decision
    await _supersede_pending(session, tenant.id, resource_type, resource_id)
    change = PlatformChange(
        tenant_id=tenant.id,
        resource_type=resource_type,
        resource_id=resource_id,
        change_kind=change_kind,
        status="pending_review",
        summary=summary,
        before_json=json.dumps(before or {}, default=str),
        after_json=json.dumps(after, default=str),
        proposed_by_type=proposed_by_type,
        proposed_by_id=proposed_by_id,
        agent_id=agent.id if agent else None,
        run_id=run_id,
    )
    session.add(change)
    await session.flush()

    from app.models.notification import DecisionRequest, Notification
    from app.services.notification_mail import decision_bell_status

    notification = Notification(
        tenant_id=tenant.id,
        user_id=user_id,
        kind="decision_request",
        title=f"Review: {summary}",
        body=summary,
        status=await decision_bell_status(session, tenant.id, user_id),
        payload_json=json.dumps({"platform_change_id": str(change.id)}),
    )
    session.add(notification)
    await session.flush()
    decision = DecisionRequest(
        tenant_id=tenant.id,
        notification_id=notification.id,
        title=f"Review: {summary}",
        summary=summary,
        status="awaiting_human",
        platform_change_id=change.id,
        signal_id=signal_id,
        options_json=json.dumps(
            [
                {
                    "id": "approve",
                    "label": "Approve",
                    "action_type": "accept_platform_change",
                    "payload": {"platform_change_id": str(change.id)},
                },
                {"id": "reject", "label": "Reject", "action_type": "reject"},
            ]
        ),
    )
    session.add(decision)
    change.decision_id = decision.id
    await session.flush()

    # Land the approval in Messages (same thread as the agent that proposed it
    # when signal_id is known; otherwise create an internal Activity thread).
    from app.services.signal_decisions import append_decision_to_signal

    await append_decision_to_signal(
        session,
        tenant.id,
        decision,
        user_id=user_id,
        agent_id=agent.id if agent else None,
        signal_id=signal_id,
    )

    from app.gateway.publish import publish_decision

    await publish_decision(
        tenant.id,
        decision_id=decision.id,
        status=decision.status,
        title=decision.title,
        signal_id=decision.signal_id,
    )

    await record_audit(
        session,
        tenant.id,
        action=f"platform_change:propose:{resource_type}",
        actor_type=proposed_by_type,
        actor_id=proposed_by_id,
        agent_id=agent.id if agent else None,
        run_id=run_id,
        resource_type=resource_type,
        resource_id=resource_id or "",
        outcome="escalated",
        summary=summary,
        payload=after,
        commit=False,
    )
    await session.commit()
    await session.refresh(change)
    return change, {"mode": "ask", "change_id": str(change.id), "status": change.status}


async def accept_platform_change(
    session: AsyncSession,
    tenant_id: UUID,
    change_id: UUID,
    user_id: UUID,
) -> PlatformChange:
    result = await session.execute(
        select(PlatformChange).where(
            PlatformChange.id == change_id, PlatformChange.tenant_id == tenant_id
        )
    )
    change = result.scalar_one_or_none()
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    if change.status not in ("draft", "pending_review"):
        raise HTTPException(status_code=400, detail=f"Cannot accept status {change.status}")

    change.status = "accepted"
    change.version = await _next_version(session, tenant_id, change.resource_type, change.resource_id)
    change.resolved_by_user_id = user_id
    change.resolved_at = datetime.utcnow()
    applied = await apply_change_to_domain(session, tenant_id, change)
    if not change.resource_id:
        for key in ("block_id", "agent_id", "workstream_id", "integration_id", "mcp_server_id", "canvas_node_id"):
            if applied.get(key):
                change.resource_id = str(applied[key])
                break

    await record_audit(
        session,
        tenant_id,
        action=f"platform_change:accept:{change.resource_type}",
        actor_type="user",
        actor_id=str(user_id),
        agent_id=change.agent_id,
        run_id=change.run_id,
        resource_type=change.resource_type,
        resource_id=change.resource_id,
        outcome="executed",
        summary=change.summary,
        after=applied,
    )
    await session.commit()
    await session.refresh(change)
    from app.services.webhooks import emit_webhook_event, platform_change_event_data

    await emit_webhook_event(
        session, tenant_id, "platform_change.applied", platform_change_event_data(change)
    )
    return change


async def reject_platform_change(
    session: AsyncSession,
    tenant_id: UUID,
    change_id: UUID,
    user_id: UUID,
) -> PlatformChange:
    result = await session.execute(
        select(PlatformChange).where(
            PlatformChange.id == change_id, PlatformChange.tenant_id == tenant_id
        )
    )
    change = result.scalar_one_or_none()
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    if change.status not in ("draft", "pending_review"):
        raise HTTPException(status_code=400, detail=f"Cannot reject status {change.status}")

    change.status = "rejected"
    change.resolved_by_user_id = user_id
    change.resolved_at = datetime.utcnow()
    await record_audit(
        session,
        tenant_id,
        action=f"platform_change:reject:{change.resource_type}",
        actor_type="user",
        actor_id=str(user_id),
        resource_type=change.resource_type,
        resource_id=change.resource_id,
        outcome="denied",
        summary=change.summary,
    )
    await session.commit()
    await session.refresh(change)
    return change


async def rollback_platform_change(
    session: AsyncSession,
    tenant_id: UUID,
    change_id: UUID,
    user_id: UUID,
) -> PlatformChange:
    result = await session.execute(
        select(PlatformChange).where(
            PlatformChange.id == change_id, PlatformChange.tenant_id == tenant_id
        )
    )
    change = result.scalar_one_or_none()
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    if change.status not in ("accepted", "applied_yolo"):
        raise HTTPException(status_code=400, detail=f"Cannot rollback status {change.status}")

    rolled_back = await rollback_change_to_domain(session, tenant_id, change)
    rollback_row = PlatformChange(
        tenant_id=tenant_id,
        resource_type=change.resource_type,
        resource_id=change.resource_id,
        change_kind="update",
        status="accepted",
        version=await _next_version(session, tenant_id, change.resource_type, change.resource_id),
        summary=f"Rollback of change {change.id}",
        before_json=change.after_json,
        after_json=change.before_json,
        proposed_by_type="user",
        proposed_by_id=str(user_id),
        resolved_by_user_id=user_id,
        resolved_at=datetime.utcnow(),
    )
    session.add(rollback_row)
    await record_audit(
        session,
        tenant_id,
        action=f"platform_change:rollback:{change.resource_type}",
        actor_type="user",
        actor_id=str(user_id),
        resource_type=change.resource_type,
        resource_id=change.resource_id,
        outcome="executed",
        summary=f"Rollback change {change.id}",
        after=rolled_back,
    )
    await session.commit()
    await session.refresh(rollback_row)
    return rollback_row


async def list_platform_changes(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    status: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[PlatformChange]:
    stmt = select(PlatformChange).where(PlatformChange.tenant_id == tenant_id)
    if status:
        stmt = stmt.where(PlatformChange.status == status)
    if resource_type:
        stmt = stmt.where(PlatformChange.resource_type == resource_type)
    if resource_id:
        stmt = stmt.where(PlatformChange.resource_id == resource_id)
    stmt = stmt.order_by(PlatformChange.created_at.desc()).limit(min(limit, 500)).offset(offset)
    result = await session.execute(stmt)
    return list(result.scalars().all())
