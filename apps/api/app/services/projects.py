"""Folder service (the dashboard calls them folders; the model is `Project`).

Every folder carries a tag (``tag_id``); a conversation sits in a folder because
it carries the tags on that folder's path (`services.folders`). A folder with
``child_group_id`` shows one virtual child per tag in that group; pinning a
virtual child creates a real row with that tag. Moving, pinning, trashing or
restoring a folder refiles what it touches.
"""

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.orchestration import QUEUE_ITEM_KINDS, AgentTask
from app.models.project import Project, ProjectAgent
from app.models.project_work import ProjectResource
from app.models.signal import Signal, SignalTag, TagGroup
from app.models.usage import UsageLedger

DEFAULT_TOKEN_BUDGET_DAILY = 100_000
DEFAULT_TOKEN_BUDGET_HOURLY = 10_000


def _positive_cap(value: Any) -> int | None:
    if value in (None, "", 0):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Token budget must be a whole number") from exc
    if parsed < 0:
        raise HTTPException(status_code=422, detail="Token budget cannot be negative")
    return parsed or None


def _parse_json(raw: str | None) -> Any:
    try:
        return json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def serialize_po_agent(agent: Agent | None) -> dict[str, Any] | None:
    """The project orchestrator as an agent summary (``serialize_agent``)."""
    if not agent:
        return None
    from app.services.workforce_runtime import serialize_agent

    return serialize_agent(agent)


def _repo_config(resource: ProjectResource | None) -> dict[str, Any]:
    if not resource:
        return {}
    try:
        return json.loads(resource.config_json or "{}")
    except json.JSONDecodeError:
        return {}


def serialize_project(
    project: Project,
    po_agent: Agent | None = None,
    repo: ProjectResource | None = None,
    *,
    tag_name: str | None = None,
    group_name: str | None = None,
) -> dict[str, Any]:
    """Folder shape for the dashboard; repo fields derive from the repo resource."""
    config = _repo_config(repo)
    return {
        "id": str(project.id),
        "name": project.name,
        "slug": project.slug,
        "tag_id": str(project.tag_id) if project.tag_id else None,
        "tag_name": tag_name,
        "child_group_id": str(project.child_group_id) if project.child_group_id else None,
        "child_group_name": group_name,
        "description": project.description or "",
        "autonomous_scope": project.autonomous_scope or "",
        "active_domains": _parse_json(project.active_domains_json),
        "workbench_connection_id": (
            str(project.workbench_connection_id) if project.workbench_connection_id else None
        ),
        "github_connection_id": str(repo.connection_id) if repo and repo.connection_id else None,
        "github_repo_full_name": repo.external_ref if repo else None,
        "github_default_branch": config.get("default_branch") if repo else None,
        "repo_source": "github_oauth" if repo else "none",
        "repo_connected_at": _iso(repo.created_at) if repo else None,
        "repo_index_status": (repo.sync_status or "ready") if repo else "none",
        "repo_indexed_at": _iso(repo.synced_at) if repo else None,
        "repo_index_error": repo.sync_error if repo else None,
        "po_agent_id": str(project.po_agent_id) if project.po_agent_id else None,
        "po_agent": serialize_po_agent(po_agent),
        "token_budget_daily": project.token_budget_daily,
        "token_budget_hourly": project.token_budget_hourly,
        "parent_id": str(project.parent_id) if project.parent_id else None,
        "updated_at": _iso(project.updated_at),
        "created_at": _iso(project.created_at),
    }


MAX_FOLDER_DEPTH = 16


async def _tag_names(session: AsyncSession, tenant_id: UUID, tag_ids: list[UUID]) -> dict[UUID, str]:
    ids = [t for t in dict.fromkeys(tag_ids) if t is not None]
    if not ids:
        return {}
    rows = await session.execute(
        select(SignalTag.id, SignalTag.name).where(SignalTag.tenant_id == tenant_id, SignalTag.id.in_(ids))
    )
    return {row[0]: row[1] for row in rows.all()}


async def _group_names(session: AsyncSession, tenant_id: UUID, group_ids: list[UUID]) -> dict[UUID, str]:
    ids = [g for g in dict.fromkeys(group_ids) if g is not None]
    if not ids:
        return {}
    rows = await session.execute(
        select(TagGroup.id, TagGroup.name).where(TagGroup.tenant_id == tenant_id, TagGroup.id.in_(ids))
    )
    return {row[0]: row[1] for row in rows.all()}


async def serialize_with_tag(
    session: AsyncSession,
    project: Project,
    po_agent: Agent | None = None,
    repo: ProjectResource | None = None,
) -> dict[str, Any]:
    tags = await _tag_names(session, project.tenant_id, [project.tag_id] if project.tag_id else [])
    groups = await _group_names(
        session, project.tenant_id, [project.child_group_id] if project.child_group_id else []
    )
    return serialize_project(
        project,
        po_agent,
        repo,
        tag_name=tags.get(project.tag_id) if project.tag_id else None,
        group_name=groups.get(project.child_group_id) if project.child_group_id else None,
    )


