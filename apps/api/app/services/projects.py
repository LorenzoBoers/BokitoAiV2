"""Project hub service (CRUD, repo, orchestration, workstreams, usage)."""

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.project import (
    Project,
    ProjectNotificationPreference,
    ProjectOrchestration,
    ProjectWorkstream,
)
from app.models.usage import UsageLedger

EVENT_TYPES = ("decisions", "updates", "failures", "tokens")
CHANNELS = ("desktop", "email", "mobile")
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
        "agent_type": "po" if agent.role == "po" else agent.role,
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
        agent_result = await session.execute(select(Agent).where(Agent.id == project.po_agent_id))
        po_agent = agent_result.scalar_one_or_none()
    return project, po_agent


async def list_projects(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(Project).where(Project.tenant_id == tenant_id).order_by(Project.updated_at.desc())
    )
    rows: list[dict[str, Any]] = []
    for project in result.scalars().all():
        po_agent = None
        if project.po_agent_id:
            agent_result = await session.execute(select(Agent).where(Agent.id == project.po_agent_id))
            po_agent = agent_result.scalar_one_or_none()
        rows.append(serialize_project(project, po_agent))
    return rows


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
    await session.flush()
    orch = ProjectOrchestration(tenant_id=tenant_id, project_id=project.id, updated_at=now)
    session.add(orch)
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
    prefs = await session.execute(
        select(ProjectNotificationPreference).where(ProjectNotificationPreference.project_id == project_id)
    )
    for pref in prefs.scalars().all():
        await session.delete(pref)
    orch = await session.execute(
        select(ProjectOrchestration).where(ProjectOrchestration.project_id == project_id)
    )
    for row in orch.scalars().all():
        await session.delete(row)
    streams = await session.execute(
        select(ProjectWorkstream).where(ProjectWorkstream.project_id == project_id)
    )
    for stream in streams.scalars().all():
        await session.delete(stream)
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
    return serialize_project(project, po_agent)


