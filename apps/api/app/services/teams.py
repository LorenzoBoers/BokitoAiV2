"""Teams: groups of people and agents used as owner, addressee and mention target.

Every workspace has two system teams whose members are computed:

- ``people``: every active member of the workspace;
- ``agents``: every active company agent.

Custom teams store their members in ``team_members`` and may mix both.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Membership, User
from app.models.team import (
    PICKUP_MODES,
    SYSTEM_TEAM_KINDS,
    TEAM_KIND_AGENTS,
    TEAM_KIND_CUSTOM,
    TEAM_KIND_PEOPLE,
    Team,
    TeamMember,
)

SYSTEM_TEAM_NAMES = {TEAM_KIND_PEOPLE: "All people", TEAM_KIND_AGENTS: "All agents"}


@dataclass(frozen=True)
class MemberRef:
    kind: str  # user | agent
    id: UUID

    @property
    def key(self) -> str:
        return f"{self.kind}:{self.id}"


async def ensure_system_teams(session: AsyncSession, tenant_id: UUID) -> dict[str, Team]:
    """Create the two system teams when missing; returns them by kind."""
    rows = (
        await session.execute(
            select(Team).where(Team.tenant_id == tenant_id, Team.kind.in_(SYSTEM_TEAM_KINDS))
        )
    ).scalars().all()
    by_kind = {row.kind: row for row in rows}
    created = False
    for kind in SYSTEM_TEAM_KINDS:
        if kind not in by_kind:
            team = Team(tenant_id=tenant_id, name=SYSTEM_TEAM_NAMES[kind], kind=kind)
            session.add(team)
            by_kind[kind] = team
            created = True
    if created:
        await session.flush()
    return by_kind


async def people_team(session: AsyncSession, tenant_id: UUID) -> Team:
    return (await ensure_system_teams(session, tenant_id))[TEAM_KIND_PEOPLE]


async def get_team(session: AsyncSession, tenant_id: UUID, team_id: UUID) -> Team | None:
    return (
        await session.execute(select(Team).where(Team.id == team_id, Team.tenant_id == tenant_id))
    ).scalar_one_or_none()


async def list_teams(session: AsyncSession, tenant_id: UUID) -> list[Team]:
    await ensure_system_teams(session, tenant_id)
    rows = (
        await session.execute(select(Team).where(Team.tenant_id == tenant_id))
    ).scalars().all()
    order = {TEAM_KIND_PEOPLE: 0, TEAM_KIND_AGENTS: 1}
    return sorted(rows, key=lambda t: (order.get(t.kind, 2), t.name.lower()))


async def _workspace_user_ids(session: AsyncSession, tenant_id: UUID) -> list[UUID]:
    rows = await session.execute(
        select(Membership.user_id)
        .join(User, User.id == Membership.user_id)
        .where(Membership.tenant_id == tenant_id, User.is_active.is_(True))
    )
    return list(rows.scalars().all())


async def _workspace_agent_ids(session: AsyncSession, tenant_id: UUID) -> list[UUID]:
    rows = await session.execute(
        select(Agent.id).where(
            Agent.tenant_id == tenant_id,
            Agent.is_active.is_(True),
            Agent.kind == "company",
            Agent.acts_for_user.is_(False),
        )
    )
    return list(rows.scalars().all())


async def team_members(session: AsyncSession, team: Team) -> list[MemberRef]:
    if team.kind == TEAM_KIND_PEOPLE:
        return [MemberRef("user", uid) for uid in await _workspace_user_ids(session, team.tenant_id)]
    if team.kind == TEAM_KIND_AGENTS:
        return [MemberRef("agent", aid) for aid in await _workspace_agent_ids(session, team.tenant_id)]
    rows = (
        await session.execute(select(TeamMember).where(TeamMember.team_id == team.id))
    ).scalars().all()
    refs: list[MemberRef] = []
    for row in rows:
        if row.member_kind == "user" and row.user_id:
            refs.append(MemberRef("user", row.user_id))
        elif row.member_kind == "agent" and row.agent_id:
            refs.append(MemberRef("agent", row.agent_id))
    return refs


async def team_user_ids(session: AsyncSession, team: Team) -> list[UUID]:
    return [ref.id for ref in await team_members(session, team) if ref.kind == "user"]


async def team_agent_ids(session: AsyncSession, team: Team) -> list[UUID]:
    return [ref.id for ref in await team_members(session, team) if ref.kind == "agent"]


async def user_team_ids(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, *, include_system: bool = True
) -> set[UUID]:
    """Teams the user belongs to. The people team counts unless excluded."""
    ids = set(
        (
            await session.execute(
                select(TeamMember.team_id).where(
                    TeamMember.tenant_id == tenant_id,
                    TeamMember.member_kind == "user",
                    TeamMember.user_id == user_id,
                )
            )
        ).scalars().all()
    )
    if include_system:
        ids.add((await people_team(session, tenant_id)).id)
    return ids


async def agent_team_ids(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> set[UUID]:
    ids = set(
        (
            await session.execute(
                select(TeamMember.team_id).where(
                    TeamMember.tenant_id == tenant_id,
                    TeamMember.member_kind == "agent",
                    TeamMember.agent_id == agent_id,
                )
            )
        ).scalars().all()
    )
    ids.add((await ensure_system_teams(session, tenant_id))[TEAM_KIND_AGENTS].id)
    return ids


async def create_team(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    name: str,
    description: str = "",
    pickup: str = "people",
    pinned: bool = False,
    members: list[dict[str, str]] | None = None,
) -> Team:
    if pickup not in PICKUP_MODES:
        raise ValueError("Invalid pickup mode")
    team = Team(
        tenant_id=tenant_id,
        name=name.strip()[:80],
        description=description.strip()[:300],
        kind=TEAM_KIND_CUSTOM,
        pickup=pickup,
        pinned=pinned,
    )
    session.add(team)
    await session.flush()
    if members is not None:
        await set_team_members(session, team, members)
    return team


async def set_team_members(session: AsyncSession, team: Team, members: list[dict[str, str]]) -> None:
    """Replace the member list of a custom team (ignored for system teams)."""
    if team.kind in SYSTEM_TEAM_KINDS:
        raise ValueError("System team members are computed")
    allowed_users = set(await _workspace_user_ids(session, team.tenant_id))
    allowed_agents = set(await _workspace_agent_ids(session, team.tenant_id))
    await session.execute(delete(TeamMember).where(TeamMember.team_id == team.id))
    seen: set[str] = set()
    for entry in members:
        kind = str(entry.get("kind") or "")
        try:
            member_id = UUID(str(entry.get("id") or ""))
        except ValueError:
            continue
        key = f"{kind}:{member_id}"
        if key in seen:
            continue
        if kind == "user" and member_id in allowed_users:
            session.add(
                TeamMember(tenant_id=team.tenant_id, team_id=team.id, member_kind="user", user_id=member_id)
            )
        elif kind == "agent" and member_id in allowed_agents:
            session.add(
                TeamMember(tenant_id=team.tenant_id, team_id=team.id, member_kind="agent", agent_id=member_id)
            )
        else:
            continue
        seen.add(key)
    team.updated_at = datetime.utcnow()
    session.add(team)


async def delete_team(session: AsyncSession, team: Team) -> None:
    from sqlalchemy import update

    from app.models.notification import DecisionRequest
    from app.models.signal import Signal

    if team.kind in SYSTEM_TEAM_KINDS:
        raise ValueError("System teams cannot be deleted")
    fallback = await people_team(session, team.tenant_id)
    await session.execute(
        update(Signal)
        .where(Signal.tenant_id == team.tenant_id, Signal.assignee_team_id == team.id)
        .values(assignee_team_id=fallback.id)
    )
    await session.execute(
        update(Signal)
        .where(Signal.tenant_id == team.tenant_id, Signal.turn_team_id == team.id)
        .values(turn_team_id=fallback.id)
    )
    await session.execute(
        update(DecisionRequest)
        .where(DecisionRequest.tenant_id == team.tenant_id, DecisionRequest.addressee_team_id == team.id)
        .values(addressee_team_id=fallback.id)
    )
    await session.execute(delete(TeamMember).where(TeamMember.team_id == team.id))
    await session.delete(team)


async def serialize_team(session: AsyncSession, team: Team) -> dict[str, Any]:
    members = await team_members(session, team)
    return {
        "id": str(team.id),
        "name": team.name,
        "description": team.description,
        "kind": team.kind,
        "system": team.kind in SYSTEM_TEAM_KINDS,
        "pickup": team.pickup,
        "pinned": bool(team.pinned),
        "members": [{"kind": ref.kind, "id": str(ref.id)} for ref in members],
        "member_count": len(members),
    }


async def team_names(session: AsyncSession, tenant_id: UUID) -> dict[UUID, str]:
    rows = (await session.execute(select(Team.id, Team.name).where(Team.tenant_id == tenant_id))).all()
    return {row[0]: row[1] for row in rows}
