"""Project hub service (CRUD, repo, workstreams, usage)."""

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.orchestration import QUEUE_ITEM_KINDS, AgentTask
from app.models.project import Project, ProjectAgent
from app.models.project_work import ProjectDocSection, ProjectResource
from app.models.orchestra import Workstream
from app.models.usage import UsageLedger

DEFAULT_TOKEN_BUDGET_DAILY = 100_000


def _parse_json(raw: str | None) -> Any:
    try:
        return json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def serialize_po_agent(agent: Agent | None) -> dict[str, Any] | None:
    if not agent:
        return None
    return {
        "id": str(agent.id),
        "name": agent.name,
        "slug": None,
        "role": agent.role,
        "agent_type": "orchestrator",
        "status": "active" if agent.is_active else "inactive",
    }


def _repo_config(resource: ProjectResource | None) -> dict[str, Any]:
    if not resource:
        return {}
    try:
        return json.loads(resource.config_json or "{}")
    except json.JSONDecodeError:
        return {}


def serialize_project(
    project: Project,
    po_agent: Agent | None = None,
    repo: ProjectResource | None = None,
) -> dict[str, Any]:
    """Project shape for the dashboard; repo fields derive from the repo resource."""
    config = _repo_config(repo)
    return {
        "id": str(project.id),
        "name": project.name,
        "slug": project.slug,
        "description": project.description or "",
        "autonomous_scope": project.autonomous_scope or "",
        "autonomous_mode": project.autonomous_mode,
        "active_domains": _parse_json(project.active_domains_json),
        "github_connection_id": str(repo.connection_id) if repo and repo.connection_id else None,
        "github_repo_full_name": repo.external_ref if repo else None,
        "github_default_branch": config.get("default_branch") if repo else None,
        "repo_source": "github_oauth" if repo else "none",
        "repo_connected_at": _iso(repo.created_at) if repo else None,
        "repo_index_status": (repo.sync_status or "ready") if repo else "none",
        "repo_indexed_at": _iso(repo.synced_at) if repo else None,
        "repo_index_error": repo.sync_error if repo else None,
        "po_agent_id": str(project.po_agent_id) if project.po_agent_id else None,
        "po_agent": serialize_po_agent(po_agent),
        "updated_at": _iso(project.updated_at),
        "created_at": _iso(project.created_at),
    }


