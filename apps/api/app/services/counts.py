"""One count rule for every surface that shows how much work sits somewhere.

A conversation counts when it is live, inside the operator's Communication hub
(the same rows All communication lists, within channel ACL), and matches the
scope. A folder scope is the folder plus every descendant: any of a folder's
labels, or the cached home folder (``Signal.project_id``) in the subtree.

``open`` is ``status == "open"``. Snoozed and scheduled threads are not open.
``overdue`` is an open ticket (open or waiting) whose ``due_at`` has passed.
Activity over a period (the Workforce map) is a different metric and never
reuses the word "open".
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal
from app.services.folders import FolderCatalog, load_catalog

OPEN = "open"
CLOSED = "closed"
OPEN_TICKET_STATUSES = ("open", "waiting")


def conversation_scope(
    tenant_id: UUID,
    user_id: UUID | None,
    visible_account_ids: set[UUID] | None,
) -> list[Any]:
    """Base clauses: tenant, live, Communication hub, channel ACL."""
    from app.services.signal_threads import _hub_predicate, _visibility_predicate
    from app.services.trash import alive

    scope = [Signal.tenant_id == tenant_id, alive(Signal), _hub_predicate(user_id)]
    acl = _visibility_predicate(visible_account_ids)
    if acl is not None:
        scope.append(acl)
    return scope


async def open_count(session: AsyncSession, scope: list[Any], predicates: list[Any]) -> int:
    stmt = select(func.count()).select_from(Signal).where(*scope, Signal.status == OPEN, *predicates)
    return int((await session.execute(stmt)).scalar_one())


async def status_counts(
    session: AsyncSession, scope: list[Any], predicates: list[Any]
) -> dict[str, int]:
    open_ticket = (Signal.ticket_tag_id.is_not(None), Signal.ticket_status.in_(OPEN_TICKET_STATUSES))
    stmt = select(
        func.count().filter(Signal.status == OPEN),
        func.count().filter(Signal.status == CLOSED),
        func.count().filter(*open_ticket),
        func.count().filter(*open_ticket, Signal.due_at.is_not(None), Signal.due_at < datetime.utcnow()),
    ).where(*scope, *predicates)
    open_n, closed_n, tickets_n, overdue_n = (await session.execute(stmt)).one()
    return {
        "open": int(open_n or 0),
        "closed": int(closed_n or 0),
        "open_tickets": int(tickets_n or 0),
        "overdue": int(overdue_n or 0),
    }


async def folder_counts(
    session: AsyncSession,
    tenant_id: UUID,
    folder_ids: list[UUID],
    scope: list[Any],
    catalog: FolderCatalog | None = None,
) -> dict[UUID, dict[str, int]]:
    """Open, closed and open tickets per folder, each including its subtree."""
    from app.services.communication_nav import list_predicates

    catalog = catalog or await load_catalog(session, tenant_id)
    out: dict[UUID, dict[str, int]] = {}
    for folder_id in folder_ids:
        predicates = await list_predicates(session, tenant_id, {"project_id": folder_id}, catalog)
        if predicates is None:
            out[folder_id] = {"open": 0, "closed": 0, "open_tickets": 0, "overdue": 0}
            continue
        out[folder_id] = await status_counts(session, scope, predicates)
    return out
