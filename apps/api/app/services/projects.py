"""Project hub service (CRUD, repo, workstreams, usage)."""

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.project import Project, ProjectAgent
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


def serialize_project(project: Project, po_agent: Agent | None = None) -> dict[str, Any]:
    return {
        "id": str(project.id),
        "name": project.name,
        "slug": project.slug,
        "description": project.description or "",
        "autonomous_scope": project.autonomous_scope or "",
        "autonomous_mode": project.autonomous_mode,
        "active_domains": _parse_json(project.active_domains_json),
        "github_connection_id": str(project.github_connection_id) if project.github_connection_id else None,
        "repo_binding_id": str(project.repo_binding_id) if project.repo_binding_id else None,
        "github_repo_full_name": project.github_repo_full_name,
        "github_default_branch": project.github_default_branch,
        "repo_source": project.repo_source or ("github_oauth" if project.github_repo_full_name else "none"),
        "repo_connected_at": _iso(project.repo_connected_at),
        "repo_index_status": project.repo_index_status or ("none" if not project.github_repo_full_name else "ready"),
        "repo_indexed_at": _iso(project.repo_indexed_at),
        "repo_index_error": project.repo_index_error,
        "po_agent_id": str(project.po_agent_id) if project.po_agent_id else None,
        "po_agent": serialize_po_agent(po_agent),
        "updated_at": _iso(project.updated_at),
        "created_at": _iso(project.created_at),
    }


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
    out = []
    for p in projects:
        item = serialize_project(p, agents_by_id.get(p.po_agent_id) if p.po_agent_id else None)
        item["agents"] = roster_by_project.get(p.id, [])
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
) -> dict[str, Any]:
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    if name is not None:
        project.name = name.strip()
    if description is not None:
        project.description = description
    if autonomous_scope is not None:
        project.autonomous_scope = autonomous_scope.strip()
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return serialize_project(project, po_agent)


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
    project.github_repo_full_name = repo_full_name
    project.github_default_branch = default_branch or "main"
    project.github_connection_id = conn_uuid
    project.repo_binding_id = conn_uuid
    project.repo_source = "github_oauth"
    project.repo_connected_at = now
    project.repo_index_status = "pending"
    project.repo_index_error = None
    project.updated_at = now
    session.add(project)
    await session.commit()
    await session.refresh(project)

    # Kick off the first index immediately; status transitions to indexing/ready.
    from app.workers.tasks import enqueue_repo_index

    await enqueue_repo_index(str(tenant_id), str(project_id))
    return serialize_project(project, po_agent)


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
    project.github_repo_full_name = None
    project.github_default_branch = None
    project.github_connection_id = None
    project.repo_binding_id = None
    project.repo_source = "none"
    project.repo_connected_at = None
    project.repo_index_status = "none"
    project.repo_indexed_at = None
    project.repo_index_error = None
    project.repo_last_commit_sha = None
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return serialize_project(project, po_agent)


async def reindex_repo(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> dict[str, bool]:
    """Queue a real index run: GitHub tree + contents into repo_file DocChunks."""
    project, _ = await get_project_row(session, tenant_id, project_id)
    if not project.github_repo_full_name:
        raise HTTPException(status_code=400, detail="No repository connected")
    project.repo_index_status = "indexing"
    project.repo_index_error = None
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()

    from app.workers.tasks import enqueue_repo_index

    await enqueue_repo_index(str(tenant_id), str(project_id))
    return {"queued": True}


async def repo_status(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> dict[str, Any]:
    project, _ = await get_project_row(session, tenant_id, project_id)
    status = project.repo_index_status or "none"
    return {
        "repo_index_status": status,
        "repo_indexed_at": _iso(project.repo_indexed_at),
        "repo_last_commit_sha": project.repo_last_commit_sha,
        "repo_index_error": project.repo_index_error,
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
        system_prompt=f"You are the orchestrator for project {project.name}. Plan work, route agents, and keep project knowledge current.",
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
    return {
        "id": str(row.id),
        "agent_id": str(row.agent_id),
        "name": agent.name if agent else "",
        "role": agent.role if agent else "",
        "is_active": bool(agent.is_active) if agent else False,
        "is_default": row.is_default,
        "created_at": _iso(row.created_at),
    }


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
