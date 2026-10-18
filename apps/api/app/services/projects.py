"""Folder service (dashboard: folders; model: ``Project`` + ``project_tag_links``).

Each folder is a named tree node (``parent_id``) with an optional AND label
filterset. Nesting sets parent; labels stay independent. Filing and trash call
into ``services.folders``.
"""

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import QUEUE_ITEM_KINDS, AgentTask
from app.models.project import Project, ProjectTagLink
from app.models.project_work import ProjectResource
from app.models.signal import Signal, SignalTag

_GONE = HTTPException(status_code=410, detail="This endpoint was removed")


def _parse_json(raw: str | None) -> Any:
    try:
        return json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def serialize_po_agent(agent: Any | None) -> dict[str, Any] | None:
    """Legacy graph helper; project orchestrators are no longer stored on folders."""
    if not agent:
        return None
    from app.services.workforce_runtime import serialize_agent

    return serialize_agent(agent)


def serialize_project(
    project: Project,
    *,
    tag_ids: list[UUID],
    tag_names: list[str],
) -> dict[str, Any]:
    return {
        "id": str(project.id),
        "name": project.name,
        "slug": project.slug,
        "description": project.description or "",
        "autonomous_scope": project.autonomous_scope or "",
        "active_domains": _parse_json(project.active_domains_json),
        "parent_id": str(project.parent_id) if project.parent_id else None,
        "tag_ids": [str(t) for t in tag_ids],
        "tag_names": tag_names,
        "sort_order": project.sort_order,
        "updated_at": _iso(project.updated_at),
        "created_at": _iso(project.created_at),
    }


async def _tag_names(session: AsyncSession, tenant_id: UUID, tag_ids: list[UUID]) -> dict[UUID, str]:
    ids = [t for t in dict.fromkeys(tag_ids) if t is not None]
    if not ids:
        return {}
    rows = await session.execute(
        select(SignalTag.id, SignalTag.name).where(SignalTag.tenant_id == tenant_id, SignalTag.id.in_(ids))
    )
    return {row[0]: row[1] for row in rows.all()}


async def serialize_with_tag(session: AsyncSession, project: Project) -> dict[str, Any]:
    from app.services.folders import folder_tag_ids

    tag_ids = await folder_tag_ids(session, project.id)
    names_map = await _tag_names(session, project.tenant_id, tag_ids)
    tag_names = [names_map[t] for t in tag_ids if t in names_map]
    return serialize_project(project, tag_ids=tag_ids, tag_names=tag_names)


async def _resolve_tag_ids(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    tag_ids: list[UUID] | None = None,
    tags: list[str] | None = None,
    user_id: UUID | None = None,
) -> list[UUID]:
    from app.services.signal_tags import normalize_tag

    out: list[UUID] = []
    if tag_ids:
        out.extend(tag_ids)
    if tags:
        for raw in tags:
            name = normalize_tag(raw)
            if not name:
                continue
            row = (
                await session.execute(
                    select(SignalTag).where(SignalTag.tenant_id == tenant_id, SignalTag.name == name)
                )
            ).scalar_one_or_none()
            if row is None:
                row = SignalTag(tenant_id=tenant_id, name=name, created_by_user_id=user_id)
                session.add(row)
                await session.flush()
            out.append(row.id)
    return list(dict.fromkeys(out))


def project_subtree_select(tenant_id: UUID, root_id: UUID):
    """This folder only (filtersets have no stored child tree)."""
    del tenant_id
    return select(Project.id).where(Project.id == root_id, Project.deleted_at.is_(None))


async def _alive_projects(session: AsyncSession, tenant_id: UUID) -> list[Project]:
    from app.services.trash import alive

    result = await session.execute(
        select(Project).where(Project.tenant_id == tenant_id, alive(Project))
    )
    return list(result.scalars().all())


