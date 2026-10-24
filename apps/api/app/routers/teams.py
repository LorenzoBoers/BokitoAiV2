"""Teams and the company team overview (people, agents, teams)."""

from __future__ import annotations

from app.core.time import utcnow

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
from app.models.team import WorkforceMemberType
from app.services import presence
from app.services import teams as teams_svc
from app.gateway.publish import publish_presence
from app.services.audit import record_audit

router = APIRouter(prefix="/departments", tags=["departments"])


class TeamMemberRef(BaseModel):
    kind: Literal["user", "agent"]
    id: str
    duty: Literal["primary", "backup", "member"] = "member"
    position: int = 0
    focus: str = ""


class CrewEntry(BaseModel):
    kind: Literal["user", "agent"]
    id: str
    role: Literal["contact", "accountable", "member"] = "member"
    focus: str = Field(default="", max_length=80)


class CrewBody(BaseModel):
    crew: list[CrewEntry]


class CrewOut(BaseModel):
    crew: list[CrewEntry]
    previous: list[CrewEntry]
    contact_agent_id: str | None = None
    contact_implicit: bool = False
    accountable_user_id: str | None = None
    summary: str = ""


class TeamPresenceOut(BaseModel):
    status: Literal["available", "away", "offline", "standby", "working"]


class TeamContactOut(BaseModel):
    """The point of contact; ``implicit`` when nobody was picked and the first agent acts."""

    id: str
    name: str
    implicit: bool = False


class TeamOut(BaseModel):
    id: str
    name: str
    description: str
    kind: str
    system: bool
    root: bool = False
    parent_id: str | None = None
    pickup: str
    pinned: bool = False
    members: list[TeamMemberRef]
    member_count: int
    contact: TeamContactOut | None = None
    presence: TeamPresenceOut = Field(default_factory=lambda: TeamPresenceOut(status="offline"))
    avatar_kind: str = "initials"
    avatar_icon: str | None = None
    avatar_color: str | None = None
    avatar_image_url: str | None = None
    icon: str = "building-2"


class TeamCreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    pickup: Literal["people", "round_robin", "least_open"] = "people"
    parent_id: str | None = None


class TeamPatchBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = None
    pickup: Literal["people", "round_robin", "least_open"] | None = None
    icon: str | None = Field(default=None, max_length=64)
    parent_id: str | None = None
    # Shielded: only this branch, the departments above it and owners/admins read its work.
    visibility: Literal["open", "shielded"] | None = None


class PresenceOut(BaseModel):
    status: Literal["available", "away", "offline"]
    last_seen_at: str | None = None
    away_until: str | None = None


class OverviewPerson(BaseModel):
    uuid: str
    member_type: Literal["person", "ai_agent"] = "person"
    name: str
    email: str
    avatar_url: str | None = None
    role: str
    presence: PresenceOut
    team_ids: list[str]
    open_owned: int
    open_turn: int
    deactivated: bool = False


class OverviewMetrics(BaseModel):
    """Last 30 days."""

    questions: int = 0
    answer_minutes: float | None = None
    unchanged_rate: float | None = None
    picked_up: int = 0


class OverviewAgent(BaseModel):
    id: str
    member_type: Literal["person", "ai_agent"] = "ai_agent"
    name: str
    role: str
    job_title: str = ""
    role_name: str | None = None
    role_slug: str | None = None
    # Older rows can still have NULL; treat that as assisted for the overview.
    autonomy_level: str = "assisted"
    team_ids: list[str]
    # Active and in no department: only picks up work handed to it directly.
    unplaced: bool = False
    open_owned: int
    status: Literal["standby", "working", "error"] = "standby"
    # Same mark fields as serialize_agent / Agents page (orb shape was dropped here).
    avatar_kind: str = "orb"
    avatar_icon: str | None = None
    avatar_color: str | None = None
    avatar_shape: str | None = None
    avatar_image_url: str | None = None
    deactivated: bool = False
    # Last run, reply or tool step (Unix ms); null before the first run.
    last_active_at: int | None = None
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


class AvailabilityBody(BaseModel):
    mode: str
    until: datetime | None = None


