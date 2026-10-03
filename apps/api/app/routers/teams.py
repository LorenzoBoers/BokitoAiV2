"""Teams and the company team overview (people, agents, teams)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.agent import Agent
from app.models.auth import Membership, User
from app.models.signal import Signal
from app.services import presence
from app.services import teams as teams_svc
from app.gateway.publish import publish_presence
from app.services.audit import record_audit

router = APIRouter(prefix="/teams", tags=["teams"])


class TeamMemberRef(BaseModel):
    kind: Literal["user", "agent"]
    id: str


class TeamOut(BaseModel):
    id: str
    name: str
    description: str
    kind: str
    system: bool
    pickup: str
    pinned: bool = False
    members: list[TeamMemberRef]
    member_count: int


class TeamCreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    pickup: Literal["people", "agent_first", "round_robin", "least_open"] = "people"
    pinned: bool = False
    members: list[TeamMemberRef] = Field(default_factory=list)


class TeamPatchBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = None
    pickup: Literal["people", "agent_first", "round_robin", "least_open"] | None = None
    pinned: bool | None = None


class TeamMembersBody(BaseModel):
    members: list[TeamMemberRef]


class PresenceOut(BaseModel):
    status: Literal["available", "away", "offline"]
    last_seen_at: str | None = None
    away_until: str | None = None


class OverviewPerson(BaseModel):
    uuid: str
    name: str
    email: str
    avatar_url: str | None = None
    role: str
    presence: PresenceOut
    team_ids: list[str]
    open_owned: int
    open_turn: int


class OverviewMetrics(BaseModel):
    """Last 30 days."""

    questions: int = 0
    answer_minutes: float | None = None
    unchanged_rate: float | None = None
    picked_up: int = 0


class OverviewAgent(BaseModel):
    id: str
    name: str
    role: str
    autonomy_level: str
    team_ids: list[str]
    open_owned: int
    metrics: OverviewMetrics = Field(default_factory=OverviewMetrics)


class OverviewTeam(TeamOut):
    metrics: OverviewMetrics = Field(default_factory=OverviewMetrics)


class OverviewOut(BaseModel):
    people: list[OverviewPerson]
    agents: list[OverviewAgent]
    teams: list[OverviewTeam]


class AwayBody(BaseModel):
    away: bool
    until: datetime | None = None


async def _team_or_404(session: AsyncSession, tenant_id: UUID, team_id: str):
    try:
        tid = UUID(team_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Team not found") from exc
    team = await teams_svc.get_team(session, tenant_id, tid)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


@router.get("", response_model=list[TeamOut])
async def list_teams(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """List the workspace teams. The two system teams always come first."""
    rows = await teams_svc.list_teams(session, auth.tenant.id)
    out = [await teams_svc.serialize_team(session, row) for row in rows]
    await session.commit()
    return out


@router.post("", response_model=TeamOut, status_code=201)
async def create_team(
    body: TeamCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create a custom team of people and agents (owner or admin)."""
    auth.require_role("owner", "admin")
    team = await teams_svc.create_team(
        session,
        auth.tenant.id,
        name=body.name,
        description=body.description,
        pickup=body.pickup,
        pinned=body.pinned,
        members=[m.model_dump() for m in body.members],
    )
    await record_audit(
        session,
        auth.tenant.id,
        action="team:created",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="team",
        resource_id=team.id,
        summary=f"Team {team.name} created",
        commit=False,
    )
    await session.commit()
    return await teams_svc.serialize_team(session, team)


