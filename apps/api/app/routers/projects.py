"""Folders router (``/api/folders``).

Operators and integrators know this object as a Folder (NL: Map); the
internal model and table are still ``Project`` / ``projects``. Includes the
conversation-driven work surface: the implementation queue, folder docs with
section statuses, and generic folder resources.
"""

import json
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import project_work as work
from app.services import projects as svc

router = APIRouter(prefix="/folders", tags=["folders"])


async def _count_scope(session: AsyncSession, auth: AuthContext) -> dict[str, Any]:
    """Folder counts use the caller's Communication hub, like the rail."""
    from app.services.channel_access import visible_channel_account_ids

    user_id = auth.user.id if auth.user else None
    visible = (
        await visible_channel_account_ids(session, auth.tenant.id, user_id=user_id, role=auth.role)
        if user_id
        else None
    )
    return {"user_id": user_id, "visible_account_ids": visible}


class ProjectCreateBody(BaseModel):
    name: str = ""
    slug: str = ""
    autonomous_scope: str = ""
    description: str = ""
    tag_ids: list[UUID] = []
    tags: list[str] = []
    parent_id: UUID | None = None
    sort_order: int = 0


class ProjectPatchBody(BaseModel):
    name: str | None = None
    description: str | None = None
    autonomous_scope: str | None = None
    tag_ids: list[UUID] | None = None
    tags: list[str] | None = None
    parent_id: UUID | None = None
    sort_order: int | None = None


class NestFolderBody(BaseModel):
    """``onto_folder_id`` null unnests to the root."""

    onto_folder_id: UUID | None = None


class ProjectDeleteBody(BaseModel):
    confirm_name: str