async def get_repo_resource(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> ProjectResource | None:
    """The project's repo resource, if one is linked (single repo per project for now)."""
    result = await session.execute(
        select(ProjectResource)
        .where(
            ProjectResource.tenant_id == tenant_id,
            ProjectResource.project_id == project_id,
            ProjectResource.resource_type == "repo",
        )
        .order_by(ProjectResource.created_at)
        .limit(1)
    )
    return result.scalars().first()


async def get_project_row(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> tuple[Project, Agent | None]:
    result = await session.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    po_agent = None
    if project.po_agent_id:
        agent_result = await session.execute(
            select(Agent).where(Agent.id == project.po_agent_id, Agent.tenant_id == tenant_id)
        )
        po_agent = agent_result.scalar_one_or_none()
    return project, po_agent


async def get_project_detail(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    repo = await get_repo_resource(session, tenant_id, project_id)
    return serialize_project(project, po_agent, repo)


async def list_projects(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(Project).where(Project.tenant_id == tenant_id).order_by(Project.updated_at.desc())
    )
    projects = list(result.scalars().all())
    # Batch-load orchestrator agents (tenant-scoped) to avoid N+1.
    po_ids = [p.po_agent_id for p in projects if p.po_agent_id]
    agents_by_id: dict[UUID, Agent] = {}
    if po_ids:
        agents_result = await session.execute(
            select(Agent).where(Agent.id.in_(po_ids), Agent.tenant_id == tenant_id)
        )
        agents_by_id = {a.id: a for a in agents_result.scalars().all()}
    # Repo resources (batched).
    repo_by_project: dict[UUID, ProjectResource] = {}
    if projects:
        repo_result = await session.execute(
            select(ProjectResource)
            .where(
                ProjectResource.tenant_id == tenant_id,
                ProjectResource.resource_type == "repo",
                ProjectResource.project_id.in_([p.id for p in projects]),
            )
            .order_by(ProjectResource.created_at)
        )
        for resource in repo_result.scalars().all():
            repo_by_project.setdefault(resource.project_id, resource)
    # Roster chips for the projects list (batched; avoids N+1).
    roster_by_project: dict[UUID, list[dict[str, Any]]] = {}
    if projects:
        roster_result = await session.execute(
            select(ProjectAgent, Agent)
            .join(Agent, Agent.id == ProjectAgent.agent_id)
            .where(
                ProjectAgent.tenant_id == tenant_id,
                ProjectAgent.project_id.in_([p.id for p in projects]),
            )
            .order_by(ProjectAgent.created_at)
        )
        for row, agent in roster_result.all():
            roster_by_project.setdefault(row.project_id, []).append(
                {"agent_id": str(agent.id), "name": agent.name, "is_default": row.is_default}
            )
    # Queue and doc-health badges for the project cards (batched).
    open_queue_by_project: dict[UUID, int] = {}
    sections_by_project: dict[UUID, tuple[int, int]] = {}  # (total, verified-ish)
    if projects:
        project_ids = [p.id for p in projects]
        queue_result = await session.execute(
            select(AgentTask.project_id, func.count())
            .where(
                AgentTask.tenant_id == tenant_id,
                AgentTask.project_id.in_(project_ids),
                AgentTask.kind.in_(QUEUE_ITEM_KINDS),
                AgentTask.status.not_in(["completed", "rejected", "cancelled", "failed"]),
            )
            .group_by(AgentTask.project_id)
        )
        open_queue_by_project = {row[0]: row[1] for row in queue_result.all()}
        section_result = await session.execute(
            select(ProjectDocSection.project_id, ProjectDocSection.status, func.count())
            .where(
                ProjectDocSection.tenant_id == tenant_id,
                ProjectDocSection.project_id.in_(project_ids),
                ProjectDocSection.status != "deprecated",
            )
            .group_by(ProjectDocSection.project_id, ProjectDocSection.status)
        )
        for project_id, status, count in section_result.all():
            total, done = sections_by_project.get(project_id, (0, 0))
            total += count
            if status in ("implemented", "verified"):
                done += count
            sections_by_project[project_id] = (total, done)
    out = []
    for p in projects:
        item = serialize_project(
            p,
            agents_by_id.get(p.po_agent_id) if p.po_agent_id else None,
            repo_by_project.get(p.id),
        )
        item["agents"] = roster_by_project.get(p.id, [])
        item["queue_open_count"] = open_queue_by_project.get(p.id, 0)
        total, done = sections_by_project.get(p.id, (0, 0))
        item["doc_sections_total"] = total
        item["doc_sections_done"] = done
        out.append(item)
    return out


async def create_project(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    name: str,
    slug: str,
    autonomous_scope: str,
    description: str = "",
) -> dict[str, Any]:
    slug_norm = slug.strip().lower()
    existing = await session.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.slug == slug_norm)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Project slug already exists")
    now = datetime.utcnow()
    project = Project(
        tenant_id=tenant_id,
        name=name.strip(),
        slug=slug_norm,
        description=description,
        autonomous_scope=autonomous_scope.strip(),
        updated_at=now,
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return serialize_project(project)


async def patch_project(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    name: str | None = None,
    description: str | None = None,
    autonomous_scope: str | None = None,
    autonomous_mode: bool | None = None,
) -> dict[str, Any]:
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    if name is not None:
        project.name = name.strip()
    if description is not None:
        project.description = description
    if autonomous_mode is not None:
        project.autonomous_mode = autonomous_mode
    if autonomous_scope is not None:
        project.autonomous_scope = autonomous_scope.strip()
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    await session.refresh(project)
    repo = await get_repo_resource(session, tenant_id, project_id)
    return serialize_project(project, po_agent, repo)


async def delete_project(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    confirm_name: str,
) -> dict[str, bool]:
    project, _ = await get_project_row(session, tenant_id, project_id)
    if confirm_name.strip() != project.name:
        raise HTTPException(status_code=400, detail="Confirmation name does not match")
    # Detach (not delete) runnable workstreams: they may still be scheduled
    # or referenced by past runs outside the project scope.
    streams = await session.execute(
        select(Workstream).where(
            Workstream.project_id == project_id, Workstream.tenant_id == tenant_id
        )
    )
    for stream in streams.scalars().all():
        stream.project_id = None
        session.add(stream)
    # Project-owned work: queue tasks, doc sections, links, resources, docs.
    from sqlalchemy import delete as sa_delete, update as sa_update

    from app.models.project_work import ProjectDocSection, TaskDocLink
    from app.models.workspace import DocChunk, WorkspaceDoc

    section_ids = select(ProjectDocSection.id).where(ProjectDocSection.project_id == project_id)
    task_ids = select(AgentTask.id).where(AgentTask.project_id == project_id)
    await session.execute(
        sa_delete(TaskDocLink).where(
            TaskDocLink.section_id.in_(section_ids)
            | TaskDocLink.task_id.in_(task_ids)
        )
    )
    await session.execute(
        sa_delete(ProjectDocSection).where(ProjectDocSection.project_id == project_id)
    )
    # Queue tasks belong to the project and go with it; execution jobs (and
    # their run history) outlive the project with the reference detached.
    from app.models.agent import AgentRun
    from app.models.orchestration import EvalCheckpoint, TaskArtifact

    queue_task_ids = select(AgentTask.id).where(
        AgentTask.project_id == project_id,
        AgentTask.kind.in_(QUEUE_ITEM_KINDS),
    )
    await session.execute(
        sa_update(AgentRun)
        .where(AgentRun.task_id.in_(queue_task_ids))
        .values(task_id=None)
    )
    await session.execute(
        sa_delete(TaskArtifact).where(TaskArtifact.agent_task_id.in_(queue_task_ids))
    )
    await session.execute(
        sa_delete(EvalCheckpoint).where(EvalCheckpoint.agent_task_id.in_(queue_task_ids))
    )
    await session.execute(
        sa_update(AgentTask)
        .where(AgentTask.duplicate_of_id.in_(queue_task_ids))
        .values(duplicate_of_id=None)
    )
    await session.execute(
        sa_delete(AgentTask).where(
            AgentTask.project_id == project_id,
            AgentTask.kind.in_(QUEUE_ITEM_KINDS),
        )
    )
    await session.execute(
        sa_update(AgentTask)
        .where(AgentTask.project_id == project_id)
        .values(project_id=None)
    )
    await session.execute(
        sa_delete(ProjectResource).where(ProjectResource.project_id == project_id)
    )
    doc_ids = select(WorkspaceDoc.id).where(WorkspaceDoc.project_id == project_id)
    await session.execute(sa_delete(DocChunk).where(DocChunk.doc_id.in_(doc_ids)))
    await session.execute(sa_delete(WorkspaceDoc).where(WorkspaceDoc.project_id == project_id))
    await session.delete(project)
    await session.commit()
    return {"deleted": True}


async def connect_repo(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    repo_full_name: str,
    default_branch: str = "main",
    connection_id: str | None = None,
) -> dict[str, Any]:
    if not repo_full_name.strip():
        raise HTTPException(status_code=400, detail="Repository name is required")
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    now = datetime.utcnow()
    conn_uuid = UUID(connection_id) if connection_id else None
    repo = await get_repo_resource(session, tenant_id, project_id)
    if not repo:
        repo = ProjectResource(
            tenant_id=tenant_id,
            project_id=project_id,
            resource_type="repo",
            created_at=now,
        )
    repo.provider = "github"
    repo.connection_id = conn_uuid
    repo.label = repo_full_name
    repo.external_ref = repo_full_name
    repo.config_json = json.dumps({"default_branch": default_branch or "main"})
    repo.status = "connected" if conn_uuid else "linked"
    repo.sync_status = "pending"
    repo.sync_error = None
    repo.updated_at = now
    session.add(repo)
    project.updated_at = now
    session.add(project)
    await session.commit()
    await session.refresh(repo)

    # Kick off the first index immediately; status transitions to indexing/ready.
    from app.workers.tasks import enqueue_repo_index

    await enqueue_repo_index(str(tenant_id), str(project_id))
    return serialize_project(project, po_agent, repo)


async def disconnect_repo(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    # Remove indexed content so search stops returning a repo that is gone.
    from sqlalchemy import delete as sa_delete

    from app.models.workspace import DocChunk

    await session.execute(
        sa_delete(DocChunk).where(
            DocChunk.tenant_id == tenant_id,
            DocChunk.source_type == "repo_file",
            DocChunk.source_id.like(f"{project_id}:%"),
        )
    )
    repo = await get_repo_resource(session, tenant_id, project_id)
    if repo:
        await session.delete(repo)
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return serialize_project(project, po_agent, None)


async def reindex_repo(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> dict[str, bool]:
    """Queue a real index run: GitHub tree + contents into repo_file DocChunks."""
    await get_project_row(session, tenant_id, project_id)
    repo = await get_repo_resource(session, tenant_id, project_id)
    if not repo or not repo.external_ref:
        raise HTTPException(status_code=400, detail="No repository connected")
    repo.sync_status = "indexing"
    repo.sync_error = None
    repo.updated_at = datetime.utcnow()
    session.add(repo)
    await session.commit()

    from app.workers.tasks import enqueue_repo_index

    await enqueue_repo_index(str(tenant_id), str(project_id))
    return {"queued": True}


async def repo_status(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    repo = await get_repo_resource(session, tenant_id, project_id)
    return {
        "repo_index_status": (repo.sync_status or "none") if repo else "none",
        "repo_indexed_at": _iso(repo.synced_at) if repo else None,
        "repo_last_commit_sha": repo.sync_ref if repo else None,
        "repo_index_error": repo.sync_error if repo else None,
    }


async def _token_usage(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, since: datetime
) -> int:
    from app.models.agent import AgentRun

    # Usage rows link to runs via run_id; runs carry the project. Also include any
    # legacy rows that stored the project id directly in scope_id.
    result = await session.execute(
        select(func.coalesce(func.sum(UsageLedger.tokens_in + UsageLedger.tokens_out), 0))
        .select_from(UsageLedger)
        .outerjoin(AgentRun, AgentRun.id == UsageLedger.run_id)
        .where(
            UsageLedger.tenant_id == tenant_id,
            UsageLedger.created_at >= since,
            (AgentRun.project_id == project_id) | (UsageLedger.scope_id == str(project_id)),
        )
    )
    return int(result.scalar_one() or 0)


async def usage_budget(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    now = datetime.utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hour_start = now.replace(minute=0, second=0, microsecond=0)
    used_today = await _token_usage(session, tenant_id, project_id, day_start)
    used_hour = await _token_usage(session, tenant_id, project_id, hour_start)
    # Tenant spend cap (spend_guard) overrides the hardcoded default; real
    # enforcement happens in resolve_model_call, this endpoint is advisory.
    budget = DEFAULT_TOKEN_BUDGET_DAILY
    from app.models.auth import Tenant
    from app.services.spend_guard import get_spend_config

    tenant = await session.get(Tenant, tenant_id)
    if tenant:
        cap = get_spend_config(tenant)["daily_token_cap"]
        if cap:
            budget = cap
    remaining_today = max(0, budget - used_today)
    remaining_hour = max(0, min(10_000, budget) - used_hour)
    return {
        "token_budget_daily": budget,
        "token_used_today": used_today,
        "token_used_this_hour": used_hour,
        "remaining_today": remaining_today,
        "remaining_hour": remaining_hour,
        "blocked": remaining_today <= 0,
    }


def _period_bounds(period: str) -> tuple[datetime, datetime, str]:
    now = datetime.utcnow()
    days = {"7d": 7, "30d": 30, "90d": 90}.get(period, 30)
    label = period if period in ("7d", "30d", "90d") else "30d"
    start = now - timedelta(days=days)
    return start, now, label


async def usage_summary(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, period: str = "30d"
) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    start, end, label = _period_bounds(period)
    tokens = await _token_usage(session, tenant_id, project_id, start)
    budget = await usage_budget(session, tenant_id, project_id)
    return {
        "project_id": str(project_id),
        "period": {"start": start.isoformat(), "end": end.isoformat(), "label": label},
        "total_runs": 0,
        "completed_runs": 0,
        "running_runs": 0,
        "failed_runs": 0,
        "tokens_used": tokens,
        "tokens_used_today": budget["token_used_today"],
        "tokens_remaining_today": budget["remaining_today"],
        "by_day": [],
    }


async def _workstream_step_counts(
    session: AsyncSession, workstream_ids: list[UUID]
) -> dict[UUID, int]:
    from sqlalchemy import func

    from app.models.orchestra import WorkstreamStep

    if not workstream_ids:
        return {}
    result = await session.execute(
        select(WorkstreamStep.workstream_id, func.count())
        .where(WorkstreamStep.workstream_id.in_(workstream_ids))
        .group_by(WorkstreamStep.workstream_id)
    )
    return {row[0]: int(row[1]) for row in result.all()}


def serialize_workstream(row: Workstream, *, steps_count: int = 0) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "project_id": str(row.project_id) if row.project_id else None,
        "tenant_id": str(row.tenant_id),
        "name": row.name,
        "description": row.description or "",
        "enabled": row.enabled,
        "steps_count": steps_count,
        "created_at": _iso(row.created_at),
    }


async def list_workstreams(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    result = await session.execute(
        select(Workstream)
        .where(Workstream.project_id == project_id, Workstream.tenant_id == tenant_id)
        .order_by(Workstream.created_at)
    )
    rows = list(result.scalars().all())
    counts = await _workstream_step_counts(session, [w.id for w in rows])
    items = [serialize_workstream(w, steps_count=counts.get(w.id, 0)) for w in rows]
    return {"items": items, "po_agent": serialize_po_agent(po_agent)}


async def create_workstream(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    data: dict[str, Any],
) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    row = Workstream(
        tenant_id=tenant_id,
        project_id=project_id,
        name=str(data.get("name", "Workstream")).strip() or "Workstream",
        description=str(data.get("description") or "").strip(),
        enabled=bool(data.get("enabled", True)),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return serialize_workstream(row)


async def patch_workstream(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    workstream_id: UUID,
    patch: dict[str, Any],
) -> dict[str, Any]:
    result = await session.execute(
        select(Workstream).where(
            Workstream.id == workstream_id,
            Workstream.project_id == project_id,
            Workstream.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Workstream not found")
    if "name" in patch and patch["name"] is not None:
        row.name = str(patch["name"]).strip() or row.name
    if "description" in patch and patch["description"] is not None:
        row.description = str(patch["description"]).strip()
    if "enabled" in patch and patch["enabled"] is not None:
        row.enabled = bool(patch["enabled"])
    session.add(row)
    await session.commit()
    await session.refresh(row)
    counts = await _workstream_step_counts(session, [row.id])
    return serialize_workstream(row, steps_count=counts.get(row.id, 0))


async def po_agent_summary(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    return {
        "project_id": str(project.id),
        "po_agent_id": str(project.po_agent_id) if project.po_agent_id else None,
        "po_agent": serialize_po_agent(po_agent),
        "setup_complete": project.po_agent_id is not None,
    }


async def create_po_agent(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    name: str | None = None,
) -> dict[str, Any]:
    project, _ = await get_project_row(session, tenant_id, project_id)
    agent = Agent(
        tenant_id=tenant_id,
        name=name or f"{project.name} Orchestrator",
        role="orchestrator",
        slug="orchestrator",
        system_prompt=(
            f"You are the orchestrator for project {project.name}. "
            "Plan work, route agents, and keep project knowledge current.\n\n"
            "Knowledge architecture and maintenance:\n"
            "- Keep documentation logically structured; prefer editing existing docs "
            "over proliferating files. Split or create a document only when a stable "
            "new concept emerges.\n"
            "- On each queue request: run impact analysis, link affected docs with "
            "link_queue_item_to_doc (doc_id), update those docs with write_doc, then "
            "verify the docs match reality before marking work complete.\n"
            "- Use list_project_docs / list_docs / read_doc to discover scoped docs."
        ),
    )
    session.add(agent)
    await session.flush()
    project.po_agent_id = agent.id
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    await session.refresh(agent)
    return await po_agent_summary(session, tenant_id, project_id)


async def link_po_agent(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    po_agent_id: UUID,
) -> dict[str, Any]:
    project, _ = await get_project_row(session, tenant_id, project_id)
    agent_result = await session.execute(
        select(Agent).where(Agent.id == po_agent_id, Agent.tenant_id == tenant_id)
    )
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.role not in ("orchestrator", "po"):
        raise HTTPException(
            status_code=400, detail="Agent must be an orchestrator to lead a project"
        )
    project.po_agent_id = agent.id
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    summary = await po_agent_summary(session, tenant_id, project_id)
    summary["po_agent"] = serialize_po_agent(agent)
    return summary


async def unlink_po_agent(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    project, _ = await get_project_row(session, tenant_id, project_id)
    project.po_agent_id = None
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    return await po_agent_summary(session, tenant_id, project_id)


# ── project agent roster ─────────────────────────────────────────────


def _serialize_project_agent(row: ProjectAgent, agent: Agent | None) -> dict[str, Any]:
    from app.services.agent_avatar import avatar_payload

    payload: dict[str, Any] = {
        "id": str(row.id),
        "agent_id": str(row.agent_id),
        "name": agent.name if agent else "",
        "role": agent.role if agent else "",
        "is_active": bool(agent.is_active) if agent else False,
        "is_default": row.is_default,
        "created_at": _iso(row.created_at),
    }
    payload.update(avatar_payload(agent))
    return payload


async def list_project_agents(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> list[dict[str, Any]]:
    await get_project_row(session, tenant_id, project_id)
    result = await session.execute(
        select(ProjectAgent, Agent)
        .join(Agent, Agent.id == ProjectAgent.agent_id)
        .where(ProjectAgent.project_id == project_id, ProjectAgent.tenant_id == tenant_id)
        .order_by(ProjectAgent.created_at)
    )
    return [_serialize_project_agent(row, agent) for row, agent in result.all()]


async def add_project_agent(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    agent_id: UUID,
    *,
    is_default: bool = False,
) -> dict[str, Any]:
    project, _ = await get_project_row(session, tenant_id, project_id)
    agent = (
        await session.execute(
            select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not agent or agent.kind != "company":
        raise HTTPException(status_code=404, detail="Agent not found")
    existing = (
        await session.execute(
            select(ProjectAgent).where(
                ProjectAgent.project_id == project_id, ProjectAgent.agent_id == agent_id
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Agent is already on this project")
    row = ProjectAgent(
        tenant_id=tenant_id, project_id=project_id, agent_id=agent_id, is_default=is_default
    )
    if is_default:
        await _clear_project_default(session, project_id)
    session.add(row)
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    await session.refresh(row)
    return _serialize_project_agent(row, agent)


async def _clear_project_default(session: AsyncSession, project_id: UUID) -> None:
    result = await session.execute(
        select(ProjectAgent).where(
            ProjectAgent.project_id == project_id, ProjectAgent.is_default.is_(True)
        )
    )
    for other in result.scalars().all():
        other.is_default = False
        session.add(other)


async def set_project_agent_default(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    agent_id: UUID,
    *,
    is_default: bool,
) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    row = (
        await session.execute(
            select(ProjectAgent).where(
                ProjectAgent.project_id == project_id,
                ProjectAgent.agent_id == agent_id,
                ProjectAgent.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Agent is not on this project")
    if is_default:
        await _clear_project_default(session, project_id)
    row.is_default = is_default
    session.add(row)
    await session.commit()
    agent = (
        await session.execute(
            select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    return _serialize_project_agent(row, agent)


async def remove_project_agent(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, agent_id: UUID
) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    row = (
        await session.execute(
            select(ProjectAgent).where(
                ProjectAgent.project_id == project_id,
                ProjectAgent.agent_id == agent_id,
                ProjectAgent.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Agent is not on this project")
    await session.delete(row)
    await session.commit()
    return {"ok": True}


async def project_default_agent(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> Agent | None:
    """The active agent marked default on the project roster, if any."""
    result = await session.execute(
        select(Agent)
        .join(ProjectAgent, ProjectAgent.agent_id == Agent.id)
        .where(
            ProjectAgent.project_id == project_id,
            ProjectAgent.tenant_id == tenant_id,
            ProjectAgent.is_default.is_(True),
            Agent.is_active.is_(True),
        )
        .limit(1)
    )
    return result.scalars().first()
