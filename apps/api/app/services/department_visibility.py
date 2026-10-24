"""Open and shielded departments: who may read a department's work.

Work in an open department is readable by everyone in the workspace. A
shielded department (``Department.visibility == "shielded"``) and every
department below it are readable only by people and agents who sit in that
branch or in a department above it, and by owners and admins. People are on
the organization implicitly; that does not count here, an agent on the
organization crew does.

Only enforced while the tenant has ``org_rules`` on.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import Department, is_root_department

UNRESTRICTED_ROLES = ("owner", "admin")


async def hidden_department_ids(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    kind: str,
    member_id: UUID | None,
    role: str | None = None,
) -> set[UUID]:
    """Departments whose work this person or agent may not read."""
    from app.services.org_rules import org_rules_on
    from app.services.teams import direct_department_ids

    if role in UNRESTRICTED_ROLES or not await org_rules_on(session, tenant_id):
        return set()
    rows = (
        await session.execute(
            select(Department).where(Department.tenant_id == tenant_id, Department.deleted_at.is_(None))
        )
    ).scalars().all()
    shielded = {d.id for d in rows if d.visibility == "shielded" and not is_root_department(d)}
    if not shielded:
        return set()
    parent_of = {d.id: d.parent_id for d in rows}
    roots = {d.id for d in rows if is_root_department(d)}
    seats = await direct_department_ids(session, tenant_id, kind, member_id) if member_id else set()
    if kind == "user":
        seats -= roots

    def chain(dept: UUID) -> list[UUID]:
        out: list[UUID] = []
        cur: UUID | None = dept
        while cur is not None and cur not in out:
            out.append(cur)
            cur = parent_of.get(cur)
        return out

    seat_chains = {seat: set(chain(seat)) for seat in seats}

    def may_read_branch(node: UUID) -> bool:
        # In the branch (node is on the seat's chain) or above it (seat is on node's chain).
        above = set(chain(node))
        return any(node in up or seat in above for seat, up in seat_chains.items())

    readable = {s: may_read_branch(s) for s in shielded}
    return {d.id for d in rows if any(not readable[s] for s in chain(d.id) if s in shielded)}


async def department_visible(
    session: AsyncSession,
    tenant_id: UUID,
    department_id: UUID | None,
    *,
    kind: str,
    member_id: UUID | None,
    role: str | None = None,
) -> bool:
    if department_id is None:
        return True
    hidden = await hidden_department_ids(session, tenant_id, kind=kind, member_id=member_id, role=role)
    return department_id not in hidden


async def hidden_signal_clause(session: AsyncSession, tenant_id: UUID, hidden: set[UUID]) -> Any | None:
    """SQL clause that matches conversations of hidden departments; None when nothing is hidden.

    A conversation belongs to a department through its flow label or a
    department owner, the same signals ``department_of_signal`` reads first.
    """
    if not hidden:
        return None
    from app.models.signal import Signal
    from app.services.department_access import department_flow_tag_ids

    tags = await department_flow_tag_ids(session, tenant_id, hidden)
    # Explicit NOT NULL: a NULL inside IN would turn the negated clause NULL and hide the row.
    clauses = [
        and_(Signal.assignee_kind == "department", Signal.assignee_id.is_not(None), Signal.assignee_id.in_(hidden))
    ]
    if tags:
        clauses.append(and_(Signal.ticket_tag_id.is_not(None), Signal.ticket_tag_id.in_(tags)))
    return or_(*clauses)


async def agent_hidden_clause(session: AsyncSession, tenant_id: UUID, agent: Any | None) -> Any | None:
    """For read tools: the clause to leave out, given the calling agent."""
    if agent is None:
        return None
    hidden = await hidden_department_ids(session, tenant_id, kind="agent", member_id=agent.id)
    return await hidden_signal_clause(session, tenant_id, hidden)


__all__ = [
    "agent_hidden_clause",
    "department_visible",
    "hidden_department_ids",
    "hidden_signal_clause",
]
