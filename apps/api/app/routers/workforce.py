"""Workforce API router (agents, work logs, messages, runtime controls)."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import workforce_runtime as svc
from app.services.os_graph import (
    build_canvas_graph,
    build_project_graph,
    build_workspace_graph,
    create_canvas_edge,
    create_canvas_node,
    delete_canvas_edge,
    delete_canvas_node,
    patch_canvas_node,
)

router = APIRouter(prefix="/workforce", tags=["workforce"])


class AgentStatusBody(BaseModel):
    status: str


class AgentModelBody(BaseModel):
    model: str


class AgentCreateBody(BaseModel):
    name: str
    role: str = "assistant"
    system_prompt: str = ""
    model: str = ""
    chat_access: str = "everyone"


class AgentUpdateBody(BaseModel):
    name: str | None = None
    system_prompt: str | None = None


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


class OsNodeCreateBody(BaseModel):
    node_type: str
    ref_id: str
    x: float = 200.0
    y: float = 200.0
    label: str | None = None


class OsNodePatchBody(BaseModel):
    x: float | None = None
    y: float | None = None
    label: str | None = None


class OsEdgeCreateBody(BaseModel):
    source_node_id: str
    target_node_id: str
    relation: str


# --- AI OS graph ---


@router.get("/os/graph")
async def os_workspace_graph(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await build_canvas_graph(session, auth.tenant.id)


@router.get("/os/graph/legacy")
async def os_workspace_graph_legacy(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await build_workspace_graph(session, auth.tenant.id)


@router.post("/os/nodes")
async def os_create_node(
    body: OsNodeCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await create_canvas_node(
        session,
        auth.tenant.id,
        node_type=body.node_type,
        ref_id=UUID(body.ref_id),
        x=body.x,
        y=body.y,
        label=body.label,
    )


@router.patch("/os/nodes/{node_id}")
async def os_patch_node(
    node_id: UUID,
    body: OsNodePatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await patch_canvas_node(
        session,
        auth.tenant.id,
        node_id,
        x=body.x,
        y=body.y,
        label=body.label,
    )


@router.delete("/os/nodes/{node_id}")
async def os_delete_node(
    node_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await delete_canvas_node(session, auth.tenant.id, node_id)
    return {"ok": True}


@router.post("/os/edges")
async def os_create_edge(
    body: OsEdgeCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await create_canvas_edge(
        session,
        auth.tenant.id,
        source_node_id=UUID(body.source_node_id),
        target_node_id=UUID(body.target_node_id),
        relation=body.relation,
    )


@router.delete("/os/edges/{edge_id}")
async def os_delete_edge(
    edge_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await delete_canvas_edge(session, auth.tenant.id, edge_id)
    return {"ok": True}


@router.get("/os/graph/{project_id}")
async def os_project_graph(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.projects import get_project_row

    await get_project_row(session, auth.tenant.id, project_id)
    return await build_project_graph(session, auth.tenant.id, project_id)


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
):
    items = await svc.list_runtime_agents(session, auth.tenant.id)
    return {"items": items}


@router.post("/agents")
async def create_agent(
    body: AgentCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await svc.create_agent(
        session,
        auth.tenant.id,
        name=body.name,
        role=body.role,
        system_prompt=body.system_prompt,
        model_slug=body.model,
        chat_access=body.chat_access,
    )


@router.patch("/agents/{agent_id}")
async def update_agent(
    agent_id: UUID,
    body: AgentUpdateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await svc.update_agent(
        session,
        auth.tenant.id,
        agent_id,
        name=body.name,
        system_prompt=body.system_prompt,
    )


@router.get("/timeline")
async def timeline(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    items = await svc.list_timeline(session, auth.tenant.id)
    return {"items": items}


@router.patch("/agents/{agent_id}/status")
async def patch_agent_status(
    agent_id: UUID,
    body: AgentStatusBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.update_agent_runtime_status(session, auth.tenant.id, agent_id, body.status)


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
        .where(Membership.tenant_id == tenant_id, User.is_active.is_(True))
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
    del body
    await svc.resolve_message(
        session, auth.tenant.id, message_id, new_status="deferred", user_id=auth.user.id
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
):
    return svc.default_workforce_config(auth.tenant.id)


@router.patch("/workforce/config")
async def patch_workforce_config(
    body: WorkforceConfigPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    config = svc.default_workforce_config(auth.tenant.id)
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            config[key] = value
    return config


@router.get("/workforce/status")
async def workforce_status(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    pipeline_id: int | None = Query(default=None),
):
    del pipeline_id
    return await svc.get_workforce_status(session, auth.tenant.id)


@router.post("/workforce/force-wake")
async def force_wake(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    body: dict[str, Any] | None = None,
):
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
    return {"ok": True}


@router.post("/workforce/force-rescan")
async def force_rescan():
    return {"ok": True, "trigger_id": 1}


@router.post("/workforce/pause")
async def pause_workforce(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    agents = await svc.list_runtime_agents(session, auth.tenant.id)
    manager = next((a for a in agents if a.get("role_slug") in ("manager", "orchestrator")), None)
    if manager:
        await svc.update_agent_runtime_status(session, auth.tenant.id, UUID(manager["id"]), "standby")
    return {"ok": True}


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
        agent_id=UUID(body.agent_id),
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
        activity_id=UUID(body.activity_id),
        outcome=body.outcome,
        summary=body.summary,
    )


@router.post("/workforce/maintenance-run")
async def maintenance_run():
    return {"ok": True, "stale_cleared": 0}
