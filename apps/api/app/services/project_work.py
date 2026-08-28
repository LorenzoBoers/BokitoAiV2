"""Conversation-driven project work: queue lifecycle, smart-doc sections, links.

Flow: a conversation (or user/agent) produces a `ProjectQueueItem`; accepting it
wakes the project agent, which compares the request against the project's
documentation, links the item to the doc sections it touches, and drives
section statuses (open -> planned -> in_progress -> implemented -> verified).
Every status transition is audited; items born from a thread echo progress
back into that thread as SignalEvents.
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

from app.models.project_work import (
    DOC_SECTION_STATUSES,
    PROJECT_RESOURCE_STATUSES,
    PROJECT_RESOURCE_TYPES,
    QUEUE_ITEM_KINDS,
    QUEUE_ITEM_PRIORITIES,
    QUEUE_ITEM_STATUSES,
    QUEUE_LINK_RELATIONS,
    ProjectDocSection,
    ProjectQueueItem,
    ProjectResource,
    QueueItemDocLink,
)
from app.models.signal import SignalEvent
from app.models.workspace import WorkspaceDoc

# Legal queue-item transitions; "rejected" is reachable from any non-terminal state.
QUEUE_TRANSITIONS: dict[str, set[str]] = {
    "proposed": {"accepted", "rejected"},
    "accepted": {"analyzing", "planned", "rejected"},
    "analyzing": {"planned", "accepted", "rejected"},
    "planned": {"in_progress", "analyzing", "rejected"},
    "in_progress": {"verifying", "planned", "rejected"},
    "verifying": {"done", "in_progress"},
    "done": set(),
    "rejected": {"proposed"},
}


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


# ── serialization ────────────────────────────────────────────────


def serialize_queue_item(
    item: ProjectQueueItem,
    *,
    links: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    try:
        metadata = json.loads(item.metadata_json or "{}")
    except json.JSONDecodeError:
        metadata = {}
    return {
        "id": str(item.id),
        "project_id": str(item.project_id),
        "kind": item.kind,
        "title": item.title,
        "body": item.body,
        "priority": item.priority,
        "status": item.status,
        "duplicate_of_id": str(item.duplicate_of_id) if item.duplicate_of_id else None,
        "origin_type": item.origin_type,
        "signal_id": str(item.signal_id) if item.signal_id else None,
        "message_id": str(item.message_id) if item.message_id else None,
        "created_by_type": item.created_by_type,
        "created_by_id": item.created_by_id,
        "impact_summary": item.impact_summary,
        "analyzed_at": _iso(item.analyzed_at),
        "assigned_agent_id": str(item.assigned_agent_id) if item.assigned_agent_id else None,
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
) -> ProjectQueueItem:
    item = (
        await session.execute(
            select(ProjectQueueItem).where(
                ProjectQueueItem.id == item_id, ProjectQueueItem.tenant_id == tenant_id
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
        select(QueueItemDocLink, ProjectDocSection)
        .join(ProjectDocSection, ProjectDocSection.id == QueueItemDocLink.section_id)
        .where(
            QueueItemDocLink.tenant_id == tenant_id,
            QueueItemDocLink.queue_item_id.in_(item_ids),
        )
        .order_by(QueueItemDocLink.created_at)
    )
    out: dict[UUID, list[dict[str, Any]]] = {}
    for link, section in result.all():
        out.setdefault(link.queue_item_id, []).append(
            {
                "id": str(link.id),
                "section_id": str(section.id),
                "doc_id": str(section.doc_id),
                "anchor": section.anchor,
                "heading": section.heading,
                "section_status": section.status,
                "relation": link.relation,
                "created_by_type": link.created_by_type,
                "created_at": _iso(link.created_at),
            }
        )
    return out


async def list_queue_items(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    status: str | None = None,
    kind: str | None = None,
) -> list[dict[str, Any]]:
    stmt = select(ProjectQueueItem).where(
        ProjectQueueItem.tenant_id == tenant_id,
        ProjectQueueItem.project_id == project_id,
    )
    if status:
        stmt = stmt.where(ProjectQueueItem.status == status)
    if kind:
        stmt = stmt.where(ProjectQueueItem.kind == kind)
    stmt = stmt.order_by(ProjectQueueItem.created_at.desc())
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
) -> ProjectQueueItem:
    """Create a queue item; auto-accepts and starts analysis on autonomous projects."""
    if kind not in QUEUE_ITEM_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid queue item kind: {kind}")
    if priority not in QUEUE_ITEM_PRIORITIES:
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
    item = ProjectQueueItem(
        tenant_id=tenant_id,
        project_id=project_id,
        kind=kind,
        title=title.strip(),
        body=body,
        priority=priority,
        origin_type=origin_type,
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
            "accepted",
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
) -> ProjectQueueItem:
    """Validated status transition + audit + thread echo + analysis kickoff."""
    if status not in QUEUE_ITEM_STATUSES:
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
    if item.signal_id and status in ("accepted", "done", "rejected"):
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

    if status == "accepted":
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
) -> ProjectQueueItem:
    item = await get_queue_item(session, tenant_id, item_id)
    if title is not None and title.strip():
        item.title = title.strip()
    if body is not None:
        item.body = body
    if kind is not None:
        if kind not in QUEUE_ITEM_KINDS:
            raise HTTPException(status_code=400, detail=f"Invalid queue item kind: {kind}")
        item.kind = kind
    if priority is not None:
        if priority not in QUEUE_ITEM_PRIORITIES:
            raise HTTPException(status_code=400, detail=f"Invalid priority: {priority}")
        item.priority = priority
    if assigned_agent_id is not None:
        item.assigned_agent_id = assigned_agent_id
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
) -> QueueItemDocLink:
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
            select(QueueItemDocLink).where(
                QueueItemDocLink.queue_item_id == item_id,
                QueueItemDocLink.section_id == section_id,
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
    link = QueueItemDocLink(
        tenant_id=tenant_id,
        queue_item_id=item_id,
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
        delete(QueueItemDocLink).where(
            QueueItemDocLink.tenant_id == tenant_id,
            QueueItemDocLink.queue_item_id == item_id,
            QueueItemDocLink.section_id == section_id,
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
    """section_id -> linked queue items (current and historical)."""
    if not section_ids:
        return {}
    result = await session.execute(
        select(QueueItemDocLink, ProjectQueueItem)
        .join(ProjectQueueItem, ProjectQueueItem.id == QueueItemDocLink.queue_item_id)
        .where(
            QueueItemDocLink.tenant_id == tenant_id,
            QueueItemDocLink.section_id.in_(section_ids),
        )
        .order_by(QueueItemDocLink.created_at.desc())
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
        active = [i for i in open_items if i["status"] not in ("done", "rejected")]
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
                + ", ".join(f"{l['title']} [{l['status']}]" for l in linked[:5])
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
    active = [i for i in open_items if i["status"] not in ("done", "rejected")]
    if active:
        lines.append("\n## Other active queue items (check for duplicates)")
        for i in active[:20]:
            lines.append(f"- {i['id']} [{i['status']}] ({i['kind']}) {i['title']}")
    return "\n".join(lines)


ANALYSIS_INSTRUCTIONS = (
    "You are analyzing a project queue item against the project documentation.\n"
    "1. Read the queue item and the documentation sections below.\n"
    "2. Decide which sections this request touches or modifies. Use "
    "link_queue_item_to_doc for each (relation: implements | modifies | touches).\n"
    "3. If the documentation needs a new or changed section to describe this "
    "request, update the project doc with write_doc (add a `## heading` per "
    "capability and a short acceptance checklist), then link the new section.\n"
    "4. Set touched sections to 'planned' with set_doc_section_status.\n"
    "5. If this duplicates an existing queue item, say so and mark it via "
    "update_queue_item_status with status 'rejected' and mention the duplicate.\n"
    "6. Finish with update_queue_item_status to 'planned' and include a concise "
    "impact summary of what this touches and why."
)

VERIFY_INSTRUCTIONS = (
    "You are verifying that reality matches the documentation for a queue item.\n"
    "1. Re-read the linked doc sections and their acceptance checklists.\n"
    "2. Use the available context (search_repo when a repo is connected, "
    "search_index, thread history) to check each checklist point.\n"
    "3. If everything matches: set the linked sections to 'implemented' (or "
    "'verified' when you have direct evidence) with set_doc_section_status and "
    "move the item to 'done' with update_queue_item_status.\n"
    "4. If something does not match: describe the gap, update the doc if the "
    "doc is wrong, and move the item back to 'in_progress' with your findings."
)


async def start_queue_item_analysis(
    session: AsyncSession, tenant_id: UUID, item: ProjectQueueItem
) -> dict[str, Any] | None:
    """Wake the project agent: analyze the item against the project docs."""
    agent = await resolve_project_agent(session, tenant_id, item.project_id)
    if agent is None:
        return None
    await transition_queue_item(
        session,
        tenant_id,
        item.id,
        "analyzing",
        actor_type="system",
        actor_id="queue_analysis",
    )
    context = await _project_work_context(session, tenant_id, item.project_id)
    description = (
        f"{ANALYSIS_INSTRUCTIONS}\n\n"
        f"## Queue item\n"
        f"- id: {item.id}\n- kind: {item.kind}\n- priority: {item.priority}\n"
        f"- title: {item.title}\n\n{item.body}\n\n{context}"
    )
    from app.services.orchestration.dispatcher import create_agent_task

    task = await create_agent_task(
        session,
        tenant_id,
        title=f"Analyze queue item: {item.title}"[:200],
        description=description,
        project_id=item.project_id,
        agent_id=agent.id,
        trigger_type="queue_item",
        trigger_id=str(item.id),
        signal_id=item.signal_id,
        auto_start=True,
    )
    return {"task_id": str(task.id)}


async def start_queue_item_verification(
    session: AsyncSession, tenant_id: UUID, item_id: UUID
) -> dict[str, Any] | None:
    """Wake the project agent: verify reality matches the linked doc sections."""
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
        f"- section_id={l['section_id']} [{l['section_status']}] {l['heading']} ({l['relation']})"
        for l in links.get(item.id, [])
    ) or "(no linked sections — link them first or verify against the docs)"
    description = (
        f"{VERIFY_INSTRUCTIONS}\n\n"
        f"## Queue item\n"
        f"- id: {item.id}\n- title: {item.title}\n\n{item.body}\n\n"
        f"## Linked sections\n{linked_txt}\n\n{context}"
    )
    from app.services.orchestration.dispatcher import create_agent_task

    task = await create_agent_task(
        session,
        tenant_id,
        title=f"Verify queue item: {item.title}"[:200],
        description=description,
        project_id=item.project_id,
        agent_id=agent.id,
        trigger_type="queue_item_verify",
        trigger_id=str(item.id),
        signal_id=item.signal_id,
        auto_start=True,
    )
    return {"task_id": str(task.id)}
