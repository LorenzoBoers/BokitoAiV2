"""GOVERN & ASSURE endpoints: posture, allowance sliders, audit, passports, changes, API tokens."""

import hashlib
import json
import secrets
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth, tenant_settings
from app.models.agent import Agent
from app.models.api_token import ApiToken
from app.models.auth import Tenant
from app.services.audit import record_audit, search_audit, serialize_audit
from app.services.platform_changes import (
    accept_platform_change,
    enrich_changes_with_signal_ids,
    list_platform_changes,
    reject_platform_change,
    rollback_platform_change,
    serialize_change,
)
from app.tools.policy import (
    ALLOWANCE_MODES,
    AUTONOMY_POSTURES,
    resolve_posture,
    serialize_posture_catalog,
    tenant_allowances,
    tenant_tool_overrides,
)
from app.tools.registry import TOOL_CATEGORIES, iter_tool_specs

router = APIRouter(prefix="/govern", tags=["govern"])


class PostureUpdate(BaseModel):
    posture: str


class AllowancesUpdate(BaseModel):
    allowances: dict[str, str]


class ToolOverrideUpdate(BaseModel):
    tool_name: str
    # null/empty mode clears the override
    mode: str | None = None


class TokenCreate(BaseModel):
    name: str
    scopes: list[str] = []


def _allowance_state(tenant: Tenant) -> dict:
    settings = tenant_settings(tenant)
    history = settings.get("learning_allowance_history")
    if not isinstance(history, list):
        history = []
    learning_history = [h for h in history if isinstance(h, dict)][:5]
    return {
        "posture": resolve_posture(tenant),
        "allowances": tenant_allowances(tenant),
        "tool_overrides": tenant_tool_overrides(tenant),
        "categories": list(TOOL_CATEGORIES),
        "presets": serialize_posture_catalog(),
        "learning_history": learning_history,
    }


@router.get("/posture")
async def get_posture(auth: Annotated[AuthContext, Depends(get_current_auth)]):
    return _allowance_state(auth.tenant)


@router.put("/posture")
async def update_posture(
    body: PostureUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    if body.posture not in AUTONOMY_POSTURES:
        raise HTTPException(status_code=400, detail=f"Invalid posture: {body.posture}")

    previous_posture = resolve_posture(auth.tenant)
    settings = tenant_settings(auth.tenant)
    settings["autonomy_posture"] = body.posture
    # Posture change resets explicit per-category overrides to the preset.
    settings.pop("tool_allowances", None)

    result = await session.execute(select(Tenant).where(Tenant.id == auth.tenant.id))
    tenant = result.scalar_one()
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)

    await record_audit(
        session,
        auth.tenant.id,
        action="govern:posture_update",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type="tenant",
        resource_id=str(auth.tenant.id),
        outcome="applied",
        summary=f"Autonomy posture changed from {previous_posture} to {body.posture}",
        before={"posture": previous_posture},
        after={"posture": body.posture},
        commit=False,
    )
    await session.commit()
    await session.refresh(tenant)
    return _allowance_state(tenant)


@router.get("/allowances")
async def get_allowances(auth: Annotated[AuthContext, Depends(get_current_auth)]):
    state = _allowance_state(auth.tenant)
    overrides = state["tool_overrides"]
    tools = [
        {
            "name": spec.name,
            "description": spec.description,
            "category": spec.category,
            "mutating": spec.mutating,
            "gated": spec.gated,
            "override": overrides.get(spec.name),
        }
        for spec in iter_tool_specs()
    ]
    return {**state, "tools": tools}


@router.put("/allowances")
async def update_allowances(
    body: AllowancesUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    for key, val in body.allowances.items():
        if key not in TOOL_CATEGORIES:
            raise HTTPException(status_code=400, detail=f"Unknown category: {key}")
        if val not in ALLOWANCE_MODES:
            raise HTTPException(status_code=400, detail=f"Invalid mode for {key}: {val}")

    settings = tenant_settings(auth.tenant)
    current = settings.get("tool_allowances") or {}
    if not isinstance(current, dict):
        current = {}
    current.update(body.allowances)
    settings["tool_allowances"] = current

    result = await session.execute(select(Tenant).where(Tenant.id == auth.tenant.id))
    tenant = result.scalar_one()
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)

    await record_audit(
        session,
        auth.tenant.id,
        action="govern:allowances_update",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type="tenant",
        resource_id=str(auth.tenant.id),
        outcome="applied",
        summary="Tool allowance sliders updated",
        after=body.allowances,
        commit=False,
    )
    await session.commit()
    await session.refresh(tenant)
    return _allowance_state(tenant)


