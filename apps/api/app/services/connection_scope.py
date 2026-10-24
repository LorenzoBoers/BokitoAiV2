"""Where and by whom a connection may be used: folder links, department, access list.

Folder links are ``ProjectResource`` rows with ``resource_type="connection"``.
A connection without links is workspace-wide; with one or more links it is
exclusive to those folders (and their sub-folders), and calls outside them
cannot use it. With org rules on, a connection with a ``department_id`` is
only usable from conversations of that department or one below it. The
access list (``connection_access``) then decides which agents may use it.

Enforced here for every agent-driven lookup (accounting verbs, module
listings, partner MCP); denials are audited. Operator listings without an
agent see every connection.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.integration import IntegrationConnection
from app.models.project import Project
from app.models.project_work import ProjectResource

CONNECTION_RESOURCE = "connection"

# The conversation of the tool call in flight. Module providers resolve
# connections without a signal argument (``call_verb`` has a fixed shape),
# so the executor sets this around every call.
tool_conversation: ContextVar[UUID | None] = ContextVar("tool_conversation", default=None)


async def _conversation(session: AsyncSession, tenant_id: UUID, signal: Any | None) -> Any | None:
    if signal is not None:
        return signal
    signal_id = tool_conversation.get()
    if signal_id is None:
        return None
    from app.models.signal import Signal

    row = await session.get(Signal, signal_id)
    return row if row is not None and row.tenant_id == tenant_id else None


async def _flow(session: AsyncSession, signal: Any | None) -> Any | None:
    if signal is None:
        return None
    from app.services.workstreams import flow_means

    return await flow_means(session, signal)


def _uuid(value: Any) -> UUID | None:
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value or "").strip())
    except ValueError:
        return None


async def project_links(
    session: AsyncSession, tenant_id: UUID, connection_ids: Iterable[UUID] | None = None
) -> dict[str, list[str]]:
    """Connection id -> linked project ids (live projects only)."""
    query = (
        select(ProjectResource.connection_id, ProjectResource.project_id)
        .join(Project, Project.id == ProjectResource.project_id)
        .where(
            ProjectResource.tenant_id == tenant_id,
            ProjectResource.resource_type == CONNECTION_RESOURCE,
            ProjectResource.deleted_at.is_(None),
            Project.deleted_at.is_(None),
        )
    )
    ids = list(connection_ids) if connection_ids is not None else None
    if ids is not None:
        if not ids:
            return {}
        query = query.where(ProjectResource.connection_id.in_(ids))
    out: dict[str, list[str]] = {}
    for conn_id, project_id in (await session.execute(query)).all():
        if conn_id is not None:
            out.setdefault(str(conn_id), []).append(str(project_id))
    return out


async def project_names(
    session: AsyncSession, tenant_id: UUID, project_ids: Iterable[str]
) -> dict[str, str]:
    ids = [u for u in (_uuid(p) for p in project_ids) if u is not None]
    if not ids:
        return {}
    rows = await session.execute(
        select(Project.id, Project.name).where(
            Project.tenant_id == tenant_id, Project.id.in_(ids)
        )
    )
    return {str(pid): name for pid, name in rows.all()}


async def set_connection_projects(
    session: AsyncSession,
    tenant_id: UUID,
    conn: IntegrationConnection,
    project_ids: list[str],
    *,
    actor_user_id: UUID | None = None,
) -> list[str]:
    """Replace the connection's project links (caller commits)."""
    wanted: set[UUID] = set()
    for raw in project_ids:
        pid = _uuid(raw)
        if pid is None:
            raise ValueError("Invalid project id")
        wanted.add(pid)
    if wanted:
        found = set(
            (
                await session.execute(
                    select(Project.id).where(
                        Project.tenant_id == tenant_id,
                        Project.id.in_(list(wanted)),
                        Project.deleted_at.is_(None),
                    )
                )
            ).scalars().all()
        )
        if found != wanted:
            raise ValueError("Unknown project")
    existing = (
        await session.execute(
            select(ProjectResource).where(
                ProjectResource.tenant_id == tenant_id,
                ProjectResource.resource_type == CONNECTION_RESOURCE,
                ProjectResource.connection_id == conn.id,
                ProjectResource.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    kept: set[UUID] = set()
    now = utcnow()
    for row in existing:
        if row.project_id in wanted and row.project_id not in kept:
            kept.add(row.project_id)
            continue
        row.deleted_at = now
        row.deleted_by_user_id = actor_user_id
        session.add(row)
    for pid in wanted - kept:
        session.add(
            ProjectResource(
                tenant_id=tenant_id,
                project_id=pid,
                resource_type=CONNECTION_RESOURCE,
                provider=conn.provider,
                connection_id=conn.id,
                label=conn.display_name or conn.provider,
                external_ref=str(conn.id),
                status="connected",
            )
        )
    await session.flush()
    return sorted(str(p) for p in wanted)


async def folder_chain(session: AsyncSession, tenant_id: UUID, project_id: UUID | None) -> list[UUID]:
    """The folder and its parents, nearest first."""
    out: list[UUID] = []
    while project_id is not None and project_id not in out and len(out) < 8:
        row = await session.get(Project, project_id)
        if row is None or row.tenant_id != tenant_id or row.deleted_at is not None:
            break
        out.append(row.id)
        project_id = row.parent_id
    return out


async def conversation_departments(
    session: AsyncSession, tenant_id: UUID, signal: Any | None, agent_id: UUID | None
) -> set[UUID] | None:
    """Departments whose connections this call may use: the chain of the conversation's department.

    Without a conversation, the chains of the agent's own departments. None
    while org rules are off (no department rule).
    """
    from app.services.org_rules import org_rules_on
    from app.services.teams import department_chain, direct_department_ids

    if not await org_rules_on(session, tenant_id):
        return None
    if signal is not None:
        from app.services.department_domain import department_of_signal

        return set(await department_chain(session, tenant_id, await department_of_signal(session, signal)))
    out: set[UUID] = set()
    for department_id in await direct_department_ids(session, tenant_id, "agent", agent_id) if agent_id else set():
        out |= set(await department_chain(session, tenant_id, department_id))
    return out


async def denial_reason(
    session: AsyncSession,
    tenant_id: UUID,
    conn: IntegrationConnection,
    *,
    agent_id: UUID | None,
    project_id: UUID | None,
    links: dict[str, list[str]] | None = None,
    folders: list[UUID] | None = None,
    departments: set[UUID] | None = None,
    flow: Any | None = None,
) -> str | None:
    """Plain-text reason this agent may not use ``conn`` here, else None.

    ``folders`` is the conversation's folder chain (defaults to ``project_id``
    alone); a link on any of them counts. ``departments`` is the chain of
    the conversation's department (``conversation_departments``). ``flow``
    is the conversation flow's means (``workstreams.flow_means``).
    """
    if agent_id is None:
        return None
    linked = (links if links is not None else await project_links(session, tenant_id, [conn.id])).get(
        str(conn.id), []
    )
    label = conn.display_name or conn.provider
    here = [str(f) for f in (folders if folders is not None else ([project_id] if project_id else []))]
    if linked and not set(here) & set(linked):
        names = await project_names(session, tenant_id, linked)
        where = ", ".join(sorted(names.get(p, p) for p in linked))
        if not here:
            return (
                f"The {label} connection belongs to folder {where}. Work on it from "
                "a conversation in that folder."
            )
        return f"The {label} connection belongs to folder {where}, not this folder."
    if flow is not None and flow.connection_ids is not None and str(conn.id) not in flow.connection_ids:
        return (
            f"The flow {flow.flow_name} works with other connections than {label}. Use one it "
            "names, or ask a person to widen the flow."
        )
    if departments is not None and conn.department_id and conn.department_id not in departments:
        from app.models.team import Department

        dept = await session.get(Department, conn.department_id)
        name = dept.name if dept is not None else "another department"
        return (
            f"The {label} connection belongs to {name}. Work on it from a conversation "
            f"of {name} or a department below it."
        )
    from app.services.connection_access import agent_level

    if await agent_level(session, conn, agent_id) is None:
        return (
            f"This agent may not use the {label} connection. An operator can grant "
            "access under the connection's Access settings."
        )
    return None


async def usable_connection_ids(
    session: AsyncSession,
    tenant_id: UUID,
    connection_ids: Iterable[UUID],
    *,
    agent_id: UUID | None,
    project_id: UUID | None,
    signal: Any | None = None,
) -> tuple[set[str], dict[str, str]]:
    """(usable ids, {denied id: reason}) for an agent call from a conversation.

    In order: the folder link of the conversation's folder or a parent; the
    department chain of the conversation (org rules on); the access list.
    """
    ids = list(connection_ids)
    if agent_id is None:
        return {str(i) for i in ids}, {}
    signal = await _conversation(session, tenant_id, signal)
    if project_id is None and signal is not None:
        project_id = getattr(signal, "project_id", None)
    folders = await folder_chain(session, tenant_id, project_id)
    departments = await conversation_departments(session, tenant_id, signal, agent_id)
    flow = await _flow(session, signal)
    rows = (
        await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.id.in_(ids),
            )
        )
    ).scalars().all() if ids else []
    links = await project_links(session, tenant_id, ids)
    usable: set[str] = set()
    denied: dict[str, str] = {}
    for conn in rows:
        reason = await denial_reason(
            session,
            tenant_id,
            conn,
            agent_id=agent_id,
            project_id=project_id,
            links=links,
            folders=folders,
            departments=departments,
            flow=flow,
        )
        if reason:
            denied[str(conn.id)] = reason
        else:
            usable.add(str(conn.id))
    return usable, denied


async def project_linked_ids(
    session: AsyncSession, tenant_id: UUID, project_id: UUID | None, connection_ids: Iterable[UUID]
) -> set[str]:
    """Connections among ``connection_ids`` linked to the nearest folder in ``project_id``'s chain that has any.

    Without ``project_id`` the folder of the conversation in flight counts.
    """
    if project_id is None:
        signal = await _conversation(session, tenant_id, None)
        project_id = getattr(signal, "project_id", None)
    links = await project_links(session, tenant_id, list(connection_ids))
    for folder in await folder_chain(session, tenant_id, project_id):
        here = {cid for cid, projects in links.items() if str(folder) in projects}
        if here:
            return here
    return set()


async def default_connection(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Any | None,
    candidates: Iterable[UUID],
    *,
    module_default: str | None = None,
) -> str | None:
    """The connection to use when the call names none.

    One candidate linked to the nearest folder of the conversation wins;
    otherwise the module default when it is a candidate; otherwise None (ask).
    """
    ids = [str(c) for c in candidates]
    linked = await project_linked_ids(
        session, tenant_id, getattr(signal, "project_id", None), [UUID(i) for i in ids]
    )
    if len(linked) == 1:
        return next(iter(linked))
    if module_default and module_default in ids:
        return module_default
    return None


async def set_connection_department(
    session: AsyncSession, tenant_id: UUID, conn: IntegrationConnection, department_id: UUID | None
) -> None:
    """Home department of a connection; None (or the organization) makes it workspace-wide. Caller commits."""
    from app.models.team import is_root_department
    from app.services.teams import get_team

    if department_id is not None:
        dept = await get_team(session, tenant_id, department_id)
        if dept is None:
            raise ValueError("Unknown department")
        if is_root_department(dept):
            department_id = None
    conn.department_id = department_id
    session.add(conn)
    await session.flush()


async def mcp_server_denial(
    session: AsyncSession,
    tenant_id: UUID,
    server_name: str,
    *,
    agent_id: UUID | None,
    project_id: UUID | None,
    signal: Any | None = None,
) -> tuple[str, str] | None:
    """(connection id, reason) when an agent may not call this MCP server here."""
    if agent_id is None or not server_name:
        return None
    from app.models.integration import IntegrationBinding, McpServer

    server = (
        await session.execute(
            select(McpServer).where(McpServer.tenant_id == tenant_id, McpServer.name == server_name)
        )
    ).scalars().first()
    if server is None:
        return None
    import json

    for binding in (
        await session.execute(
            select(IntegrationBinding).where(
                IntegrationBinding.tenant_id == tenant_id,
                IntegrationBinding.binding_type == "mcp_server",
            )
        )
    ).scalars().all():
        try:
            config = json.loads(binding.config_json or "{}")
        except json.JSONDecodeError:
            continue
        if str(config.get("mcp_server_id") or "") != str(server.id):
            continue
        conn = await session.get(IntegrationConnection, binding.connection_id)
        if conn is None or conn.tenant_id != tenant_id:
            return None
        signal = await _conversation(session, tenant_id, signal)
        if project_id is None and signal is not None:
            project_id = getattr(signal, "project_id", None)
        reason = await denial_reason(
            session,
            tenant_id,
            conn,
            agent_id=agent_id,
            project_id=project_id,
            folders=await folder_chain(session, tenant_id, project_id),
            departments=await conversation_departments(session, tenant_id, signal, agent_id),
            flow=await _flow(session, signal),
        )
        return (str(conn.id), reason) if reason else None
    return None


async def record_denial(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    agent_id: UUID | None,
    connection_id: str,
    reason: str,
    action: str = "connection:use",
) -> None:
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action=action,
        actor_type="agent",
        actor_id=agent_id or "",
        agent_id=agent_id,
        resource_type="connection",
        resource_id=connection_id,
        outcome="denied",
        summary=reason,
    )
