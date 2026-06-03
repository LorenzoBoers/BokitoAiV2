"""Action policy and whitelist matching."""

import hashlib
import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.policy import ActionPolicy, ActionWhitelistEntry


def action_signature(action_type: str, payload: dict[str, Any]) -> str:
    stable = json.dumps({"action_type": action_type, "payload": payload}, sort_keys=True)
    return hashlib.sha256(stable.encode()).hexdigest()[:16]


async def get_or_create_policy(session: AsyncSession, tenant_id: UUID) -> ActionPolicy:
    result = await session.execute(select(ActionPolicy).where(ActionPolicy.tenant_id == tenant_id))
    policy = result.scalar_one_or_none()
    if not policy:
        policy = ActionPolicy(tenant_id=tenant_id, mode="whitelist")
        session.add(policy)
        await session.commit()
        await session.refresh(policy)
    return policy


async def is_action_allowed(
    session: AsyncSession,
    tenant_id: UUID,
    action_type: str,
    payload: dict[str, Any] | None = None,
) -> tuple[bool, str]:
    policy = await get_or_create_policy(session, tenant_id)
    if policy.mode == "yolo":
        return True, "yolo"
    if policy.mode == "manual":
        return False, "manual"
    sig = action_signature(action_type, payload or {})
    result = await session.execute(
        select(ActionWhitelistEntry).where(
            ActionWhitelistEntry.tenant_id == tenant_id,
            ActionWhitelistEntry.action_type == action_type,
        )
    )
    entries = result.scalars().all()
    for entry in entries:
        if entry.scope_signature in ("*", sig):
            return True, "whitelist"
    return False, "not_whitelisted"


async def add_whitelist_entry(
    session: AsyncSession,
    tenant_id: UUID,
    action_type: str,
    payload: dict[str, Any] | None,
    created_by: UUID,
) -> ActionWhitelistEntry:
    entry = ActionWhitelistEntry(
        tenant_id=tenant_id,
        action_type=action_type,
        scope_signature=action_signature(action_type, payload or {}),
        created_by=created_by,
    )
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    return entry