async def disconnect_repo(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    project, po_agent = await get_project_row(session, tenant_id, project_id)
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
    project, _ = await get_project_row(session, tenant_id, project_id)
    if not project.github_repo_full_name:
        raise HTTPException(status_code=400, detail="No repository connected")
    project.repo_index_status = "indexing"
    project.repo_index_error = None
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    project.repo_index_status = "ready"
    project.repo_indexed_at = datetime.utcnow()
    project.repo_last_commit_sha = "mock-commit-sha"
    session.add(project)
    await session.commit()
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


async def get_or_create_orchestration(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> ProjectOrchestration:
    await get_project_row(session, tenant_id, project_id)
    result = await session.execute(
        select(ProjectOrchestration).where(ProjectOrchestration.project_id == project_id)
    )
    row = result.scalar_one_or_none()
    if row:
        return row
    row = ProjectOrchestration(tenant_id=tenant_id, project_id=project_id)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


def serialize_orchestration(row: ProjectOrchestration) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "tenant_id": str(row.tenant_id),
        "project_id": str(row.project_id),
        "wake_cadence": row.wake_cadence,
        "autonomy_mode": row.autonomy_mode,
        "hitl_sensitivity": row.hitl_sensitivity,
        "continuous_enabled": row.continuous_enabled,
        "next_po_wake_at": _iso(row.next_po_wake_at),
        "last_po_wake_at": _iso(row.last_po_wake_at),
        "created_at": _iso(row.created_at) or datetime.utcnow().isoformat(),
        "updated_at": _iso(row.updated_at) or datetime.utcnow().isoformat(),
    }


async def patch_orchestration(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    patch: dict[str, Any],
) -> dict[str, Any]:
    row = await get_or_create_orchestration(session, tenant_id, project_id)
    for key in ("wake_cadence", "autonomy_mode", "hitl_sensitivity", "continuous_enabled"):
        if key in patch and patch[key] is not None:
            setattr(row, key, patch[key])
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return serialize_orchestration(row)


def _default_enabled(event_type: str, channel: str) -> bool:
    if channel == "desktop" and event_type in ("decisions", "failures"):
        return True
    if channel == "email" and event_type == "failures":
        return True
    return False


async def ensure_notification_prefs(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> list[ProjectNotificationPreference]:
    result = await session.execute(
        select(ProjectNotificationPreference).where(ProjectNotificationPreference.project_id == project_id)
    )
    rows = list(result.scalars().all())
    if rows:
        return rows
    created: list[ProjectNotificationPreference] = []
    for event_type in EVENT_TYPES:
        for channel in CHANNELS:
            pref = ProjectNotificationPreference(
                tenant_id=tenant_id,
                project_id=project_id,
                event_type=event_type,
                channel=channel,
                enabled=_default_enabled(event_type, channel),
            )
            session.add(pref)
            created.append(pref)
    await session.commit()
    for pref in created:
        await session.refresh(pref)
    return created


async def notification_prefs_response(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    rows = await ensure_notification_prefs(session, tenant_id, project_id)
    return {
        "project_id": str(project_id),
        "preferences": [
            {
                "event_type": r.event_type,
                "channel": r.channel,
                "enabled": r.enabled,
            }
            for r in rows
        ],
    }


async def patch_notification_prefs(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    preferences: list[dict[str, Any]],
) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    rows = await ensure_notification_prefs(session, tenant_id, project_id)
    by_key = {(r.event_type, r.channel): r for r in rows}
    for item in preferences:
        key = (item.get("event_type"), item.get("channel"))
        row = by_key.get(key)
        if row and "enabled" in item:
            row.enabled = bool(item["enabled"])
            session.add(row)
    await session.commit()
    return await notification_prefs_response(session, tenant_id, project_id)


async def _token_usage(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, since: datetime
) -> int:
    result = await session.execute(
        select(func.coalesce(func.sum(UsageLedger.tokens_in + UsageLedger.tokens_out), 0)).where(
            UsageLedger.tenant_id == tenant_id,
            UsageLedger.scope_id == str(project_id),
            UsageLedger.created_at >= since,
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
    budget = DEFAULT_TOKEN_BUDGET_DAILY
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


def serialize_workstream(row: ProjectWorkstream) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "project_id": str(row.project_id),
        "tenant_id": str(row.tenant_id),
        "name": row.name,
        "slug": row.slug,
        "status": row.status,
        "trigger_text": row.trigger_text,
        "output_text": row.output_text,
        "steps": _parse_json(row.steps_json),
        "position": row.position,
        "last_active_at": _iso(row.last_active_at),
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


async def list_workstreams(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    result = await session.execute(
        select(ProjectWorkstream)
        .where(ProjectWorkstream.project_id == project_id, ProjectWorkstream.tenant_id == tenant_id)
        .order_by(ProjectWorkstream.position, ProjectWorkstream.created_at)
    )
    items = [serialize_workstream(w) for w in result.scalars().all()]
    return {"items": items, "po_agent": serialize_po_agent(po_agent)}


async def create_workstream(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    data: dict[str, Any],
) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    slug = str(data.get("slug", "")).strip().lower()
    row = ProjectWorkstream(
        tenant_id=tenant_id,
        project_id=project_id,
        name=str(data.get("name", "Workstream")).strip(),
        slug=slug or "workstream",
        status=data.get("status") or "draft",
        trigger_text=data.get("trigger_text"),
        output_text=data.get("output_text"),
        steps_json=json.dumps(data.get("steps") or []),
        position=int(data.get("position") or 0),
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
        select(ProjectWorkstream).where(
            ProjectWorkstream.id == workstream_id,
            ProjectWorkstream.project_id == project_id,
            ProjectWorkstream.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Workstream not found")
    for key in ("name", "slug", "status", "trigger_text", "output_text", "position"):
        if key in patch and patch[key] is not None:
            setattr(row, key, patch[key])
    if "steps" in patch and patch["steps"] is not None:
        row.steps_json = json.dumps(patch["steps"])
    if "last_active_at" in patch:
        row.last_active_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return serialize_workstream(row)


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
        name=name or f"{project.name} PO",
        role="po",
        system_prompt=f"You are the product owner for project {project.name}.",
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