def _parent_map_from_derived(roots: list[Any]) -> dict[UUID, UUID | None]:
    from app.services.folders import DerivedNode

    parent: dict[UUID, UUID | None] = {}

    def walk(nodes: list[DerivedNode], parent_project: UUID | None) -> None:
        for node in nodes:
            if node.project_id:
                parent[node.project_id] = parent_project
                walk(node.children, node.project_id)
            else:
                walk(node.children, parent_project)

    walk(roots, None)
    return parent


def _children_project_ids(node: Any) -> list[UUID]:
    ids: list[UUID] = []
    for child in node.children:
        if child.project_id:
            ids.append(child.project_id)
        elif child.virtual:
            ids.extend(_children_project_ids(child))
    return ids


def _ancestors(
    project_id: UUID,
    parent_map: dict[UUID, UUID | None],
    by_id: dict[UUID, Project],
    catalog: Any | None = None,
) -> list[dict[str, Any]]:
    chain: list[Project] = []
    current = parent_map.get(project_id)
    seen: set[UUID] = set()
    while current is not None and current not in seen:
        seen.add(current)
        row = by_id.get(current)
        if row is None:
            break
        chain.append(row)
        current = parent_map.get(current)
    chain.reverse()
    out: list[dict[str, Any]] = []
    for row in chain:
        item: dict[str, Any] = {"id": str(row.id), "name": row.name}
        fs = catalog.by_id.get(row.id) if catalog is not None else None
        if fs is not None:
            item["tag_ids"] = [str(t) for t in fs.tag_ids]
            item["tag_names"] = list(fs.tag_names)
        out.append(item)
    return out


async def get_repo_resource(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> ProjectResource | None:
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
    session: AsyncSession, tenant_id: UUID, project_id: UUID, *, include_deleted: bool = False
) -> tuple[Project, None]:
    from app.services.trash import alive

    query = select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    if not include_deleted:
        query = query.where(alive(Project))
    result = await session.execute(query)
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project, None


def _folder_ref_key(value: str) -> str:
    return value.strip().lower().replace(" ", "-")


async def resolve_folder_ref(
    session: AsyncSession,
    tenant_id: UUID,
    ref: str | None,
) -> tuple[Project | None, str | None]:
    from app.services.trash import alive

    raw = str(ref or "").strip()
    if not raw:
        return None, None
    try:
        folder_id = UUID(raw)
    except (TypeError, ValueError):
        folder_id = None
    if folder_id is not None:
        row = (
            await session.execute(
                select(Project).where(
                    Project.id == folder_id,
                    Project.tenant_id == tenant_id,
                    alive(Project),
                )
            )
        ).scalar_one_or_none()
        if row is None:
            return None, "folder ref is not a known folder id"
        return row, None

    key = _folder_ref_key(raw)
    rows = list(
        (
            await session.execute(
                select(Project).where(Project.tenant_id == tenant_id, alive(Project))
            )
        )
        .scalars()
        .all()
    )
    matches = [
        row
        for row in rows
        if _folder_ref_key(row.slug or "") == key or _folder_ref_key(row.name or "") == key
    ]
    if not matches:
        return None, (
            f"folder ref {raw!r} is not a folder id, slug, or name; "
            "call list_folders and pass the folder id"
        )
    if len(matches) > 1:
        candidates = [{"id": str(row.id), "name": row.name, "slug": row.slug} for row in matches[:8]]
        return None, (
            f"folder ref {raw!r} matches {len(matches)} folders; "
            f"pass the folder id instead. candidates={candidates}"
        )
    return matches[0], None


async def _path_status_count(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    status: str,
) -> int:
    from app.services.communication_nav import list_predicates
    from app.services.trash import alive

    predicates = await list_predicates(session, tenant_id, {"project_id": project_id})
    if predicates is None:
        return 0
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(Signal)
                .where(Signal.tenant_id == tenant_id, alive(Signal), Signal.status == status, *predicates)
            )
        ).scalar_one()
    )


