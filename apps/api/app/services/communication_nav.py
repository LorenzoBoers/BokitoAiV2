"""Communication rail beyond channels: hashtags and projects.

Categories with ``show_in_nav`` and pinned free tags form the Tags and
categories section; every project gets a row in Projects. Each row opens the
same four queues as a channel (For you, Open, Unassigned, Closed) with a list
filter: ``tag`` (link or ticket) or ``project_id`` (the project chosen when the
ticket was filed, or set on the conversation).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.signal import TICKET_STAGE_KINDS, Signal, SignalTag


def _uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def filter_predicates(tenant_id: UUID, filters: dict[str, Any]) -> list[Any] | None:
    """SQL predicates for the list filters; None when an id does not parse."""
    from app.services.signal_tags import signals_tagged

    out: list[Any] = []
    if filters.get("project_id"):
        project_id = _uuid(filters["project_id"])
        if project_id is None:
            return None
        out.append(Signal.project_id == project_id)
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


async def nav(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Rail rows with the open count All communication shows this user."""
    scope = _hub_scope(tenant_id, user_id, visible_account_ids)
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
        is_category = tag.workstream_id is not None
        if is_category and not tag.show_in_nav:
            continue
        if not is_category and not tag.pinned:
            continue
        row = {
            "id": str(tag.id),
            "name": tag.name,
            "count": await _open_count(session, scope, filter_predicates(tenant_id, {"tag": tag.name}) or []),
        }
        (ticket_tags if is_category else free_tags).append(row)
    projects = (
        await session.execute(
            select(Project)
            .where(Project.tenant_id == tenant_id, Project.deleted_at.is_(None))
            .order_by(Project.name)
        )
    ).scalars().all()
    project_rows = [
        {
            "id": str(project.id),
            "name": project.name,
            "count": await _open_count(session, scope, [Signal.project_id == project.id]),
        }
        for project in projects
    ]
    return {"ticket_tags": ticket_tags, "tags": free_tags, "projects": project_rows}
