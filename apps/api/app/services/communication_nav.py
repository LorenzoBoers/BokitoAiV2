"""Communication rail beyond channels: tags and folders.

Tags with ``show_in_nav`` form flat tag rows. Folder rows come from the derived
filterset tree (tag-set inclusion). Each row opens the same queues as a channel
with ``folder_tag_ids`` (AND of tags) or ``project_id`` resolved to those tags.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import ProjectTagLink
from app.models.signal import TICKET_STAGE_KINDS, Signal, SignalTag
from app.services.folders import DerivedNode, FolderCatalog, derive_tree, load_catalog


def _uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _uuid_list(value: Any) -> list[UUID] | None:
    if value is None or value == "":
        return []
    raw = value if isinstance(value, (list, tuple, set)) else str(value).split(",")
    out: list[UUID] = []
    for item in raw:
        if not str(item).strip():
            continue
        parsed = _uuid(item)
        if parsed is None:
            return None
        out.append(parsed)
    return out


def filter_predicates(tenant_id: UUID, filters: dict[str, Any]) -> list[Any] | None:
    from app.services.signal_tags import signals_tagged, signals_with_tag_ids

    out: list[Any] = []
    if "folder_tag_ids" in filters:
        raw_ids = filters.get("folder_tag_ids") or []
        tag_ids: list[UUID] = []
        for item in raw_ids:
            parsed = item if isinstance(item, UUID) else _uuid(item)
            if parsed is None:
                return None
            tag_ids.append(parsed)
        if tag_ids:
            for tag_id in tag_ids:
                out.append(Signal.id.in_(signals_with_tag_ids(tenant_id, [tag_id])))
        elif filters.get("missing_folder"):
            out.append(Signal.id.in_([]))
        elif filters.get("home_project_id"):
            home = filters["home_project_id"]
            home_id = home if isinstance(home, UUID) else _uuid(home)
            if home_id is None:
                return None
            out.append(Signal.project_id == home_id)
    elif filters.get("project_id"):
        return None
    path_tags = _uuid_list(filters.get("path"))
    if path_tags is None:
        return None
    if "folder_tag_ids" not in filters:
        for tag_id in path_tags:
            out.append(Signal.id.in_(signals_with_tag_ids(tenant_id, [tag_id])))
    if filters.get("category_id"):
        category_id = _uuid(filters["category_id"])
        if category_id is None:
            return None
        out.append(Signal.ticket_tag_id == category_id)
    stage = str(filters.get("stage") or "").strip()
    if stage:
        out.append(Signal.ticket_tag_id.is_not(None))
        out.append(
            Signal.ticket_status == stage if stage in TICKET_STAGE_KINDS else Signal.stage_key == stage
        )
    if filters.get("tag"):
        out.append(Signal.id.in_(signals_tagged(tenant_id, str(filters["tag"]))))
    return out


async def list_predicates(
    session: AsyncSession,
    tenant_id: UUID,
    filters: dict[str, Any],
    tree: FolderCatalog | None = None,
) -> list[Any] | None:
    """Resolve ``project_id`` to the folder's AND tag set via ``project_tag_links``."""
    from app.services.folders import folder_tag_ids

    resolved = dict(filters)
    if resolved.get("project_id") and "folder_tag_ids" not in resolved:
        project_id = _uuid(resolved["project_id"])
        if project_id is None:
            return None
        extra = _uuid_list(resolved.get("path"))
        if extra is None:
            return None
        tag_ids = await folder_tag_ids(session, project_id)
        if extra:
            tag_ids = [*tag_ids, *extra]
        if not tag_ids:
            resolved["folder_tag_ids"] = []
            resolved["missing_folder"] = True
        else:
            resolved["folder_tag_ids"] = tag_ids
        resolved.pop("project_id", None)
        resolved.pop("path", None)
    return filter_predicates(tenant_id, resolved)


def _hub_scope(tenant_id: UUID, user_id: UUID, visible_account_ids: set[UUID] | None) -> list[Any]:
    from app.services.signal_threads import _hub_predicate, _visibility_predicate
    from app.services.trash import alive

    scope = [Signal.tenant_id == tenant_id, alive(Signal), _hub_predicate(user_id)]
    acl = _visibility_predicate(visible_account_ids)
    if acl is not None:
        scope.append(acl)
    return scope


async def _open_count(session: AsyncSession, scope: list[Any], predicates: list[Any]) -> int:
    stmt = select(func.count()).select_from(Signal).where(*scope, Signal.status == "open", *predicates)
    return int((await session.execute(stmt)).scalar_one())


def virtual_row_id(project_id: UUID, tag_id: UUID) -> str:
    return f"{project_id}:{tag_id}"


async def folder_rows(
    session: AsyncSession,
    tenant_id: UUID,
    scope: list[Any],
    catalog: FolderCatalog | None = None,
) -> list[dict[str, Any]]:
    catalog = catalog or await load_catalog(session, tenant_id)
    roots = derive_tree(catalog)

    async def _node_count(node: DerivedNode) -> int:
        if node.project_id:
            predicates = await list_predicates(
                session, tenant_id, {"project_id": node.project_id}, catalog
            )
        elif node.tag_ids:
            predicates = filter_predicates(tenant_id, {"folder_tag_ids": list(node.tag_ids)})
        else:
            return 0
        if predicates is None:
            return 0
        return await _open_count(session, scope, predicates)

    async def _node(node: DerivedNode, parent_key: str | None) -> dict[str, Any]:
        children = [await _node(child, node.key) for child in node.children]
        parent_id = None
        if node.project_id and parent_key and not parent_key.startswith("cluster:"):
            parent_id = parent_key
        elif parent_key and parent_key.startswith("cluster:"):
            parent_id = parent_key
        row_id = str(node.project_id) if node.project_id else node.key
        return {
            "id": row_id,
            "name": node.name,
            "parent_id": parent_id,
            "project_id": str(node.project_id) if node.project_id else None,
            "tag_id": str(node.tag_ids[-1]) if node.tag_ids else None,
            "tag_ids": [str(t) for t in node.tag_ids],
            "tag_names": list(node.tag_names),
            "virtual": node.virtual,
            "count": await _node_count(node),
            "children": children,
        }

    return [await _node(root, None) for root in roots]


async def nav(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    scope = _hub_scope(tenant_id, user_id, visible_account_ids)
    catalog = await load_catalog(session, tenant_id)
    used_in_filtersets = set(
        (
            await session.execute(
                select(ProjectTagLink.tag_id).where(ProjectTagLink.tenant_id == tenant_id)
            )
        ).scalars()
    )
    tags = list(
        (
            await session.execute(
                select(SignalTag)
                .where(SignalTag.tenant_id == tenant_id)
                .order_by(SignalTag.sort_order, SignalTag.name)
            )
        ).scalars()
    )
    ticket_tags: list[dict[str, Any]] = []
    free_tags: list[dict[str, Any]] = []
    for tag in tags:
        if not tag.show_in_nav or tag.id in used_in_filtersets:
            continue
        row = {
            "id": str(tag.id),
            "name": tag.name,
            "tag_id": str(tag.id),
            "group_id": str(tag.group_id) if tag.group_id else None,
            "count": await _open_count(
                session,
                scope,
                await list_predicates(session, tenant_id, {"tag": tag.name}) or [],
            ),
        }
        (ticket_tags if tag.workstream_id is not None else free_tags).append(row)
    return {
        "ticket_tags": ticket_tags,
        "tags": free_tags,
        "projects": await folder_rows(session, tenant_id, scope, catalog),
    }