@router.put("/tool-overrides")
async def update_tool_override(
    body: ToolOverrideUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    if body.mode is not None and body.mode not in ALLOWANCE_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {body.mode}")

    settings = tenant_settings(auth.tenant)
    overrides = settings.get("tool_overrides") or {}
    if not isinstance(overrides, dict):
        overrides = {}
    before_mode = overrides.get(body.tool_name)
    if body.mode is None:
        overrides.pop(body.tool_name, None)
    else:
        overrides[body.tool_name] = body.mode
    settings["tool_overrides"] = overrides

    result = await session.execute(select(Tenant).where(Tenant.id == auth.tenant.id))
    tenant = result.scalar_one()
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await record_audit(
        session,
        auth.tenant.id,
        action="govern:tool_override_update",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type="tenant",
        resource_id=str(auth.tenant.id),
        outcome="applied",
        summary=f"Tool override for {body.tool_name}",
        before={"tool": body.tool_name, "mode": before_mode},
        after={"tool": body.tool_name, "mode": body.mode},
        commit=False,
    )
    await session.commit()
    await session.refresh(tenant)
    return _allowance_state(tenant)


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

    return {
        "items": [
            {
                "id": str(a.id),
                "name": a.name,
                "role": a.role,
                "model": a.model,
                "provider": a.provider,
                "autonomy_level": a.autonomy_level,
                "allowed_tools": _list(a.tools_json),
                "permission_scopes": _list(a.permission_scopes_json),
                "is_active": a.is_active,
                "runtime_status": a.runtime_status,
            }
            for a in agents
        ]
    }


class PassportUpdate(BaseModel):
    autonomy_level: str | None = None  # manual | approval | auto
    allowed_tools: list[str] | None = None
    permission_scopes: list[str] | None = None


@router.patch("/passports/{agent_id}")
async def update_passport(
    agent_id: UUID,
    body: PassportUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    result = await session.execute(
        select(Agent).where(Agent.id == agent_id, Agent.tenant_id == auth.tenant.id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    changed: dict[str, object] = {}
    if body.autonomy_level is not None:
        if body.autonomy_level not in ("manual", "approval", "auto"):
            raise HTTPException(status_code=400, detail="Invalid autonomy level")
        agent.autonomy_level = body.autonomy_level
        changed["autonomy_level"] = body.autonomy_level
    if body.allowed_tools is not None:
        agent.tools_json = json.dumps([str(t) for t in body.allowed_tools])
        changed["allowed_tools"] = body.allowed_tools
    if body.permission_scopes is not None:
        agent.permission_scopes_json = json.dumps([str(s) for s in body.permission_scopes])
        changed["permission_scopes"] = body.permission_scopes

    if changed:
        agent.updated_at = datetime.utcnow()
        session.add(agent)
        await record_audit(
            session,
            auth.tenant.id,
            action="agent_passport.update",
            actor_type="user",
            actor_id=str(auth.user.id) if auth.user else "",
            resource_type="agent_passport",
            resource_id=str(agent.id),
            payload=changed,
            commit=False,
        )
        await session.commit()

    def _list(raw: str) -> list:
        try:
            value = json.loads(raw or "[]")
            return value if isinstance(value, list) else []
        except (json.JSONDecodeError, TypeError):
            return []

    return {
        "ok": True,
        "passport": {
            "id": str(agent.id),
            "name": agent.name,
            "role": agent.role,
            "model": agent.model,
            "provider": agent.provider,
            "autonomy_level": agent.autonomy_level,
            "allowed_tools": _list(agent.tools_json),
            "permission_scopes": _list(agent.permission_scopes_json),
            "is_active": agent.is_active,
            "runtime_status": agent.runtime_status,
        },
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
    return {"items": await enrich_changes_with_signal_ids(session, list(rows))}


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
    items = await enrich_changes_with_signal_ids(session, [row])
    return items[0]


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


# ── API tokens (MCP server access) ───────────────────────────────


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _serialize_token(row: ApiToken) -> dict:
    return {
        "id": str(row.id),
        "name": row.name,
        "token_prefix": row.token_prefix,
        "scopes": json.loads(row.scopes_json or "[]"),
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
        "created_at": row.created_at.isoformat(),
    }


@router.get("/tokens")
async def list_tokens(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    result = await session.execute(
        select(ApiToken).where(ApiToken.tenant_id == auth.tenant.id).order_by(ApiToken.created_at.desc())
    )
    return {"items": [_serialize_token(t) for t in result.scalars().all()]}


@router.post("/tokens")
async def create_token(
    body: TokenCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    from app.routers.public_api import REST_SCOPES

    for scope in body.scopes:
        if scope not in TOOL_CATEGORIES and scope not in REST_SCOPES:
            raise HTTPException(status_code=400, detail=f"Unknown scope: {scope}")
    plain = f"bok_{secrets.token_urlsafe(32)}"
    token = ApiToken(
        tenant_id=auth.tenant.id,
        name=body.name,
        token_hash=hash_token(plain),
        token_prefix=plain[:12],
        scopes_json=json.dumps(body.scopes),
        created_by_user_id=auth.user.id,
    )
    session.add(token)
    await record_audit(
        session,
        auth.tenant.id,
        action="govern:token_create",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type="api_token",
        resource_id=str(token.id),
        outcome="applied",
        summary=f"API token '{body.name}' created",
        commit=False,
    )
    await session.commit()
    await session.refresh(token)
    return {**_serialize_token(token), "token": plain}


@router.delete("/tokens/{token_id}")
async def revoke_token(
    token_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    result = await session.execute(
        select(ApiToken).where(ApiToken.id == token_id, ApiToken.tenant_id == auth.tenant.id)
    )
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    token.revoked_at = datetime.utcnow()
    session.add(token)
    await session.commit()
    return _serialize_token(token)
