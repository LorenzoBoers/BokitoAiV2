"""Communication folders: saved filters plus one computed folder per project.

A folder filters the conversation list on any of ``project_id``,
``category_id``, ``tag`` and ``stage``. The same keys are list query
parameters, so a folder is a link and nothing more. A project folder holds the
conversations linked to the project and the tickets whose playbook belongs to
it.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.case import Case, CaseType
from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.signal import InboxFolder, Signal

FILTER_KEYS = ("project_id", "category_id", "tag", "stage")
STAGE_KINDS = ("open", "waiting", "done")
SCOPES = ("workspace", "personal")


def _uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def project_predicate(tenant_id: UUID, project_id: UUID):
    via_tickets = select(Case.signal_id).where(
        Case.tenant_id == tenant_id,
        or_(
            Case.project_id == project_id,
            Case.workstream_id.in_(
                select(Workstream.id).where(
                    Workstream.tenant_id == tenant_id, Workstream.project_id == project_id
                )
            ),
        ),
    )
    return or_(Signal.project_id == project_id, Signal.id.in_(via_tickets))


def category_predicate(tenant_id: UUID, category_id: UUID | None, stage: str | None):
    """Conversations in a category and/or a ticket stage (key or kind)."""
    conditions = [Case.tenant_id == tenant_id, Case.status != "proposed"]
    if category_id is not None:
        conditions.append(Case.case_type_id == category_id)
    if stage:
        conditions.append(Case.status == stage if stage in STAGE_KINDS else Case.stage_key == stage)
    return Signal.id.in_(select(Case.signal_id).where(and_(*conditions)))


def filter_predicates(tenant_id: UUID, filters: dict[str, Any]) -> list[Any] | None:
    """SQL predicates for a folder filter; None when an id does not parse."""
    from app.services.signal_tags import signals_tagged

    out: list[Any] = []
    if filters.get("project_id"):
        project_id = _uuid(filters["project_id"])
        if project_id is None:
            return None
        out.append(project_predicate(tenant_id, project_id))
    category_id = None
    if filters.get("category_id"):
        category_id = _uuid(filters["category_id"])
        if category_id is None:
            return None
    stage = str(filters.get("stage") or "").strip() or None
    if category_id is not None or stage:
        out.append(category_predicate(tenant_id, category_id, stage))
    if filters.get("tag"):
        out.append(Signal.id.in_(signals_tagged(tenant_id, str(filters["tag"]))))
    return out


def clean_filter(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        raise ValueError("filter must be an object")
    out = {key: str(raw[key]).strip() for key in FILTER_KEYS if raw.get(key)}
    for key in ("project_id", "category_id"):
        if key in out and _uuid(out[key]) is None:
            raise ValueError(f"{key} is not an id")
    if not out:
        raise ValueError("A folder needs at least one filter")
    return out


def serialize_folder(row: InboxFolder, count: int = 0) -> dict[str, Any]:
    try:
        filters = json.loads(row.filter_json or "{}")
    except json.JSONDecodeError:
        filters = {}
    return {
        "id": str(row.id),
        "kind": "saved",
        "name": row.name,
        "filter": filters if isinstance(filters, dict) else {},
        "scope": row.scope,
        "position": row.position,
        "count": count,
    }


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


async def _visible_rows(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> list[InboxFolder]:
    rows = await session.execute(
        select(InboxFolder)
        .where(
            InboxFolder.tenant_id == tenant_id,
            or_(InboxFolder.scope == "workspace", InboxFolder.owner_user_id == user_id),
        )
        .order_by(InboxFolder.position, InboxFolder.created_at)
    )
    return list(rows.scalars().all())


async def list_folders(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    visible_account_ids: set[UUID] | None = None,
) -> list[dict[str, Any]]:
    """Saved folders first (in order), then one folder per project with conversations.

    ``count`` is the number of open conversations in the folder that All
    communication shows this user.
    """
    scope = _hub_scope(tenant_id, user_id, visible_account_ids)
    out: list[dict[str, Any]] = []
    for row in await _visible_rows(session, tenant_id, user_id):
        folder = serialize_folder(row)
        predicates = filter_predicates(tenant_id, folder["filter"])
        folder["count"] = await _open_count(session, scope, predicates) if predicates else 0
        out.append(folder)

    projects = (
        await session.execute(
            select(Project)
            .where(Project.tenant_id == tenant_id, Project.deleted_at.is_(None))
            .order_by(Project.name)
        )
    ).scalars().all()
    for project in projects:
        predicate = project_predicate(tenant_id, project.id)
        linked = (
            await session.execute(
                select(Signal.id).where(*scope, predicate).limit(1)
            )
        ).first()
        if linked is None:
            continue
        out.append(
            {
                "id": f"project:{project.id}",
                "kind": "project",
                "name": project.name,
                "filter": {"project_id": str(project.id)},
                "scope": "workspace",
                "position": None,
                "count": await _open_count(session, scope, [predicate]),
            }
        )
    return out


async def _get_row(session: AsyncSession, tenant_id: UUID, user_id: UUID, folder_id: UUID) -> InboxFolder:
    row = await session.get(InboxFolder, folder_id)
    if row is None or row.tenant_id != tenant_id:
        raise LookupError("Folder not found")
    if row.scope == "personal" and row.owner_user_id != user_id:
        raise LookupError("Folder not found")
    return row


async def _check_refs(session: AsyncSession, tenant_id: UUID, filters: dict[str, str]) -> None:
    if "project_id" in filters:
        project = await session.get(Project, UUID(filters["project_id"]))
        if project is None or project.tenant_id != tenant_id:
            raise ValueError("Unknown project")
    if "category_id" in filters:
        category = await session.get(CaseType, UUID(filters["category_id"]))
        if category is None or category.tenant_id != tenant_id:
            raise ValueError("Unknown category")


async def create_folder(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    name: str,
    filters: dict[str, Any],
    scope: str = "workspace",
) -> dict[str, Any]:
    clean_name = name.strip()[:80]
    if not clean_name:
        raise ValueError("Name is required")
    if scope not in SCOPES:
        raise ValueError("Invalid scope")
    clean = clean_filter(filters)
    await _check_refs(session, tenant_id, clean)
    last = (
        await session.execute(
            select(func.max(InboxFolder.position)).where(InboxFolder.tenant_id == tenant_id)
        )
    ).scalar_one()
    row = InboxFolder(
        tenant_id=tenant_id,
        name=clean_name,
        filter_json=json.dumps(clean),
        scope=scope,
        owner_user_id=user_id if scope == "personal" else None,
        position=(last or 0) + 1,
    )
    session.add(row)
    await session.commit()
    return serialize_folder(row)


async def update_folder(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    folder_id: UUID,
    *,
    name: str | None = None,
    filters: dict[str, Any] | None = None,
    position: int | None = None,
) -> dict[str, Any]:
    row = await _get_row(session, tenant_id, user_id, folder_id)
    if name is not None:
        if not name.strip():
            raise ValueError("Name is required")
        row.name = name.strip()[:80]
    if filters is not None:
        clean = clean_filter(filters)
        await _check_refs(session, tenant_id, clean)
        row.filter_json = json.dumps(clean)
    if position is not None:
        row.position = position
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.commit()
    return serialize_folder(row)


async def delete_folder(session: AsyncSession, tenant_id: UUID, user_id: UUID, folder_id: UUID) -> None:
    row = await _get_row(session, tenant_id, user_id, folder_id)
    await session.delete(row)
    await session.commit()
