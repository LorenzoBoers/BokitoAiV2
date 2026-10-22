"""Department access: who leads a department and what a freelancer may see.

A department's lead is its primary agent; the person accountable is its
primary user. Flows belong to a department through ``Workstream.department_id``.

A member with ``Membership.scope == "departments"`` sees only conversations
whose flow label belongs to a department they are in (or one below it),
conversations assigned to them, and conversations they take part in. The rule
rides on the channel ACL set (``ConversationAccess``) so every list, count and
search that already applies the ACL applies this too.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership
from app.models.orchestra import Workstream
from app.models.signal import SignalTag
from app.models.team import ALL_DEPARTMENT_NAME, Department, DepartmentMember

SCOPES = ("workspace", "departments")


class ConversationAccess(set):
    """Visible channel ids plus the department rule for a scoped member."""

    def __init__(self, account_ids, *, user_id: UUID, flow_tag_ids: set[UUID]):
        super().__init__(account_ids)
        self.user_id = user_id
        self.flow_tag_ids = set(flow_tag_ids)


async def membership_scope(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> str:
    row = (
        await session.execute(
            select(Membership.scope).where(Membership.tenant_id == tenant_id, Membership.user_id == user_id)
        )
    ).scalar_one_or_none()
    return row if row in SCOPES else "workspace"


async def accessible_department_ids(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> set[UUID]:
    """Departments the user is in, plus every department below those.

    Everyone sits in the All root, so that membership grants nothing here.
    """
    direct = set(
        (
            await session.execute(
                select(DepartmentMember.department_id)
                .join(Department, Department.id == DepartmentMember.department_id)
                .where(
                    DepartmentMember.tenant_id == tenant_id,
                    DepartmentMember.member_kind == "user",
                    DepartmentMember.user_id == user_id,
                    or_(Department.parent_id.is_not(None), Department.name != ALL_DEPARTMENT_NAME),
                )
            )
        ).scalars().all()
    )
    if not direct:
        return set()
    rows = (
        await session.execute(
            select(Department.id, Department.parent_id).where(
                Department.tenant_id == tenant_id, Department.deleted_at.is_(None)
            )
        )
    ).all()
    children: dict[UUID, list[UUID]] = {}
    for dept_id, parent_id in rows:
        if parent_id is not None:
            children.setdefault(parent_id, []).append(dept_id)
    out: set[UUID] = set()
    stack = list(direct)
    while stack:
        current = stack.pop()
        if current in out:
            continue
        out.add(current)
        stack.extend(children.get(current, []))
    return out


async def department_flow_tag_ids(session: AsyncSession, tenant_id: UUID, department_ids: set[UUID]) -> set[UUID]:
    if not department_ids:
        return set()
    return set(
        (
            await session.execute(
                select(SignalTag.id)
                .join(Workstream, Workstream.id == SignalTag.workstream_id)
                .where(SignalTag.tenant_id == tenant_id, Workstream.department_id.in_(department_ids))
            )
        ).scalars().all()
    )


async def scoped_access(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, account_ids: set[UUID]
) -> set[UUID] | ConversationAccess:
    """Wrap the channel ids with the department rule when the member is scoped."""
    if await membership_scope(session, tenant_id, user_id) != "departments":
        return account_ids
    departments = await accessible_department_ids(session, tenant_id, user_id)
    tags = await department_flow_tag_ids(session, tenant_id, departments)
    return ConversationAccess(account_ids, user_id=user_id, flow_tag_ids=tags)


def department_predicate(access: Any):
    """Extra clause for a scoped member; None for everyone else."""
    if not isinstance(access, ConversationAccess):
        return None
    from app.models.signal import Signal
    from app.models.signal_participant import SignalParticipant

    takes_part = (
        select(SignalParticipant.id)
        .where(
            SignalParticipant.signal_id == Signal.id,
            SignalParticipant.kind == "user",
            SignalParticipant.ref_id == access.user_id,
            SignalParticipant.left_at.is_(None),
        )
        .exists()
    )
    assigned = and_(Signal.assignee_kind == "user", Signal.assignee_id == access.user_id)
    clauses = [assigned, takes_part]
    if access.flow_tag_ids:
        clauses.append(Signal.ticket_tag_id.in_(access.flow_tag_ids))
    return or_(*clauses)


async def department_leads(session: AsyncSession, tenant_id: UUID, department_id: UUID) -> dict[str, Any]:
    """The lead (primary agent) and the person accountable (primary user)."""
    rows = (
        await session.execute(
            select(DepartmentMember).where(
                DepartmentMember.tenant_id == tenant_id,
                DepartmentMember.department_id == department_id,
                DepartmentMember.duty == "primary",
            )
        )
    ).scalars().all()
    lead = next((r.agent_id for r in rows if r.member_kind == "agent" and r.agent_id), None)
    accountable = next((r.user_id for r in rows if r.member_kind == "user" and r.user_id), None)
    return {"lead_agent_id": lead, "accountable_user_id": accountable}


__all__ = [
    "SCOPES",
    "ConversationAccess",
    "accessible_department_ids",
    "department_flow_tag_ids",
    "department_leads",
    "department_predicate",
    "membership_scope",
    "scoped_access",
]
