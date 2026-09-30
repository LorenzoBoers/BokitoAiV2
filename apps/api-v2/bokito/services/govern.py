"""Changes: proposed and applied platform changes with rollback."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.base import utcnow
from bokito.domain.govern import Change, ChangeStatus, Policy
from bokito.domain.identity import Posture, Tenant
from bokito.domain.work import Agent, Playbook
from bokito.errors import Conflict, NotFound


def policy_snapshot(policy: Policy) -> dict[str, Any]:
    return {
        "posture": policy.posture.value,
        "allowances": dict(policy.allowances or {}),
        "tool_overrides": dict(policy.tool_overrides or {}),
        "consequential": list(policy.consequential or []),
        "budgets": dict(policy.budgets or {}),
        "disclosure_text": policy.disclosure_text,
    }


async def record_change(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    target_kind: str,
    target_id: uuid.UUID | None,
    title: str,
    before: dict[str, Any] | None,
    after: dict[str, Any],
    proposed_by: str,
    conversation_id: uuid.UUID | None = None,
    decision_id: uuid.UUID | None = None,
    applied: bool = False,
    applied_by_user_id: uuid.UUID | None = None,
) -> Change:
    change = Change(
        tenant_id=tenant_id,
        status=ChangeStatus.applied if applied else ChangeStatus.draft,
        target_kind=target_kind,
        target_id=target_id,
        title=title[:300],
        before=before,
        after=after,
        proposed_by=proposed_by,
        conversation_id=conversation_id,
        decision_id=decision_id,
        applied_by_user_id=applied_by_user_id if applied else None,
        created_at=utcnow(),
        applied_at=utcnow() if applied else None,
    )
    session.add(change)
    await session.flush()
    return change


async def get_change(session: AsyncSession, tenant_id: uuid.UUID, change_id: uuid.UUID) -> Change:
    change = await session.get(Change, change_id)
    if not change or change.tenant_id != tenant_id:
        raise NotFound("change not found", code="change_not_found")
    return change


async def list_changes(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    status: ChangeStatus | None = None,
    limit: int = 50,
) -> list[Change]:
    stmt = select(Change).where(Change.tenant_id == tenant_id)
    if status:
        stmt = stmt.where(Change.status == status)
    stmt = stmt.order_by(Change.created_at.desc()).limit(limit)
    return list((await session.scalars(stmt)).all())


async def _apply_snapshot(
    session: AsyncSession, change: Change, snapshot: dict[str, Any] | None
) -> None:
    if snapshot is None:
        return
    if change.target_kind == "policy":
        policy = await session.scalar(select(Policy).where(Policy.tenant_id == change.tenant_id))
        if policy:
            policy.posture = Posture(snapshot["posture"])
            policy.allowances = snapshot.get("allowances", {})
            policy.tool_overrides = snapshot.get("tool_overrides", {})
            policy.consequential = snapshot.get("consequential", [])
            policy.budgets = snapshot.get("budgets", {})
            policy.disclosure_text = snapshot.get("disclosure_text", "")
            tenant = await session.get(Tenant, change.tenant_id)
            if tenant:
                tenant.posture = policy.posture
    elif change.target_kind == "agent" and change.target_id:
        agent = await session.get(Agent, change.target_id)
        if agent:
            from bokito.services.work import apply_agent_patch

            apply_agent_patch(agent, snapshot)
    elif change.target_kind == "playbook" and change.target_id:
        pb = await session.get(Playbook, change.target_id)
        if pb:
            pb.name = snapshot.get("name", pb.name)
            pb.steps = snapshot.get("steps", pb.steps)
            if "description" in snapshot:
                pb.description = snapshot["description"]


async def apply_change(
    session: AsyncSession, change: Change, *, user_id: uuid.UUID | None
) -> Change:
    if change.status != ChangeStatus.draft:
        raise Conflict("change is not a draft", code="change_not_draft")
    await _apply_snapshot(session, change, change.after)
    change.status = ChangeStatus.applied
    change.applied_at = utcnow()
    change.applied_by_user_id = user_id
    await session.flush()
    return change


async def reject_change(session: AsyncSession, change: Change) -> Change:
    if change.status != ChangeStatus.draft:
        raise Conflict("change is not a draft", code="change_not_draft")
    change.status = ChangeStatus.rejected
    await session.flush()
    return change


async def rollback_change(session: AsyncSession, change: Change) -> Change:
    if change.status != ChangeStatus.applied:
        raise Conflict("only applied changes can be rolled back", code="change_not_applied")
    if change.before is None:
        raise Conflict("this change has no previous state to restore", code="no_before_state")
    await _apply_snapshot(session, change, change.before)
    change.status = ChangeStatus.rolled_back
    change.rolled_back_at = utcnow()
    await session.flush()
    return change