async def get_project_detail(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    from app.services.folders import derive_tree, load_catalog

    project, _ = await get_project_row(session, tenant_id, project_id)
    payload = await serialize_with_tag(session, project)
    catalog = await load_catalog(session, tenant_id)
    roots = derive_tree(catalog)
    parent_map = _parent_map_from_derived(roots)
    projects_by_id = {p.id: p for p in await _alive_projects(session, tenant_id)}

    def find_node(nodes: list[Any], pid: UUID) -> Any | None:
        for node in nodes:
            if node.project_id == pid:
                return node
            found = find_node(node.children, pid)
            if found is not None:
                return found
        return None

    node = find_node(roots, project_id)
    child_ids = _children_project_ids(node) if node else []
    payload["parent_id"] = str(parent_map[project_id]) if project_id in parent_map and parent_map[project_id] else None
    payload["ancestors"] = _ancestors(project_id, parent_map, projects_by_id, catalog)
    payload["child_count"] = len(child_ids)
    payload["open_count"] = await _path_status_count(session, tenant_id, project.id, "open")
    payload["closed_count"] = await _path_status_count(session, tenant_id, project.id, "closed")
    children: list[dict[str, Any]] = []
    for cid in child_ids:
        child = projects_by_id.get(cid)
        fs = catalog.by_id.get(cid)
        if child is None or fs is None:
            continue
        children.append(
            {
                "id": str(child.id),
                "name": child.name,
                "slug": child.slug,
                "tag_ids": [str(t) for t in fs.tag_ids],
                "tag_names": list(fs.tag_names),
                "virtual": False,
                "child_count": len(
                    _children_project_ids(_find_derived_node(roots, cid) or _EmptyNode())
                ),
                "open_count": await _path_status_count(session, tenant_id, child.id, "open"),
                "closed_count": await _path_status_count(session, tenant_id, child.id, "closed"),
            }
        )
    children.sort(key=lambda row: row["name"].lower())
    payload["children"] = children
    return payload


async def folder_digest(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> str:
    detail = await get_project_detail(session, tenant_id, project_id)
    children = detail.get("children") or []
    if not children:
        return ""
    lines = ["Folders nested under this filterset (include these figures in the snapshot):"]
    for child in sorted(children, key=lambda row: row["name"].lower()):
        lines.append(
            f"- {child['name']}: {child.get('open_count', 0)} open, {child.get('closed_count', 0)} closed."
        )
    return "\n".join(lines)


async def list_projects(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    from app.services.folders import derive_tree, load_catalog
    from app.services.trash import alive

    result = await session.execute(
        select(Project)
        .where(Project.tenant_id == tenant_id, alive(Project))
        .order_by(Project.sort_order, Project.name)
    )
    projects = list(result.scalars().all())
    catalog = await load_catalog(session, tenant_id)
    roots = derive_tree(catalog)
    parent_map = _parent_map_from_derived(roots)

    open_tickets_by_project: dict[UUID, int] = {}
    sections_by_project: dict[UUID, tuple[int, int]] = {}
    if projects:
        project_ids = [p.id for p in projects]
        ticket_result = await session.execute(
            select(Signal.project_id, func.count())
            .where(
                Signal.tenant_id == tenant_id,
                Signal.project_id.in_(project_ids),
                Signal.ticket_status.in_(("open", "waiting")),
                Signal.deleted_at.is_(None),
            )
            .group_by(Signal.project_id)
        )
        open_tickets_by_project = {row[0]: row[1] for row in ticket_result.all()}
        from app.models.workspace import DocSection, WorkspaceDoc

        section_result = await session.execute(
            select(WorkspaceDoc.project_id, DocSection.status, func.count())
            .join(WorkspaceDoc, WorkspaceDoc.id == DocSection.doc_id)
            .where(
                DocSection.tenant_id == tenant_id,
                WorkspaceDoc.project_id.in_(project_ids),
            )
            .group_by(WorkspaceDoc.project_id, DocSection.status)
        )
        for pid, status, count in section_result.all():
            total, done = sections_by_project.get(pid, (0, 0))
            total += count
            if status == "final":
                done += count
            sections_by_project[pid] = (total, done)

    out: list[dict[str, Any]] = []
    by_project_id = {p.id: p for p in projects}
    for p in projects:
        fs = catalog.by_id.get(p.id)
        if fs:
            tag_ids = list(fs.tag_ids)
        else:
            from app.services.folders import folder_tag_ids

            tag_ids = await folder_tag_ids(session, p.id)
        names_map = await _tag_names(session, tenant_id, tag_ids)
        tag_names = [names_map[t] for t in tag_ids if t in names_map]
        item = serialize_project(p, tag_ids=tag_ids, tag_names=tag_names)
        item["open_tickets_count"] = open_tickets_by_project.get(p.id, 0)
        total, done = sections_by_project.get(p.id, (0, 0))
        item["doc_sections_total"] = total
        item["doc_sections_done"] = done
        parent = parent_map.get(p.id)
        item["parent_id"] = str(parent) if parent else None
        item["ancestors"] = _ancestors(p.id, parent_map, by_project_id, catalog)
        derived = _find_derived_node(roots, p.id) or _EmptyNode()
        item["child_count"] = len(_children_project_ids(derived))
        out.append(item)
    return out


class _EmptyNode:
    children: list[Any] = []


def _find_derived_node(nodes: list[Any], project_id: UUID) -> Any | None:
    for node in nodes:
        if node.project_id == project_id:
            return node
        found = _find_derived_node(node.children, project_id)
        if found is not None:
            return found
    return None


async def _slug_in_use(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    exclude_id: UUID | None = None,
) -> bool:
    from app.services.trash import alive

    query = select(Project.id).where(Project.tenant_id == tenant_id, Project.slug == slug, alive(Project))
    if exclude_id is not None:
        query = query.where(Project.id != exclude_id)
    return (await session.execute(query.limit(1))).scalar_one_or_none() is not None


async def _default_folder_name(session: AsyncSession, tenant_id: UUID, tag_ids: list[UUID]) -> str:
    names = await _tag_names(session, tenant_id, tag_ids)
    parts = [names[t] for t in tag_ids if t in names]
    return " · ".join(f"#{n}" for n in parts) if parts else "Folder"


async def find_folder_with_tag_set(
    session: AsyncSession,
    tenant_id: UUID,
    tag_ids: list[UUID],
    *,
    exclude_id: UUID | None = None,
) -> Any | None:
    """Return an existing alive folder whose AND tag set equals ``tag_ids`` (order-insensitive)."""
    from app.services.folders import load_catalog

    wanted = frozenset(tag_ids)
    if not wanted:
        return None
    catalog = await load_catalog(session, tenant_id)
    for folder in catalog.folders:
        if exclude_id is not None and folder.id == exclude_id:
            continue
        if frozenset(folder.tag_ids) == wanted:
            return folder
    return None


async def _would_create_cycle(
    session: AsyncSession,
    tenant_id: UUID,
    folder_id: UUID,
    new_parent_id: UUID | None,
) -> bool:
    if new_parent_id is None:
        return False
    if new_parent_id == folder_id:
        return True
    current: UUID | None = new_parent_id
    seen: set[UUID] = {folder_id}
    while current is not None:
        if current in seen:
            return True
        seen.add(current)
        row = (
            await session.execute(
                select(Project.parent_id).where(
                    Project.id == current, Project.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        current = row
    return False


async def create_project(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    name: str = "",
    slug: str = "",
    autonomous_scope: str = "",
    description: str = "",
    tag_ids: list[UUID] | None = None,
    tags: list[str] | None = None,
    parent_id: UUID | None = None,
    sort_order: int = 0,
    user_id: UUID | None = None,
) -> dict[str, Any]:
    from uuid import uuid4

    from app.services.folders import refile_tagged, set_folder_tags
    from app.services.signal_tags import normalize_tag

    resolved = await _resolve_tag_ids(session, tenant_id, tag_ids=tag_ids, tags=tags, user_id=user_id)
    clean_name = (name or "").strip()
    if not clean_name and not resolved:
        raise HTTPException(status_code=422, detail="A folder needs a name or at least one label")
    if not clean_name:
        clean_name = await _default_folder_name(session, tenant_id, resolved)
    if parent_id is not None:
        await get_project_row(session, tenant_id, parent_id)
    slug_seed = slug or clean_name.replace("#", "").replace(" · ", "-")
    slug_norm = normalize_tag(slug_seed) or (str(resolved[0])[:8] if resolved else "folder")
    if await _slug_in_use(session, tenant_id, slug_norm):
        slug_norm = f"{slug_norm}-{(str(resolved[0])[:8] if resolved else str(uuid4())[:8])}"
    now = datetime.utcnow()
    project = Project(
        tenant_id=tenant_id,
        name=clean_name,
        slug=slug_norm,
        description=description,
        autonomous_scope=autonomous_scope.strip(),
        parent_id=parent_id,
        sort_order=sort_order,
        updated_at=now,
    )
    session.add(project)
    await session.flush()
    if resolved:
        await set_folder_tags(session, tenant_id, project.id, resolved)
    if resolved:
        await refile_tagged(session, tenant_id, await _refile_tags_for(session, tenant_id, project.id))
    await session.commit()
    await session.refresh(project)
    return await serialize_with_tag(session, project)


async def _refile_tags_for(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> list[UUID]:
    from app.services.folders import folder_tag_ids

    del tenant_id
    return await folder_tag_ids(session, project_id)


async def nest_folder(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    onto_folder_id: UUID | None,
    *,
    user_id: UUID | None = None,
) -> dict[str, Any]:
    """Move a folder in the free tree. Labels are unchanged."""
    del user_id
    project, _ = await get_project_row(session, tenant_id, project_id)
    if onto_folder_id is not None:
        await get_project_row(session, tenant_id, onto_folder_id)
        if await _would_create_cycle(session, tenant_id, project.id, onto_folder_id):
            raise HTTPException(status_code=422, detail="Cannot nest a folder under its own descendant")
    project.parent_id = onto_folder_id
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return await serialize_with_tag(session, project)


async def patch_project(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    name: str | None = None,
    description: str | None = None,
    autonomous_scope: str | None = None,
    tag_ids: list[UUID] | None | object = ...,
    tags: list[str] | None | object = ...,
    parent_id: UUID | None | object = ...,
    sort_order: int | None = None,
    user_id: UUID | None = None,
) -> dict[str, Any]:
    from app.services.folders import folder_tag_ids, refile_subtree, set_folder_tags

    project, _ = await get_project_row(session, tenant_id, project_id)
    before_tags = await folder_tag_ids(session, project.id)
    tags_changed = False
    if name is not None:
        clean = name.strip()
        if not clean:
            raise HTTPException(status_code=422, detail="Folder name cannot be empty")
        project.name = clean
    if description is not None:
        project.description = description
    if autonomous_scope is not None:
        project.autonomous_scope = autonomous_scope.strip()
    if sort_order is not None:
        project.sort_order = sort_order
    if parent_id is not ...:
        next_parent = parent_id if isinstance(parent_id, UUID) else None
        if next_parent is not None:
            await get_project_row(session, tenant_id, next_parent)
            if await _would_create_cycle(session, tenant_id, project.id, next_parent):
                raise HTTPException(
                    status_code=422, detail="Cannot nest a folder under its own descendant"
                )
        project.parent_id = next_parent
    next_ids: list[UUID] | None = None
    if tags is not ... and tags is not None:
        next_ids = await _resolve_tag_ids(
            session,
            tenant_id,
            tag_ids=list(tag_ids) if tag_ids is not ... and tag_ids else None,
            tags=list(tags),
            user_id=user_id,
        )
    elif tag_ids is not ...:
        next_ids = list(tag_ids) if tag_ids else []
    if next_ids is not None:
        tags_changed = frozenset(next_ids) != frozenset(before_tags)
        await set_folder_tags(session, tenant_id, project.id, next_ids)
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.flush()
    if tags_changed:
        await refile_subtree(session, tenant_id, project.id, actor_id=str(user_id or ""))
    await session.commit()
    await session.refresh(project)
    return await serialize_with_tag(session, project)


async def pin_virtual_child(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def _trash_project(
    session: AsyncSession,
    tenant: Any,
    project: Project,
    *,
    user_id: UUID | None,
    batch_id: UUID,
    commit: bool,
) -> None:
    from app.models.project_canvas import OWNER_PROJECT, ProjectCanvas
    from app.models.trigger import Trigger
    from app.models.workspace import WorkspaceDoc
    from app.services.trash import alive, move_to_bin

    canvases = list(
        (
            await session.execute(
                select(ProjectCanvas).where(
                    ProjectCanvas.tenant_id == project.tenant_id,
                    ProjectCanvas.owner_kind == OWNER_PROJECT,
                    ProjectCanvas.owner_id == project.id,
                    alive(ProjectCanvas),
                )
            )
        ).scalars().all()
    )
    docs = list(
        (
            await session.execute(
                select(WorkspaceDoc).where(
                    WorkspaceDoc.tenant_id == project.tenant_id,
                    WorkspaceDoc.project_id == project.id,
                    alive(WorkspaceDoc),
                )
            )
        ).scalars().all()
    )
    resources = list(
        (
            await session.execute(
                select(ProjectResource).where(
                    ProjectResource.tenant_id == project.tenant_id,
                    ProjectResource.project_id == project.id,
                    alive(ProjectResource),
                )
            )
        ).scalars().all()
    )
    queue_items = list(
        (
            await session.execute(
                select(AgentTask).where(
                    AgentTask.tenant_id == project.tenant_id,
                    AgentTask.project_id == project.id,
                    AgentTask.kind.in_(QUEUE_ITEM_KINDS),
                    alive(AgentTask),
                )
            )
        ).scalars().all()
    )
    children: list[tuple[str, Any]] = []
    children.extend(("canvas", canvas) for canvas in canvases)
    children.extend(("knowledge", doc) for doc in docs)
    children.extend(("project_resource", resource) for resource in resources)
    children.extend(("queue_item", item) for item in queue_items)
    for canvas in canvases:
        if not canvas.refresh_trigger_id:
            continue
        trigger = (
            await session.execute(
                select(Trigger).where(
                    Trigger.id == canvas.refresh_trigger_id,
                    Trigger.tenant_id == project.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if trigger and getattr(trigger, "enabled", False):
            trigger.trash_was_enabled = True
            trigger.enabled = False
            session.add(trigger)
    await move_to_bin(
        session,
        tenant,
        resource_type="project",
        row=project,
        user_id=user_id,
        children=children,
        commit=commit,
        batch_id=batch_id,
    )


async def delete_project(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    confirm_name: str,
    *,
    permanent: bool = False,
    commit: bool = True,
    user_id: UUID | None = None,
) -> dict[str, bool]:
    project, _ = await get_project_row(session, tenant_id, project_id, include_deleted=permanent)
    if confirm_name.strip() != project.name:
        raise HTTPException(status_code=400, detail="Confirmation name does not match")
    if not permanent:
        from uuid import uuid4

        from app.services.folders import refile_many
        from app.services.trash import load_tenant

        tenant = await load_tenant(session, tenant_id)
        batch_id = uuid4()
        await _trash_project(
            session,
            tenant,
            project,
            user_id=user_id,
            batch_id=batch_id,
            commit=False,
        )
        await session.flush()
        inside = (
            await session.execute(
                select(Signal.id).where(
                    Signal.tenant_id == tenant_id,
                    Signal.project_id == project_id,
                    Signal.deleted_at.is_(None),
                )
            )
        ).scalars()
        await refile_many(session, tenant_id, list(inside), actor_id=str(user_id or ""))
        if commit:
            await session.commit()
        return {"deleted": True}

    from sqlalchemy import delete as sa_delete, update as sa_update

    from app.models.project_canvas import OWNER_PROJECT, ProjectCanvas
    from app.models.project_work import TaskDocLink
    from app.models.trigger import Trigger
    from app.models.workspace import DocChunk, DocSection, WorkspaceDoc
    from app.models.agent import AgentRun
    from app.models.orchestration import TaskArtifact

    await session.execute(sa_delete(ProjectTagLink).where(ProjectTagLink.project_id == project_id))
    project_doc_ids = select(WorkspaceDoc.id).where(WorkspaceDoc.project_id == project_id)
    section_ids = select(DocSection.id).where(DocSection.doc_id.in_(project_doc_ids))
    task_ids = select(AgentTask.id).where(AgentTask.project_id == project_id)
    await session.execute(
        sa_delete(TaskDocLink).where(
            TaskDocLink.section_id.in_(section_ids)
            | TaskDocLink.doc_id.in_(project_doc_ids)
            | TaskDocLink.task_id.in_(task_ids)
        )
    )
    await session.execute(sa_delete(DocSection).where(DocSection.doc_id.in_(project_doc_ids)))
    queue_task_ids = select(AgentTask.id).where(
        AgentTask.project_id == project_id,
        AgentTask.kind.in_(QUEUE_ITEM_KINDS),
    )
    await session.execute(sa_update(AgentRun).where(AgentRun.task_id.in_(queue_task_ids)).values(task_id=None))
    await session.execute(sa_delete(TaskArtifact).where(TaskArtifact.agent_task_id.in_(queue_task_ids)))
    await session.execute(
        sa_update(AgentTask).where(AgentTask.duplicate_of_id.in_(queue_task_ids)).values(duplicate_of_id=None)
    )
    await session.execute(
        sa_delete(AgentTask).where(
            AgentTask.project_id == project_id,
            AgentTask.kind.in_(QUEUE_ITEM_KINDS),
        )
    )
    await session.execute(sa_update(AgentTask).where(AgentTask.project_id == project_id).values(project_id=None))
    await session.execute(sa_delete(ProjectResource).where(ProjectResource.project_id == project_id))
    canvases = (
        await session.execute(
            select(ProjectCanvas).where(
                ProjectCanvas.tenant_id == tenant_id,
                ProjectCanvas.owner_kind == OWNER_PROJECT,
                ProjectCanvas.owner_id == project_id,
            )
        )
    ).scalars().all()
    trigger_ids = [c.refresh_trigger_id for c in canvases if c.refresh_trigger_id]
    if trigger_ids:
        await session.execute(sa_delete(Trigger).where(Trigger.id.in_(trigger_ids)))
    await session.execute(
        sa_delete(ProjectCanvas).where(
            ProjectCanvas.tenant_id == tenant_id,
            ProjectCanvas.owner_kind == OWNER_PROJECT,
            ProjectCanvas.owner_id == project_id,
        )
    )
    doc_ids = select(WorkspaceDoc.id).where(WorkspaceDoc.project_id == project_id)
    await session.execute(sa_delete(DocChunk).where(DocChunk.doc_id.in_(doc_ids)))
    await session.execute(sa_delete(WorkspaceDoc).where(WorkspaceDoc.project_id == project_id))
    await session.delete(project)
    if commit:
        await session.commit()
    return {"deleted": True}


async def connect_repo(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def disconnect_repo(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def reindex_repo(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def repo_status(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def usage_budget(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def check_project_token_budget(*_args: Any, **_kwargs: Any) -> None:
    return None


async def usage_summary(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def po_agent_summary(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def create_po_agent(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def link_po_agent(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def unlink_po_agent(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def list_project_agents(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
    raise _GONE


async def add_project_agent(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def set_project_agent_default(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def remove_project_agent(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    raise _GONE


async def project_default_agent(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> Any:
    del project_id
    from app.services.lead_agent import get_lead_agent

    return await get_lead_agent(session, tenant_id)