@router.patch("/{team_id}", response_model=TeamOut)
async def patch_team(
    team_id: str,
    body: TeamPatchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Rename a team, change its description, pickup, or sidebar pin.

    System teams accept a pickup change only.
    """
    auth.require_role("owner", "admin")
    team = await _team_or_404(session, auth.tenant.id, team_id)
    if team.kind in teams_svc.SYSTEM_TEAM_KINDS and (body.name is not None or body.description is not None):
        raise HTTPException(status_code=400, detail="System teams cannot be renamed")
    if body.name is not None:
        team.name = body.name.strip()
    if body.description is not None:
        team.description = body.description.strip()[:300]
    if body.pickup is not None:
        team.pickup = body.pickup
    if body.pinned is not None:
        team.pinned = body.pinned
    team.updated_at = datetime.utcnow()
    session.add(team)
    await session.commit()
    return await teams_svc.serialize_team(session, team)


@router.put("/{team_id}/members", response_model=TeamOut)
async def put_team_members(
    team_id: str,
    body: TeamMembersBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Replace the members of a custom team. System team members are computed."""
    auth.require_role("owner", "admin")
    team = await _team_or_404(session, auth.tenant.id, team_id)
    try:
        await teams_svc.set_team_members(session, team, [m.model_dump() for m in body.members])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return await teams_svc.serialize_team(session, team)


@router.delete("/{team_id}", status_code=204)
async def delete_team(
    team_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Delete a custom team. Its conversations and questions move to All people."""
    auth.require_role("owner", "admin")
    team = await _team_or_404(session, auth.tenant.id, team_id)
    try:
        await teams_svc.delete_team(session, team)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await record_audit(
        session,
        auth.tenant.id,
        action="team:deleted",
        actor_type="user",
        actor_id=auth.user.id,
        resource_type="team",
        resource_id=team_id,
        summary=f"Team {team.name} deleted",
        commit=False,
    )
    await session.commit()


@router.get("/overview", response_model=OverviewOut)
async def team_overview(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Company team overview: every person and agent with teams, workload and status.

    Agents and teams carry ``metrics`` for the last 30 days: questions, median
    answer time in minutes, share approved unchanged, and conversations picked up.
    """
    from app.services.team_metrics import empty_metrics, overview_metrics

    tenant_id = auth.tenant.id
    metrics = await overview_metrics(session, tenant_id)
    team_rows = await teams_svc.list_teams(session, tenant_id)
    teams_out = [
        {
            **await teams_svc.serialize_team(session, row),
            "metrics": metrics["teams"].get(str(row.id), empty_metrics()),
        }
        for row in team_rows
    ]
    membership: dict[str, list[str]] = {}
    for team in teams_out:
        for member in team["members"]:
            membership.setdefault(f"{member['kind']}:{member['id']}", []).append(team["id"])

    open_owned_user = dict(
        (
            await session.execute(
                select(Signal.assigned_user_id, func.count())
                .where(
                    Signal.tenant_id == tenant_id,
                    Signal.status == "open",
                    Signal.assignee_kind == "user",
                    Signal.assigned_user_id.is_not(None),
                )
                .group_by(Signal.assigned_user_id)
            )
        ).all()
    )
    open_turn_user = dict(
        (
            await session.execute(
                select(Signal.turn_user_id, func.count())
                .where(
                    Signal.tenant_id == tenant_id,
                    Signal.status == "open",
                    Signal.turn_user_id.is_not(None),
                )
                .group_by(Signal.turn_user_id)
            )
        ).all()
    )
    open_owned_agent = dict(
        (
            await session.execute(
                select(Signal.agent_id, func.count())
                .where(
                    Signal.tenant_id == tenant_id,
                    Signal.status == "open",
                    Signal.assignee_kind == "agent",
                    Signal.agent_id.is_not(None),
                )
                .group_by(Signal.agent_id)
            )
        ).all()
    )

    now = datetime.utcnow()
    people_rows = (
        await session.execute(
            select(User, Membership)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.tenant_id == tenant_id, User.is_active.is_(True))
        )
    ).all()
    people = [
        {
            "uuid": str(user.id),
            "name": user.display_name or user.email,
            "email": user.email,
            "avatar_url": user.avatar_url,
            "role": member.role,
            "presence": presence.serialize_presence(user, now=now),
            "team_ids": membership.get(f"user:{user.id}", []),
            "open_owned": int(open_owned_user.get(user.id, 0)),
            "open_turn": int(open_turn_user.get(user.id, 0)),
        }
        for user, member in people_rows
    ]
    people.sort(key=lambda p: p["name"].lower())

    agent_rows = (
        await session.execute(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.is_active.is_(True),
                Agent.kind == "company",
                Agent.acts_for_user.is_(False),
            )
        )
    ).scalars().all()
    agents = []
    for agent in agent_rows:
        agents.append(
            {
                "id": str(agent.id),
                "name": agent.name,
                "role": agent.role,
                "autonomy_level": agent.autonomy_level,
                "team_ids": membership.get(f"agent:{agent.id}", []),
                "open_owned": int(open_owned_agent.get(agent.id, 0)),
                "metrics": metrics["agents"].get(str(agent.id), empty_metrics()),
            }
        )
    agents.sort(key=lambda a: a["name"].lower())
    await session.commit()
    return {"people": people, "agents": agents, "teams": teams_out}


@router.put("/me/away", response_model=PresenceOut)
async def set_my_away(
    body: AwayBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Mark yourself away (optionally until a moment) or back."""
    until = body.until.replace(tzinfo=None) if body.until and body.until.tzinfo else body.until
    user = await presence.set_away(session, auth.user, away=body.away, until=until)
    status = presence.user_status(user)
    await publish_presence(
        auth.tenant.id, user_id=user.id, device="dashboard", online=status != "offline", status=status
    )
    return presence.serialize_presence(user)
