"""Conversation-driven project work: queue lifecycle, smart-doc sections, links.

Flow: a conversation (or user/agent) produces a queue task (a workflow-kind
row on the unified `AgentTask` ledger); accepting it wakes the project agent
on that same task, which compares the request against the project's
documentation, links the task to the doc sections it touches (`TaskDocLink`),
and drives section statuses (open -> planned -> in_progress -> implemented ->
verified). Every status transition is audited; tasks born from a thread echo
progress back into that thread as SignalEvents.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import (
    QUEUE_ITEM_KINDS,
    TASK_PRIORITIES,
    TASK_STATUSES,
    AgentTask,
)
from app.models.project_work import (
    DOC_SECTION_STATUSES,
    PROJECT_RESOURCE_STATUSES,
    PROJECT_RESOURCE_TYPES,
    QUEUE_LINK_RELATIONS,
    ProjectDocSection,
    ProjectResource,
    TaskDocLink,
)
from app.models.signal import SignalEvent
from app.models.workspace import WorkspaceDoc

# Legal workflow transitions on the unified status machine; "rejected" is
# reachable from any non-terminal state. "running" doubles as the execution
# status while an agent segment is live, so agent tools may finish a run by
# moving running -> planned/verifying/completed directly.
QUEUE_TRANSITIONS: dict[str, set[str]] = {
    "proposed": {"queued", "rejected"},
    "queued": {"analyzing", "planned", "rejected"},
    "analyzing": {"planned", "queued", "rejected"},
    "planned": {"running", "analyzing", "rejected"},
    "running": {"verifying", "planned", "completed", "rejected"},
    "verifying": {"completed", "running"},
    "completed": set(),
    "rejected": {"proposed"},
}

# Terminal / inactive workflow statuses (queue lists usually exclude these).
QUEUE_INACTIVE_STATUSES = ("completed", "rejected", "cancelled", "failed")


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


# ── serialization ────────────────────────────────────────────────


def serialize_queue_item(
    item: AgentTask,
    *,
    links: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    try:
        metadata = json.loads(item.metadata_json or "{}")
    except json.JSONDecodeError:
        metadata = {}
    return {
        "id": str(item.id),
        "project_id": str(item.project_id) if item.project_id else None,
        "kind": item.kind,
        "title": item.title,
        "body": item.description,
        "priority": item.priority,
        "status": item.status,
        "duplicate_of_id": str(item.duplicate_of_id) if item.duplicate_of_id else None,
        "origin_type": item.origin,
        "signal_id": str(item.signal_id) if item.signal_id else None,
        "message_id": str(item.message_id) if item.message_id else None,
        "created_by_type": item.created_by_type,
        "created_by_id": item.created_by_id,
        "impact_summary": item.impact_summary,
        "analyzed_at": _iso(item.analyzed_at),
        "assigned_agent_id": str(item.assignee_agent_id) if item.assignee_agent_id else None,
        "assignee_kind": item.assignee_kind,
        "assignee_user_id": str(item.assignee_user_id) if item.assignee_user_id else None,
        "metadata": metadata,
        "links": links or [],
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }


def serialize_section(section: ProjectDocSection) -> dict[str, Any]:
    return {
        "id": str(section.id),
        "doc_id": str(section.doc_id),
        "project_id": str(section.project_id),
        "anchor": section.anchor,
        "heading": section.heading,
        "position": section.position,
        "status": section.status,
        "status_changed_at": _iso(section.status_changed_at),
        "status_changed_by_type": section.status_changed_by_type,
        "summary": section.summary,
        "updated_at": _iso(section.updated_at),
    }


def serialize_resource(resource: ProjectResource) -> dict[str, Any]:
    try:
        config = json.loads(resource.config_json or "{}")
    except json.JSONDecodeError:
        config = {}
    return {
        "id": str(resource.id),
        "project_id": str(resource.project_id),
        "resource_type": resource.resource_type,
        "provider": resource.provider,
        "connection_id": str(resource.connection_id) if resource.connection_id else None,
        "label": resource.label,
        "external_ref": resource.external_ref,
        "config": config,
        "status": resource.status,
        "sync_status": resource.sync_status,
        "synced_at": _iso(resource.synced_at),
        "sync_error": resource.sync_error,
        "sync_ref": resource.sync_ref,
        "created_at": _iso(resource.created_at),
        "updated_at": _iso(resource.updated_at),
    }


# ── doc section sync ─────────────────────────────────────────────

_HEADING_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)


def _anchor_from(heading: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")
    return slug[:120] or "section"


def extract_headings(content: str) -> list[str]:
    """Ordered `##` headings; the smart-doc section grain."""
    return [match.group(1).strip() for match in _HEADING_RE.finditer(content or "")]


async def sync_doc_sections(session: AsyncSession, doc: WorkspaceDoc) -> list[ProjectDocSection]:
    """Align section rows with the doc's `##` headings.

    Anchors are heading slugs, so a section keeps its status and links across
    saves as long as the heading survives. Sections whose heading disappeared
    are marked deprecated (not deleted) to preserve queue-item link history.
    """
    if not doc.project_id:
        return []
    existing = (
        await session.execute(
            select(ProjectDocSection).where(ProjectDocSection.doc_id == doc.id)
        )
    ).scalars().all()
    by_anchor = {section.anchor: section for section in existing}
    now = datetime.utcnow()

    seen: set[str] = set()
    out: list[ProjectDocSection] = []
    for position, heading in enumerate(extract_headings(doc.content)):
        anchor = _anchor_from(heading)
        if anchor in seen:
            continue  # duplicate headings collapse into the first section
        seen.add(anchor)
        section = by_anchor.get(anchor)
        if section:
            changed = section.heading != heading or section.position != position
            section.heading = heading
            section.position = position
            if section.status == "deprecated":
                # Heading came back: reopen instead of resurrecting old status.
                section.status = "open"
                section.status_changed_at = now
                section.status_changed_by_type = "system"
                changed = True
            if changed:
                section.updated_at = now
            session.add(section)
        else:
            section = ProjectDocSection(
                tenant_id=doc.tenant_id,
                project_id=doc.project_id,
                doc_id=doc.id,
                anchor=anchor,
                heading=heading,
                position=position,
                status="open",
                updated_at=now,
            )
            session.add(section)
        out.append(section)

    for section in existing:
        if section.anchor not in seen and section.status != "deprecated":
            section.status = "deprecated"
            section.status_changed_at = now
            section.status_changed_by_type = "system"
            section.updated_at = now
            session.add(section)

    await session.flush()
    return out


async def section_status_by_heading(session: AsyncSession, doc: WorkspaceDoc) -> dict[str, str]:
    """heading -> status map for chunk metadata (RAG knows planned vs implemented)."""
    rows = (
        await session.execute(
            select(ProjectDocSection).where(ProjectDocSection.doc_id == doc.id)
        )
    ).scalars().all()
    return {section.heading: section.status for section in rows}


async def list_doc_sections(
    session: AsyncSession, tenant_id: UUID, doc_id: UUID
) -> list[ProjectDocSection]:
    result = await session.execute(
        select(ProjectDocSection)
        .where(ProjectDocSection.tenant_id == tenant_id, ProjectDocSection.doc_id == doc_id)
        .order_by(ProjectDocSection.position)
    )
    return list(result.scalars().all())


async def set_section_status(
    session: AsyncSession,
    tenant_id: UUID,
    section_id: UUID,
    status: str,
    *,
    actor_type: str = "user",
    actor_id: str = "",
    summary: str | None = None,
    commit: bool = True,
) -> ProjectDocSection:
    if status not in DOC_SECTION_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid section status: {status}")
    section = (
        await session.execute(
            select(ProjectDocSection).where(
                ProjectDocSection.id == section_id, ProjectDocSection.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=404, detail="Doc section not found")
    previous = section.status
    section.status = status
    section.status_changed_at = datetime.utcnow()
    section.status_changed_by_type = actor_type
    section.status_changed_by_id = actor_id
    if summary is not None:
        section.summary = summary
    section.updated_at = datetime.utcnow()
    session.add(section)

    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action="project_doc_section:status",
        actor_type=actor_type,
        actor_id=actor_id,
        resource_type="project_doc_section",
        resource_id=str(section.id),
        summary=f"Section '{section.heading}' {previous} -> {status}",
        before={"status": previous},
        after={"status": status},
        commit=False,
    )
    # Keep chunk metadata (planned vs implemented) in sync for RAG consumers.
    doc = (
        await session.execute(select(WorkspaceDoc).where(WorkspaceDoc.id == section.doc_id))
    ).scalar_one_or_none()
    if doc is not None:
        from app.services.workspace import reindex_doc

        await reindex_doc(session, doc)
    if commit:
        await session.commit()
        await session.refresh(section)
    return section


# ── queue items ──────────────────────────────────────────────────


async def get_queue_item(
    session: AsyncSession, tenant_id: UUID, item_id: UUID
) -> AgentTask:
    item = (
        await session.execute(
            select(AgentTask).where(
                AgentTask.id == item_id, AgentTask.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found")
    return item


async def _links_for_items(
    session: AsyncSession, tenant_id: UUID, item_ids: list[UUID]
) -> dict[UUID, list[dict[str, Any]]]:
    if not item_ids:
        return {}
    result = await session.execute(
        select(TaskDocLink, ProjectDocSection, WorkspaceDoc)
        .outerjoin(ProjectDocSection, ProjectDocSection.id == TaskDocLink.section_id)
        .outerjoin(WorkspaceDoc, WorkspaceDoc.id == TaskDocLink.doc_id)
        .where(
            TaskDocLink.tenant_id == tenant_id,
            TaskDocLink.task_id.in_(item_ids),
        )
        .order_by(TaskDocLink.created_at)
    )
    out: dict[UUID, list[dict[str, Any]]] = {}
    for link, section, doc in result.all():
        doc_id = link.doc_id or (section.doc_id if section else None)
        out.setdefault(link.task_id, []).append(
            {
                "id": str(link.id),
                "section_id": str(section.id) if section else None,
                "doc_id": str(doc_id) if doc_id else None,
                "doc_title": (doc.title if doc else None)
                or (section.heading if section else None),
                "anchor": section.anchor if section else None,
                "heading": section.heading if section else None,
                "section_status": section.status if section else None,
                "relation": link.relation,
                "created_by_type": link.created_by_type,
                "created_at": _iso(link.created_at),
            }
        )
    return out


ACTIVE_LINKED_REQUEST_STATUSES = frozenset(
    {
        "proposed",
        "queued",
        "analyzing",
        "planned",
        "running",
        "verifying",
        "paused",
        "awaiting_human",
    }
)


async def active_requests_for_docs(
    session: AsyncSession, tenant_id: UUID, doc_ids: list[UUID]
) -> dict[UUID, list[dict[str, Any]]]:
    """doc_id -> active linked queue requests (status lives on the task only)."""
    if not doc_ids:
        return {}
    result = await session.execute(
        select(TaskDocLink, AgentTask)
        .join(AgentTask, AgentTask.id == TaskDocLink.task_id)
        .where(
            TaskDocLink.tenant_id == tenant_id,
            TaskDocLink.doc_id.in_(doc_ids),
            AgentTask.status.in_(tuple(ACTIVE_LINKED_REQUEST_STATUSES)),
        )
        .order_by(TaskDocLink.created_at.desc())
    )
    out: dict[UUID, list[dict[str, Any]]] = {}
    seen: dict[UUID, set[UUID]] = {}
    for link, item in result.all():
        if link.doc_id is None:
            continue
        seen.setdefault(link.doc_id, set())
        if item.id in seen[link.doc_id]:
            continue
        seen[link.doc_id].add(item.id)
        out.setdefault(link.doc_id, []).append(
            {
                "id": str(item.id),
                "title": item.title,
                "status": item.status,
                "kind": item.kind,
                "project_id": str(item.project_id) if item.project_id else None,
                "relation": link.relation,
            }
        )
    return out


async def link_item_to_doc(
    session: AsyncSession,
    tenant_id: UUID,
    item_id: UUID,
    doc_id: UUID,
    *,
    relation: str = "touches",
    created_by_type: str = "agent",
    created_by_id: str = "",
    commit: bool = True,
) -> TaskDocLink:
    """Document-level queue ↔ knowledge link (preferred over section links)."""
    if relation not in QUEUE_LINK_RELATIONS:
        raise HTTPException(status_code=400, detail=f"Invalid link relation: {relation}")
    item = await get_queue_item(session, tenant_id, item_id)
    doc = (
        await session.execute(
            select(WorkspaceDoc).where(
                WorkspaceDoc.id == doc_id, WorkspaceDoc.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.project_id and item.project_id and doc.project_id != item.project_id:
        raise HTTPException(status_code=400, detail="Document belongs to another project")
    existing = (
        await session.execute(
            select(TaskDocLink).where(
                TaskDocLink.task_id == item_id,
                TaskDocLink.doc_id == doc_id,
                TaskDocLink.section_id.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.relation = relation
        session.add(existing)
        if commit:
            await session.commit()
            await session.refresh(existing)
        return existing
    link = TaskDocLink(
        tenant_id=tenant_id,
        task_id=item_id,
        doc_id=doc_id,
        section_id=None,
        relation=relation,
        created_by_type=created_by_type,
        created_by_id=created_by_id,
    )
    session.add(link)
    if commit:
        await session.commit()
        await session.refresh(link)
    else:
        await session.flush()
    return link


# ── queue items ──────────────────────────────────────────────────


async def list_queue_items(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    status: str | None = None,
    kind: str | None = None,
) -> list[dict[str, Any]]:
    stmt = select(AgentTask).where(
        AgentTask.tenant_id == tenant_id,
        AgentTask.project_id == project_id,
        AgentTask.kind.in_(QUEUE_ITEM_KINDS),
    )
    if status:
        stmt = stmt.where(AgentTask.status == status)
    if kind:
        stmt = stmt.where(AgentTask.kind == kind)
    stmt = stmt.order_by(AgentTask.created_at.desc())
    items = list((await session.execute(stmt)).scalars().all())
    links = await _links_for_items(session, tenant_id, [item.id for item in items])
    return [serialize_queue_item(item, links=links.get(item.id, [])) for item in items]


async def get_queue_item_detail(
    session: AsyncSession, tenant_id: UUID, item_id: UUID
) -> dict[str, Any]:
    item = await get_queue_item(session, tenant_id, item_id)
    links = await _links_for_items(session, tenant_id, [item.id])
    return serialize_queue_item(item, links=links.get(item.id, []))


async def create_queue_item(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    kind: str = "task",
    title: str,
    body: str = "",
    priority: str = "normal",
    origin_type: str = "user",
    signal_id: UUID | None = None,
    message_id: UUID | None = None,
    created_by_type: str = "user",
    created_by_id: str = "",
    commit: bool = True,
) -> AgentTask:
    """Create a queue task; auto-accepts and starts analysis on autonomous projects."""
    if kind not in QUEUE_ITEM_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid queue item kind: {kind}")
    if priority not in TASK_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority: {priority}")
    if not title.strip():
        raise HTTPException(status_code=400, detail="Title is required")

    from app.models.project import Project

    project = (
        await session.execute(
            select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    now = datetime.utcnow()
    item = AgentTask(
        tenant_id=tenant_id,
        project_id=project_id,
        kind=kind,
        title=title.strip(),
        description=body,
        priority=priority,
        status="proposed",
        origin=origin_type,
        trigger_type="queue_item",
        signal_id=signal_id,
        message_id=message_id,
        created_by_type=created_by_type,
        created_by_id=created_by_id,
        created_at=now,
        updated_at=now,
    )
    session.add(item)
    await session.flush()

    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action="queue_item:create",
        actor_type=created_by_type,
        actor_id=created_by_id,
        resource_type="queue_item",
        resource_id=str(item.id),
        summary=f"Queue item '{item.title}' ({kind}) created for project {project.name}",
        payload={"origin_type": origin_type, "signal_id": str(signal_id) if signal_id else None},
        commit=False,
    )
    if signal_id:
        session.add(
            SignalEvent(
                signal_id=signal_id,
                tenant_id=tenant_id,
                event_type="queue_item_created",
                actor_type=created_by_type,
                actor_id=created_by_id,
                payload_json=json.dumps(
                    {
                        "queue_item_id": str(item.id),
                        "project_id": str(project_id),
                        "title": item.title,
                        "kind": kind,
                    }
                ),
            )
        )

    auto = bool(project.autonomous_mode)
    if commit:
        await session.commit()
        await session.refresh(item)
    if auto:
        # Autonomous projects skip the human accept gate and analyze directly.
        await transition_queue_item(
            session,
            tenant_id,
            item.id,
            "queued",
            actor_type="system",
            actor_id="autonomous_mode",
        )
    return item


async def transition_queue_item(
    session: AsyncSession,
    tenant_id: UUID,
    item_id: UUID,
    status: str,
    *,
    actor_type: str = "user",
    actor_id: str = "",
    impact_summary: str | None = None,
    duplicate_of_id: UUID | None = None,
    commit: bool = True,
) -> AgentTask:
    """Validated status transition + audit + thread echo + analysis kickoff."""
    if status not in TASK_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid queue item status: {status}")
    item = await get_queue_item(session, tenant_id, item_id)
    previous = item.status
    if status == previous:
        return item
    if status not in QUEUE_TRANSITIONS.get(previous, set()):
        raise HTTPException(
            status_code=400, detail=f"Cannot move queue item from {previous} to {status}"
        )
    now = datetime.utcnow()
    item.status = status
    item.updated_at = now
    if status == "completed":
        item.completed_at = now
    if impact_summary is not None:
        item.impact_summary = impact_summary
        item.analyzed_at = now
    if duplicate_of_id is not None:
        item.duplicate_of_id = duplicate_of_id
    session.add(item)

    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action="queue_item:status",
        actor_type=actor_type,
        actor_id=actor_id,
        resource_type="queue_item",
        resource_id=str(item.id),
        summary=f"Queue item '{item.title}' {previous} -> {status}",
        before={"status": previous},
        after={"status": status},
        commit=False,
    )
    if item.signal_id and status in ("queued", "completed", "rejected"):
        session.add(
            SignalEvent(
                signal_id=item.signal_id,
                tenant_id=tenant_id,
                event_type="queue_item_status",
                actor_type=actor_type,
                actor_id=actor_id,
                payload_json=json.dumps(
                    {"queue_item_id": str(item.id), "from": previous, "to": status}
                ),
            )
        )
    if commit:
        await session.commit()
        await session.refresh(item)
    else:
        await session.flush()

    if status == "queued":
        # Acceptance wakes the project agent for doc impact analysis.
        await start_queue_item_analysis(session, tenant_id, item)
    return item


async def update_queue_item(
    session: AsyncSession,
    tenant_id: UUID,
    item_id: UUID,
    *,
    title: str | None = None,
    body: str | None = None,
    kind: str | None = None,
    priority: str | None = None,
    assigned_agent_id: UUID | None = None,
) -> AgentTask:
    item = await get_queue_item(session, tenant_id, item_id)
    if title is not None and title.strip():
        item.title = title.strip()
    if body is not None:
        item.description = body
    if kind is not None:
        if kind not in QUEUE_ITEM_KINDS:
            raise HTTPException(status_code=400, detail=f"Invalid queue item kind: {kind}")
        item.kind = kind
    if priority is not None:
        if priority not in TASK_PRIORITIES:
            raise HTTPException(status_code=400, detail=f"Invalid priority: {priority}")
        item.priority = priority
    if assigned_agent_id is not None:
        item.assignee_agent_id = assigned_agent_id
    item.updated_at = datetime.utcnow()
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


# ── links ────────────────────────────────────────────────────────


async def link_item_to_section(
    session: AsyncSession,
    tenant_id: UUID,
    item_id: UUID,
    section_id: UUID,
    *,
    relation: str = "touches",
    created_by_type: str = "agent",
    created_by_id: str = "",
    commit: bool = True,
) -> TaskDocLink:
    if relation not in QUEUE_LINK_RELATIONS:
        raise HTTPException(status_code=400, detail=f"Invalid link relation: {relation}")
    item = await get_queue_item(session, tenant_id, item_id)
    section = (
        await session.execute(
            select(ProjectDocSection).where(
                ProjectDocSection.id == section_id, ProjectDocSection.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=404, detail="Doc section not found")
    if section.project_id != item.project_id:
        raise HTTPException(status_code=400, detail="Section belongs to another project")
    existing = (
        await session.execute(
            select(TaskDocLink).where(
                TaskDocLink.task_id == item_id,
                TaskDocLink.section_id == section_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.relation = relation
        if existing.doc_id is None:
            existing.doc_id = section.doc_id
        session.add(existing)
        if commit:
            await session.commit()
            await session.refresh(existing)
        return existing
    link = TaskDocLink(
        tenant_id=tenant_id,
        task_id=item_id,
        doc_id=section.doc_id,
        section_id=section_id,
        relation=relation,
        created_by_type=created_by_type,
        created_by_id=created_by_id,
    )
    session.add(link)
    if commit:
        await session.commit()
        await session.refresh(link)
    else:
        await session.flush()
    return link


async def unlink_item_section(
    session: AsyncSession, tenant_id: UUID, item_id: UUID, section_id: UUID
) -> None:
    await session.execute(
        delete(TaskDocLink).where(
            TaskDocLink.tenant_id == tenant_id,
            TaskDocLink.task_id == item_id,
            TaskDocLink.section_id == section_id,
        )
    )
    await session.commit()


async def sections_for_project(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> list[ProjectDocSection]:
    result = await session.execute(
        select(ProjectDocSection)
        .where(
            ProjectDocSection.tenant_id == tenant_id,
            ProjectDocSection.project_id == project_id,
        )
        .order_by(ProjectDocSection.doc_id, ProjectDocSection.position)
    )
    return list(result.scalars().all())


async def links_for_sections(
    session: AsyncSession, tenant_id: UUID, section_ids: list[UUID]
) -> dict[UUID, list[dict[str, Any]]]:
    """section_id -> linked queue tasks (current and historical)."""
    if not section_ids:
        return {}
    result = await session.execute(
        select(TaskDocLink, AgentTask)
        .join(AgentTask, AgentTask.id == TaskDocLink.task_id)
        .where(
            TaskDocLink.tenant_id == tenant_id,
            TaskDocLink.section_id.in_(section_ids),
        )
        .order_by(TaskDocLink.created_at.desc())
    )
    out: dict[UUID, list[dict[str, Any]]] = {}
    for link, item in result.all():
        out.setdefault(link.section_id, []).append(
            {
                "queue_item_id": str(item.id),
                "title": item.title,
                "kind": item.kind,
                "status": item.status,
                "relation": link.relation,
                "created_at": _iso(link.created_at),
            }
        )
    return out


# ── project resources ────────────────────────────────────────────


async def list_resources(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> list[dict[str, Any]]:
    result = await session.execute(
        select(ProjectResource)
        .where(
            ProjectResource.tenant_id == tenant_id,
            ProjectResource.project_id == project_id,
        )
        .order_by(ProjectResource.created_at)
    )
    return [serialize_resource(r) for r in result.scalars().all()]


async def create_resource(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    resource_type: str,
    provider: str = "",
    label: str = "",
    external_ref: str = "",
    config: dict[str, Any] | None = None,
    connection_id: UUID | None = None,
    created_by_type: str = "user",
    created_by_id: str = "",
) -> dict[str, Any]:
    if resource_type not in PROJECT_RESOURCE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid resource type: {resource_type}")
    resource = ProjectResource(
        tenant_id=tenant_id,
        project_id=project_id,
        resource_type=resource_type,
        provider=provider,
        connection_id=connection_id,
        label=label or external_ref,
        external_ref=external_ref,
        config_json=json.dumps(config or {}),
        status="connected" if connection_id else "linked",
    )
    session.add(resource)

    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action="project_resource:create",
        actor_type=created_by_type,
        actor_id=created_by_id,
        resource_type="project_resource",
        resource_id=str(resource.id),
        summary=f"Linked {resource_type} resource '{resource.label}' to project",
        commit=False,
    )
    await session.commit()
    await session.refresh(resource)
    return serialize_resource(resource)


async def patch_resource(
    session: AsyncSession,
    tenant_id: UUID,
    resource_id: UUID,
    *,
    label: str | None = None,
    external_ref: str | None = None,
    config: dict[str, Any] | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    resource = (
        await session.execute(
            select(ProjectResource).where(
                ProjectResource.id == resource_id, ProjectResource.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    if label is not None:
        resource.label = label
    if external_ref is not None:
        resource.external_ref = external_ref
    if config is not None:
        resource.config_json = json.dumps(config)
    if status is not None:
        if status not in PROJECT_RESOURCE_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid resource status: {status}")
        resource.status = status
    resource.updated_at = datetime.utcnow()
    session.add(resource)
    await session.commit()
    await session.refresh(resource)
    return serialize_resource(resource)


async def delete_resource(session: AsyncSession, tenant_id: UUID, resource_id: UUID) -> None:
    resource = (
        await session.execute(
            select(ProjectResource).where(
                ProjectResource.id == resource_id, ProjectResource.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    await session.delete(resource)
    await session.commit()


async def conversation_project_context(
    session: AsyncSession, tenant_id: UUID, signal: Any | None
) -> str:
    """Project snapshot for inbound prompts: enables opportunity detection.

    When the thread belongs to a project the agent gets that project's queue
    state; otherwise a compact project list so it can route a detected
    opportunity or bug to the right queue via create_queue_item.
    """
    from app.models.project import Project

    projects = list(
        (
            await session.execute(
                select(Project)
                .where(Project.tenant_id == tenant_id)
                .order_by(Project.updated_at.desc())
                .limit(10)
            )
        ).scalars().all()
    )
    if not projects:
        return ""
    lines: list[str] = ["Project opportunity detection:"]
    thread_project = None
    if signal is not None and getattr(signal, "project_id", None):
        thread_project = next((p for p in projects if p.id == signal.project_id), None)
    if thread_project:
        open_items = await list_queue_items(session, tenant_id, thread_project.id)
        active = [i for i in open_items if i["status"] not in QUEUE_INACTIVE_STATUSES]
        lines.append(
            f"- This thread belongs to project '{thread_project.name}' "
            f"(slug: {thread_project.slug}); {len(active)} active queue item(s)."
        )
        if active:
            for i in active[:8]:
                lines.append(f"  - [{i['status']}] ({i['kind']}) {i['title']}")
    else:
        lines.append("- Tenant projects: " + ", ".join(f"{p.name} (slug: {p.slug})" for p in projects))
    lines.append(
        "- When the conversation reveals a bug, feature request, or actionable "
        "idea for a project, call create_queue_item (kind: feature|bug|task|"
        "idea|risk) with a clear title and context. Check the active items "
        "first to avoid duplicates. Under 'ask' policy this becomes a proposal "
        "card for the human — prefer proposing over ignoring an opportunity."
    )
    return "\n".join(lines)


# ── agent flows: analysis and verification ───────────────────────


async def resolve_project_agent(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> Any | None:
    """Roster default -> project PO -> tenant lead agent."""
    from app.services.lead_agent import get_lead_agent
    from app.services.projects import get_project_row, project_default_agent

    agent = await project_default_agent(session, tenant_id, project_id)
    if agent:
        return agent
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    if po_agent and po_agent.is_active:
        return po_agent
    return await get_lead_agent(session, tenant_id)


async def _project_work_context(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> str:
    """Docs + sections + statuses + linked items + resources for the agent prompt."""
    from app.services.workspace import list_docs

    docs = await list_docs(session, tenant_id, project_id=project_id)
    sections = await sections_for_project(session, tenant_id, project_id)
    links = await links_for_sections(session, tenant_id, [s.id for s in sections])
    sections_by_doc: dict[UUID, list[ProjectDocSection]] = {}
    for section in sections:
        sections_by_doc.setdefault(section.doc_id, []).append(section)

    lines: list[str] = ["## Project documentation (sections with status)"]
    if not docs:
        lines.append("(no project docs yet — create one with write_doc)")
    for doc in docs:
        lines.append(f"### {doc.title} (path: {doc.path}, doc_id: {doc.id})")
        for section in sections_by_doc.get(doc.id, []):
            linked = links.get(section.id, [])
            linked_txt = (
                " | linked items: "
                + ", ".join(f"{link['title']} [{link['status']}]" for link in linked[:5])
                if linked
                else ""
            )
            lines.append(
                f"- section_id={section.id} [{section.status}] {section.heading}{linked_txt}"
            )

    resources = await list_resources(session, tenant_id, project_id)
    if resources:
        lines.append("\n## Project resources")
        for r in resources:
            lines.append(
                f"- {r['resource_type']} ({r['provider'] or 'unlinked'}): "
                f"{r['external_ref'] or r['label']} [{r['status']}]"
            )

    open_items = await list_queue_items(session, tenant_id, project_id)
    active = [i for i in open_items if i["status"] not in QUEUE_INACTIVE_STATUSES]
    if active:
        lines.append("\n## Other active queue items (check for duplicates)")
        for i in active[:20]:
            lines.append(f"- {i['id']} [{i['status']}] ({i['kind']}) {i['title']}")
    return "\n".join(lines)


ANALYSIS_INSTRUCTIONS = (
    "You are analyzing a project queue task against the project documentation.\n"
    "Capability: Knowledge architecture and maintenance — keep documents logically "
    "structured; split or create a document only when a stable new concept emerges; "
    "prefer editing existing docs over proliferating files.\n"
    "1. Read the queue task and the documentation below.\n"
    "2. Impact analysis: decide which documents this request touches or modifies. "
    "Use link_queue_item_to_doc with doc_id for each "
    "(relation: implements | modifies | touches | documents).\n"
    "3. If documentation must change, update those docs with write_doc "
    "(keep structure clear; new `##` headings only when needed).\n"
    "4. Optionally set touched section statuses with set_doc_section_status.\n"
    "5. If this duplicates an existing queue task, say so and mark it via "
    "update_queue_item_status with status 'rejected' and mention the duplicate.\n"
    "6. Before finishing, verify the linked docs match the intended reality of "
    "this request, then update_queue_item_status to 'planned' with a concise "
    "impact summary of what this touches and why."
)

VERIFY_INSTRUCTIONS = (
    "You are verifying that reality matches the documentation for a queue task.\n"
    "1. Re-read the linked doc sections and their acceptance checklists.\n"
    "2. Use the available context (search_repo when a repo is connected, "
    "search_index, thread history) to check each checklist point.\n"
    "3. If everything matches: set the linked sections to 'implemented' (or "
    "'verified' when you have direct evidence) with set_doc_section_status and "
    "move the task to 'completed' with update_queue_item_status.\n"
    "4. If something does not match: describe the gap, update the doc if the "
    "doc is wrong, and move the task back to 'planned' with your findings."
)


async def _wake_task_agent(
    session: AsyncSession,
    tenant_id: UUID,
    item: AgentTask,
    agent: Any,
    *,
    instructions: str,
    fallback_status: str,
) -> dict[str, Any]:
    """Run an agent segment against the queue task itself (one ledger row).

    The instructions live in `context_json` so the task description stays the
    original request. `workflow=True` tells the runner to respect statuses the
    agent sets via tools instead of force-completing the task.
    """
    try:
        ctx = json.loads(item.context_json or "{}")
        if not isinstance(ctx, dict):
            ctx = {}
    except json.JSONDecodeError:
        ctx = {}
    ctx["instructions"] = instructions
    ctx["agent_id"] = str(agent.id)
    ctx["workflow"] = True
    ctx["workflow_fallback_status"] = fallback_status
    item.context_json = json.dumps(ctx)
    item.assignee_agent_id = agent.id
    item.updated_at = datetime.utcnow()
    session.add(item)
    await session.commit()

    from app.services.orchestration.queue import enqueue_agent_task_segment

    if not await enqueue_agent_task_segment(str(tenant_id), str(item.id)):
        from app.services.orchestration.runner import run_agent_task_segment

        await run_agent_task_segment(session, tenant_id, item.id)
    return {"task_id": str(item.id)}


async def start_queue_item_analysis(
    session: AsyncSession, tenant_id: UUID, item: AgentTask
) -> dict[str, Any] | None:
    """Wake the project agent on this task: analyze it against the project docs."""
    agent = await resolve_project_agent(session, tenant_id, item.project_id)
    if agent is None:
        return None
    item = await transition_queue_item(
        session,
        tenant_id,
        item.id,
        "analyzing",
        actor_type="system",
        actor_id="queue_analysis",
    )
    context = await _project_work_context(session, tenant_id, item.project_id)
    instructions = (
        f"{ANALYSIS_INSTRUCTIONS}\n\n"
        f"## Queue task\n"
        f"- id: {item.id}\n- kind: {item.kind}\n- priority: {item.priority}\n"
        f"- title: {item.title}\n\n{item.description}\n\n{context}"
    )
    return await _wake_task_agent(
        session, tenant_id, item, agent, instructions=instructions, fallback_status="planned"
    )


async def start_queue_item_verification(
    session: AsyncSession, tenant_id: UUID, item_id: UUID
) -> dict[str, Any] | None:
    """Wake the project agent on this task: verify reality matches the docs."""
    item = await get_queue_item(session, tenant_id, item_id)
    if item.status != "verifying":
        item = await transition_queue_item(
            session,
            tenant_id,
            item_id,
            "verifying",
            actor_type="system",
            actor_id="queue_verification",
        )
    agent = await resolve_project_agent(session, tenant_id, item.project_id)
    if agent is None:
        return None
    context = await _project_work_context(session, tenant_id, item.project_id)
    links = await _links_for_items(session, tenant_id, [item.id])
    linked_txt = "\n".join(
        f"- section_id={link['section_id']} [{link['section_status']}] {link['heading']} ({link['relation']})"
        for link in links.get(item.id, [])
    ) or "(no linked sections — link them first or verify against the docs)"
    instructions = (
        f"{VERIFY_INSTRUCTIONS}\n\n"
        f"## Queue task\n"
        f"- id: {item.id}\n- title: {item.title}\n\n{item.description}\n\n"
        f"## Linked sections\n{linked_txt}\n\n{context}"
    )
    return await _wake_task_agent(
        session, tenant_id, item, agent, instructions=instructions, fallback_status="verifying"
    )