def _parse_uuid(raw: str) -> UUID:
    try:
        return UUID(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid id") from exc


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
    rows = await teams_svc.list_teams(session, auth.tenant.id, include_system=False)
    out = [await teams_svc.serialize_team(session, row) for row in rows]
    await session.commit()
    return out


class DepartmentNavRow(BaseModel):
    id: str
    name: str
    icon: str
    open: int
    href: str


@router.get("/nav", response_model=list[DepartmentNavRow])
async def department_nav(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """The Departments group in the left menu: the departments the caller may
    open, each with its icon and open tickets. Owners and admins see all."""
    from app.services.channel_access import visible_channel_account_ids
    from app.services.department_overview import nav_departments

    user_id = auth.user.id if auth.user else None
    visible = (
        await visible_channel_account_ids(session, auth.tenant.id, user_id=user_id, role=auth.role)
        if user_id
        else None
    )
    out = await nav_departments(
        session, auth.tenant.id, user_id=user_id, role=auth.role, visible_account_ids=visible
    )
    await session.commit()
    return out


@router.post("", response_model=TeamOut, status_code=201)
async def create_team(
    body: TeamCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Create a department under the organization or under ``parent_id`` (owner or admin).

    The crew is set afterwards on the department page (PUT members).
    """
    auth.require_role("owner", "admin")
    try:
        team = await teams_svc.create_team(
            session,
            auth.tenant.id,
            name=body.name,
            description=body.description,
            pickup=body.pickup,
            parent_id=_parse_uuid(body.parent_id) if body.parent_id else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
    """Rename a department, change its description, pickup, icon or parent.

    The organization root is not editable here; its name is the workspace name.
    A new parent must keep the tree at most two levels deep.
    """
    auth.require_role("owner", "admin")
    team = await _team_or_404(session, auth.tenant.id, team_id)
    from app.models.team import is_root_department

    if is_root_department(team):
        raise HTTPException(status_code=400, detail="The organization is edited in workspace settings")
    if "parent_id" in body.model_fields_set:
        root = await teams_svc.ensure_org_root(session, auth.tenant.id)
        parent_id = _parse_uuid(body.parent_id) if body.parent_id else root.id
        if parent_id != team.parent_id:
            try:
                await teams_svc.check_parent(session, auth.tenant.id, team.id, parent_id)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            team.parent_id = parent_id
    if body.name is not None:
        team.name = body.name.strip()
    if body.description is not None:
        team.description = body.description.strip()[:300]
    if body.visibility is not None:
        team.visibility = body.visibility
    if body.pickup is not None:
        team.pickup = body.pickup
    if body.icon is not None:
        import json

        from app.data.platform_icons import PLATFORM_ICON_IDS

        icon = body.icon.strip()
        if icon and icon not in PLATFORM_ICON_IDS:
            raise HTTPException(status_code=400, detail="Unknown icon")
        try:
            settings = json.loads(team.settings_json or "{}")
        except (TypeError, ValueError):
            settings = {}
        if not isinstance(settings, dict):
            settings = {}
        if icon:
            settings["icon"] = icon
        else:
            settings.pop("icon", None)
        team.settings_json = json.dumps(settings)
    team.pinned = True
    team.updated_at = utcnow()
    session.add(team)
    await session.commit()
    return await teams_svc.serialize_team(session, team)


@router.put("/{team_id}/members", response_model=CrewOut)
async def put_department_crew(
    team_id: str,
    body: CrewBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Replace the crew of a department or of the organization (owner or admin).

    One point of contact (an agent) and one accountable person at most. Without
    an explicit contact the first agent by position acts as one. Owners and
    admins are on the organization by role and are not listed there. Returns the
    previous crew so the page can undo.
    """
    auth.require_role("owner", "admin")
    team = await _team_or_404(session, auth.tenant.id, team_id)
    try:
        result = await teams_svc.change_department_crew(
            session, team, [e.model_dump() for e in body.crew], actor_type="user", actor_id=auth.user.id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return CrewOut(
        crew=[CrewEntry(**e) for e in result["crew"]],
        previous=[CrewEntry(**e) for e in result["previous"]],
        contact_agent_id=result["contact_agent_id"],
        contact_implicit=result["contact_implicit"],
        accountable_user_id=result["accountable_user_id"],
        summary=result["summary"],
    )


class PlaceBody(BaseModel):
    agent_id: UUID


@router.post("/{team_id}/members/place", response_model=CrewOut)
async def place_agent_in_department(
    team_id: str,
    body: PlaceBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Seat an agent in a department as a member (owner or admin). Already seated: no change.

    The action behind Place on an agent that sits in no department yet.
    """
    auth.require_role("owner", "admin")
    team = await _team_or_404(session, auth.tenant.id, team_id)
    entries = await teams_svc.crew_entries(session, team)
    if not any(e["kind"] == "agent" and e["id"] == str(body.agent_id) for e in entries):
        entries = teams_svc.with_member(entries, "agent", body.agent_id)
    try:
        result = await teams_svc.change_department_crew(
            session, team, entries, actor_type="user", actor_id=auth.user.id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return CrewOut(
        crew=[CrewEntry(**e) for e in result["crew"]],
        previous=[CrewEntry(**e) for e in result["previous"]],
        contact_agent_id=result["contact_agent_id"],
        contact_implicit=result["contact_implicit"],
        accountable_user_id=result["accountable_user_id"],
        summary=result["summary"],
    )


class TeamRoomOut(BaseModel):
    id: str
    title: str


@router.post("/{team_id}/room", response_model=TeamRoomOut)
async def open_team_room(
    team_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Get or create the standing group chat for this team.

    One internal conversation owned by the team. The Communication sidebar
    Groepschat row opens it. Members talk here like any other internal thread.
    """
    team = await _team_or_404(session, auth.tenant.id, team_id)
    from app.models.team import is_root_department

    if is_root_department(team):
        raise HTTPException(status_code=400, detail="The All department has no group chat")
    signal = await teams_svc.get_or_create_team_room(session, auth.tenant.id, team)
    await session.commit()
    return TeamRoomOut(id=str(signal.id), title=signal.subject)


@router.delete("/{team_id}", status_code=204)
async def delete_team(
    team_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Delete a custom department. Its conversations and questions move to All."""
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
    # Include All so the access picker can pin Everyone to its uuid.
    team_rows = await teams_svc.list_teams(session, tenant_id, include_system=True)
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
                select(Signal.assignee_id, func.count())
                .where(
                    Signal.tenant_id == tenant_id,
                    Signal.status == "open",
                    Signal.assignee_kind == "user",
                    Signal.assignee_id.is_not(None),
                )
                .group_by(Signal.assignee_id)
            )
        ).all()
    )
    open_turn_user = dict(
        (
            await session.execute(
                select(Signal.turn_ref_id, func.count())
                .where(
                    Signal.tenant_id == tenant_id,
                    Signal.status == "open",
                    Signal.turn_kind == "user",
                    Signal.turn_ref_id.is_not(None),
                )
                .group_by(Signal.turn_ref_id)
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

    now = utcnow()
    connected = presence.connected_user_ids_for(tenant_id)
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
            "member_type": WorkforceMemberType.person.value,
            "name": user.display_name or user.email,
            "email": user.email,
            "avatar_url": user.avatar_url,
            "role": member.role,
            "presence": presence.serialize_presence(
                user, now=now, connected=str(user.id) in connected
            ),
            "team_ids": membership.get(f"user:{user.id}", []),
            "open_owned": int(open_owned_user.get(user.id, 0)),
            "open_turn": int(open_turn_user.get(user.id, 0)),
            "deactivated": not bool(member.is_active),
        }
        for user, member in people_rows
    ]
    people.sort(key=lambda p: p["name"].lower())

    from app.models.agent import AgentRun

    agent_rows = list(
        (
            await session.execute(
                select(Agent).where(
                    Agent.tenant_id == tenant_id,
                    Agent.acts_for_user.is_(False),
                    Agent.kind.in_(("company", "archived")),
                )
            )
        )
        .scalars()
        .all()
    )
    running_ids: set[UUID] = set()
    if agent_rows:
        running_ids = set(
            (
                await session.execute(
                    select(AgentRun.agent_id).where(
                        AgentRun.tenant_id == tenant_id,
                        AgentRun.agent_id.in_([a.id for a in agent_rows]),
                        AgentRun.status == "running",
                    )
                )
            )
            .scalars()
            .all()
        )
    from app.services.workforce_runtime import serialize_agent

    agents = []
    for agent in agent_rows:
        deactivated = agent.kind == "archived" or not bool(agent.is_active)
        row = serialize_agent(agent, view="passport", running=agent.id in running_ids)
        if deactivated:
            row["status"] = "standby"
        row.update(
            {
                "member_type": agent.member_type or WorkforceMemberType.ai_agent.value,
                "team_ids": membership.get(f"agent:{agent.id}", []),
                "unplaced": not deactivated and not membership.get(f"agent:{agent.id}"),
                "open_owned": int(open_owned_agent.get(agent.id, 0)),
                "deactivated": deactivated,
                "metrics": metrics["agents"].get(str(agent.id), empty_metrics()),
            }
        )
        agents.append(row)
    agents.sort(key=lambda a: a["name"].lower())
    await session.commit()
    return {"people": people, "agents": agents, "teams": teams_out}


class DepartmentRef(BaseModel):
    id: str
    name: str
    status: str | None = None
    presence: str | None = None
    avatar_kind: str | None = None
    avatar_icon: str | None = None
    avatar_color: str | None = None
    avatar_shape: str | None = None
    avatar_image_url: str | None = None


class DepartmentContactRef(DepartmentRef):
    """The point of contact; ``implicit`` when nobody was picked and the first agent acts."""

    implicit: bool = False


class DepartmentCrewRow(BaseModel):
    kind: Literal["user", "agent"]
    id: str
    name: str
    role: Literal["contact", "accountable", "member"] = "member"
    focus: str = ""
    workspace_role: str | None = None
    hours_per_week: int | None = None
    open_assigned: int | None = None
    presence: str | None = None
    status: str | None = None
    doing: str = ""
    cost_cents: int | None = None
    avatar_kind: str | None = None
    avatar_icon: str | None = None
    avatar_color: str | None = None
    avatar_shape: str | None = None
    avatar_image_url: str | None = None


class DepartmentPathRow(BaseModel):
    id: str
    name: str
    is_org: bool = False
    href: str


class DepartmentChildRow(BaseModel):
    id: str
    name: str
    icon: str = "building-2"
    open: int = 0
    href: str
    contact: DepartmentRef | None = None


class DepartmentStageRow(BaseModel):
    key: str
    name: str
    kind: Literal["open", "waiting", "done", "closed"] = "open"
    count: int
    overdue: int
    soon: int


class DepartmentFlowRow(BaseModel):
    id: str
    name: str
    label: str
    label_id: str | None = None
    autonomy: str = ""
    open: int
    waiting: int
    overdue: int
    scorecard: dict | None = None
    stages: list[DepartmentStageRow] = Field(default_factory=list)
    board_href: str = ""


class DepartmentProposalRow(BaseModel):
    change_id: str
    decision_id: str
    kind: str
    summary: str
    signal_id: str
    created_at: str


class DepartmentProposalHistoryRow(BaseModel):
    change_id: str
    kind: str
    summary: str
    status: Literal["accepted", "rejected"]
    resolved_at: str | None = None


class DepartmentOrientation(BaseModel):
    at: str | None = None
    summary: str = ""
    quiet: bool = False
    signal_id: str


class DepartmentToday(BaseModel):
    bottlenecks: list[dict] = Field(default_factory=list)
    decisions_waiting: int = 0
    orientation: DepartmentOrientation | None = None


class DepartmentReach(BaseModel):
    flows: list[dict] = Field(default_factory=list)
    channels: list[dict] = Field(default_factory=list)
    connections: list[dict] = Field(default_factory=list)
    modules: list[str] = Field(default_factory=list)
    organizations: list[dict] = Field(default_factory=list)


class DepartmentFolderRow(BaseModel):
    id: str
    name: str
    open: int
    home: bool
    href: str


class DepartmentFolderScope(DepartmentFolderRow):
    """One folder tab on the department page: the same counts, scoped to tickets in that folder."""

    totals: dict[str, int] = Field(default_factory=dict)
    bottlenecks: list[dict] = Field(default_factory=list)
    flows: list[DepartmentFlowRow] = Field(default_factory=list)


class DepartmentQuestionRow(BaseModel):
    key: str
    question: str
    answer: str | None = None
    status: Literal["open", "answered"]
    asked_at: str | None = None
    answered_at: str | None = None
    signal_id: str | None = None
    message_id: str | None = None


class DepartmentOverviewOut(BaseModel):
    id: str
    name: str
    description: str
    icon: str = "building-2"
    is_org: bool = False
    visibility: Literal["open", "shielded"] = "open"
    parent_id: str | None = None
    path: list[DepartmentPathRow] = Field(default_factory=list)
    children: list[DepartmentChildRow] = Field(default_factory=list)
    contact: DepartmentContactRef | None = None
    accountable: DepartmentRef | None = None
    autonomy: str | None = None
    origin_module: dict | None = None
    room_signal_id: str | None = None
    pickup: str = "people"
    crew: list[DepartmentCrewRow] = Field(default_factory=list)
    admins: list[DepartmentCrewRow] = Field(default_factory=list)
    flows: list[DepartmentFlowRow]
    totals: dict[str, int]
    today: DepartmentToday = Field(default_factory=DepartmentToday)
    proposals: list[DepartmentProposalRow] = Field(default_factory=list)
    proposal_history: list[DepartmentProposalHistoryRow] = Field(default_factory=list)
    awareness: dict | None = None
    reach: DepartmentReach = Field(default_factory=DepartmentReach)
    lands: list[DepartmentFolderRow] = Field(default_factory=list)
    folders: list[DepartmentFolderScope] = Field(default_factory=list)
    reach_attempts: dict | None = None
    domain_questions: list[DepartmentQuestionRow] = Field(default_factory=list)
    outcomes: dict | None = None
    grid_href: str = ""
    # Organization only: whether agents follow the tree (holder, shielding, talk lines).
    org_rules: Literal["off", "on"] | None = None


class OrgRulesBody(BaseModel):
    mode: Literal["off", "on"]


@router.get("/{team_id}/overview", response_model=DepartmentOverviewOut)
async def department_overview(
    team_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """One department: its path from the organization, the point of contact and
    the person accountable, the crew and the departments below, what asks
    attention today, the work per flow and stage, the contact's awareness,
    what it can reach, where its work lands, pushes and calls, domain
    questions and outcomes."""
    from app.services.department_overview import department_overview as build

    team = await _team_or_404(session, auth.tenant.id, team_id)
    out = await build(session, auth.tenant.id, team.id)
    if out is None:
        raise HTTPException(status_code=404, detail="Team not found")
    await session.commit()
    return out


@router.get("/organization", response_model=DepartmentOverviewOut)
async def organization_overview(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """The organization (the root of the department tree) in the same shape as
    a department: its point of contact (the workspace lead), the person
    accountable, owners and admins by role, and the departments below."""
    from app.services.department_overview import department_overview as build

    root = await teams_svc.ensure_org_root(session, auth.tenant.id)
    out = await build(session, auth.tenant.id, root.id)
    if out is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    from app.services.org_rules import org_rules_on

    out["name"] = auth.tenant.name or out["name"]
    out["org_rules"] = "on" if await org_rules_on(session, auth.tenant.id) else "off"
    await session.commit()
    return out


@router.put("/organization/rules")
async def put_org_rules(
    body: OrgRulesBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, str]:
    """Turn the organization rules on or off: with them on, only the holder acts on a
    conversation, shielded departments stay out of reach and asks follow the tree."""
    from app.services.audit import record_audit
    from app.services.org_rules import org_rules_on, set_org_rules

    auth.require_role("owner", "admin")
    before = "on" if await org_rules_on(session, auth.tenant.id) else "off"
    await set_org_rules(session, auth.tenant.id, body.mode)
    await record_audit(
        session,
        auth.tenant.id,
        action="govern:org_rules",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type="tenant",
        resource_id=str(auth.tenant.id),
        outcome="applied",
        summary=f"Organization rules {body.mode}",
        before={"org_rules": before},
        after={"org_rules": body.mode},
        commit=False,
    )
    await session.commit()
    return {"org_rules": body.mode}


@router.get("/{team_id}/board")
async def department_board(
    team_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Kanban of this department's flows. Tickets are every conversation filed on those flows."""
    from app.services.tickets import department_board as build

    team = await _team_or_404(session, auth.tenant.id, team_id)
    return {"playbooks": await build(session, auth.tenant.id, team.id)}


@router.get("/{team_id}/works-in")
async def department_works_in(
    team_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Works in for the whole department: one board, one file count, canvases and resources."""
    from app.services.works_in import department_items

    team = await _team_or_404(session, auth.tenant.id, team_id)
    return {"items": await department_items(session, auth.tenant.id, team.id)}


@router.get("/{team_id}/docs")
async def department_docs(
    team_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Documentation of this department, as one list. A folder tab still reads that folder's docs."""
    from app.services.project_work import docs_for_department
    from app.services.works_in import department_folder_ids

    team = await _team_or_404(session, auth.tenant.id, team_id)
    folder_ids = await department_folder_ids(session, auth.tenant.id, team.id)
    return {"docs": await docs_for_department(session, auth.tenant.id, team.id, folder_ids)}


class DomainQuestionBody(BaseModel):
    question: str = Field(min_length=3, max_length=500)


class DomainAnswerBody(BaseModel):
    answer: str = Field(min_length=1, max_length=2000)


@router.get("/{team_id}/domain/questions", response_model=list[DepartmentQuestionRow])
async def list_domain_questions(
    team_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """What the lead asked the person accountable about the domain, newest first."""
    from app.services.department_domain import domain_questions

    team = await _team_or_404(session, auth.tenant.id, team_id)
    return list(reversed(domain_questions(team)))


@router.post("/{team_id}/domain/questions", response_model=DepartmentQuestionRow)
async def ask_domain_question(
    team_id: str,
    body: DomainQuestionBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Put a domain question in the department room (the same question twice is one row)."""
    from app.services.department_domain import ask_domain_question as ask

    team = await _team_or_404(session, auth.tenant.id, team_id)
    row = await ask(session, auth.tenant.id, team, body.question, agent_id=None)
    await session.commit()
    return row


@router.patch("/{team_id}/domain/questions/{key}", response_model=DepartmentQuestionRow)
async def answer_domain_question(
    team_id: str,
    key: str,
    body: DomainAnswerBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Answer a domain question. The answer becomes a fact in the lead's standing brief."""
    from app.services.department_domain import answer_domain_question as answer

    team = await _team_or_404(session, auth.tenant.id, team_id)
    try:
        row = await answer(session, auth.tenant.id, team, key, body.answer, user_id=auth.user.id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Question not found") from exc
    await session.commit()
    return row


class AwarenessPatch(BaseModel):
    follows: list[str] | None = None
    mode: str | None = None
    cron: str | None = None
    daily_cost_cents: int | None = Field(default=None, ge=0, le=100_000)
    max_proposals: int | None = Field(default=None, ge=0, le=10)
    scope: dict | None = None


@router.get("/{team_id}/awareness")
async def get_department_awareness(
    team_id: str,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """What the department follows, may spend and last saw on its orientation.

    ``agent_id`` is the point of contact that runs it; null when no agent sits in the department.
    """
    from app.services.agent_awareness import department_awareness_view

    team = await _team_or_404(session, auth.tenant.id, team_id)
    return await department_awareness_view(session, team)


@router.patch("/{team_id}/awareness")
async def patch_department_awareness(
    team_id: str,
    body: AwarenessPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Change what wakes the department's point of contact between orientations and what it may spend a day."""
    from app.services.agent_awareness import department_awareness_view, set_awareness

    team = await _team_or_404(session, auth.tenant.id, team_id)
    try:
        set_awareness(team, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.add(team)
    await record_audit(
        session,
        auth.tenant.id,
        action="department.awareness_updated",
        actor_type="user",
        actor_id=str(auth.user.id),
        resource_type="department",
        resource_id=str(team.id),
        summary=f"Awareness of {team.name} changed",
        after=body.model_dump(exclude_none=True),
    )
    await session.commit()
    return await department_awareness_view(session, team)


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


@router.put("/me/availability", response_model=PresenceOut)
async def set_my_availability(
    body: AvailabilityBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Online, away or unavailable. Agents skip calls and the bell when unavailable."""
    until = body.until.replace(tzinfo=None) if body.until and body.until.tzinfo else body.until
    try:
        user = await presence.set_availability(session, auth.user, body.mode, until=until)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    status = presence.user_status(user)
    await publish_presence(
        auth.tenant.id, user_id=user.id, device="dashboard", online=status == "available", status=status
    )
    return presence.serialize_presence(user)