@router.get("")
async def list_projects(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_projects(session, auth.tenant.id, **await _count_scope(session, auth))


@router.post("")
async def create_project(
    body: ProjectCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create a named folder. Optional labels (tags) define membership; optional
    parent_id places it in the free tree."""
    return await svc.create_project(
        session,
        auth.tenant.id,
        name=body.name,
        slug=body.slug,
        autonomous_scope=body.autonomous_scope,
        description=body.description,
        tag_ids=body.tag_ids or None,
        tags=body.tags or None,
        parent_id=body.parent_id,
        sort_order=body.sort_order,
        user_id=auth.user.id if auth.user else None,
    )


@router.post("/{project_id}/nest")
async def nest_folder(
    project_id: UUID,
    body: NestFolderBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Move this folder under another (or to root when onto_folder_id is null)."""
    return await svc.nest_folder(
        session,
        auth.tenant.id,
        project_id,
        body.onto_folder_id,
        user_id=auth.user.id if auth.user else None,
    )


@router.get("/{project_id}/board")
async def folder_board(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """The folder's flows, stacked, each with its stages and the tickets inside the folder (subtree)."""
    from app.models.project import Project
    from app.services import tickets

    project = await session.get(Project, project_id)
    if project is None or project.tenant_id != auth.tenant.id:
        raise HTTPException(status_code=404, detail="Folder not found")
    return {"playbooks": await tickets.project_board(session, auth.tenant.id, project_id)}


@router.get("/{project_id}/files")
async def folder_files(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = Query(100, ge=1, le=300),
):
    """Attachments on conversations that match this folder filterset."""
    from sqlalchemy import select

    from app.models.signal import Signal, SignalMessage
    from app.services.communication_nav import list_predicates

    predicates = await list_predicates(session, auth.tenant.id, {"project_id": project_id})
    if predicates is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    rows = (
        await session.execute(
            select(SignalMessage, Signal)
            .join(Signal, Signal.id == SignalMessage.signal_id)
            .where(
                Signal.tenant_id == auth.tenant.id,
                Signal.deleted_at.is_(None),
                SignalMessage.attachments_json != "[]",
                *predicates,
            )
            .order_by(SignalMessage.created_at.desc())
            .limit(limit)
        )
    ).all()
    files: list[dict[str, Any]] = []
    for message, signal in rows:
        try:
            attachments = json.loads(message.attachments_json or "[]")
        except (TypeError, json.JSONDecodeError):
            attachments = []
        if not isinstance(attachments, list):
            continue
        for item in attachments:
            if not isinstance(item, dict):
                continue
            files.append(
                {
                    "name": str(item.get("name") or item.get("filename") or "file"),
                    "url": item.get("url") or item.get("href"),
                    "content_type": item.get("content_type") or item.get("type") or "",
                    "signal_id": str(signal.id),
                    "subject": signal.subject,
                    "created_at": message.created_at.isoformat() if message.created_at else None,
                }
            )
    return {"files": files}


@router.get("/{project_id}")
async def get_project(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.get_project_detail(
        session, auth.tenant.id, project_id, **await _count_scope(session, auth)
    )


@router.patch("/{project_id}")
async def patch_project(
    project_id: UUID,
    body: ProjectPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    extras = body.model_dump(exclude_unset=True)
    return await svc.patch_project(
        session,
        auth.tenant.id,
        project_id,
        name=body.name,
        description=body.description,
        autonomous_scope=body.autonomous_scope,
        tag_ids=extras["tag_ids"] if "tag_ids" in extras else ...,
        tags=extras["tags"] if "tags" in extras else ...,
        parent_id=extras["parent_id"] if "parent_id" in extras else ...,
        sort_order=body.sort_order,
        user_id=auth.user.id if auth.user else None,
    )


@router.delete("/{project_id}")
async def delete_project(
    project_id: UUID,
    body: ProjectDeleteBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.delete_project(
        session,
        auth.tenant.id,
        project_id,
        body.confirm_name,
        user_id=auth.user.id if auth.user else None,
    )


# ── implementation queue ─────────────────────────────────────────────


class QueueItemCreateBody(BaseModel):
    title: str
    kind: str = "task"
    body: str = ""
    priority: str = "normal"
    # Link the queue task to the thread it originated from ("Add to project"
    # from any conversation); the project is the explicit path parameter.
    signal_id: UUID | None = None


class QueueItemPatchBody(BaseModel):
    title: str | None = None
    body: str | None = None
    kind: str | None = None
    priority: str | None = None
    status: str | None = None
    assigned_agent_id: str | None = None
    impact_summary: str | None = None


@router.get("/{project_id}/queue")
async def list_queue_items(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: str | None = Query(None),
    kind: str | None = Query(None),
):
    """Implementation requests (features, bugs, tasks) for one project."""
    await svc.get_project_row(session, auth.tenant.id, project_id)
    items = await work.list_queue_items(
        session, auth.tenant.id, project_id, status=status, kind=kind
    )
    return {"items": items}


@router.post("/{project_id}/queue")
async def create_queue_item(
    project_id: UUID,
    body: QueueItemCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Add a request to the project queue (origin: operator)."""
    item = await work.create_queue_item(
        session,
        auth.tenant.id,
        project_id,
        kind=body.kind,
        title=body.title,
        body=body.body,
        priority=body.priority,
        origin_type="user",
        signal_id=body.signal_id,
        created_by_type="user",
        created_by_id=str(auth.user.id),
    )
    return await work.get_queue_item_detail(session, auth.tenant.id, item.id)


@router.get("/{project_id}/queue/{item_id}")
async def get_queue_item(
    project_id: UUID,
    item_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    detail = await work.get_queue_item_detail(session, auth.tenant.id, item_id)
    if detail["project_id"] != str(project_id):
        raise HTTPException(status_code=404, detail="Queue item not found")
    return detail


@router.patch("/{project_id}/queue/{item_id}")
async def patch_queue_item(
    project_id: UUID,
    item_id: UUID,
    body: QueueItemPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Edit fields and/or move the item through its status machine."""
    item = await work.get_queue_item(session, auth.tenant.id, item_id)
    if item.project_id != project_id:
        raise HTTPException(status_code=404, detail="Queue item not found")
    if any(
        value is not None
        for value in (body.title, body.body, body.kind, body.priority, body.assigned_agent_id)
    ):
        await work.update_queue_item(
            session,
            auth.tenant.id,
            item_id,
            title=body.title,
            body=body.body,
            kind=body.kind,
            priority=body.priority,
            assigned_agent_id=UUID(body.assigned_agent_id) if body.assigned_agent_id else None,
        )
    if body.status is not None:
        await work.transition_queue_item(
            session,
            auth.tenant.id,
            item_id,
            body.status,
            actor_type="user",
            actor_id=str(auth.user.id),
            impact_summary=body.impact_summary,
        )
    return await work.get_queue_item_detail(session, auth.tenant.id, item_id)


@router.post("/{project_id}/queue/{item_id}/analyze")
async def analyze_queue_item(
    project_id: UUID,
    item_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Wake the project agent to (re)analyze this item against the project docs."""
    item = await work.get_queue_item(session, auth.tenant.id, item_id)
    if item.project_id != project_id:
        raise HTTPException(status_code=404, detail="Queue item not found")
    if item.status == "proposed":
        item = await work.transition_queue_item(
            session,
            auth.tenant.id,
            item_id,
            "queued",
            actor_type="user",
            actor_id=str(auth.user.id),
        )
        return {"started": True}
    result = await work.start_queue_item_analysis(session, auth.tenant.id, item)
    if result is None:
        raise HTTPException(status_code=400, detail="No project agent available")
    return {"started": True, **result}


@router.post("/{project_id}/queue/{item_id}/verify")
async def verify_queue_item(
    project_id: UUID,
    item_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Wake the project agent to verify reality matches the linked doc sections."""
    item = await work.get_queue_item(session, auth.tenant.id, item_id)
    if item.project_id != project_id:
        raise HTTPException(status_code=404, detail="Queue item not found")
    result = await work.start_queue_item_verification(session, auth.tenant.id, item_id)
    if result is None:
        raise HTTPException(status_code=400, detail="No project agent available")
    return {"started": True, **result}


# ── project docs (smart documentation) ───────────────────────────────


class ProjectDocCreateBody(BaseModel):
    path: str
    content: str = ""
    title: str | None = None


class SectionPatchBody(BaseModel):
    status: str
    summary: str | None = None


class LinkBody(BaseModel):
    queue_item_id: str
    relation: str = "touches"


@router.get("/{project_id}/docs")
async def list_project_docs(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Project documentation with linked requests and optional section statuses."""
    from app.services.workspace import list_docs, serialize_doc

    await svc.get_project_row(session, auth.tenant.id, project_id)
    docs = await list_docs(session, auth.tenant.id, project_id=project_id)
    sections = await work.sections_for_project(session, auth.tenant.id, project_id)
    links = await work.links_for_sections(session, auth.tenant.id, [s.id for s in sections])
    by_doc: dict[UUID, list[dict[str, Any]]] = {}
    for section in sections:
        payload = work.serialize_section(section)
        payload["items"] = links.get(section.id, [])
        by_doc.setdefault(section.doc_id, []).append(payload)
    linked = await work.active_requests_for_docs(session, auth.tenant.id, [d.id for d in docs])
    out = []
    for doc in docs:
        data = serialize_doc(doc)
        data["sections"] = by_doc.get(doc.id, [])
        data["linked_requests"] = linked.get(doc.id, [])
        out.append(data)
    return {"docs": out}


@router.post("/{project_id}/docs")
async def create_project_doc(
    project_id: UUID,
    body: ProjectDocCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create or update a project doc; sections sync from `##` headings."""
    from app.services.workspace import serialize_doc, upsert_doc

    project, _ = await svc.get_project_row(session, auth.tenant.id, project_id)
    path = body.path.strip().lstrip("/")
    if not path.startswith("projects/"):
        path = f"projects/{project.slug}/{path}"
    doc = await upsert_doc(
        session,
        auth.tenant.id,
        path=path,
        content=body.content,
        kind="project_doc",
        title=body.title,
        project_id=project_id,
        created_by_type="user",
        created_by_id=str(auth.user.id),
    )
    data = serialize_doc(doc)
    sections = await work.list_doc_sections(session, auth.tenant.id, doc.id)
    data["sections"] = [work.serialize_section(s) for s in sections]
    linked = await work.active_requests_for_docs(session, auth.tenant.id, [doc.id])
    data["linked_requests"] = linked.get(doc.id, [])
    return data


@router.patch("/{project_id}/docs/{doc_id}/sections/{section_id}")
async def patch_doc_section(
    project_id: UUID,
    doc_id: UUID,
    section_id: UUID,
    body: SectionPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Manually set a section maturity status (draft/review/final)."""
    section = await work.set_section_status(
        session,
        auth.tenant.id,
        section_id,
        body.status,
        actor_type="user",
        actor_id=str(auth.user.id),
        summary=body.summary,
    )
    return work.serialize_section(section)


@router.post("/{project_id}/docs/{doc_id}/links")
async def link_doc_item(
    project_id: UUID,
    doc_id: UUID,
    body: LinkBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Link a queue item to a knowledge document (document-level)."""
    await svc.get_project_row(session, auth.tenant.id, project_id)
    link = await work.link_item_to_doc(
        session,
        auth.tenant.id,
        UUID(body.queue_item_id),
        doc_id,
        relation=body.relation,
        created_by_type="user",
        created_by_id=str(auth.user.id),
    )
    return {
        "id": str(link.id),
        "doc_id": str(link.doc_id) if link.doc_id else None,
        "relation": link.relation,
    }


@router.post("/{project_id}/docs/{doc_id}/sections/{section_id}/links")
async def link_section_item(
    project_id: UUID,
    doc_id: UUID,
    section_id: UUID,
    body: LinkBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Link a queue item to a doc section (legacy)."""
    link = await work.link_item_to_section(
        session,
        auth.tenant.id,
        UUID(body.queue_item_id),
        section_id,
        relation=body.relation,
        created_by_type="user",
        created_by_id=str(auth.user.id),
    )
    return {
        "id": str(link.id),
        "doc_id": str(link.doc_id) if link.doc_id else None,
        "relation": link.relation,
    }


# ── project resources (repo / drive / notion / vibecode slots) ───────


class ResourceCreateBody(BaseModel):
    resource_type: str
    provider: str = ""
    label: str = ""
    external_ref: str = ""
    config: dict[str, Any] | None = None
    # resource_type="connection": the IntegrationConnection to make exclusive to this project.
    connection_id: UUID | None = None


async def _require_connection_manage(
    session: AsyncSession, auth: AuthContext, connection_id: UUID | None
) -> None:
    from app.models.integration import IntegrationConnection
    from app.services.connection_access import require_manage

    conn = await session.get(IntegrationConnection, connection_id) if connection_id else None
    if conn is None or conn.tenant_id != auth.tenant.id:
        raise HTTPException(status_code=404, detail="Connection not found")
    await require_manage(session, conn, user_id=auth.user.id, role=auth.role)


class ResourcePatchBody(BaseModel):
    label: str | None = None
    external_ref: str | None = None
    config: dict[str, Any] | None = None
    status: str | None = None


@router.get("/{project_id}/resources")
async def list_project_resources(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """External surfaces linked to this project (repo, drive, notion, vibecode, connection)."""
    await svc.get_project_row(session, auth.tenant.id, project_id)
    return {"items": await work.list_resources(session, auth.tenant.id, project_id)}


@router.post("/{project_id}/resources")
async def create_project_resource(
    project_id: UUID,
    body: ResourceCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Link a resource slot to the project; connectors attach to it later.

    ``resource_type="connection"`` with ``connection_id`` makes that connection
    exclusive to its linked projects (requires Manage on the connection).
    """
    await svc.get_project_row(session, auth.tenant.id, project_id)
    if body.resource_type == "connection":
        await _require_connection_manage(session, auth, body.connection_id)
    return await work.create_resource(
        session,
        auth.tenant.id,
        project_id,
        resource_type=body.resource_type,
        provider=body.provider,
        label=body.label,
        external_ref=body.external_ref,
        config=body.config,
        connection_id=body.connection_id if body.resource_type == "connection" else None,
        created_by_type="user",
        created_by_id=str(auth.user.id),
    )


@router.patch("/{project_id}/resources/{resource_id}")
async def patch_project_resource(
    project_id: UUID,
    resource_id: UUID,
    body: ResourcePatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await work.patch_resource(
        session,
        auth.tenant.id,
        resource_id,
        label=body.label,
        external_ref=body.external_ref,
        config=body.config,
        status=body.status,
    )


@router.delete("/{project_id}/resources/{resource_id}")
async def delete_project_resource(
    project_id: UUID,
    resource_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.models.project_work import ProjectResource

    resource = await session.get(ProjectResource, resource_id)
    if (
        resource is not None
        and resource.tenant_id == auth.tenant.id
        and resource.resource_type == "connection"
    ):
        await _require_connection_manage(session, auth, resource.connection_id)
    await work.delete_resource(session, auth.tenant.id, resource_id)
    return {"ok": True}


# ── Works in: board, files, canvases and connections of one folder


class WorksInItem(BaseModel):
    key: str
    kind: str
    origin: str
    label: str
    detail: str = ""
    href: str | None = None
    status: str = "active"
    count: int | None = None


class WorksInList(BaseModel):
    items: list[WorksInItem]


class WorksInAddBody(BaseModel):
    kind: str  # canvas | connection | drive
    title: str = ""
    managing_agent_id: UUID | None = None
    connection_id: UUID | None = None
    provider: str = ""
    external_ref: str = ""


class WorksInAdded(BaseModel):
    item: WorksInItem | None


@router.get("/{project_id}/works-in", response_model=WorksInList)
async def list_works_in(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Every place in this folder where work lands.

    ``origin`` is ``bokito`` (board, files, canvas) or ``connection`` (repo,
    drive, administration). ``key`` is the stable reference that deliveries
    and flow destinations use.
    """
    from app.services.works_in import works_in_items

    return {"items": await works_in_items(session, auth.tenant.id, project_id)}


@router.post("/{project_id}/works-in", response_model=WorksInAdded)
async def add_works_in(
    project_id: UUID,
    body: WorksInAddBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Add a canvas, a connection or a file folder to this folder's Works in."""
    from app.services.works_in import add_item

    auth.require_role("owner", "admin")
    if body.kind == "connection":
        await _require_connection_manage(session, auth, body.connection_id)
    result = await add_item(
        session,
        auth.tenant.id,
        project_id,
        kind=body.kind,
        title=body.title,
        managing_agent_id=body.managing_agent_id,
        connection_id=body.connection_id,
        provider=body.provider,
        external_ref=body.external_ref,
        user_id=auth.user.id if auth.user else None,
    )
    return {"item": result["item"]}


# ── project canvases (snapshot nodes; source writes go through agents/Govern)


class CanvasCreateBody(BaseModel):
    title: str
    slug: str | None = None
    managing_agent_id: UUID | None = None
    refresh_minutes: int | None = None
    refresh_cadence: str | None = None
    refresh_cron: str | None = None
    notes: str | None = None


class CanvasMetaBody(BaseModel):
    title: str | None = None
    slug: str | None = None
    managing_agent_id: UUID | None = None
    refresh_minutes: int | None = None
    refresh_cadence: str | None = None
    refresh_cron: str | None = None
    notes: str | None = None


@router.get("/{project_id}/canvases")
async def list_project_canvases(
    project_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import project_canvas as canvas_svc

    return {
        "items": await canvas_svc.list_project_canvases(session, auth.tenant.id, project_id)
    }


@router.post("/{project_id}/canvases")
async def create_project_canvas(
    project_id: UUID,
    body: CanvasCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.project_canvas import OWNER_PROJECT, create_canvas

    auth.require_role("owner", "admin")
    return await create_canvas(
        session,
        auth.tenant.id,
        owner_kind=OWNER_PROJECT,
        owner_id=project_id,
        title=body.title,
        slug=body.slug,
        managing_agent_id=body.managing_agent_id,
        refresh_minutes=body.refresh_minutes,
        refresh_cadence=body.refresh_cadence,
        refresh_cron=body.refresh_cron,
        notes=body.notes,
        updated_by_type="user",
        updated_by_id=str(auth.user.id),
    )


@router.get("/{project_id}/canvases/{slug}")
async def get_project_canvas(
    project_id: UUID,
    slug: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import project_canvas as canvas_svc

    return await canvas_svc.get_canvas(
        session, auth.tenant.id, project_id=project_id, slug=slug
    )


@router.patch("/{project_id}/canvases/{slug}")
async def patch_project_canvas_meta(
    project_id: UUID,
    slug: str,
    body: CanvasMetaBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import project_canvas as canvas_svc

    auth.require_role("owner", "admin")
    current = await canvas_svc.get_canvas(
        session, auth.tenant.id, project_id=project_id, slug=slug
    )
    return await canvas_svc.patch_canvas_meta(
        session,
        auth.tenant.id,
        UUID(current["id"]),
        title=body.title,
        slug=body.slug,
        managing_agent_id=body.managing_agent_id,
        refresh_minutes=body.refresh_minutes,
        refresh_cadence=body.refresh_cadence,
        refresh_cron=body.refresh_cron,
        notes=body.notes,
    )


@router.delete("/{project_id}/canvases/{slug}")
async def delete_project_canvas(
    project_id: UUID,
    slug: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services import project_canvas as canvas_svc

    auth.require_role("owner", "admin")
    current = await canvas_svc.get_canvas(
        session, auth.tenant.id, project_id=project_id, slug=slug
    )
    return await canvas_svc.delete_canvas(
        session, auth.tenant.id, UUID(current["id"]), user_id=auth.user.id if auth.user else None
    )
