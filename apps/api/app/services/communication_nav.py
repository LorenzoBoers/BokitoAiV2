"""Communication rail beyond channels: tags and folders.

Tags with ``show_in_nav`` form the tag rows (action tags and free tags), except
tags that are a folder: those show as the folder. Every folder gets a row with
its children; a group folder also lists one virtual child per tag in its group
that has no pinned row yet. Each row opens the same queues as a channel with a
list filter: ``tag`` (link, action tag, or inherited from the contact),
``project_id`` (the folder and everything inside it), optionally narrowed by
``path`` (the virtual remainder: tag ids the conversation must also carry).
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
    """SQL predicates for the list filters; None when an id does not parse."""
    from app.services.signal_tags import signals_tagged, signals_with_tag_ids

    out: list[Any] = []
    if filters.get("project_id"):
        project_id = _uuid(filters["project_id"])
        if project_id is None:
            return None
        from app.services.projects import project_subtree_select

        out.append(Signal.project_id.in_(project_subtree_select(tenant_id, project_id)))
    path_tags = _uuid_list(filters.get("path"))
    if path_tags is None:
        return None
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
    exact: dict[UUID, int] = {}
    if tree.nodes:
        counted = await session.execute(
            select(Signal.project_id, func.count())
            .select_from(Signal)
            .where(*scope, Signal.status == "open", Signal.project_id.in_(list(tree.nodes)))
            .group_by(Signal.project_id)
        )
        exact = {row[0]: int(row[1]) for row in counted.all() if row[0] is not None}

    async def _virtual_children(node: FolderNode) -> list[dict[str, Any]]:
        if node.child_group_id is None:
            return []
        group_tags = tree.tags_by_group.get(node.child_group_id, set())
        pinned = {child.tag_id for child in tree.children.get(node.id, []) if child.tag_id in group_tags}
        subtree = tree.subtree_ids(node.id)
        rows: list[dict[str, Any]] = []
        for tag_id in sorted(group_tags - pinned, key=lambda t: tree.tag_name(t).lower()):
            count = await _open_count(
                session,
                scope,
                filter_predicates(tenant_id, {"project_id": node.id, "path": [tag_id]}) or [],
            ) if subtree else 0
            rows.append(
                {
                    "id": virtual_row_id(node.id, tag_id),
                    "name": tree.tag_name(tag_id),
                    "parent_id": str(node.id),
                    "project_id": str(node.id),
                    "tag_id": str(tag_id),
                    "virtual": True,
                    "count": count,
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
            "count": sum(exact.get(pid, 0) for pid in tree.subtree_ids(node.id)),
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
            "count": await _open_count(session, scope, filter_predicates(tenant_id, {"tag": tag.name}) or []),
        }
        (ticket_tags if tag.workstream_id is not None else free_tags).append(row)
    return {
        "ticket_tags": ticket_tags,
        "tags": free_tags,
        "projects": await folder_rows(session, tenant_id, scope, tree),
    }
