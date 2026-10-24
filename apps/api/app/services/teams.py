"""Departments: groups of people and agents used as owner, addressee and mention target.

Every workspace has one root (``parent_id`` null, stored name All) that
operators see as the organization. Custom departments hang below it, at most
``MAX_DEPARTMENT_DEPTH`` levels deep. Membership is stored in
``department_members``; a member of a child is treated as a member of every
ancestor up to the root. Every person is implicitly on the root. Agents are on
it only when placed there or through a department below it.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.agent import Agent
from app.models.auth import Membership, User
from app.models.signal import Signal
from app.models.team import (
    ALL_DEPARTMENT_NAME,
    CREW_ROLES,
    FOCUS_MAX,
    MAX_DEPARTMENT_DEPTH,
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


async def ensure_org_root(session: AsyncSession, tenant_id: UUID) -> Team:
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
    return team


async def org_root(session: AsyncSession, tenant_id: UUID) -> Team:
    return await ensure_org_root(session, tenant_id)


async def department_depth(session: AsyncSession, tenant_id: UUID, department_id: UUID) -> int:
    """Levels below the root: the root is 0, a department 1, a sub-department 2."""
    parent_of = await _parent_map(session, tenant_id)
    depth = 0
    cur = parent_of.get(department_id)
    seen: set[UUID] = set()
    while cur is not None and cur not in seen:
        seen.add(cur)
        depth += 1
        cur = parent_of.get(cur)
    return depth


async def subtree_height(session: AsyncSession, tenant_id: UUID, department_id: UUID) -> int:
    """How many levels hang below this department (0 for a leaf)."""
    parent_of = await _parent_map(session, tenant_id)
    children: dict[UUID, list[UUID]] = {}
    for child, parent in parent_of.items():
        if parent is not None:
            children.setdefault(parent, []).append(child)

    def height(node: UUID, seen: frozenset[UUID]) -> int:
        kids = [k for k in children.get(node, []) if k not in seen]
        return 1 + max((height(k, seen | {k}) for k in kids), default=-1) if kids else 0

    return height(department_id, frozenset({department_id}))


async def department_chain(session: AsyncSession, tenant_id: UUID, department_id: UUID | None) -> list[UUID]:
    """From the organization down to ``department_id`` (inclusive). Just the root when None."""
    parent_of = await _parent_map(session, tenant_id)
    if department_id is None or department_id not in parent_of:
        return [(await ensure_org_root(session, tenant_id)).id]
    chain: list[UUID] = []
    cur: UUID | None = department_id
    while cur is not None and cur not in chain:
        chain.append(cur)
        cur = parent_of.get(cur)
    return list(reversed(chain))


async def direct_department_ids(session: AsyncSession, tenant_id: UUID, kind: str, member_id: UUID) -> set[UUID]:
    """Departments a person or agent sits in directly (no ancestors)."""
    column = TeamMember.agent_id if kind == "agent" else TeamMember.user_id
    return set(
        (
            await session.execute(
                select(TeamMember.department_id).where(
                    TeamMember.tenant_id == tenant_id,
                    TeamMember.member_kind == kind,
                    column == member_id,
                )
            )
        ).scalars().all()
    )


async def _parent_map(session: AsyncSession, tenant_id: UUID) -> dict[UUID, UUID | None]:
    from app.services.trash import alive

    rows = (
        await session.execute(select(Team.id, Team.parent_id).where(Team.tenant_id == tenant_id, alive(Team)))
    ).all()
    return {row[0]: row[1] for row in rows}


async def check_parent(session: AsyncSession, tenant_id: UUID, team_id: UUID | None, parent_id: UUID) -> None:
    """Raise ValueError when hanging ``team_id`` (or a new department) under ``parent_id`` breaks the tree."""
    parent = await get_team(session, tenant_id, parent_id)
    if parent is None:
        raise ValueError("Parent department not found")
    if team_id is not None:
        cur: UUID | None = parent_id
        parent_of = await _parent_map(session, tenant_id)
        seen: set[UUID] = set()
        while cur is not None and cur not in seen:
            if cur == team_id:
                raise ValueError("A department cannot hang below itself")
            seen.add(cur)
            cur = parent_of.get(cur)
    below = await subtree_height(session, tenant_id, team_id) if team_id is not None else 0
    if await department_depth(session, tenant_id, parent_id) + 1 + below > MAX_DEPARTMENT_DEPTH:
        raise ValueError("Departments go at most two levels deep")


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
    await ensure_org_root(session, tenant_id)
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


async def _workspace_agent_ids(
    session: AsyncSession, tenant_id: UUID, *, include_paused: bool = False
) -> list[UUID]:
    clauses = [Agent.tenant_id == tenant_id, Agent.kind == "company", Agent.acts_for_user.is_(False)]
    if not include_paused:
        clauses.append(Agent.is_active.is_(True))
    rows = await session.execute(select(Agent.id).where(*clauses))
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
    """Departments the user belongs to, ancestors included. Every person is on the root."""
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
    root = await ensure_org_root(session, tenant_id)
    if include_system:
        ids.add(root.id)
    else:
        ids.discard(root.id)
    return ids


async def agent_team_ids(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> set[UUID]:
    """Departments the agent sits in, ancestors included. Empty for an agent placed nowhere."""
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
    return await _ancestor_ids(session, tenant_id, direct)


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
    root = await ensure_org_root(session, tenant_id)
    parent = root.id if parent_id is None else parent_id
    if parent != root.id:
        await check_parent(session, tenant_id, None, parent)
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
    """Replace the member rows of a department: ``{kind, id, duty, focus}`` in order.

    Unknown or paused members are skipped and a second primary per kind becomes a
    member. Operator edits go through ``set_department_crew``, which refuses instead.
    """
    allowed_users = set(await _workspace_user_ids(session, team.tenant_id))
    allowed_agents = set(await _workspace_agent_ids(session, team.tenant_id, include_paused=True))
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
                focus=str(entry.get("focus") or "").strip()[:FOCUS_MAX],
            )
        )
        seen.add(key)
        position += 1
    team.updated_at = utcnow()
    session.add(team)


@dataclass(frozen=True)
class CrewChange:
    added: list[str]
    removed: list[str]
    contact_before: str | None
    contact_after: str | None
    accountable_before: str | None
    accountable_after: str | None

    def summary(self, names: dict[str, str]) -> str:
        """One line for audit and the room; ``names`` maps member ids to display names."""

        def name(key: str | None) -> str:
            ident = (key or "").split(":", 1)[-1]
            return names.get(ident, ident)

        parts: list[str] = []
        if self.contact_after != self.contact_before:
            parts.append(
                f"{name(self.contact_after)} is point of contact"
                if self.contact_after
                else "no explicit point of contact"
            )
        if self.accountable_after != self.accountable_before and self.accountable_after:
            parts.append(f"{name(self.accountable_after)} is accountable")
        if self.added:
            parts.append("added " + ", ".join(name(k) for k in self.added))
        if self.removed:
            parts.append("removed " + ", ".join(name(k) for k in self.removed))
        return "; ".join(parts) or "focus changed"


async def validate_crew(
    session: AsyncSession, team: Team, crew: list[dict[str, Any]]
) -> tuple[list[dict[str, str]], set[str], str | None, str | None, set[UUID]]:
    """Check a crew ``[{kind, id, role, focus}]`` with role contact | accountable | member.

    Refuses (ValueError) a second point of contact or accountable person, a
    contact who is a person, an accountable who is an agent, the personal
    helper, someone outside the workspace, and owners or admins on the root
    (they are on it by role). Paused agents are skipped: they keep their stored
    seat. Returns member rows, their keys, the contact and accountable keys and
    the active agent ids.
    """
    users = set(await _workspace_user_ids(session, team.tenant_id))
    agents = set(await _workspace_agent_ids(session, team.tenant_id))
    paused_agents = set(await _workspace_agent_ids(session, team.tenant_id, include_paused=True)) - agents
    root = is_root_department(team)
    admins: set[UUID] = set()
    if root:
        admins = set(
            (
                await session.execute(
                    select(Membership.user_id).where(
                        Membership.tenant_id == team.tenant_id, Membership.role.in_(("owner", "admin"))
                    )
                )
            ).scalars().all()
        )
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    contact = accountable = None
    for entry in crew:
        kind = str(entry.get("kind") or "")
        role = str(entry.get("role") or "member")
        try:
            member_id = UUID(str(entry.get("id") or ""))
        except ValueError as exc:
            raise ValueError("Unknown crew member") from exc
        if kind not in ("user", "agent") or role not in CREW_ROLES:
            raise ValueError("Unknown crew member")
        key = f"{kind}:{member_id}"
        if key in seen or (kind == "agent" and member_id in paused_agents):
            # A paused agent keeps its stored seat below; an undo may send it back.
            continue
        seen.add(key)
        if kind == "agent" and member_id not in agents:
            raise ValueError("Only active company agents can join a department")
        if kind == "user" and member_id not in users:
            raise ValueError("That person is not in this workspace")
        if kind == "user" and root and member_id in admins and role != "accountable":
            raise ValueError("Owners and admins are on the organization already")
        if role == "contact":
            if kind != "agent":
                raise ValueError("The point of contact is an agent")
            if contact is not None:
                raise ValueError("A department has one point of contact")
            contact = key
        if role == "accountable":
            if kind != "user":
                raise ValueError("The accountable person is a person")
            if accountable is not None:
                raise ValueError("A department has one accountable person")
            accountable = key
        rows.append(
            {
                "kind": kind,
                "id": str(member_id),
                "duty": "primary" if role in ("contact", "accountable") else "member",
                "focus": str(entry.get("focus") or "").strip()[:FOCUS_MAX],
            }
        )
    return rows, seen, contact, accountable, agents


async def set_department_crew(
    session: AsyncSession, team: Team, crew: list[dict[str, Any]]
) -> CrewChange:
    """Replace a department's crew: ``[{kind, id, role, focus}]`` with role contact | accountable | member.

    Refusals are those of ``validate_crew``. Caller commits.
    """
    rows, seen, contact, accountable, agents = await validate_crew(session, team, crew)
    before = await team_members(session, team)
    paused = [
        entry
        for entry in await crew_entries(session, team)
        if entry["kind"] == "agent" and UUID(entry["id"]) not in agents and f"agent:{entry['id']}" not in seen
    ]
    # Paused agents keep their seat (hidden) and come back when reactivated.
    rows.extend({"kind": "agent", "id": e["id"], "duty": "member", "focus": e["focus"]} for e in paused)
    seen.update(f"agent:{e['id']}" for e in paused)
    before_keys = {ref.key for ref in before}
    contact_before = next((ref.key for ref in before if ref.kind == "agent" and ref.duty == "primary"), None)
    accountable_before = next((ref.key for ref in before if ref.kind == "user" and ref.duty == "primary"), None)
    await set_team_members(session, team, rows)
    await session.flush()
    return CrewChange(
        added=sorted(seen - before_keys),
        removed=sorted(before_keys - seen),
        contact_before=contact_before,
        contact_after=contact,
        accountable_before=accountable_before,
        accountable_after=accountable,
    )


async def edit_department_crew(
    session: AsyncSession, team: Team, change: Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
) -> CrewChange:
    """Read the crew, let ``change`` rewrite it, and store it through ``set_department_crew``.

    Rows that no longer validate (a person who left, an owner on the root) are
    dropped first, so system paths (module install, lead change) never trip on
    old data. Caller commits.
    """
    users = {str(u) for u in await _workspace_user_ids(session, team.tenant_id)}
    admins: set[str] = set()
    if is_root_department(team):
        admins = {
            str(u)
            for u in (
                await session.execute(
                    select(Membership.user_id).where(
                        Membership.tenant_id == team.tenant_id, Membership.role.in_(("owner", "admin"))
                    )
                )
            ).scalars().all()
        }
    entries = [
        e
        for e in await crew_entries(session, team)
        if e["kind"] != "user" or (e["id"] in users and (e["id"] not in admins or e["role"] == "accountable"))
    ]
    return await set_department_crew(session, team, change(entries))


def with_member(
    entries: list[dict[str, Any]], kind: str, member_id: UUID, role: str = "member"
) -> list[dict[str, Any]]:
    """The crew with ``member_id`` in ``role``. A new contact or accountable demotes the current one."""
    key = str(member_id)
    out: list[dict[str, Any]] = []
    mine: dict[str, Any] | None = None
    for e in entries:
        if e["kind"] == kind and e["id"] == key:
            mine = dict(e)
            continue
        if role != "member" and e["role"] == role:
            e = {**e, "role": "member"}
        out.append(e)
    entry = {**(mine or {"kind": kind, "id": key, "focus": ""}), "role": role}
    return [entry, *out] if role == "contact" else [*out, entry]


async def crew_entries(session: AsyncSession, team: Team) -> list[dict[str, Any]]:
    """The stored crew in the shape ``set_department_crew`` takes."""
    rows = (
        await session.execute(select(TeamMember).where(TeamMember.department_id == team.id))
    ).scalars().all()
    out: list[dict[str, Any]] = []
    for row in sorted(rows, key=lambda r: (r.position, str(r.id))):
        member_id = row.agent_id if row.member_kind == "agent" else row.user_id
        if member_id is None:
            continue
        role = "member"
        if row.duty == "primary":
            role = "contact" if row.member_kind == "agent" else "accountable"
        out.append({"kind": row.member_kind, "id": str(member_id), "role": role, "focus": row.focus or ""})
    return out


async def crew_names(session: AsyncSession, tenant_id: UUID, entries: list[dict[str, Any]]) -> dict[str, str]:
    """Display names for crew ids (agents and people) in this workspace."""
    ids: dict[str, set[UUID]] = {"agent": set(), "user": set()}
    for e in entries:
        try:
            ids[str(e["kind"])].add(UUID(str(e["id"])))
        except (KeyError, ValueError):
            continue
    names: dict[str, str] = {}
    if ids["agent"]:
        for a in (
            await session.execute(select(Agent).where(Agent.tenant_id == tenant_id, Agent.id.in_(ids["agent"])))
        ).scalars().all():
            names[str(a.id)] = a.name
    if ids["user"]:
        for u in (await session.execute(select(User).where(User.id.in_(ids["user"])))).scalars().all():
            names[str(u.id)] = u.display_name or u.email
    return names


async def department_tree(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    """Every department top-down with its place, point of contact, accountable person and crew.

    The root is listed first under the workspace name (``is_org``). Paused
    agents are left out of the crew; owners and admins sit on the root by role.
    """
    from app.models.auth import Tenant
    from app.services.department_access import department_roles

    teams = await list_teams(session, tenant_id)
    tenant = await session.get(Tenant, tenant_id)
    active = set(await _workspace_agent_ids(session, tenant_id))
    by_parent: dict[UUID | None, list[Team]] = {}
    for t in teams:
        by_parent.setdefault(t.parent_id, []).append(t)
    entries = {t.id: await crew_entries(session, t) for t in teams}
    names = await crew_names(session, tenant_id, [e for rows in entries.values() for e in rows])
    out: list[dict[str, Any]] = []

    async def visit(team: Team, depth: int, path: list[str]) -> None:
        org = is_root_department(team)
        name = ((tenant.name if tenant else "") or team.name) if org else team.name
        roles = await department_roles(session, tenant_id, team.id)
        contact_id = roles["contact_agent_id"]
        if org and contact_id is None:
            from app.services.lead_agent import lead_agent_id

            contact_id = await lead_agent_id(session, tenant_id)
        accountable_id = roles["accountable_user_id"]
        crew = [
            {**e, "name": names.get(e["id"], "")}
            for e in entries[team.id]
            if e["kind"] == "user" or UUID(e["id"]) in active
        ]
        for row in crew:
            if row["kind"] == "agent" and contact_id and row["id"] == str(contact_id):
                row["role"] = "contact"
        here = [*path, name]
        out.append(
            {
                "id": str(team.id),
                "name": name,
                "is_org": org,
                "depth": depth,
                "parent_id": str(team.parent_id) if team.parent_id else None,
                "path": " / ".join(here),
                "href": "/organisatie" if org else f"/departments/{team.id}",
                "mention": f"@[{name}](team:{team.id})",
                "contact": (
                    {
                        "id": str(contact_id),
                        "name": names.get(str(contact_id)) or await _agent_name(session, contact_id),
                        "implicit": bool(roles["contact_implicit"]) or roles["contact_agent_id"] is None,
                    }
                    if contact_id
                    else None
                ),
                "accountable": (
                    {"id": str(accountable_id), "name": names.get(str(accountable_id), "")} if accountable_id else None
                ),
                "crew": crew,
                "children": [str(c.id) for c in by_parent.get(team.id, [])],
            }
        )
        for child in sorted(by_parent.get(team.id, []), key=lambda c: c.name.lower()):
            await visit(child, depth + 1, here)

    for root in sorted(by_parent.get(None, []), key=lambda t: (not is_root_department(t), t.name.lower())):
        await visit(root, 0, [])
    return out


async def _agent_name(session: AsyncSession, agent_id: UUID) -> str:
    agent = await session.get(Agent, agent_id)
    return agent.name if agent else ""


async def change_department_crew(
    session: AsyncSession,
    team: Team,
    crew: list[dict[str, Any]],
    *,
    actor_type: str,
    actor_id: UUID | None,
    agent_id: UUID | None = None,
) -> dict[str, Any]:
    """The operator action behind Edit crew: replace, audit, and tell the room when the contact changed.

    Same refusals as ``set_department_crew`` (ValueError). Returns the new and
    previous crew, the resolved roles and a one-line summary. Caller commits.
    """
    from app.services.audit import record_audit
    from app.services.department_access import department_roles

    previous = await crew_entries(session, team)
    change = await set_department_crew(session, team, crew)
    names = await crew_names(session, team.tenant_id, previous + list(crew))
    summary = change.summary(names)
    await record_audit(
        session,
        team.tenant_id,
        action="department:crew",
        actor_type=actor_type,
        actor_id=actor_id,
        agent_id=agent_id,
        resource_type="department",
        resource_id=team.id,
        summary=f"{team.name}: {summary}",
        commit=False,
    )
    if change.contact_after != change.contact_before and not is_root_department(team):
        from app.services.chat_runtime import post_message

        room = await get_or_create_team_room(session, team.tenant_id, team)
        await session.flush()
        await post_message(
            session,
            room,
            content=f"Crew changed: {summary}.",
            role="user" if actor_type == "user" else "assistant",
            trust="operator",
            author_user_id=actor_id if actor_type == "user" else None,
            author_agent_id=agent_id,
            metadata={"department_crew": True},
        )
    await session.flush()
    roles = await department_roles(session, team.tenant_id, team.id)
    return {
        "department_id": str(team.id),
        "crew": await crew_entries(session, team),
        "previous": previous,
        "contact_agent_id": str(roles["contact_agent_id"]) if roles["contact_agent_id"] else None,
        "contact_implicit": bool(roles["contact_implicit"]),
        "accountable_user_id": str(roles["accountable_user_id"]) if roles["accountable_user_id"] else None,
        "summary": summary,
    }


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
    fallback = await org_root(session, team.tenant_id)
    # Reparent children under All before delete.
    await session.execute(
        update(Team)
        .where(Team.tenant_id == team.tenant_id, Team.parent_id == team.id)
        .values(parent_id=fallback.id, updated_at=utcnow())
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
    from app.services.department_overview import department_icon
    from app.services.team_avatar import avatar_payload

    from app.services.department_access import department_roles

    members = await team_members(session, team)
    avatar = avatar_payload(team)
    root = is_root_department(team)
    roles = await department_roles(session, team.tenant_id, team.id)
    contact_id, implicit = roles["contact_agent_id"], bool(roles["contact_implicit"])
    if root and contact_id is None:
        from app.services.lead_agent import lead_agent_id

        contact_id, implicit = await lead_agent_id(session, team.tenant_id), True
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
        "contact": (
            {"id": str(contact_id), "name": await _agent_name(session, contact_id), "implicit": implicit}
            if contact_id
            else None
        ),
        "presence": await _team_presence_payload(session, team, members),
        "avatar_kind": avatar["avatar_kind"],
        "avatar_icon": avatar["avatar_icon"],
        "avatar_color": avatar["avatar_color"],
        "avatar_image_url": avatar["avatar_image_url"],
        "icon": department_icon(team),
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

    now = utcnow()
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
