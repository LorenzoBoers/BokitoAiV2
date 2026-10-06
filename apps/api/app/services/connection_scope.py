"""Where and by whom a connection may be used: project links + access list.

Project links are ``ProjectResource`` rows with ``resource_type="connection"``.
A connection without links is workspace-wide; with one or more links it is
exclusive to those projects, and calls outside them (or without a project)
cannot use it. The access list (``connection_access``) then decides which
agents may use it.

Enforced here for every agent-driven lookup (accounting verbs, module
listings, partner MCP); denials are audited. Operator listings without an
agent see every connection.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationConnection
from app.models.project import Project
from app.models.project_work import ProjectResource

CONNECTION_RESOURCE = "connection"


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
    now = datetime.utcnow()
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


async def denial_reason(
    session: AsyncSession,
    tenant_id: UUID,
    conn: IntegrationConnection,
    *,
    agent_id: UUID | None,
    project_id: UUID | None,
    links: dict[str, list[str]] | None = None,
) -> str | None:
    """Plain-text reason this agent may not use ``conn`` here, else None."""
    if agent_id is None:
        return None
    linked = (links if links is not None else await project_links(session, tenant_id, [conn.id])).get(
        str(conn.id), []
    )
    label = conn.display_name or conn.provider
    if linked and (project_id is None or str(project_id) not in linked):
        names = await project_names(session, tenant_id, linked)
        where = ", ".join(sorted(names.get(p, p) for p in linked))
        if project_id is None:
            return (
                f"The {label} connection belongs to project {where}. Work on it from "
                "a conversation in that project."
            )
        return f"The {label} connection belongs to project {where}, not this project."
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
) -> tuple[set[str], dict[str, str]]:
    """(usable ids, {denied id: reason}) for an agent call in a project context."""
    ids = list(connection_ids)
    if agent_id is None:
        return {str(i) for i in ids}, {}
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
            session, tenant_id, conn, agent_id=agent_id, project_id=project_id, links=links
        )
        if reason:
            denied[str(conn.id)] = reason
        else:
            usable.add(str(conn.id))
    return usable, denied


async def project_linked_ids(
    session: AsyncSession, tenant_id: UUID, project_id: UUID | None, connection_ids: Iterable[UUID]
) -> set[str]:
    """Connections among ``connection_ids`` linked to ``project_id``."""
    if project_id is None:
        return set()
    links = await project_links(session, tenant_id, list(connection_ids))
    return {cid for cid, projects in links.items() if str(project_id) in projects}


async def mcp_server_denial(
    session: AsyncSession,
    tenant_id: UUID,
    server_name: str,
    *,
    agent_id: UUID | None,
    project_id: UUID | None,
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
        reason = await denial_reason(
            session, tenant_id, conn, agent_id=agent_id, project_id=project_id
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
