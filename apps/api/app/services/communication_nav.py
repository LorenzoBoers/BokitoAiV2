"""Communication rail beyond channels: tags and folders.

Tags with ``show_in_nav`` form the tag rows (action tags and free tags), except
tags that are a folder: those show as the folder. Every folder gets a row with
its children; a group folder also lists one virtual child per tag in its group
that has no pinned row yet. Each row opens the same queues as a channel with a
list filter: ``tag`` (link, action tag, or inherited from the contact),
``project_id`` (conversations that carry every tag on that folder's path),
optionally narrowed by ``path`` (virtual remainder tag ids). A conversation
can appear in more than one folder. The badge is a distinct count on that
filter, not a sum of children.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import TICKET_STAGE_KINDS, Signal, SignalTag
from app.services.folders import FolderNode, FolderTree, load_tree


def _uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _uuid_list(value: Any) -> list[UUID] | None:
    """Parse a comma-separated string or list of ids; None when one does not parse."""
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
    """SQL predicates for the list filters; None when an id does not parse.

    ``folder_tag_ids`` is the AND of path tags (own + inherited). Callers that
    still pass ``project_id`` should go through ``list_predicates`` so the
    folder is resolved to those tags.
    """
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
    tree: FolderTree | None = None,
) -> list[Any] | None:
    """Resolve ``project_id`` (+ virtual ``path``) to path-tag filters."""
    resolved = dict(filters)
    if resolved.get("project_id") and "folder_tag_ids" not in resolved:
        project_id = _uuid(resolved["project_id"])
        if project_id is None:
            return None
        extra = _uuid_list(resolved.get("path"))
        if extra is None:
            return None
        tree = tree or await load_tree(session, tenant_id)
        if project_id not in tree.nodes:
            resolved["folder_tag_ids"] = []
            resolved["missing_folder"] = True
        else:
            resolved["folder_tag_ids"] = tree.path_tag_ids(project_id, extra)
            if not resolved["folder_tag_ids"]:
                resolved["home_project_id"] = project_id
            resolved.pop("path", None)
    return filter_predicates(tenant_id, resolved)


def _hub_scope(tenant_id: UUID, user_id: UUID, visible_account_ids: set[UUID] | None) -> list[Any]:
    """The conversations All communication lists for this user, so counts match the list."""
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
    """Stable id for a virtual child: the group folder plus the tag."""
    return f"{project_id}:{tag_id}"


async def folder_rows(
    session: AsyncSession,
    tenant_id: UUID,
    scope: list[Any],
    tree: FolderTree | None = None,
) -> list[dict[str, Any]]:
    """Folder tree rows with open counts, virtual children included."""
    tree = tree or await load_tree(session, tenant_id)
    async def _path_count(project_id: UUID, extra: list[UUID] | None = None) -> int:
        predicates = await list_predicates(
            session, tenant_id, {"project_id": project_id, "path": extra or []}, tree
        )
        if predicates is None:
            return 0
        return await _open_count(session, scope, predicates)

    async def _virtual_children(node: FolderNode) -> list[dict[str, Any]]:
        if node.child_group_id is None:
            return []
        group_tags = tree.tags_by_group.get(node.child_group_id, set())
        pinned = {child.tag_id for child in tree.children.get(node.id, []) if child.tag_id in group_tags}
        rows: list[dict[str, Any]] = []
        for tag_id in sorted(group_tags - pinned, key=lambda t: tree.tag_name(t).lower()):
            rows.append(
                {
                    "id": virtual_row_id(node.id, tag_id),
                    "name": tree.tag_name(tag_id),
                    "parent_id": str(node.id),
                    "project_id": str(node.id),
                    "tag_id": str(tag_id),
                    "virtual": True,
                    "count": await _path_count(node.id, [tag_id]),
                    "children": [],
                }
            )
        return rows

    async def _node(node: FolderNode) -> dict[str, Any]:
        children = [await _node(child) for child in tree.children.get(node.id, [])]
        children.extend(await _virtual_children(node))
        return {
            "id": str(node.id),
            "name": node.name,
            "parent_id": str(node.parent_id) if node.parent_id in tree.nodes else None,
            "project_id": str(node.id),
            "tag_id": str(node.tag_id) if node.tag_id else None,
            "group_id": str(node.child_group_id) if node.child_group_id else None,
            "virtual": False,
            "count": await _path_count(node.id),
            "children": children,
        }

    return [await _node(root) for root in tree.roots()]


async def nav(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Rail rows with the open count All communication shows this user."""
    scope = _hub_scope(tenant_id, user_id, visible_account_ids)
    tree = await load_tree(session, tenant_id)
    folder_tag_ids = {node.tag_id for node in tree.nodes.values() if node.tag_id is not None}
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
        if not tag.show_in_nav or tag.id in folder_tag_ids:
            continue
        row = {
            "id": str(tag.id),
            "name": tag.name,
            "tag_id": str(tag.id),
            "group_id": str(tag.group_id) if tag.group_id else None,
            "count": await _open_count(session, scope, await list_predicates(session, tenant_id, {"tag": tag.name}) or []),
        }
        (ticket_tags if tag.workstream_id is not None else free_tags).append(row)
    return {
        "ticket_tags": ticket_tags,
        "tags": free_tags,
        "projects": await folder_rows(session, tenant_id, scope, tree),
    }
