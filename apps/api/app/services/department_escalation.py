"""Who an agent asks inside a department.

Order: the primary person, then the primary agent, then everyone else by
``position``. Skip anyone away, deactivated, or already on another open
conversation. Nobody free means the conversation stays with the department.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Membership, User
from app.models.signal import Signal
from app.models.team import Team, is_root_department
from app.services.teams import MemberRef, team_members


def escalation_sequence(members: list[MemberRef]) -> list[MemberRef]:
    """Primary person, primary agent, then the rest by position."""
    primary_user = [ref for ref in members if ref.kind == "user" and ref.duty == "primary"]
    primary_agent = [ref for ref in members if ref.kind == "agent" and ref.duty == "primary"]
    chosen = {ref.key for ref in primary_user + primary_agent}
    rest = sorted(
        (ref for ref in members if ref.key not in chosen),
        key=lambda ref: (ref.position, ref.key),
    )
    return primary_user + primary_agent + rest


async def _free(session: AsyncSession, team: Team, ref: MemberRef, signal_id: UUID | None) -> bool:
    from app.services.presence import AVAILABLE, user_status

    if ref.kind == "user":
        user = await session.get(User, ref.id)
        membership = (
            await session.execute(
                select(Membership).where(
                    Membership.tenant_id == team.tenant_id,
                    Membership.user_id == ref.id,
                )
            )
        ).scalar_one_or_none()
        if user is None or membership is None or not user.is_active or not membership.is_active:
            return False
        if user_status(user) != AVAILABLE:
            return False
        stmt = select(Signal.id).where(
            Signal.tenant_id == team.tenant_id,
            Signal.status == "open",
            Signal.assignee_kind == "user",
            Signal.assignee_id == ref.id,
        )
        if signal_id is not None:
            stmt = stmt.where(Signal.id != signal_id)
        busy = (await session.execute(stmt.limit(1))).first()
        return busy is None
    agent = await session.get(Agent, ref.id)
    if agent is None or agent.tenant_id != team.tenant_id or not agent.is_active:
        return False
    if agent.current_signal_id and agent.current_signal_id != signal_id:
        return False
    return True


async def first_available(
    session: AsyncSession, team: Team, *, signal_id: UUID | None = None
) -> MemberRef | None:
    """Next member to ask, or None so the department keeps the conversation."""
    if is_root_department(team):
        return None
    for ref in escalation_sequence(await team_members(session, team)):
        if await _free(session, team, ref, signal_id):
            return ref
    return None
