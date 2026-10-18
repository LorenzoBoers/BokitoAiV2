"""Departments: groups of people and agents used as owner, addressee and mention target.

Every workspace has one root **All** department (``parent_id`` null). Custom
departments nest under All. Membership is stored in ``department_members``;
a member of a child is treated as a member of every ancestor up to All.
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
from app.models.signal import Signal
from app.models.team import (
    ALL_DEPARTMENT_NAME,
    PICKUP_MODES,
    TEAM_KIND_CUSTOM,
    Team,
    TeamMember,
    is_root_department,
)


@dataclass(frozen=True)
class MemberRef:
    kind: str  # user | agent
    id: UUID
    duty: str = "member"  # primary | backup | member
    position: int = 0

    @property
    def key(self) -> str:
        return f"{self.kind}:{self.id}"


async def ensure_all_department(session: AsyncSession, tenant_id: UUID) -> Team:
    """Return the All root, creating it when missing."""
    from app.services.trash import alive

    row = (
        await session.execute(
            select(Team).where(
                Team.tenant_id == tenant_id,
                Team.parent_id.is_(None),
                Team.name == ALL_DEPARTMENT_NAME,
                alive(Team),
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        if not row.pinned:
            row.pinned = True
            session.add(row)
            await session.flush()
        return row
    team = Team(
        tenant_id=tenant_id,
        name=ALL_DEPARTMENT_NAME,
        description="",
        kind=TEAM_KIND_CUSTOM,
        pickup="people",
        pinned=True,
        parent_id=None,
    )
    session.add(team)
    await session.flush()
    await _seed_all_members(session, team)
    return team


async def all_department(session: AsyncSession, tenant_id: UUID) -> Team:
    return await ensure_all_department(session, tenant_id)


async def _seed_all_members(session: AsyncSession, all_team: Team) -> None:
    """Put every active person and company agent into All (idempotent)."""
    existing_users = set(
        (
            await session.execute(
                select(TeamMember.user_id).where(
                    TeamMember.department_id == all_team.id,
                    TeamMember.member_kind == "user",
                    TeamMember.user_id.is_not(None),
                )
            )
        ).scalars().all()
    )
    existing_agents = set(
        (
            await session.execute(
                select(TeamMember.agent_id).where(
                    TeamMember.department_id == all_team.id,
                    TeamMember.member_kind == "agent",
                    TeamMember.agent_id.is_not(None),
                )
            )
        ).scalars().all()
    )
    position = int(
        (
            await session.execute(
                select(TeamMember.position)
                .where(TeamMember.department_id == all_team.id)
                .order_by(TeamMember.position.desc())
                .limit(1)
            )
        ).scalar()
        or -1
    ) + 1
    for uid in await _workspace_user_ids(session, all_team.tenant_id):
        if uid in existing_users:
            continue
        session.add(
            TeamMember(
                tenant_id=all_team.tenant_id,
                department_id=all_team.id,
                member_kind="user",
                user_id=uid,
                duty="member",
                position=position,
            )
        )
        position += 1
    for aid in await _workspace_agent_ids(session, all_team.tenant_id):
        if aid in existing_agents:
            continue
        session.add(
            TeamMember(
                tenant_id=all_team.tenant_id,
                department_id=all_team.id,
                member_kind="agent",
                agent_id=aid,
                duty="member",
                position=position,
            )
        )
        position += 1
    await session.flush()


async def get_team(session: AsyncSession, tenant_id: UUID, team_id: UUID) -> Team | None:
    from app.services.trash import alive

    return (
        await session.execute(
            select(Team).where(Team.id == team_id, Team.tenant_id == tenant_id, alive(Team))
        )
    ).scalar_one_or_none()


async def list_teams(
    session: AsyncSession, tenant_id: UUID, *, include_system: bool = True
) -> list[Team]:
    await ensure_all_department(session, tenant_id)
    from app.services.trash import alive

    rows = list(
        (
            await session.execute(
                select(Team).where(Team.tenant_id == tenant_id, alive(Team))
            )
        )
        .scalars()
        .all()
    )
    dirty = False
    for row in rows:
        if not is_root_department(row) and not row.pinned:
            row.pinned = True
            session.add(row)
            dirty = True
    if dirty:
        await session.flush()
    visible = rows if include_system else [row for row in rows if not is_root_department(row)]
    return sorted(
        visible,
        key=lambda t: (0 if is_root_department(t) else 1, t.name.lower()),
    )


async def _workspace_user_ids(session: AsyncSession, tenant_id: UUID) -> list[UUID]:
    rows = await session.execute(
        select(Membership.user_id)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.tenant_id == tenant_id,
            Membership.is_active.is_(True),
            User.is_active.is_(True),
        )
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
    rows = (
        await session.execute(select(TeamMember).where(TeamMember.department_id == team.id))
    ).scalars().all()
    refs: list[MemberRef] = []
    ordered = sorted(rows, key=lambda row: (row.position, str(row.id)))
    for row in ordered:
        if row.member_kind == "user" and row.user_id:
            refs.append(MemberRef("user", row.user_id, row.duty or "member", row.position))
        elif row.member_kind == "agent" and row.agent_id:
            refs.append(MemberRef("agent", row.agent_id, row.duty or "member", row.position))
    return refs


async def team_user_ids(session: AsyncSession, team: Team) -> list[UUID]:
    return [ref.id for ref in await team_members(session, team) if ref.kind == "user"]


async def team_agent_ids(session: AsyncSession, team: Team) -> list[UUID]:
    return [ref.id for ref in await team_members(session, team) if ref.kind == "agent"]


async def _ancestor_ids(session: AsyncSession, tenant_id: UUID, department_ids: set[UUID]) -> set[UUID]:
    """Expand department ids with every parent up to All."""
    if not department_ids:
        return set()
    from app.services.trash import alive

    rows = list(
        (
            await session.execute(
                select(Team.id, Team.parent_id).where(
                    Team.tenant_id == tenant_id, alive(Team)
                )
            )
        ).all()
    )
    parent_of = {row[0]: row[1] for row in rows}
    out = set(department_ids)
    for start in list(department_ids):
        cur = start
        seen: set[UUID] = set()
        while cur is not None and cur not in seen:
            seen.add(cur)
            out.add(cur)
            cur = parent_of.get(cur)
    return out


async def user_team_ids(
    session: AsyncSession, tenant_id: UUID, user_id: UUID, *, include_system: bool = True
) -> set[UUID]:
    """Departments the user belongs to, including ancestors up to All."""
    direct = set(
        (
            await session.execute(
                select(TeamMember.department_id).where(
                    TeamMember.tenant_id == tenant_id,
                    TeamMember.member_kind == "user",
                    TeamMember.user_id == user_id,
                )
            )
        ).scalars().all()
    )
    ids = await _ancestor_ids(session, tenant_id, direct)
    if not include_system:
        root = await ensure_all_department(session, tenant_id)
        ids.discard(root.id)
    return ids


async def agent_team_ids(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> set[UUID]:
    direct = set(
        (
            await session.execute(
                select(TeamMember.department_id).where(
                    TeamMember.tenant_id == tenant_id,
                    TeamMember.member_kind == "agent",
                    TeamMember.agent_id == agent_id,
                )
            )
        ).scalars().all()
    )
    ids = await _ancestor_ids(session, tenant_id, direct)
    root = await ensure_all_department(session, tenant_id)
    ids.add(root.id)
    return ids


async def create_team(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    name: str,
    description: str = "",
    pickup: str = "people",
    members: list[dict[str, str]] | None = None,
    parent_id: UUID | None = None,
) -> Team:
    if pickup not in PICKUP_MODES:
        raise ValueError("Invalid pickup mode")
    root = await ensure_all_department(session, tenant_id)
    parent = root.id if parent_id is None else parent_id
    if parent != root.id:
        parent_row = await get_team(session, tenant_id, parent)
        if parent_row is None:
            raise ValueError("Parent department not found")
    team = Team(
        tenant_id=tenant_id,
        name=name.strip()[:80],
        description=description.strip()[:300],
        kind=TEAM_KIND_CUSTOM,
        pickup=pickup,
        pinned=True,
        parent_id=parent,
    )
    session.add(team)
    await session.flush()
    if members is not None:
        await set_team_members(session, team, members)
    return team


async def set_team_members(session: AsyncSession, team: Team, members: list[dict[str, str]]) -> None:
    """Replace the member list of a custom department."""
    if is_root_department(team):
        # All keeps a full roster; allow replace but re-seed afterward is safer —
        # operators should not empty All. Reject edits that would leave it empty
        # of people? Spec: All is undeletable; members are maintained. Allow set.
        pass
    allowed_users = set(await _workspace_user_ids(session, team.tenant_id))
    allowed_agents = set(await _workspace_agent_ids(session, team.tenant_id))
    await session.execute(delete(TeamMember).where(TeamMember.department_id == team.id))
    seen: set[str] = set()
    primary = {"user": False, "agent": False}
    position = 0
    for entry in members:
        kind = str(entry.get("kind") or "")
        try:
            member_id = UUID(str(entry.get("id") or ""))
        except ValueError:
            continue
        key = f"{kind}:{member_id}"
        if key in seen or kind not in ("user", "agent"):
            continue
        allowed = allowed_users if kind == "user" else allowed_agents
        if member_id not in allowed:
            continue
        duty = str(entry.get("duty") or "member")
        if duty not in ("primary", "backup", "member"):
            duty = "member"
        if duty == "primary":
            if primary[kind]:
                duty = "member"
            else:
                primary[kind] = True
        session.add(
            TeamMember(
                tenant_id=team.tenant_id,
                department_id=team.id,
                member_kind=kind,
                user_id=member_id if kind == "user" else None,
                agent_id=member_id if kind == "agent" else None,
                duty=duty,
                position=position,
            )
        )
        seen.add(key)
        position += 1
    team.updated_at = datetime.utcnow()
    session.add(team)


async def delete_team(session: AsyncSession, team: Team, *, permanent: bool = False) -> None:
    from sqlalchemy import update

    from app.models.notification import DecisionRequest
    from app.models.signal import Signal
    from app.services.trash import load_tenant, move_to_bin

    if is_root_department(team):
        raise ValueError("The All department cannot be deleted")
    if not permanent:
        tenant = await load_tenant(session, team.tenant_id)
        await move_to_bin(
            session,
            tenant,
            resource_type="team",
            row=team,
            user_id=None,
            commit=True,
        )
        return
    fallback = await all_department(session, team.tenant_id)
    # Reparent children under All before delete.
    await session.execute(
        update(Team)
        .where(Team.tenant_id == team.tenant_id, Team.parent_id == team.id)
        .values(parent_id=fallback.id, updated_at=datetime.utcnow())
    )
    await session.execute(
        update(Signal)
        .where(
            Signal.tenant_id == team.tenant_id,
            Signal.assignee_kind == "department",
            Signal.assignee_id == team.id,
        )
        .values(assignee_id=fallback.id)
    )
    await session.execute(
        update(Signal)
        .where(
            Signal.tenant_id == team.tenant_id,
            Signal.turn_kind == "department",
            Signal.turn_ref_id == team.id,
        )
        .values(turn_ref_id=fallback.id)
    )
    await session.execute(
        update(DecisionRequest)
        .where(DecisionRequest.tenant_id == team.tenant_id, DecisionRequest.addressee_department_id == team.id)
        .values(addressee_department_id=fallback.id)
    )
    await session.execute(delete(TeamMember).where(TeamMember.department_id == team.id))
    await session.delete(team)


async def _team_presence_payload(session: AsyncSession, team: Team, members: list[MemberRef]) -> dict[str, Any]:
    from app.models.agent import AgentRun
    from app.services.presence import (
        agent_corner_status,
        serialize_team_presence,
        statuses_for,
        team_status,
    )

    user_ids = [ref.id for ref in members if ref.kind == "user"]
    agent_ids = [ref.id for ref in members if ref.kind == "agent"]
    person_statuses = list((await statuses_for(session, user_ids)).values()) if user_ids else []
    agent_statuses: list[str] = []
    if agent_ids:
        agents = list(
            (
                await session.execute(
                    select(Agent).where(
                        Agent.id.in_(agent_ids),
                        Agent.is_active.is_(True),
                        Agent.kind == "company",
                        Agent.acts_for_user.is_(False),
                    )
                )
            )
            .scalars()
            .all()
        )
        running_ids: set[UUID] = set()
        if agents:
            running_ids = set(
                (
                    await session.execute(
                        select(AgentRun.agent_id).where(
                            AgentRun.tenant_id == team.tenant_id,
                            AgentRun.agent_id.in_([a.id for a in agents]),
                            AgentRun.status == "running",
                        )
                    )
                )
                .scalars()
                .all()
            )
        for agent in agents:
            corner = agent_corner_status(agent, has_running_run=agent.id in running_ids)
            if corner is not None:
                agent_statuses.append(corner)
    return serialize_team_presence(team_status(person_statuses, agent_statuses=agent_statuses))


async def serialize_team(session: AsyncSession, team: Team) -> dict[str, Any]:
    from app.services.team_avatar import avatar_payload

    members = await team_members(session, team)
    avatar = avatar_payload(team)
    root = is_root_department(team)
    return {
        "id": str(team.id),
        "name": team.name,
        "description": team.description,
        "kind": team.kind,
        "system": root,
        "root": root,
        "parent_id": str(team.parent_id) if team.parent_id else None,
        "pickup": team.pickup,
        "pinned": True,
        "members": [
            {"kind": ref.kind, "id": str(ref.id), "duty": ref.duty, "position": ref.position}
            for ref in members
        ],
        "member_count": len(members),
        "presence": await _team_presence_payload(session, team, members),
        "avatar_kind": avatar["avatar_kind"],
        "avatar_icon": avatar["avatar_icon"],
        "avatar_color": avatar["avatar_color"],
        "avatar_image_url": avatar["avatar_image_url"],
    }


async def team_names(session: AsyncSession, tenant_id: UUID) -> dict[UUID, str]:
    rows = (await session.execute(select(Team.id, Team.name).where(Team.tenant_id == tenant_id))).all()
    return {row[0]: row[1] for row in rows}


async def get_or_create_team_room(session: AsyncSession, tenant_id: UUID, team: Team) -> Signal:
    """Standing internal conversation for a pinned team's Groepschat row."""
    existing = (
        await session.execute(
            select(Signal)
            .where(
                Signal.tenant_id == tenant_id,
                Signal.channel == "internal",
                Signal.source == "department",
                Signal.assignee_kind == "department",
                Signal.assignee_id == team.id,
            )
            .order_by(Signal.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing:
        if existing.subject in ("", "(No subject)") or existing.subject == existing.contact_name:
            existing.subject = team.name
        if not existing.contact_name:
            existing.contact_name = team.name
        if existing.assignee_kind != "department":
            existing.assignee_kind = "department"
            existing.assignee_id = team.id
        if existing.turn_reason == "room":
            existing.turn_kind = ""
            existing.turn_ref_id = None
            existing.turn_reason = ""
        return existing

    now = datetime.utcnow()
    signal = Signal(
        tenant_id=tenant_id,
        channel="internal",
        source="department",
        subject=team.name,
        contact_name=team.name,
        status="open",
        priority="normal",
        assignee_kind="department",
        assignee_id=team.id,
        last_message_at=now,
        has_unread=False,
    )
    session.add(signal)
    await session.flush()
    return signal
