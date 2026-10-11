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
from app.models.signal import SignalTag
from app.models.orchestra import Workstream
from app.services.agent_rules import (
    ADMIN_ROLES,
    AUTONOMY_MODES,
    agent_rules,
    dry_run,
    normalize_autonomy,
    set_rules,
    workspace_rules,
)
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


class AutonomyScopeUpdate(BaseModel):
    autonomy_level: str


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


async def _autonomous_prerequisites(
    session: AsyncSession, auth: AuthContext
) -> dict:
    """Live model + at least one send-ready channel before Autonomous posture."""
    from app.models.channel import ChannelAccount
    from app.services.channel_registry import can_send, resolve_channel
    from app.services.model_resolution import resolve_model_call

    tenant = auth.tenant
    call = await resolve_model_call(session, tenant.id, kind="chat")
    llm_live = bool(call.live)
    accounts = (
        await session.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant.id,
                ChannelAccount.is_enabled.is_(True),
            )
        )
    ).scalars().all()
    send_ready = any(can_send(resolve_channel(a, tenant=tenant)) for a in accounts)
    reasons: list[str] = []
    if not llm_live:
        reasons.append("llm_not_live")
    if not send_ready:
        reasons.append("no_send_ready_channel")
    return {
        "llm_live": llm_live,
        "send_ready": send_ready,
        "autonomous_allowed": llm_live and send_ready,
        "block_reasons": reasons,
    }


@router.get("/posture")
async def get_posture(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.ai_handling import autonomous_override_count, governance_ceiling

    prereq = await _autonomous_prerequisites(session, auth)
    ceiling, clamped_by = governance_ceiling(auth.tenant)
    return {
        **_allowance_state(auth.tenant),
        "prerequisites": prereq,
        # AI handling ceiling for conversations (same messaging allowance).
        "conversation_ceiling": {"mode": ceiling, "clamped_by": clamped_by},
        "autonomous_overrides": await autonomous_override_count(session, auth.tenant),
    }


@router.put("/posture")
async def update_posture(
    body: PostureUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    if body.posture not in AUTONOMY_POSTURES:
        raise HTTPException(status_code=400, detail=f"Invalid posture: {body.posture}")

    prereq = await _autonomous_prerequisites(session, auth)
    if body.posture == "autonomous" and not prereq["autonomous_allowed"]:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "autonomous_prerequisites",
                "message": (
                    "Autonomous posture requires a live AI model and at least "
                    "one send-ready channel."
                ),
                "prerequisites": prereq,
            },
        )

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
    return {**_allowance_state(tenant), "prerequisites": prereq}


