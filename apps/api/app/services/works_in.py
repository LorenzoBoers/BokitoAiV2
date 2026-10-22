"""Works in: every place inside a folder where work lands.

A folder is the place where all work on one subject comes together: a client,
a project or a department task. Its Works in items are the board (tickets),
the files on its conversations, its canvases (in Bokito) and the external
resources a connection writes to (repo, drive, administration).

Each item has a stable ``key`` (``board``, ``files``, ``canvas:{id}``,
``resource:{id}``). Deliveries, flow destinations and the Grid refer to items
by that key.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.project_canvas import ProjectCanvas
from app.models.project_work import ProjectResource
from app.models.signal import Signal, SignalMessage

ORIGIN_BOKITO = "bokito"
ORIGIN_CONNECTION = "connection"
GENERAL_FOLDER_NAMES = {"nl": "Algemeen", "en": "General"}
ADD_KINDS = ("canvas", "connection", "drive")


def board_key() -> str:
    return "board"


def files_key() -> str:
    return "files"


def canvas_key(canvas_id: UUID | str) -> str:
    return f"canvas:{canvas_id}"


def resource_key(resource_id: UUID | str) -> str:
    return f"resource:{resource_id}"


def folder_href(project_id: UUID | str, tab: str = "", **params: str) -> str:
    query = [f"tab={tab}"] if tab else []
    query += [f"{k}={v}" for k, v in params.items()]
    return f"/folders/{project_id}" + (f"?{'&'.join(query)}" if query else "")


def _resource_href(resource: ProjectResource) -> str | None:
    ref = (resource.external_ref or "").strip()
    if ref.startswith(("http://", "https://")):
        return ref
    if resource.resource_type == "repo" and ref.count("/") == 1 and resource.provider in ("", "github"):
        return f"https://github.com/{ref}"
    if resource.connection_id:
        return "/settings/connections"
    return None


def resource_item(resource: ProjectResource) -> dict[str, Any]:
    label = resource.label or resource.external_ref or resource.provider or resource.resource_type
    return {
        "key": resource_key(resource.id),
        "kind": resource.resource_type,
        "origin": ORIGIN_CONNECTION,
        "label": label,
        "detail": resource.provider or "",
        "href": _resource_href(resource),
        "status": resource.status,
        "count": None,
    }


def canvas_item(canvas: ProjectCanvas, project_id: UUID) -> dict[str, Any]:
    content_kind = (getattr(canvas, "kind", None) or "dashboard").strip() or "dashboard"
    return {
        "key": canvas_key(canvas.id),
        "kind": "canvas",
        "origin": ORIGIN_BOKITO,
        "label": canvas.title or "Canvas",
        "detail": "",
        "canvas_kind": content_kind,
        "href": folder_href(project_id, "canvas", canvas=str(canvas.id)),
        "status": "active",
        "count": None,
    }


async def _folder(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> Project:
    project = await session.get(Project, project_id)
    if project is None or project.tenant_id != tenant_id or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return project


async def _counts(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> tuple[int, int]:
    """(tickets, messages with files) on conversations in the folder subtree."""
    from app.services.communication_nav import list_predicates

    predicates = await list_predicates(session, tenant_id, {"project_id": project_id})
    if predicates is None:
        return 0, 0
    scope = [Signal.tenant_id == tenant_id, Signal.deleted_at.is_(None), *predicates]
    tickets = (
        await session.execute(
            select(func.count(Signal.id)).where(*scope, Signal.ticket_tag_id.is_not(None))
        )
    ).scalar_one()
    files = (
        await session.execute(
            select(func.count(SignalMessage.id))
            .join(Signal, Signal.id == SignalMessage.signal_id)
            .where(*scope, SignalMessage.attachments_json != "[]")
        )
    ).scalar_one()
    return int(tickets or 0), int(files or 0)


async def works_in_items(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> list[dict[str, Any]]:
    """Board and files when they hold something, then canvases, then resources."""
    await _folder(session, tenant_id, project_id)
    tickets, files = await _counts(session, tenant_id, project_id)
    items: list[dict[str, Any]] = []
    if tickets:
        items.append(
            {
                "key": board_key(),
                "kind": "board",
                "origin": ORIGIN_BOKITO,
                "label": "",
                "detail": "",
                "href": folder_href(project_id, "tickets"),
                "status": "active",
                "count": tickets,
            }
        )
    if files:
        items.append(
            {
                "key": files_key(),
                "kind": "files",
                "origin": ORIGIN_BOKITO,
                "label": "",
                "detail": "",
                "href": folder_href(project_id, "files"),
                "status": "active",
                "count": files,
            }
        )
    from app.services import folders as folder_svc

    catalog = await folder_svc.load_catalog(session, tenant_id)
    folder_ids = folder_svc.folder_subtree_ids(catalog, project_id)
    # Prefer the conversation's folder cache; also accept a direct match on the
    # folder itself so a just-filed canvas shows up before subtree catalog refresh.
    scope_ids = set(folder_ids) | {project_id}
    canvases = (
        await session.execute(
            select(ProjectCanvas)
            .join(Signal, Signal.id == ProjectCanvas.signal_id)
            .where(
                ProjectCanvas.tenant_id == tenant_id,
                Signal.tenant_id == tenant_id,
                Signal.project_id.in_(scope_ids),
                ProjectCanvas.deleted_at.is_(None),
            )
            .order_by(ProjectCanvas.created_at)
        )
    ).scalars().all()
    items.extend(canvas_item(canvas, project_id) for canvas in canvases)
    resources = (
        await session.execute(
            select(ProjectResource)
            .where(
                ProjectResource.tenant_id == tenant_id,
                ProjectResource.project_id == project_id,
                ProjectResource.deleted_at.is_(None),
            )
            .order_by(ProjectResource.created_at)
        )
    ).scalars().all()
    items.extend(resource_item(resource) for resource in resources)
    return items


async def item_for_key(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, key: str
) -> dict[str, Any] | None:
    """The Works in item behind ``key`` in this folder, or None."""
    for item in await works_in_items(session, tenant_id, project_id):
        if item["key"] == key:
            return item
    if key in (board_key(), files_key()):
        # An empty board or file list is still a valid place to land.
        return {
            "key": key,
            "kind": key,
            "origin": ORIGIN_BOKITO,
            "label": "",
            "detail": "",
            "href": folder_href(project_id, "tickets" if key == board_key() else "files"),
            "status": "active",
            "count": 0,
        }
    return None


async def resource_for_connection(
    session: AsyncSession, tenant_id: UUID, connection_id: UUID, external_ref: str = ""
) -> ProjectResource | None:
    """The live resource a connection writes to; an exact ``external_ref`` wins."""
    rows = (
        await session.execute(
            select(ProjectResource).where(
                ProjectResource.tenant_id == tenant_id,
                ProjectResource.connection_id == connection_id,
                ProjectResource.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    if external_ref:
        for row in rows:
            if row.external_ref == external_ref:
                return row
    return rows[0] if rows else None


def workspace_language(tenant) -> str:
    import json

    try:
        data = json.loads(getattr(tenant, "settings_json", None) or "{}")
    except json.JSONDecodeError:
        data = {}
    lang = str(data.get("ai_workspace_language") or data.get("ui_language") or "") if isinstance(data, dict) else ""
    return "nl" if lang.lower().startswith("nl") else "en"


async def general_folder(session: AsyncSession, tenant_id: UUID, *, create: bool = True) -> Project | None:
    """The folder for loose work ("Algemeen" / "General"), one per workspace."""
    from app.models.auth import Tenant

    names = set(GENERAL_FOLDER_NAMES.values())
    row = (
        await session.execute(
            select(Project)
            .where(
                Project.tenant_id == tenant_id,
                Project.deleted_at.is_(None),
                Project.parent_id.is_(None),
                Project.name.in_(names),
            )
            .order_by(Project.created_at)
        )
    ).scalars().first()
    if row is not None or not create:
        return row
    from app.services.projects import create_project

    tenant = await session.get(Tenant, tenant_id)
    created = await create_project(session, tenant_id, name=GENERAL_FOLDER_NAMES[workspace_language(tenant)])
    return await session.get(Project, UUID(str(created["id"])))


async def add_item(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    kind: str,
    title: str = "",
    managing_agent_id: UUID | None = None,
    connection_id: UUID | None = None,
    provider: str = "",
    external_ref: str = "",
    user_id: UUID | None = None,
) -> dict[str, Any]:
    """Add a canvas, a connection or a file folder (drive) to Works in."""
    from app.services import project_work as work
    from app.services.project_canvas import create_canvas

    await _folder(session, tenant_id, project_id)
    if kind not in ADD_KINDS:
        raise HTTPException(status_code=422, detail=f"Unknown Works in kind: {kind}")
    actor = str(user_id) if user_id else ""
    if kind == "canvas":
        created = await create_canvas(
            session,
            tenant_id,
            new_thread=True,
            folder_id=project_id,
            title=title or "Canvas",
            managing_agent_id=managing_agent_id,
            updated_by_type="user",
            updated_by_id=actor,
            force_new=True,
        )
        canvas_id = created.get("id") or (created.get("canvas") or {}).get("id")
        key = canvas_key(canvas_id)
    else:
        created = await work.create_resource(
            session,
            tenant_id,
            project_id,
            resource_type="connection" if kind == "connection" else "drive",
            provider=provider,
            label=title,
            external_ref=external_ref,
            connection_id=connection_id if kind == "connection" else None,
            created_by_type="user",
            created_by_id=actor,
        )
        key = resource_key(created["id"])
    item = await item_for_key(session, tenant_id, project_id, key)
    if item is None and kind == "canvas" and canvas_id:
        # create_canvas commits in its own unit of work; the folder refile
        # may not yet show in works_in_items for this session. Still return
        # the just-created canvas so callers can deep-link immediately.
        row = await session.get(ProjectCanvas, UUID(str(canvas_id)))
        if row is not None:
            item = canvas_item(row, project_id)
    return {"item": item, "created": created}
