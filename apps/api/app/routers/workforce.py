"""Workforce API router (agents, work logs, messages, runtime controls)."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import workforce_runtime as svc
from app.services.os_graph import os_graph_retired_response

router = APIRouter(prefix="/workforce", tags=["workforce"])


def _body_uuid(value: str, field: str) -> UUID:
    """Parse a UUID from a request body string: 400 instead of a 500."""
    try:
        return UUID(value)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"Invalid {field}") from None


class AgentStatusBody(BaseModel):
    status: str


class AgentModelBody(BaseModel):
    model: str


class AgentCreateBody(BaseModel):
    name: str
    description: str = ""
    purpose: str = ""
    system_prompt: str = ""
    model: str = ""
    tools: list[str] = []
    owner_user_id: UUID | None = None
    default_channels: list[str] = []
    default_signal_types: list[str] = []
    chat_access: str = "everyone"


class AgentUpdateBody(BaseModel):
    name: str | None = None
    description: str | None = None
    purpose: str | None = None
    system_prompt: str | None = None
    tools: list[str] | None = None
    owner_user_id: UUID | None = None
    default_channels: list[str] | None = None
    default_signal_types: list[str] | None = None
    # Plain-text signature appended to outbound replies sent as this agent.
    email_signature_text: str | None = None
    # Legacy HTML field — converted to plain text on write.
    email_signature_html: str | None = None
    # Default Send as on approvals for this agent: user (impersonate) | agent.
    reply_send_as: str | None = None
    avatar_kind: str | None = None
    avatar_icon: str | None = None
    avatar_color: str | None = None
    avatar_image_url: str | None = None
    # Who the agent asks: {"kind": "auto"} or {"kind": "user" | "team", "id": ...}.
    ask_target: dict[str, Any] | None = None


class TriggerAgentBody(BaseModel):
    agent_id: str
    instruction: str
    priority: str | None = None
    correlation_id: str | None = None


class CompleteActivityBody(BaseModel):
    activity_id: str
    outcome: str
    summary: str | None = None
    result: dict[str, Any] | None = None
    correlation_id: str | None = None


class WorkforceConfigPatch(BaseModel):
    enabled: bool | None = None
    autonomy_level: str | None = None
    check_interval_sec: int | None = None
    max_retry_per_feature: int | None = None
    allow_verdict_override: bool | None = None
    sleep_mode: str | None = None


class DeferBody(BaseModel):
    days: int = 7


# --- AI OS graph (retired overlay) ---


@router.get("/os/graph")
async def os_workspace_graph_retired() -> None:
    return os_graph_retired_response()


@router.get("/os/graph/{project_id}")
async def os_project_graph_retired(project_id: UUID) -> None:
    del project_id
    return os_graph_retired_response()


@router.post("/os/nodes")
async def os_create_node_retired() -> None:
    return os_graph_retired_response()


@router.patch("/os/nodes/{node_id}")
async def os_patch_node_retired(node_id: UUID) -> None:
    del node_id
    return os_graph_retired_response()


@router.delete("/os/nodes/{node_id}")
async def os_delete_node_retired(node_id: UUID) -> None:
    del node_id
    return os_graph_retired_response()


@router.post("/os/edges")
async def os_create_edge_retired() -> None:
    return os_graph_retired_response()


@router.delete("/os/edges/{edge_id}")
async def os_delete_edge_retired(edge_id: UUID) -> None:
    del edge_id
    return os_graph_retired_response()


# --- Work logs ---


@router.get("/work_logs")
async def get_work_logs(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    project_id: str | None = Query(default=None),
    agent_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
):
    items = await svc.list_work_logs(
        session,
        auth.tenant.id,
        project_id=project_id,
        agent_id=agent_id,
        status=status,
        limit=limit,
    )
    return {"items": items}


@router.get("/activity-timeline")
async def activity_timeline(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    agent_id: UUID | None = Query(default=None),
    hours: int = Query(default=168, ge=6, le=336),
):
    """Now-centered past sessions and upcoming wakes for one agent or the whole library."""
    return await svc.list_activity_timeline(
        session,
        auth.tenant.id,
        agent_id=agent_id,
        hours=hours,
    )


@router.get("/work_logs/{work_log_id}/events")
async def work_log_events(
    work_log_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.get_work_log_events(session, auth.tenant.id, work_log_id)


@router.get("/runs/{work_log_id}/status")
async def run_status(
    work_log_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    data = await svc.get_work_log_events(session, auth.tenant.id, work_log_id)
    return {
        "status": data.get("status"),
        "task_subject": data.get("task_subject"),
        "tokens_used": data.get("tokens_used"),
    }


# --- Agents ---


@router.get("/agents")
async def list_agents(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    include_inactive: bool = False,
):
    """Company agents for pickers and the Agents library.

    Deactivated agents are omitted by default so channel access, assign menus
    and bindings stay on the working roster. Pass ``include_inactive=true`` for
    directory views that show the Deactivated filter.
    """
    items = await svc.list_runtime_agents(
        session, auth.tenant.id, include_inactive=include_inactive
    )
    return {"items": items}


@router.post("/agents")
async def create_agent(
    body: AgentCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    result = await svc.create_agent(
        session,
        auth.tenant.id,
        name=body.name,
        role="assistant",
        description=body.description,
        system_prompt=body.purpose or body.system_prompt,
        tools=body.tools,
        owner_user_id=body.owner_user_id,
        default_channels=body.default_channels,
        default_signal_types=body.default_signal_types,
        model_slug=body.model,
        chat_access=body.chat_access,
    )
    from app.services.audit import record_audit

    created = result.get("agent") if isinstance(result, dict) else None
    await record_audit(
        session,
        auth.tenant.id,
        action="agent:created",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="agent",
        resource_id=(created or {}).get("id", ""),
        summary=body.name,
    )
    return result


@router.patch("/agents/{agent_id}")
async def update_agent(
    agent_id: UUID,
    body: AgentUpdateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    result = await svc.update_agent(
        session,
        auth.tenant.id,
        agent_id,
        name=body.name,
        description=body.description,
        system_prompt=body.purpose if body.purpose is not None else body.system_prompt,
        tools=body.tools,
        owner_user_id=body.owner_user_id,
        default_channels=body.default_channels,
        default_signal_types=body.default_signal_types,
        email_signature_html=body.email_signature_html,
        email_signature_text=body.email_signature_text,
        reply_send_as=body.reply_send_as,
        avatar_kind=body.avatar_kind,
        avatar_icon=body.avatar_icon,
        avatar_color=body.avatar_color,
        avatar_image_url=body.avatar_image_url,
        ask_target=body.ask_target,
    )
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="agent:updated",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="agent",
        resource_id=agent_id,
        after={
            "name": body.name,
            "purpose_changed": body.purpose is not None or body.system_prompt is not None,
            "ask_target": body.ask_target,
        },
    )
    return result


class AgentRulesOut(BaseModel):
    autonomy_level: str
    rules: list[dict[str, Any]]
    workspace_rules: list[dict[str, Any]]


class AgentRulesBody(BaseModel):
    autonomy_level: str | None = None  # manual | assisted | autonomous
    rules: list[dict[str, Any]] | None = None


class AgentRuleTestBody(BaseModel):
    tool: str
    certainty: int | None = None
    rule_id: str = ""


class AgentRuleTestOut(BaseModel):
    tool: str
    mode: str
    reason: str
    outcome: str  # runs | asks | refused
    rule: dict[str, Any] | None = None


async def _tenant_agent(session: AsyncSession, auth: AuthContext, agent_id: UUID):
    from app.models.agent import Agent
    from app.models.auth import Tenant

    agent = await session.get(Agent, agent_id)
    if agent is None or agent.tenant_id != auth.tenant.id:
        raise HTTPException(status_code=404, detail="Agent not found")
    return await session.get(Tenant, auth.tenant.id), agent


@router.get("/agents/{agent_id}/rules", response_model=AgentRulesOut)
async def get_agent_rules(
    agent_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """The agent's autonomy ceiling, its own exception rules, and the workspace rules it also follows."""
    from app.services.agent_rules import agent_rules, normalize_autonomy, workspace_rules

    tenant, agent = await _tenant_agent(session, auth, agent_id)
    return {
        "autonomy_level": normalize_autonomy(agent.autonomy_level),
        "rules": agent_rules(agent),
        "workspace_rules": workspace_rules(tenant),
    }