async def folder_tag(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    tag_id: UUID | None = None,
    tag: str | None = None,
    fallback_name: str = "",
    user_id: UUID | None = None,
) -> SignalTag:
    """The tag a folder carries: by id, by name, or a new tag named after the folder."""
    from app.services.signal_tags import normalize_tag

    if tag_id is not None:
        row = (
            await session.execute(
                select(SignalTag).where(SignalTag.id == tag_id, SignalTag.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Tag not found")
        return row
    name = normalize_tag(tag or "") or normalize_tag(fallback_name)
    if not name:
        raise HTTPException(status_code=422, detail="A folder needs a tag")
    row = (
        await session.execute(
            select(SignalTag).where(SignalTag.tenant_id == tenant_id, SignalTag.name == name)
        )
    ).scalar_one_or_none()
    if row is None:
        row = SignalTag(tenant_id=tenant_id, name=name, created_by_user_id=user_id)
        session.add(row)
        await session.flush()
    return row


async def assert_folder_tag(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    project_id: UUID | None,
    parent_id: UUID | None,
    tag: SignalTag,
) -> None:
    """A tag appears once on a path and once among siblings."""
    from app.services.folders import load_tree

    tree = await load_tree(session, tenant_id)
    current = tree.nodes.get(parent_id) if parent_id else None
    while current is not None:
        if current.tag_id == tag.id:
            raise HTTPException(
                status_code=422, detail=f"#{tag.name} is already the tag of a folder above this one"
            )
        current = tree.nodes.get(current.parent_id) if current.parent_id else None
    for sibling in tree.children.get(parent_id if parent_id in tree.nodes else None, []):
        if sibling.id != project_id and sibling.tag_id == tag.id:
            raise HTTPException(status_code=409, detail=f"A folder with #{tag.name} already sits here")


async def _group_row(session: AsyncSession, tenant_id: UUID, group_id: UUID) -> TagGroup:
    row = (
        await session.execute(
            select(TagGroup).where(TagGroup.id == group_id, TagGroup.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Tag group not found")
    return row


def project_subtree_select(tenant_id: UUID, root_id: UUID):
    """This project and every living folder inside it."""
    tree = (
        select(Project.id)
        .where(
            Project.tenant_id == tenant_id,
            Project.id == root_id,
            Project.deleted_at.is_(None),
        )
        .cte(name="project_subtree", recursive=True)
    )
    tree = tree.union_all(
        select(Project.id).where(
            Project.tenant_id == tenant_id,
            Project.parent_id == tree.c.id,
            Project.deleted_at.is_(None),
        )
    )
    return select(tree.c.id)


async def _alive_projects(session: AsyncSession, tenant_id: UUID) -> list[Project]:
    from app.services.trash import alive

    result = await session.execute(
        select(Project).where(Project.tenant_id == tenant_id, alive(Project))
    )
    return list(result.scalars().all())


def _children_of(projects: list[Project]) -> dict[UUID, list[UUID]]:
    out: dict[UUID, list[UUID]] = {}
    ids = {p.id for p in projects}
    for project in projects:
        if project.parent_id and project.parent_id in ids:
            out.setdefault(project.parent_id, []).append(project.id)
    return out


def _subtree_ids(root_id: UUID, children_of: dict[UUID, list[UUID]]) -> list[UUID]:
    out: list[UUID] = []
    stack = [root_id]
    seen: set[UUID] = set()
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        out.append(current)
        stack.extend(children_of.get(current, []))
    return out


def _ancestor_rows(project: Project, by_id: dict[UUID, Project]) -> list[dict[str, str]]:
    chain: list[Project] = []
    current = by_id.get(project.parent_id) if project.parent_id else None
    seen: set[UUID] = set()
    while current is not None and current.id not in seen and len(chain) <= MAX_FOLDER_DEPTH:
        seen.add(current.id)
        chain.append(current)
        current = by_id.get(current.parent_id) if current.parent_id else None
    chain.reverse()
    return [{"id": str(row.id), "name": row.name} for row in chain]


def _folder_depth(project: Project, by_id: dict[UUID, Project]) -> int:
    depth = 1
    current = project
    seen: set[UUID] = set()
    while current.parent_id and current.parent_id in by_id and current.id not in seen:
        seen.add(current.id)
        current = by_id[current.parent_id]
        depth += 1
    return depth


async def assert_folder_parent(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    project_id: UUID | None,
    parent_id: UUID | None,
) -> None:
    """Refuse a missing parent, a cycle, or a chain deeper than the safety cap."""
    if parent_id is None:
        return
    if project_id is not None and parent_id == project_id:
        raise HTTPException(status_code=422, detail="A folder cannot sit inside itself")
    depth = 1
    current_id: UUID | None = parent_id
    seen: set[UUID] = {project_id} if project_id else set()
    while current_id is not None:
        if current_id in seen:
            raise HTTPException(
                status_code=422, detail="A folder cannot sit inside one of its own folders"
            )
        if depth > MAX_FOLDER_DEPTH:
            raise HTTPException(status_code=422, detail="This folder is nested too deeply")
        seen.add(current_id)
        row = (
            await session.execute(
                select(Project).where(
                    Project.id == current_id,
                    Project.tenant_id == tenant_id,
                    Project.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Parent folder not found")
        current_id = row.parent_id
        depth += 1


async def _slug_in_use(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    parent_id: UUID | None,
    *,
    exclude_id: UUID | None = None,
) -> bool:
    from app.services.trash import alive

    query = select(Project.id).where(
        Project.tenant_id == tenant_id,
        Project.slug == slug,
        alive(Project),
    )
    if parent_id is None:
        query = query.where(Project.parent_id.is_(None))
    else:
        query = query.where(Project.parent_id == parent_id)
    if exclude_id is not None:
        query = query.where(Project.id != exclude_id)
    return (await session.execute(query.limit(1))).scalar_one_or_none() is not None


async def get_repo_resource(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> ProjectResource | None:
    """The project's repo resource, if one is linked (single repo per project for now)."""
    result = await session.execute(
        select(ProjectResource)
        .where(
            ProjectResource.tenant_id == tenant_id,
            ProjectResource.project_id == project_id,
            ProjectResource.resource_type == "repo",
        )
        .order_by(ProjectResource.created_at)
        .limit(1)
    )
    return result.scalars().first()


async def get_project_row(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, *, include_deleted: bool = False
) -> tuple[Project, Agent | None]:
    from app.services.trash import alive

    query = select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    if not include_deleted:
        query = query.where(alive(Project))
    result = await session.execute(query)
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    po_agent = None
    if project.po_agent_id:
        agent_result = await session.execute(
            select(Agent).where(Agent.id == project.po_agent_id, Agent.tenant_id == tenant_id)
        )
        po_agent = agent_result.scalar_one_or_none()
    return project, po_agent


def _annotate_folder_tree(
    projects: list[Project],
    items: list[dict[str, Any]],
    open_counts: dict[UUID, int],
) -> None:
    by_id = {project.id: project for project in projects}
    children_of = _children_of(projects)
    by_item = {item["id"]: item for item in items}
    for project in projects:
        item = by_item.get(str(project.id))
        if item is None:
            continue
        ids = _subtree_ids(project.id, children_of)
        item["open_tickets_count"] = sum(open_counts.get(pid, 0) for pid in ids)
        item["child_count"] = len(children_of.get(project.id, []))
        item["ancestors"] = _ancestor_rows(project, by_id)


async def _status_counts(
    session: AsyncSession, tenant_id: UUID, project_ids: list[UUID], status: str
) -> dict[UUID, int]:
    if not project_ids:
        return {}
    result = await session.execute(
        select(Signal.project_id, func.count())
        .where(
            Signal.tenant_id == tenant_id,
            Signal.project_id.in_(project_ids),
            Signal.status == status,
            Signal.deleted_at.is_(None),
        )
        .group_by(Signal.project_id)
    )
    return {row[0]: int(row[1]) for row in result.all() if row[0] is not None}


async def get_project_detail(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    repo = await get_repo_resource(session, tenant_id, project_id)
    payload = await serialize_with_tag(session, project, po_agent, repo)
    projects = await _alive_projects(session, tenant_id)
    by_id = {row.id: row for row in projects}
    children_of = _children_of(projects)
    subtree = _subtree_ids(project.id, children_of)
    open_counts = await _status_counts(session, tenant_id, subtree, "open")
    closed_counts = await _status_counts(session, tenant_id, subtree, "closed")
    payload["ancestors"] = _ancestor_rows(project, by_id)
    payload["child_count"] = len(children_of.get(project.id, []))
    payload["open_count"] = sum(open_counts.get(pid, 0) for pid in subtree)
    payload["closed_count"] = sum(closed_counts.get(pid, 0) for pid in subtree)
    tag_names = await _tag_names(
        session, tenant_id, [by_id[cid].tag_id for cid in children_of.get(project.id, []) if by_id[cid].tag_id]
    )
    children: list[dict[str, Any]] = []
    for child_id in children_of.get(project.id, []):
        child = by_id[child_id]
        child_tree = _subtree_ids(child.id, children_of)
        children.append(
            {
                "id": str(child.id),
                "name": child.name,
                "slug": child.slug,
                "tag_id": str(child.tag_id) if child.tag_id else None,
                "tag_name": tag_names.get(child.tag_id) if child.tag_id else None,
                "virtual": False,
                "child_count": len(children_of.get(child.id, [])),
                "open_count": sum(open_counts.get(pid, 0) for pid in child_tree),
                "closed_count": sum(closed_counts.get(pid, 0) for pid in child_tree),
            }
        )
    children.extend(await _virtual_children(session, tenant_id, project, by_id))
    children.sort(key=lambda row: row["name"].lower())
    payload["children"] = children
    return payload


async def _virtual_children(
    session: AsyncSession, tenant_id: UUID, project: Project, by_id: dict[UUID, Project]
) -> list[dict[str, Any]]:
    """One row per tag in the folder's child group that has no pinned row yet."""
    if project.child_group_id is None:
        return []
    from app.services.communication_nav import filter_predicates, virtual_row_id
    from app.services.trash import alive

    group_tags = list(
        (
            await session.execute(
                select(SignalTag)
                .where(SignalTag.tenant_id == tenant_id, SignalTag.group_id == project.child_group_id)
                .order_by(SignalTag.name)
            )
        ).scalars()
    )
    pinned = {row.tag_id for row in by_id.values() if row.parent_id == project.id and row.tag_id}
    out: list[dict[str, Any]] = []
    for tag in group_tags:
        if tag.id in pinned:
            continue
        counts: dict[str, int] = {}
        for status in ("open", "closed"):
            predicates = filter_predicates(tenant_id, {"project_id": project.id, "path": [tag.id]}) or []
            counts[status] = int(
                (
                    await session.execute(
                        select(func.count())
                        .select_from(Signal)
                        .where(Signal.tenant_id == tenant_id, alive(Signal), Signal.status == status, *predicates)
                    )
                ).scalar_one()
            )
        out.append(
            {
                "id": virtual_row_id(project.id, tag.id),
                "name": tag.name,
                "slug": tag.name,
                "tag_id": str(tag.id),
                "tag_name": tag.name,
                "virtual": True,
                "child_count": 0,
                "open_count": counts["open"],
                "closed_count": counts["closed"],
            }
        )
    return out


async def folder_digest(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> str:
    """Plain summary of folders inside a project, for a canvas refresh."""
    projects = await _alive_projects(session, tenant_id)
    by_id = {row.id: row for row in projects}
    project = by_id.get(project_id)
    if project is None:
        return ""
    children_of = _children_of(projects)
    direct = [by_id[cid] for cid in children_of.get(project.id, []) if cid in by_id]
    if not direct:
        return ""
    subtree = _subtree_ids(project.id, children_of)
    open_counts = await _status_counts(session, tenant_id, subtree, "open")
    closed_counts = await _status_counts(session, tenant_id, subtree, "closed")
    lines = ["Folders inside this project (include these figures in the snapshot):"]
    for child in sorted(direct, key=lambda row: row.name.lower()):
        ids = _subtree_ids(child.id, children_of)
        recent = (
            await session.execute(
                select(Signal.subject)
                .where(
                    Signal.tenant_id == tenant_id,
                    Signal.project_id.in_(ids),
                    Signal.deleted_at.is_(None),
                )
                .order_by(Signal.updated_at.desc())
                .limit(5)
            )
        ).scalars().all()
        subjects = [subject.strip() for subject in recent if subject and subject.strip()]
        recent_bit = f" Recent: {', '.join(subjects)}." if subjects else ""
        lines.append(
            f"- {child.name}: {sum(open_counts.get(pid, 0) for pid in ids)} open, "
            f"{sum(closed_counts.get(pid, 0) for pid in ids)} closed.{recent_bit}"
        )
    return "\n".join(lines)


async def list_projects(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    from app.services.trash import alive

    result = await session.execute(
        select(Project)
        .where(Project.tenant_id == tenant_id, alive(Project))
        .order_by(Project.updated_at.desc())
    )
    projects = list(result.scalars().all())
    # Batch-load orchestrator agents (tenant-scoped) to avoid N+1.
    po_ids = [p.po_agent_id for p in projects if p.po_agent_id]
    agents_by_id: dict[UUID, Agent] = {}
    if po_ids:
        agents_result = await session.execute(
            select(Agent).where(Agent.id.in_(po_ids), Agent.tenant_id == tenant_id)
        )
        agents_by_id = {a.id: a for a in agents_result.scalars().all()}
    # Repo resources (batched).
    repo_by_project: dict[UUID, ProjectResource] = {}
    if projects:
        repo_result = await session.execute(
            select(ProjectResource)
            .where(
                ProjectResource.tenant_id == tenant_id,
                ProjectResource.resource_type == "repo",
                ProjectResource.project_id.in_([p.id for p in projects]),
            )
            .order_by(ProjectResource.created_at)
        )
        for resource in repo_result.scalars().all():
            repo_by_project.setdefault(resource.project_id, resource)
    # Roster chips for the projects list (batched; avoids N+1).
    roster_by_project: dict[UUID, list[dict[str, Any]]] = {}
    if projects:
        roster_result = await session.execute(
            select(ProjectAgent, Agent)
            .join(Agent, Agent.id == ProjectAgent.agent_id)
            .where(
                ProjectAgent.tenant_id == tenant_id,
                ProjectAgent.project_id.in_([p.id for p in projects]),
            )
            .order_by(ProjectAgent.created_at)
        )
        for row, agent in roster_result.all():
            roster_by_project.setdefault(row.project_id, []).append(
                {"agent_id": str(agent.id), "name": agent.name, "is_default": row.is_default}
            )
    # Open tickets filed on the project, the same cards as its board.
    open_tickets_by_project: dict[UUID, int] = {}
    sections_by_project: dict[UUID, tuple[int, int]] = {}  # (total, verified-ish)
    if projects:
        project_ids = [p.id for p in projects]
        ticket_result = await session.execute(
            select(Signal.project_id, func.count())
            .where(
                Signal.tenant_id == tenant_id,
                Signal.project_id.in_(project_ids),
                Signal.ticket_status.in_(("open", "waiting")),
                Signal.deleted_at.is_(None),
            )
            .group_by(Signal.project_id)
        )
        open_tickets_by_project = {row[0]: row[1] for row in ticket_result.all()}
        from app.models.workspace import DocSection, WorkspaceDoc

        section_result = await session.execute(
            select(WorkspaceDoc.project_id, DocSection.status, func.count())
            .join(WorkspaceDoc, WorkspaceDoc.id == DocSection.doc_id)
            .where(
                DocSection.tenant_id == tenant_id,
                WorkspaceDoc.project_id.in_(project_ids),
            )
            .group_by(WorkspaceDoc.project_id, DocSection.status)
        )
        for project_id, status, count in section_result.all():
            total, done = sections_by_project.get(project_id, (0, 0))
            total += count
            if status == "final":
                done += count
            sections_by_project[project_id] = (total, done)
    tag_names = await _tag_names(session, tenant_id, [p.tag_id for p in projects if p.tag_id])
    group_names = await _group_names(
        session, tenant_id, [p.child_group_id for p in projects if p.child_group_id]
    )
    out = []
    for p in projects:
        item = serialize_project(
            p,
            agents_by_id.get(p.po_agent_id) if p.po_agent_id else None,
            repo_by_project.get(p.id),
            tag_name=tag_names.get(p.tag_id) if p.tag_id else None,
            group_name=group_names.get(p.child_group_id) if p.child_group_id else None,
        )
        item["agents"] = roster_by_project.get(p.id, [])
        item["open_tickets_count"] = open_tickets_by_project.get(p.id, 0)
        total, done = sections_by_project.get(p.id, (0, 0))
        item["doc_sections_total"] = total
        item["doc_sections_done"] = done
        out.append(item)
    _annotate_folder_tree(projects, out, open_tickets_by_project)
    return out


async def create_project(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    name: str,
    slug: str,
    autonomous_scope: str,
    description: str = "",
    parent_id: UUID | None = None,
    tag_id: UUID | None = None,
    tag: str | None = None,
    child_group_id: UUID | None = None,
    user_id: UUID | None = None,
) -> dict[str, Any]:
    """Create a folder. Its tag comes from ``tag_id``, ``tag`` (a name, created
    when new) or, by default, a tag named after the slug. Conversations that
    already carry the path's tags move in."""
    from app.services.folders import refile_tagged

    slug_norm = slug.strip().lower()
    await assert_folder_parent(session, tenant_id, project_id=None, parent_id=parent_id)
    if await _slug_in_use(session, tenant_id, slug_norm, parent_id):
        raise HTTPException(status_code=409, detail="Project slug already exists")
    row_tag = await folder_tag(
        session, tenant_id, tag_id=tag_id, tag=tag, fallback_name=slug_norm, user_id=user_id
    )
    await assert_folder_tag(session, tenant_id, project_id=None, parent_id=parent_id, tag=row_tag)
    if child_group_id is not None:
        await _group_row(session, tenant_id, child_group_id)
    now = datetime.utcnow()
    project = Project(
        tenant_id=tenant_id,
        name=name.strip(),
        slug=slug_norm,
        description=description,
        autonomous_scope=autonomous_scope.strip(),
        parent_id=parent_id,
        tag_id=row_tag.id,
        child_group_id=child_group_id,
        updated_at=now,
    )
    session.add(project)
    await session.flush()
    # Every project ships with a default workstream: agent edits to project
    # docs run exclusively through workstream runs.
    from app.services.workstreams import ensure_default_workstream

    await ensure_default_workstream(session, tenant_id, project.id, commit=False)
    await refile_tagged(session, tenant_id, await _refile_tags_for(session, tenant_id, project))
    await session.commit()
    await session.refresh(project)
    return await serialize_with_tag(session, project)


async def _refile_tags_for(session: AsyncSession, tenant_id: UUID, project: Project) -> list[UUID]:
    """Tags whose conversations may land in (or leave) this folder: its own tag
    and, for a group folder, every tag in the group."""
    out: list[UUID] = [project.tag_id] if project.tag_id else []
    if project.child_group_id is not None:
        rows = await session.execute(
            select(SignalTag.id).where(
                SignalTag.tenant_id == tenant_id, SignalTag.group_id == project.child_group_id
            )
        )
        out.extend(rows.scalars().all())
    return out


async def pin_virtual_child(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    tag_id: UUID,
    *,
    user_id: UUID | None = None,
) -> dict[str, Any]:
    """"Vastzetten": turn a virtual child (group folder + tag) into a real row.
    Nothing moves: the conversations already carried the tag."""
    from app.services.signal_tags import normalize_tag

    parent, _ = await get_project_row(session, tenant_id, project_id)
    if parent.child_group_id is None:
        raise HTTPException(status_code=400, detail="This folder has no tag group")
    tag = await folder_tag(session, tenant_id, tag_id=tag_id)
    if tag.group_id != parent.child_group_id:
        raise HTTPException(status_code=422, detail=f"#{tag.name} is not in this folder's group")
    existing = (
        await session.execute(
            select(Project).where(
                Project.tenant_id == tenant_id,
                Project.parent_id == parent.id,
                Project.tag_id == tag.id,
                Project.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return await serialize_with_tag(session, existing)
    slug = normalize_tag(tag.name)
    if await _slug_in_use(session, tenant_id, slug, parent.id):
        slug = f"{slug}-{str(tag.id)[:8]}"
    return await create_project(
        session,
        tenant_id,
        name=tag.name,
        slug=slug,
        autonomous_scope=parent.autonomous_scope or "",
        parent_id=parent.id,
        tag_id=tag.id,
        user_id=user_id,
    )


async def patch_project(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    name: str | None = None,
    description: str | None = None,
    autonomous_scope: str | None = None,
    token_budget_daily: int | None | object = ...,
    token_budget_hourly: int | None | object = ...,
    parent_id: UUID | None | object = ...,
    tag_id: UUID | object = ...,
    child_group_id: UUID | None | object = ...,
    user_id: UUID | None = None,
) -> dict[str, Any]:
    from app.services.folders import refile_subtree, refile_tagged

    project, po_agent = await get_project_row(session, tenant_id, project_id)
    before_tags = await _refile_tags_for(session, tenant_id, project)
    tree_changed = False
    if name is not None:
        project.name = name.strip()
    if description is not None:
        project.description = description
    if autonomous_scope is not None:
        project.autonomous_scope = autonomous_scope.strip()
    next_parent = project.parent_id
    if parent_id is not ...:
        next_parent = parent_id if isinstance(parent_id, UUID) else None
        await assert_folder_parent(
            session, tenant_id, project_id=project.id, parent_id=next_parent
        )
        if await _slug_in_use(
            session, tenant_id, project.slug, next_parent, exclude_id=project.id
        ):
            raise HTTPException(status_code=409, detail="Project slug already exists")
        tree_changed = tree_changed or next_parent != project.parent_id
    next_tag_id = project.tag_id
    if tag_id is not ...:
        if not isinstance(tag_id, UUID):
            raise HTTPException(status_code=422, detail="A folder needs a tag")
        next_tag_id = tag_id
        tree_changed = tree_changed or next_tag_id != project.tag_id
    if tree_changed or next_tag_id != project.tag_id:
        row_tag = await folder_tag(session, tenant_id, tag_id=next_tag_id)
        await assert_folder_tag(
            session, tenant_id, project_id=project.id, parent_id=next_parent, tag=row_tag
        )
    project.parent_id = next_parent
    project.tag_id = next_tag_id
    if child_group_id is not ...:
        next_group = child_group_id if isinstance(child_group_id, UUID) else None
        if next_group is not None:
            await _group_row(session, tenant_id, next_group)
        tree_changed = tree_changed or next_group != project.child_group_id
        project.child_group_id = next_group
    if token_budget_daily is not ...:
        project.token_budget_daily = _positive_cap(token_budget_daily)
    if token_budget_hourly is not ...:
        project.token_budget_hourly = _positive_cap(token_budget_hourly)
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.flush()
    if tree_changed:
        await refile_subtree(session, tenant_id, project.id, actor_id=str(user_id or ""))
        await refile_tagged(
            session,
            tenant_id,
            [*before_tags, *await _refile_tags_for(session, tenant_id, project)],
            actor_id=str(user_id or ""),
        )
    await session.commit()
    await session.refresh(project)
    repo = await get_repo_resource(session, tenant_id, project_id)
    return await serialize_with_tag(session, project, po_agent, repo)


async def _trash_project(
    session: AsyncSession,
    tenant: Any,
    project: Project,
    *,
    user_id: UUID | None,
    batch_id: UUID,
    commit: bool,
) -> None:
    from app.models.project_canvas import OWNER_PROJECT, ProjectCanvas
    from app.models.trigger import Trigger
    from app.models.workspace import WorkspaceDoc
    from app.services.trash import alive, move_to_bin

    canvases = list(
        (
            await session.execute(
                select(ProjectCanvas).where(
                    ProjectCanvas.tenant_id == project.tenant_id,
                    ProjectCanvas.owner_kind == OWNER_PROJECT,
                    ProjectCanvas.owner_id == project.id,
                    alive(ProjectCanvas),
                )
            )
        ).scalars().all()
    )
    docs = list(
        (
            await session.execute(
                select(WorkspaceDoc).where(
                    WorkspaceDoc.tenant_id == project.tenant_id,
                    WorkspaceDoc.project_id == project.id,
                    alive(WorkspaceDoc),
                )
            )
        ).scalars().all()
    )
    resources = list(
        (
            await session.execute(
                select(ProjectResource).where(
                    ProjectResource.tenant_id == project.tenant_id,
                    ProjectResource.project_id == project.id,
                    alive(ProjectResource),
                )
            )
        ).scalars().all()
    )
    queue_items = list(
        (
            await session.execute(
                select(AgentTask).where(
                    AgentTask.tenant_id == project.tenant_id,
                    AgentTask.project_id == project.id,
                    AgentTask.kind.in_(QUEUE_ITEM_KINDS),
                    alive(AgentTask),
                )
            )
        ).scalars().all()
    )
    children: list[tuple[str, Any]] = []
    children.extend(("canvas", canvas) for canvas in canvases)
    children.extend(("knowledge", doc) for doc in docs)
    children.extend(("project_resource", resource) for resource in resources)
    children.extend(("queue_item", item) for item in queue_items)
    for canvas in canvases:
        if not canvas.refresh_trigger_id:
            continue
        trigger = (
            await session.execute(
                select(Trigger).where(
                    Trigger.id == canvas.refresh_trigger_id,
                    Trigger.tenant_id == project.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if trigger and getattr(trigger, "enabled", False):
            trigger.trash_was_enabled = True
            trigger.enabled = False
            session.add(trigger)
    await move_to_bin(
        session,
        tenant,
        resource_type="project",
        row=project,
        user_id=user_id,
        children=children,
        commit=commit,
        batch_id=batch_id,
    )


async def delete_project(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    confirm_name: str,
    *,
    permanent: bool = False,
    commit: bool = True,
    user_id: UUID | None = None,
) -> dict[str, bool]:
    project, _ = await get_project_row(session, tenant_id, project_id, include_deleted=permanent)
    if confirm_name.strip() != project.name:
        raise HTTPException(status_code=400, detail="Confirmation name does not match")
    if not permanent:
        from uuid import uuid4

        from app.services.trash import load_tenant

        tenant = await load_tenant(session, tenant_id)
        alive_rows = await _alive_projects(session, tenant_id)
        by_id = {row.id: row for row in alive_rows}
        children_of = _children_of(alive_rows)
        tree_ids = set(_subtree_ids(project.id, children_of))
        ordered = sorted(
            (row for row in alive_rows if row.id in tree_ids),
            key=lambda row: _folder_depth(row, by_id),
            reverse=True,
        )
        batch_id = uuid4()
        for row in ordered:
            await _trash_project(
                session,
                tenant,
                row,
                user_id=user_id,
                batch_id=batch_id,
                commit=False,
            )
        # The folder is gone from the tree: what sat in it lands on the
        # nearest folder its tags still match (or none).
        from app.services.folders import refile_many

        await session.flush()
        inside = (
            await session.execute(
                select(Signal.id).where(
                    Signal.tenant_id == tenant_id,
                    Signal.project_id.in_(list(tree_ids)),
                    Signal.deleted_at.is_(None),
                )
            )
        ).scalars()
        await refile_many(session, tenant_id, list(inside), actor_id=str(user_id or ""))
        if commit:
            await session.commit()
        return {"deleted": True}
    from sqlalchemy import update as sa_update

    await session.execute(
        sa_update(Project)
        .where(Project.parent_id == project_id, Project.tenant_id == tenant_id)
        .values(parent_id=None)
    )
    # Detach (not delete) playbooks: they are reusable across projects.
    from sqlalchemy import delete as _sa_delete

    from app.models.orchestra import WorkstreamProject

    await session.execute(
        _sa_delete(WorkstreamProject).where(
            WorkstreamProject.project_id == project_id, WorkstreamProject.tenant_id == tenant_id
        )
    )
    # Project-owned work: queue tasks, doc sections, links, resources, docs.
    from sqlalchemy import delete as sa_delete, update as sa_update

    from app.models.project_work import TaskDocLink
    from app.models.workspace import DocChunk, DocSection, WorkspaceDoc

    project_doc_ids = select(WorkspaceDoc.id).where(WorkspaceDoc.project_id == project_id)
    section_ids = select(DocSection.id).where(DocSection.doc_id.in_(project_doc_ids))
    task_ids = select(AgentTask.id).where(AgentTask.project_id == project_id)
    await session.execute(
        sa_delete(TaskDocLink).where(
            TaskDocLink.section_id.in_(section_ids)
            | TaskDocLink.doc_id.in_(project_doc_ids)
            | TaskDocLink.task_id.in_(task_ids)
        )
    )
    await session.execute(
        sa_delete(DocSection).where(DocSection.doc_id.in_(project_doc_ids))
    )
    # Queue tasks belong to the project and go with it; execution jobs (and
    # their run history) outlive the project with the reference detached.
    from app.models.agent import AgentRun
    from app.models.orchestration import EvalCheckpoint, TaskArtifact

    queue_task_ids = select(AgentTask.id).where(
        AgentTask.project_id == project_id,
        AgentTask.kind.in_(QUEUE_ITEM_KINDS),
    )
    await session.execute(
        sa_update(AgentRun)
        .where(AgentRun.task_id.in_(queue_task_ids))
        .values(task_id=None)
    )
    await session.execute(
        sa_delete(TaskArtifact).where(TaskArtifact.agent_task_id.in_(queue_task_ids))
    )
    await session.execute(
        sa_delete(EvalCheckpoint).where(EvalCheckpoint.agent_task_id.in_(queue_task_ids))
    )
    await session.execute(
        sa_update(AgentTask)
        .where(AgentTask.duplicate_of_id.in_(queue_task_ids))
        .values(duplicate_of_id=None)
    )
    await session.execute(
        sa_delete(AgentTask).where(
            AgentTask.project_id == project_id,
            AgentTask.kind.in_(QUEUE_ITEM_KINDS),
        )
    )
    await session.execute(
        sa_update(AgentTask)
        .where(AgentTask.project_id == project_id)
        .values(project_id=None)
    )
    await session.execute(
        sa_delete(ProjectResource).where(ProjectResource.project_id == project_id)
    )
    from app.models.project_canvas import OWNER_PROJECT, ProjectCanvas
    from app.models.trigger import Trigger

    canvases = (
        await session.execute(
            select(ProjectCanvas).where(
                ProjectCanvas.tenant_id == tenant_id,
                ProjectCanvas.owner_kind == OWNER_PROJECT,
                ProjectCanvas.owner_id == project_id,
            )
        )
    ).scalars().all()
    trigger_ids = [c.refresh_trigger_id for c in canvases if c.refresh_trigger_id]
    if trigger_ids:
        await session.execute(sa_delete(Trigger).where(Trigger.id.in_(trigger_ids)))
    await session.execute(
        sa_delete(ProjectCanvas).where(
            ProjectCanvas.tenant_id == tenant_id,
            ProjectCanvas.owner_kind == OWNER_PROJECT,
            ProjectCanvas.owner_id == project_id,
        )
    )
    doc_ids = select(WorkspaceDoc.id).where(WorkspaceDoc.project_id == project_id)
    await session.execute(sa_delete(DocChunk).where(DocChunk.doc_id.in_(doc_ids)))
    await session.execute(sa_delete(WorkspaceDoc).where(WorkspaceDoc.project_id == project_id))
    await session.delete(project)
    if commit:
        await session.commit()
    return {"deleted": True}


async def connect_repo(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    repo_full_name: str,
    default_branch: str = "main",
    connection_id: str | None = None,
) -> dict[str, Any]:
    if not repo_full_name.strip():
        raise HTTPException(status_code=400, detail="Repository name is required")
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    now = datetime.utcnow()
    conn_uuid = UUID(connection_id) if connection_id else None
    repo = await get_repo_resource(session, tenant_id, project_id)
    if not repo:
        repo = ProjectResource(
            tenant_id=tenant_id,
            project_id=project_id,
            resource_type="repo",
            created_at=now,
        )
    repo.provider = "github"
    repo.connection_id = conn_uuid
    repo.label = repo_full_name
    repo.external_ref = repo_full_name
    repo.config_json = json.dumps({"default_branch": default_branch or "main"})
    repo.status = "connected" if conn_uuid else "linked"
    repo.sync_status = "pending"
    repo.sync_error = None
    repo.updated_at = now
    session.add(repo)
    project.updated_at = now
    session.add(project)
    await session.commit()
    await session.refresh(repo)

    # Kick off the first index immediately; status transitions to indexing/ready.
    from app.workers.tasks import enqueue_repo_index

    await enqueue_repo_index(str(tenant_id), str(project_id))
    return serialize_project(project, po_agent, repo)


async def disconnect_repo(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    # Remove indexed content so search stops returning a repo that is gone.
    from sqlalchemy import delete as sa_delete

    from app.models.workspace import DocChunk

    await session.execute(
        sa_delete(DocChunk).where(
            DocChunk.tenant_id == tenant_id,
            DocChunk.source_type == "repo_file",
            DocChunk.source_id.like(f"{project_id}:%"),
        )
    )
    repo = await get_repo_resource(session, tenant_id, project_id)
    if repo:
        await session.delete(repo)
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return serialize_project(project, po_agent, None)


async def reindex_repo(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> dict[str, bool]:
    """Queue a real index run: GitHub tree + contents into repo_file DocChunks."""
    await get_project_row(session, tenant_id, project_id)
    repo = await get_repo_resource(session, tenant_id, project_id)
    if not repo or not repo.external_ref:
        raise HTTPException(status_code=400, detail="No repository connected")
    repo.sync_status = "indexing"
    repo.sync_error = None
    repo.updated_at = datetime.utcnow()
    session.add(repo)
    await session.commit()

    from app.workers.tasks import enqueue_repo_index

    await enqueue_repo_index(str(tenant_id), str(project_id))
    return {"queued": True}


async def repo_status(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    repo = await get_repo_resource(session, tenant_id, project_id)
    return {
        "repo_index_status": (repo.sync_status or "none") if repo else "none",
        "repo_indexed_at": _iso(repo.synced_at) if repo else None,
        "repo_last_commit_sha": repo.sync_ref if repo else None,
        "repo_index_error": repo.sync_error if repo else None,
    }


async def _token_usage(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, since: datetime
) -> int:
    from app.models.agent import AgentRun

    # Usage rows link to runs via run_id; runs carry the project. Also include any
    # legacy rows that stored the project id directly in scope_id.
    result = await session.execute(
        select(func.coalesce(func.sum(UsageLedger.tokens_in + UsageLedger.tokens_out), 0))
        .select_from(UsageLedger)
        .outerjoin(AgentRun, AgentRun.id == UsageLedger.run_id)
        .where(
            UsageLedger.tenant_id == tenant_id,
            UsageLedger.created_at >= since,
            (AgentRun.project_id == project_id) | (UsageLedger.scope_id == str(project_id)),
        )
    )
    return int(result.scalar_one() or 0)


async def usage_budget(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    now = datetime.utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hour_start = now.replace(minute=0, second=0, microsecond=0)
    used_today = await _token_usage(session, tenant_id, project_id, day_start)
    used_hour = await _token_usage(session, tenant_id, project_id, hour_start)
    workspace_daily = DEFAULT_TOKEN_BUDGET_DAILY
    from app.models.auth import Tenant
    from app.services.spend_guard import get_spend_config

    tenant = await session.get(Tenant, tenant_id)
    if tenant:
        cap = get_spend_config(tenant)["daily_token_cap"]
        if cap:
            workspace_daily = cap
        elif cap is None:
            workspace_daily = DEFAULT_TOKEN_BUDGET_DAILY
    project, _ = await get_project_row(session, tenant_id, project_id)
    daily = project.token_budget_daily or workspace_daily
    if workspace_daily:
        daily = min(daily, workspace_daily)
    hourly = project.token_budget_hourly or min(DEFAULT_TOKEN_BUDGET_HOURLY, daily)
    hourly = min(hourly, daily)
    remaining_today = max(0, daily - used_today)
    remaining_hour = max(0, hourly - used_hour)
    return {
        "token_budget_daily": daily,
        "token_budget_hourly": hourly,
        "token_budget_daily_set": project.token_budget_daily,
        "token_budget_hourly_set": project.token_budget_hourly,
        "workspace_daily_cap": workspace_daily,
        "token_used_today": used_today,
        "token_used_this_hour": used_hour,
        "remaining_today": remaining_today,
        "remaining_hour": remaining_hour,
        "blocked": remaining_today <= 0 or remaining_hour <= 0,
    }


async def check_project_token_budget(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> None:
    from app.exceptions import AppError

    status = await usage_budget(session, tenant_id, project_id)
    if not status["blocked"]:
        return
    raise AppError(
        "This project's token budget is used up. Raise the cap on the project or wait for the next window.",
        code="project_budget_exceeded",
        status_code=402,
    )


def _period_bounds(period: str) -> tuple[datetime, datetime, str]:
    now = datetime.utcnow()
    days = {"7d": 7, "30d": 30, "90d": 90}.get(period, 30)
    label = period if period in ("7d", "30d", "90d") else "30d"
    start = now - timedelta(days=days)
    return start, now, label


async def usage_summary(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, period: str = "30d"
) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    start, end, label = _period_bounds(period)
    tokens = await _token_usage(session, tenant_id, project_id, start)
    budget = await usage_budget(session, tenant_id, project_id)
    return {
        "project_id": str(project_id),
        "period": {"start": start.isoformat(), "end": end.isoformat(), "label": label},
        "total_runs": 0,
        "completed_runs": 0,
        "running_runs": 0,
        "failed_runs": 0,
        "tokens_used": tokens,
        "tokens_used_today": budget["token_used_today"],
        "tokens_remaining_today": budget["remaining_today"],
        "by_day": [],
    }


async def po_agent_summary(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    project, po_agent = await get_project_row(session, tenant_id, project_id)
    return {
        "project_id": str(project.id),
        "po_agent_id": str(project.po_agent_id) if project.po_agent_id else None,
        "po_agent": serialize_po_agent(po_agent),
        "setup_complete": project.po_agent_id is not None,
    }


async def create_po_agent(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    name: str | None = None,
) -> dict[str, Any]:
    project, _ = await get_project_row(session, tenant_id, project_id)
    agent = Agent(
        tenant_id=tenant_id,
        name=name or f"{project.name} Orchestrator",
        role="orchestrator",
        slug="orchestrator",
        chat_access="everyone",
        description=f"Plans and routes the work for project {project.name}."[:280],
        system_prompt=(
            f"You are the orchestrator for project {project.name}. "
            "Plan work, route agents, and keep project knowledge current.\n\n"
            "Knowledge architecture and maintenance:\n"
            "- Keep documentation logically structured; prefer editing existing docs "
            "over proliferating files. Split or create a document only when a stable "
            "new concept emerges.\n"
            "- On each queue request: run impact analysis, link affected docs with "
            "link_queue_item_to_doc (doc_id), update those docs with write_doc, then "
            "verify the docs match reality before marking work complete.\n"
            "- Use list_project_docs / list_docs / read_doc to discover scoped docs."
        ),
    )
    session.add(agent)
    await session.flush()
    project.po_agent_id = agent.id
    project.updated_at = datetime.utcnow()
    session.add(project)
    await _ensure_default_roster(session, tenant_id, project_id, agent.id)
    await session.commit()
    await session.refresh(agent)
    return await po_agent_summary(session, tenant_id, project_id)


async def link_po_agent(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    po_agent_id: UUID,
) -> dict[str, Any]:
    project, _ = await get_project_row(session, tenant_id, project_id)
    agent_result = await session.execute(
        select(Agent).where(Agent.id == po_agent_id, Agent.tenant_id == tenant_id)
    )
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.kind != "company":
        raise HTTPException(status_code=400, detail="Only company agents can lead a project")
    if not agent.is_active:
        raise HTTPException(status_code=400, detail="Agent is archived")
    project.po_agent_id = agent.id
    project.updated_at = datetime.utcnow()
    session.add(project)
    await _ensure_default_roster(session, tenant_id, project_id, agent.id)
    await session.commit()
    summary = await po_agent_summary(session, tenant_id, project_id)
    summary["po_agent"] = serialize_po_agent(agent)
    return summary


async def unlink_po_agent(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    project, _ = await get_project_row(session, tenant_id, project_id)
    project.po_agent_id = None
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    return await po_agent_summary(session, tenant_id, project_id)


# ── project agent roster ─────────────────────────────────────────────


def _serialize_project_agent(row: ProjectAgent, agent: Agent | None) -> dict[str, Any]:
    from app.services.agent_avatar import avatar_payload

    payload: dict[str, Any] = {
        "id": str(row.id),
        "agent_id": str(row.agent_id),
        "name": agent.name if agent else "",
        "role": agent.role if agent else "",
        "is_active": bool(agent.is_active) if agent else False,
        "is_default": row.is_default,
        "created_at": _iso(row.created_at),
    }
    payload.update(avatar_payload(agent))
    return payload


async def list_project_agents(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> list[dict[str, Any]]:
    await get_project_row(session, tenant_id, project_id)
    result = await session.execute(
        select(ProjectAgent, Agent)
        .join(Agent, Agent.id == ProjectAgent.agent_id)
        .where(ProjectAgent.project_id == project_id, ProjectAgent.tenant_id == tenant_id)
        .order_by(ProjectAgent.created_at)
    )
    return [_serialize_project_agent(row, agent) for row, agent in result.all()]


async def add_project_agent(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    agent_id: UUID,
    *,
    is_default: bool = False,
) -> dict[str, Any]:
    project, _ = await get_project_row(session, tenant_id, project_id)
    agent = (
        await session.execute(
            select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not agent or agent.kind != "company":
        raise HTTPException(status_code=404, detail="Agent not found")
    existing = (
        await session.execute(
            select(ProjectAgent).where(
                ProjectAgent.project_id == project_id, ProjectAgent.agent_id == agent_id
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Agent is already on this project")
    row = ProjectAgent(
        tenant_id=tenant_id, project_id=project_id, agent_id=agent_id, is_default=is_default
    )
    if is_default:
        await _clear_project_default(session, project_id)
    session.add(row)
    project.updated_at = datetime.utcnow()
    session.add(project)
    await session.commit()
    await session.refresh(row)
    return _serialize_project_agent(row, agent)


async def _ensure_default_roster(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, agent_id: UUID
) -> None:
    """Keep the project default agent in the roster in sync with po_agent_id."""
    await _clear_project_default(session, project_id)
    existing = (
        await session.execute(
            select(ProjectAgent).where(
                ProjectAgent.project_id == project_id, ProjectAgent.agent_id == agent_id
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.is_default = True
        session.add(existing)
        return
    session.add(
        ProjectAgent(
            tenant_id=tenant_id,
            project_id=project_id,
            agent_id=agent_id,
            is_default=True,
        )
    )


async def _clear_project_default(session: AsyncSession, project_id: UUID) -> None:
    result = await session.execute(
        select(ProjectAgent).where(
            ProjectAgent.project_id == project_id, ProjectAgent.is_default.is_(True)
        )
    )
    for other in result.scalars().all():
        other.is_default = False
        session.add(other)


async def set_project_agent_default(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    agent_id: UUID,
    *,
    is_default: bool,
) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    row = (
        await session.execute(
            select(ProjectAgent).where(
                ProjectAgent.project_id == project_id,
                ProjectAgent.agent_id == agent_id,
                ProjectAgent.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Agent is not on this project")
    if is_default:
        await _clear_project_default(session, project_id)
    row.is_default = is_default
    session.add(row)
    await session.commit()
    agent = (
        await session.execute(
            select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    return _serialize_project_agent(row, agent)


async def remove_project_agent(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, agent_id: UUID
) -> dict[str, Any]:
    await get_project_row(session, tenant_id, project_id)
    row = (
        await session.execute(
            select(ProjectAgent).where(
                ProjectAgent.project_id == project_id,
                ProjectAgent.agent_id == agent_id,
                ProjectAgent.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Agent is not on this project")
    await session.delete(row)
    await session.commit()
    return {"ok": True}


async def project_default_agent(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> Agent | None:
    """The active agent marked default on the project roster, if any."""
    result = await session.execute(
        select(Agent)
        .join(ProjectAgent, ProjectAgent.agent_id == Agent.id)
        .where(
            ProjectAgent.project_id == project_id,
            ProjectAgent.tenant_id == tenant_id,
            ProjectAgent.is_default.is_(True),
            Agent.is_active.is_(True),
        )
        .limit(1)
    )
    return result.scalars().first()