@router.get("/autonomy-scopes")
async def list_autonomy_scopes(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.tickets import list_categories

    categories = await list_categories(session, auth.tenant.id)
    workstreams = (
        await session.execute(
            select(Workstream)
            .where(Workstream.tenant_id == auth.tenant.id, Workstream.enabled.is_(True))
            .order_by(Workstream.name)
        )
    ).scalars().all()
    return {
        "categories": [
            {
                "id": str(row.id),
                "name": row.name,
                "autonomy_level": row.autonomy_level or "",
                # draft/ask: replies on tickets of this category never go out
                # autonomously (AI handling safeguard).
                "send_mode": row.send_mode,
            }
            for row in categories
        ],
        "workstreams": [
            {"id": str(row.id), "name": row.name, "autonomy_level": row.autonomy_level or ""}
            for row in workstreams
        ],
    }


@router.patch("/autonomy-scopes/{scope_kind}/{scope_id}")
async def update_autonomy_scope(
    scope_kind: str,
    scope_id: UUID,
    body: AutonomyScopeUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    from app.services.agent_rules import parse_scope_autonomy

    level = parse_scope_autonomy(body.autonomy_level)
    model = SignalTag if scope_kind == "category" else Workstream if scope_kind == "workstream" else None
    if model is None:
        raise HTTPException(status_code=400, detail="Invalid autonomy scope")
    row = (
        await session.execute(
            select(model).where(model.id == scope_id, model.tenant_id == auth.tenant.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Autonomy scope not found")
    previous = row.autonomy_level or ""
    row.autonomy_level = level
    row.updated_at = datetime.utcnow()
    session.add(row)
    await record_audit(
        session,
        auth.tenant.id,
        action=f"govern:{scope_kind}_autonomy_update",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type=scope_kind,
        resource_id=str(row.id),
        outcome="applied",
        summary=f"Autonomy for {row.name} changed from {previous} to {level}",
        before={"autonomy_level": previous},
        after={"autonomy_level": level},
        commit=False,
    )
    await session.commit()
    return {"id": str(row.id), "name": row.name, "autonomy_level": level}


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

    from app.services.workforce_runtime import serialize_agent

    return {"items": [serialize_agent(a, view="passport") for a in agents]}


class RuleItem(BaseModel):
    id: str = ""
    text: str
    mode: str  # manual | assisted | autonomous
    kind: str = "judgement"  # hard | judgement
    tool: str = ""
    category: str = ""
    uses: int = 0
    approved: int = 0
    rejected: int = 0


class RulesBody(BaseModel):
    rules: list[RuleItem]


class RulesOut(BaseModel):
    rules: list[dict]


class RuleTestBody(BaseModel):
    tool: str
    agent_id: UUID | None = None
    certainty: int | None = None
    rule_id: str = ""


class RuleTestOut(BaseModel):
    tool: str
    mode: str
    reason: str
    outcome: str  # runs | asks | refused
    rule: dict | None = None


@router.get("/rules", response_model=RulesOut)
async def get_workspace_rules(auth: Annotated[AuthContext, Depends(get_current_auth)]):
    """Exception rules for all agents in this workspace (hard and judgement)."""
    return {"rules": workspace_rules(auth.tenant)}


@router.put("/rules", response_model=RulesOut)
async def put_workspace_rules(
    body: RulesBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Replace the workspace rules. A rule to Autonomous needs an owner or admin."""
    tenant = await session.get(Tenant, auth.tenant.id)
    before = workspace_rules(tenant)
    rules = await set_rules(
        session, tenant, None, [r.model_dump() for r in body.rules], role=auth.role, user_id=auth.user.id
    )
    await record_audit(
        session,
        auth.tenant.id,
        action="govern:agent_rules_update",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type="tenant",
        resource_id=str(auth.tenant.id),
        outcome="applied",
        summary=f"Workspace rules updated ({len(rules)})",
        before={"rules": before},
        after={"rules": rules},
        commit=False,
    )
    await session.commit()
    return {"rules": rules}


class AgentRulesRow(BaseModel):
    agent_id: str
    agent_name: str
    rules: list[dict]


class AgentRulesListOut(BaseModel):
    agents: list[AgentRulesRow]


@router.get("/agent-rules", response_model=AgentRulesListOut)
async def list_agent_rules(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Per-agent action rules (always / ask / never per tool), set from decision
    cards or on the agent page. Agents without rules are left out."""
    rows = (
        await session.execute(
            select(Agent).where(Agent.tenant_id == auth.tenant.id).order_by(Agent.name)
        )
    ).scalars().all()
    out = []
    for agent in rows:
        rules = agent_rules(agent)
        if rules:
            out.append({"agent_id": str(agent.id), "agent_name": agent.name, "rules": rules})
    return {"agents": out}


@router.delete("/agent-rules/{agent_id}/{rule_id}", response_model=AgentRulesRow)
async def delete_agent_rule(
    agent_id: UUID,
    rule_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Remove one agent rule. Dropping a rule that let the agent act on its own
    is for everyone; dropping an ask/never rule loosens the agent and needs an
    owner or admin."""
    agent = await session.get(Agent, agent_id)
    if agent is None or agent.tenant_id != auth.tenant.id:
        raise HTTPException(status_code=404, detail="Agent not found")
    rules = agent_rules(agent)
    rule = next((r for r in rules if r["id"] == rule_id), None)
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    if rule["mode"] != "autonomous" and auth.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Only owners and admins can loosen an agent's rules")
    remaining = [r for r in rules if r["id"] != rule_id]
    settings = json.loads(agent.settings_json or "{}") if agent.settings_json else {}
    if not isinstance(settings, dict):
        settings = {}
    settings["rules"] = remaining
    agent.settings_json = json.dumps(settings)
    session.add(agent)
    await record_audit(
        session,
        auth.tenant.id,
        action="agent_rule:delete",
        actor_type="user",
        actor_id=str(auth.user.id),
        agent_id=agent.id,
        resource_type="agent_rule",
        resource_id=str(agent.id),
        outcome="applied",
        summary=f"Rule removed for {agent.name}: {rule['text']}"[:240],
        before={"rule": rule},
        commit=False,
    )
    await session.commit()
    return {"agent_id": str(agent.id), "agent_name": agent.name, "rules": remaining}


@router.post("/rules/test", response_model=RuleTestOut)
async def test_workspace_rules(
    body: RuleTestBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Try out: which rule applies to an action and whether the agent runs it, asks, or refuses."""
    agent = None
    if body.agent_id is not None:
        agent = await session.get(Agent, body.agent_id)
        if agent is None or agent.tenant_id != auth.tenant.id:
            raise HTTPException(status_code=404, detail="Agent not found")
    return await dry_run(
        session, auth.tenant, agent, tool=body.tool, certainty=body.certainty, rule_id=body.rule_id
    )


class PassportUpdate(BaseModel):
    autonomy_level: str | None = None  # manual | assisted | autonomous
    tools: list[str] | None = None
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
        level = normalize_autonomy(body.autonomy_level)
        if level not in AUTONOMY_MODES or body.autonomy_level not in (*AUTONOMY_MODES, "approval", "auto"):
            raise HTTPException(status_code=400, detail="Invalid autonomy level")
        agent.autonomy_level = level
        changed["autonomy_level"] = level
    if body.tools is not None:
        agent.tools_json = json.dumps([str(t) for t in body.tools])
        changed["tools"] = body.tools
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

    from app.services.workforce_runtime import serialize_agent

    return {"ok": True, "passport": serialize_agent(agent, view="passport")}


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