@router.put("/agents/{agent_id}/rules", response_model=AgentRulesOut)
async def put_agent_rules(
    agent_id: UUID,
    body: AgentRulesBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Set the ceiling and/or replace the agent's rules.

    Raising the ceiling or a rule to Autonomous needs an owner or admin.
    """
    from datetime import datetime

    from app.services.agent_rules import (
        ADMIN_ROLES,
        AUTONOMY_MODES,
        agent_rules,
        normalize_autonomy,
        set_rules,
        workspace_rules,
    )
    from app.services.audit import record_audit

    tenant, agent = await _tenant_agent(session, auth, agent_id)
    before = {"autonomy_level": agent.autonomy_level, "rules": agent_rules(agent)}
    if body.autonomy_level is not None:
        if body.autonomy_level not in AUTONOMY_MODES:
            raise HTTPException(status_code=422, detail="Autonomy is manual, assisted or autonomous")
        if (
            body.autonomy_level == "autonomous"
            and normalize_autonomy(agent.autonomy_level) != "autonomous"
            and auth.role not in ADMIN_ROLES
        ):
            raise HTTPException(status_code=403, detail="Only owners and admins can let an agent act on its own")
        agent.autonomy_level = body.autonomy_level
    if body.rules is not None:
        await set_rules(session, tenant, agent, body.rules, role=auth.role, user_id=auth.user.id)
    agent.updated_at = datetime.utcnow()
    session.add(agent)
    await record_audit(
        session,
        auth.tenant.id,
        action="agent:rules_updated",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type="agent",
        resource_id=str(agent.id),
        outcome="applied",
        summary=f"Autonomy and rules for {agent.name} updated",
        before=before,
        after={"autonomy_level": agent.autonomy_level, "rules": agent_rules(agent)},
        commit=False,
    )
    await session.commit()
    return {
        "autonomy_level": normalize_autonomy(agent.autonomy_level),
        "rules": agent_rules(agent),
        "workspace_rules": workspace_rules(tenant),
    }


@router.post("/agents/{agent_id}/rules/test", response_model=AgentRuleTestOut)
async def test_agent_rules(
    agent_id: UUID,
    body: AgentRuleTestBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Try out: would this agent run the action, ask first, or refuse it, and which rule decides."""
    from app.services.agent_rules import dry_run

    tenant, agent = await _tenant_agent(session, auth, agent_id)
    return await dry_run(
        session, tenant, agent, tool=body.tool, certainty=body.certainty, rule_id=body.rule_id
    )


@router.delete("/agents/{agent_id}")
async def archive_agent(
    agent_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    result = await svc.archive_agent(session, auth.tenant.id, agent_id)
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="agent:archived",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="agent",
        resource_id=agent_id,
    )
    return result


@router.post("/agents/{agent_id}/restore")
async def restore_agent(
    agent_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    result = await svc.restore_agent(session, auth.tenant.id, agent_id)
    from app.services.audit import record_audit

    await record_audit(
        session,
        auth.tenant.id,
        action="agent:restored",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="agent",
        resource_id=agent_id,
    )
    return result


@router.patch("/agents/{agent_id}/status")
async def patch_agent_status(
    agent_id: UUID,
    body: AgentStatusBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.update_agent_runtime_status(session, auth.tenant.id, agent_id, body.status)


@router.patch("/agents/{agent_id}/lead")
async def patch_agent_lead(
    agent_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Move the tenant's lead-agent label to this agent (owner/admin)."""
    auth.require_role("owner", "admin")
    from app.services.audit import record_audit
    from app.services.lead_agent import set_lead_agent

    agent = await set_lead_agent(session, auth.tenant.id, agent_id)
    await record_audit(
        session,
        auth.tenant.id,
        action="agent:lead_changed",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="agent",
        resource_id=agent_id,
    )
    return {"ok": True, "agent": svc.serialize_agent(agent, view="runtime")}


@router.patch("/agents/{agent_id}/model")
async def patch_agent_model(
    agent_id: UUID,
    body: AgentModelBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await svc.update_agent_model(session, auth.tenant.id, agent_id, body.model)


# --- Chat access (who may DM this company agent) ---


class ChatAccessBody(BaseModel):
    mode: str  # everyone | selected | nobody
    user_ids: list[UUID] = []


async def _company_agent_or_404(session: AsyncSession, tenant_id: UUID, agent_id: UUID):
    from fastapi import HTTPException
    from sqlalchemy import select

    from app.models.agent import Agent

    result = await session.execute(
        select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
    )
    agent = result.scalar_one_or_none()
    if not agent or agent.kind != "company":
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


async def _chat_access_payload(session: AsyncSession, tenant_id: UUID, agent) -> dict:
    from sqlalchemy import select

    from app.models.agent import AgentChatUser
    from app.models.auth import Membership, User

    selected_result = await session.execute(
        select(AgentChatUser.user_id).where(
            AgentChatUser.tenant_id == tenant_id, AgentChatUser.agent_id == agent.id
        )
    )
    selected_ids = {u for u in selected_result.scalars().all()}
    members_result = await session.execute(
        select(User, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.tenant_id == tenant_id,
            User.is_active.is_(True),
            Membership.is_active.is_(True),
        )
    )
    members = [
        {
            "id": str(user.id),
            "name": user.display_name or user.email,
            "email": user.email,
            "role": role,
            "selected": user.id in selected_ids,
        }
        for user, role in members_result.all()
    ]
    return {"agent_id": str(agent.id), "mode": agent.chat_access, "members": members}


@router.get("/agents/{agent_id}/scopes")
async def get_agent_scopes(
    agent_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Per-agent resource allowlists (project | knowledge | channel)."""
    from app.services.agent_scopes import SCOPE_KINDS, list_agent_scopes

    auth.require_role("owner", "admin")
    agent = await _company_agent_or_404(session, auth.tenant.id, agent_id)
    scopes = await list_agent_scopes(session, auth.tenant.id, agent.id)
    return {"agent_id": str(agent.id), "kinds": list(SCOPE_KINDS), "scopes": scopes}


@router.put("/agents/{agent_id}/scopes/{resource_kind}")
async def put_agent_scope(
    agent_id: UUID,
    resource_kind: str,
    body: dict,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Replace one kind's allowlist. Empty ``entries`` clears the restriction."""
    from fastapi import HTTPException

    from app.services.agent_scopes import set_agent_scope

    auth.require_role("owner", "admin")
    agent = await _company_agent_or_404(session, auth.tenant.id, agent_id)
    entries = body.get("entries") if isinstance(body, dict) else None
    if entries is not None and not isinstance(entries, list):
        raise HTTPException(status_code=400, detail="entries must be a list")
    try:
        scopes = await set_agent_scope(
            session, auth.tenant.id, agent.id, resource_kind, entries
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"agent_id": str(agent.id), "scopes": scopes}


@router.get("/agents/{agent_id}/chat-access")
async def get_agent_chat_access(
    agent_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    agent = await _company_agent_or_404(session, auth.tenant.id, agent_id)
    return await _chat_access_payload(session, auth.tenant.id, agent)


@router.patch("/agents/{agent_id}/chat-access")
async def patch_agent_chat_access(
    agent_id: UUID,
    body: ChatAccessBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from datetime import datetime

    from fastapi import HTTPException
    from sqlalchemy import delete, select

    from app.models.agent import AgentChatUser
    from app.models.auth import Membership

    auth.require_role("owner", "admin")
    if body.mode not in ("everyone", "selected", "nobody"):
        raise HTTPException(status_code=400, detail="Invalid chat access mode")
    agent = await _company_agent_or_404(session, auth.tenant.id, agent_id)
    agent.chat_access = body.mode
    agent.updated_at = datetime.utcnow()

    await session.execute(
        delete(AgentChatUser).where(
            AgentChatUser.tenant_id == auth.tenant.id, AgentChatUser.agent_id == agent.id
        )
    )
    if body.mode == "selected" and body.user_ids:
        member_result = await session.execute(
            select(Membership.user_id).where(
                Membership.tenant_id == auth.tenant.id,
                Membership.user_id.in_(body.user_ids),
            )
        )
        for user_id in member_result.scalars().all():
            session.add(
                AgentChatUser(tenant_id=auth.tenant.id, agent_id=agent.id, user_id=user_id)
            )
    await session.commit()
    return await _chat_access_payload(session, auth.tenant.id, agent)


# --- Messages / decisions ---


@router.get("/messages")
async def list_messages(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: str | None = Query(default=None),
    message_type: str | None = Query(default=None),
    channel: str | None = Query(default=None),
    thread_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
):
    items = await svc.list_messages(
        session,
        auth.tenant.id,
        status=status,
        message_type=message_type,
        channel=channel,
        thread_id=thread_id,
        project_id=project_id,
    )
    return {"items": items}


@router.post("/messages/{message_id}/approve")
async def approve_message(
    message_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await svc.resolve_message(
        session, auth.tenant.id, message_id, new_status="done", user_id=auth.user.id
    )
    return {"ok": True}


@router.post("/messages/{message_id}/defer")
async def defer_message(
    message_id: UUID,
    body: DeferBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await svc.resolve_message(
        session,
        auth.tenant.id,
        message_id,
        new_status="deferred",
        user_id=auth.user.id,
        defer_days=body.days,
    )
    return {"ok": True}


@router.post("/messages/{message_id}/reject")
async def reject_message(
    message_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await svc.resolve_message(
        session, auth.tenant.id, message_id, new_status="rejected", user_id=auth.user.id
    )
    return {"ok": True}


# --- Workforce runtime controls ---


@router.get("/workforce/config")
async def get_workforce_config(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.get_workforce_config(session, auth.tenant.id)


@router.patch("/workforce/config")
async def patch_workforce_config(
    body: WorkforceConfigPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await svc.update_workforce_config(
        session, auth.tenant.id, body.model_dump(exclude_unset=True)
    )


@router.post("/workforce/force-wake")
async def force_wake(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    body: dict[str, Any] | None = None,
):
    auth.require_role("owner", "admin")
    del body
    agents = await svc.list_runtime_agents(session, auth.tenant.id)
    manager = next((a for a in agents if a.get("role_slug") in ("manager", "orchestrator")), None)
    if manager:
        return await svc.trigger_agent(
            session,
            auth.tenant.id,
            agent_id=UUID(manager["id"]),
            instruction="Force wake from workforce dashboard",
        )
    if agents:
        return await svc.trigger_agent(
            session,
            auth.tenant.id,
            agent_id=UUID(agents[0]["id"]),
            instruction="Force wake from workforce dashboard",
        )
    raise HTTPException(status_code=409, detail="No agents to wake")


@router.post("/workforce/force-rescan")
async def force_rescan(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    body: dict[str, Any] | None = None,
):
    del body
    from app.services.triggers import process_due_triggers

    fired = await process_due_triggers(session, tenant_id=auth.tenant.id)
    return {"ok": True, "fired": fired}


@router.post("/workforce/trigger-agent")
async def post_trigger_agent(
    body: TriggerAgentBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    del body.priority, body.correlation_id
    return await svc.trigger_agent(
        session,
        auth.tenant.id,
        agent_id=_body_uuid(body.agent_id, "agent_id"),
        instruction=body.instruction,
    )


@router.post("/workforce/complete-activity")
async def post_complete_activity(
    body: CompleteActivityBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    del body.result, body.correlation_id
    return await svc.complete_activity(
        session,
        auth.tenant.id,
        activity_id=_body_uuid(body.activity_id, "activity_id"),
        outcome=body.outcome,
        summary=body.summary,
    )


class MaintenanceRunBody(BaseModel):
    max_stale_minutes: int = 15


@router.post("/workforce/maintenance-run")
async def maintenance_run(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    body: MaintenanceRunBody | None = None,
):
    max_stale_minutes = body.max_stale_minutes if body else 15
    result = await svc.clear_stale_runtime(
        session, auth.tenant.id, max_stale_minutes=max_stale_minutes
    )
    return {"ok": True, **result}
