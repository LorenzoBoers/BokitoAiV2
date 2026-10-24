"""Department access: who is its point of contact and what a freelancer may see.

A department's point of contact is its primary agent (or, without one, its
first active agent); the person accountable is its primary user. A flow's department is the label's; older rows still read
``Workstream.department_id`` when the label has none.

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
    """Visible channel ids plus the department rules for a member.

    ``scoped``: a freelancer who sees only their departments (``flow_tag_ids``).
    ``hidden``: a clause for conversations of shielded departments they may not read.
    """

    def __init__(self, account_ids, *, user_id: UUID, flow_tag_ids: set[UUID], scoped: bool = True, hidden: Any = None):
        super().__init__(account_ids)
        self.user_id = user_id
        self.flow_tag_ids = set(flow_tag_ids)
        self.scoped = scoped
        self.hidden = hidden


async def membership_scope(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> str:
    row = (
        await session.execute(
            select(Membership.scope).where(Membership.tenant_id == tenant_id, Membership.user_id == user_id)
        )
    ).scalar_one_or_none()
    return row if row in SCOPES else "workspace"


async def accessible_department_ids(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> set[UUID]:
    """Departments the user is in, plus every department below those.

    Everyone is on the organization root, so that membership grants nothing here.
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
                .where(
                    SignalTag.tenant_id == tenant_id,
                    or_(
                        SignalTag.department_id.in_(department_ids),
                        Workstream.department_id.in_(department_ids),
                    ),
                )
            )
        ).scalars().all()
    )


async def scoped_access(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, account_ids: set[UUID]
) -> set[UUID] | ConversationAccess:
    """Wrap the channel ids with the department rules that apply to this member."""
    from app.services.department_visibility import hidden_department_ids, hidden_signal_clause

    hidden_ids = await hidden_department_ids(session, tenant_id, kind="user", member_id=user_id)
    hidden = await hidden_signal_clause(session, tenant_id, hidden_ids)
    if await membership_scope(session, tenant_id, user_id) != "departments":
        if hidden is None:
            return account_ids
        return ConversationAccess(account_ids, user_id=user_id, flow_tag_ids=set(), scoped=False, hidden=hidden)
    departments = await accessible_department_ids(session, tenant_id, user_id)
    tags = await department_flow_tag_ids(session, tenant_id, departments)
    return ConversationAccess(account_ids, user_id=user_id, flow_tag_ids=tags, hidden=hidden)


def department_predicate(access: Any):
    """Extra clause for a scoped member or shielded work; None for everyone else."""
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
    if not access.scoped:
        return or_(assigned, takes_part, ~access.hidden) if access.hidden is not None else None
    clauses = [assigned, takes_part]
    if access.flow_tag_ids:
        clauses.append(Signal.ticket_tag_id.in_(access.flow_tag_ids))
    if access.hidden is not None:
        return and_(or_(*clauses), or_(assigned, takes_part, ~access.hidden))
    return or_(*clauses)


async def department_roles(session: AsyncSession, tenant_id: UUID, department_id: UUID) -> dict[str, Any]:
    """The point of contact (agent) and the person accountable (user) of one department.

    The point of contact is the active agent with duty primary. Without one, the
    first active agent by position is the point of contact (``contact_implicit``),
    so a department with a single agent needs no setup. Paused agents and the
    personal helper never count.
    """
    from app.models.agent import Agent

    rows = (
        await session.execute(
            select(DepartmentMember).where(
                DepartmentMember.tenant_id == tenant_id,
                DepartmentMember.department_id == department_id,
            )
        )
    ).scalars().all()
    rows = sorted(rows, key=lambda r: (r.position, str(r.id)))
    agent_ids = [r.agent_id for r in rows if r.member_kind == "agent" and r.agent_id]
    active = set(
        (
            await session.execute(
                select(Agent.id).where(
                    Agent.id.in_(agent_ids),
                    Agent.is_active.is_(True),
                    Agent.kind == "company",
                    Agent.acts_for_user.is_(False),
                )
            )
        ).scalars().all()
    ) if agent_ids else set()
    agents = [r for r in rows if r.member_kind == "agent" and r.agent_id in active]
    explicit = next((r.agent_id for r in agents if r.duty == "primary"), None)
    contact = explicit or (agents[0].agent_id if agents else None)
    accountable = next(
        (r.user_id for r in rows if r.member_kind == "user" and r.user_id and r.duty == "primary"), None
    )
    return {
        "contact_agent_id": contact,
        "contact_implicit": contact is not None and explicit is None,
        "accountable_user_id": accountable,
    }


async def department_contact(session: AsyncSession, tenant_id: UUID, department_id: UUID):
    """(agent, implicit) for the department's point of contact, or (None, False)."""
    from app.models.agent import Agent

    roles = await department_roles(session, tenant_id, department_id)
    agent_id = roles["contact_agent_id"]
    if agent_id is None:
        return None, False
    return await session.get(Agent, agent_id), bool(roles["contact_implicit"])


__all__ = [
    "SCOPES",
    "ConversationAccess",
    "accessible_department_ids",
    "department_contact",
    "department_flow_tag_ids",
    "department_roles",
    "department_predicate",
    "membership_scope",
    "scoped_access",
]
