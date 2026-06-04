"""Project hub router (dashboard workforce contract)."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import projects as svc

router = APIRouter(prefix="/workforce/projects", tags=["projects"])


class ProjectCreateBody(BaseModel):
    name: str
    slug: str
    autonomous_scope: str
    description: str = ""


class ProjectPatchBody(BaseModel):
    name: str | None = None
    description: str | None = None
    autonomous_scope: str | None = None


class ProjectDeleteBody(BaseModel):
    confirm_name: str


class RepoConnectBody(BaseModel):
    repo_full_name: str | None = None
    github_repo_full_name: str | None = None
    default_branch: str | None = None
    github_default_branch: str | None = None
    connection_id: str | None = None
    github_connection_id: str | None = None


class OrchestrationPatchBody(BaseModel):
    wake_cadence: str | None = None
    autonomy_mode: str | None = None
    hitl_sensitivity: str | None = None
    continuous_enabled: bool | None = None


class NotificationPrefItem(BaseModel):
    event_type: str
    channel: str
    enabled: bool


class NotificationPrefsPatchBody(BaseModel):
    preferences: list[NotificationPrefItem]


class WorkstreamCreateBody(BaseModel):
    name: str
    slug: str
    status: str | None = None
    trigger_text: str | None = None
    output_text: str | None = None
    steps: list[dict[str, Any]] | None = None
    position: int | None = None


class WorkstreamPatchBody(BaseModel):
    name: str | None = None
    slug: str | None = None
    status: str | None = None
    trigger_text: str | None = None
    output_text: str | None = None
    steps: list[dict[str, Any]] | None = None
    position: int | None = None
    last_active_at: str | None = None


class PoAgentCreateBody(BaseModel):
    name: str | None = None


class PoAgentLinkBody(BaseModel):
    po_agent_id: str


@router.get("")
async def list_projects(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_projects(session, auth.tenant.id)


@router.post("")
async def create_project(
    body: ProjectCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.create_project(
        session,
        auth.tenant.id,
        name=body.name,
        slug=body.slug,
        autonomous_scope=body.autonomous_scope,
        description=body.description,
    )


@router.get("/{project_id}")
async def get_project(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    project, po_agent = await svc.get_project_row(session, auth.tenant.id, project_id)
    return svc.serialize_project(project, po_agent)


@router.patch("/{project_id}")
async def patch_project(
    project_id: UUID,
    body: ProjectPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.patch_project(
        session,
        auth.tenant.id,
        project_id,
        name=body.name,
        description=body.description,
        autonomous_scope=body.autonomous_scope,
    )


@router.delete("/{project_id}")
async def delete_project(
    project_id: UUID,
    body: ProjectDeleteBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.delete_project(session, auth.tenant.id, project_id, body.confirm_name)


@router.patch("/{project_id}/repo")
async def connect_repo(
    project_id: UUID,
    body: RepoConnectBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    repo = body.github_repo_full_name or body.repo_full_name
    branch = body.github_default_branch or body.default_branch or "main"
    conn = body.github_connection_id or body.connection_id
    return await svc.connect_repo(
        session,
        auth.tenant.id,
        project_id,
        repo_full_name=repo or "",
        default_branch=branch,
        connection_id=conn,
    )


@router.delete("/{project_id}/repo")
async def disconnect_repo(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.disconnect_repo(session, auth.tenant.id, project_id)


@router.post("/{project_id}/repo/reindex")
async def reindex_repo(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.reindex_repo(session, auth.tenant.id, project_id)


@router.get("/{project_id}/repo/status")
async def repo_status(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.repo_status(session, auth.tenant.id, project_id)


@router.get("/{project_id}/orchestration")
async def get_orchestration(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    row = await svc.get_or_create_orchestration(session, auth.tenant.id, project_id)
    return svc.serialize_orchestration(row)


@router.patch("/{project_id}/orchestration")
async def patch_orchestration(
    project_id: UUID,
    body: OrchestrationPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.patch_orchestration(
        session,
        auth.tenant.id,
        project_id,
        body.model_dump(exclude_unset=True),
    )


@router.get("/{project_id}/notifications/preferences")
async def get_notification_prefs(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.notification_prefs_response(session, auth.tenant.id, project_id)


@router.patch("/{project_id}/notifications/preferences")
async def patch_notification_prefs(
    project_id: UUID,
    body: NotificationPrefsPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.patch_notification_prefs(
        session,
        auth.tenant.id,
        project_id,
        [p.model_dump() for p in body.preferences],
    )


@router.get("/{project_id}/usage/budget")
async def usage_budget(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.usage_budget(session, auth.tenant.id, project_id)


@router.get("/{project_id}/usage/summary")
async def usage_summary(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    period: str = Query(default="30d"),
):
    return await svc.usage_summary(session, auth.tenant.id, project_id, period)


@router.get("/{project_id}/workstreams")
async def list_workstreams(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_workstreams(session, auth.tenant.id, project_id)


@router.post("/{project_id}/workstreams")
async def create_workstream(
    project_id: UUID,
    body: WorkstreamCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.create_workstream(session, auth.tenant.id, project_id, body.model_dump())


@router.patch("/{project_id}/workstreams/{workstream_id}")
async def patch_workstream(
    project_id: UUID,
    workstream_id: UUID,
    body: WorkstreamPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.patch_workstream(
        session,
        auth.tenant.id,
        project_id,
        workstream_id,
        body.model_dump(exclude_unset=True),
    )


@router.get("/{project_id}/po-agent")
async def get_po_agent(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.po_agent_summary(session, auth.tenant.id, project_id)


@router.post("/{project_id}/po-agent")
async def create_po_agent(
    project_id: UUID,
    body: PoAgentCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.create_po_agent(session, auth.tenant.id, project_id, body.name)


@router.patch("/{project_id}/po-agent")
async def link_po_agent(
    project_id: UUID,
    body: PoAgentLinkBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.link_po_agent(session, auth.tenant.id, project_id, UUID(body.po_agent_id))


@router.delete("/{project_id}/po-agent")
async def unlink_po_agent(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.unlink_po_agent(session, auth.tenant.id, project_id)
