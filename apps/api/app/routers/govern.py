"""GOVERN & ASSURE endpoints: audit, passports, drafts, versioning, apply modes."""

import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth, tenant_settings
from app.models.agent import Agent
from app.models.auth import Tenant
from app.services.apply_mode import DEFAULT_PLATFORM_APPLY_MODES, tenant_platform_apply_modes
from app.services.audit import search_audit, serialize_audit
from app.services.platform_changes import (
    accept_platform_change,
    list_platform_changes,
    reject_platform_change,
    rollback_platform_change,
    serialize_change,
)
from app.services.policy import get_or_create_policy

router = APIRouter(prefix="/govern", tags=["govern"])


class ApplyModesUpdate(BaseModel):
    platform_apply_modes: dict[str, str]


@router.get("/audit")
async def list_audit(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    action: str | None = None,
    actor_type: str | None = None,
    agent_id: UUID | None = None,
    outcome: str | None = None,
    q: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    events = await search_audit(
        session,
        auth.tenant.id,
        action=action,
        actor_type=actor_type,
        agent_id=agent_id,
        outcome=outcome,
        q=q,
        limit=limit,
        offset=offset,
    )
    return {"items": [serialize_audit(e) for e in events]}


@router.get("/passports")
async def list_passports(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(Agent).where(Agent.tenant_id == auth.tenant.id).order_by(Agent.created_at)
    )
    agents = result.scalars().all()

    def _list(raw: str) -> list:
        try:
            value = json.loads(raw or "[]")
            return value if isinstance(value, list) else []
        except (json.JSONDecodeError, TypeError):
            return []

    def _dict(raw: str) -> dict:
        try:
            value = json.loads(raw or "{}")
            return value if isinstance(value, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}

    return {
        "items": [
            {
                "id": str(a.id),
                "name": a.name,
                "role": a.role,
                "autonomy_level": a.autonomy_level,
                "allowed_tools": _list(a.tools_json),
                "permission_scopes": _list(a.permission_scopes_json),
                "apply_modes": _dict(a.apply_modes_json),
                "is_active": a.is_active,
                "runtime_status": a.runtime_status,
            }
            for a in agents
        ]
    }


@router.get("/changes")
async def list_changes(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: str | None = "pending_review",
    resource_type: str | None = None,
    resource_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    rows = await list_platform_changes(
        session,
        auth.tenant.id,
        status=status,
        resource_type=resource_type,
        resource_id=resource_id,
        limit=limit,
        offset=offset,
    )
    return {"items": [serialize_change(r) for r in rows]}


@router.get("/changes/{change_id}")
async def get_change(
    change_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.models.platform_change import PlatformChange

    result = await session.execute(
        select(PlatformChange).where(
            PlatformChange.id == change_id, PlatformChange.tenant_id == auth.tenant.id
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Change not found")
    return serialize_change(row)


@router.post("/changes/{change_id}/accept")
async def accept_change(
    change_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    change = await accept_platform_change(session, auth.tenant.id, change_id, auth.user.id)
    return serialize_change(change)


@router.post("/changes/{change_id}/reject")
async def reject_change(
    change_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    change = await reject_platform_change(session, auth.tenant.id, change_id, auth.user.id)
    return serialize_change(change)


@router.post("/changes/{change_id}/rollback")
async def rollback_change(
    change_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    change = await rollback_platform_change(session, auth.tenant.id, change_id, auth.user.id)
    return serialize_change(change)


@router.post("/changes/{change_id}/restore")
async def restore_change(
    change_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create a compensating rollback entry from an accepted change (alias for rollback)."""
    auth.require_role("owner", "admin")
    change = await rollback_platform_change(session, auth.tenant.id, change_id, auth.user.id)
    return serialize_change(change)


@router.get("/apply-modes")
async def get_apply_modes(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    policy = await get_or_create_policy(session, auth.tenant.id)
    return {
        "defaults": DEFAULT_PLATFORM_APPLY_MODES,
        "tenant_modes": tenant_platform_apply_modes(auth.tenant),
        "policy_mode": policy.mode,
    }


@router.put("/apply-modes")
async def update_apply_modes(
    body: ApplyModesUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    for key, val in body.platform_apply_modes.items():
        if val not in ("draft", "yolo", "decision"):
            raise HTTPException(status_code=400, detail=f"Invalid mode for {key}: {val}")
    settings = tenant_settings(auth.tenant)
    settings["platform_apply_modes"] = body.platform_apply_modes
    result = await session.execute(select(Tenant).where(Tenant.id == auth.tenant.id))
    tenant = result.scalar_one()
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    return {
        "tenant_modes": tenant_platform_apply_modes(tenant),
        "platform_apply_modes": body.platform_apply_modes,
    }
