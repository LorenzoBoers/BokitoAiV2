"""Per-agent resource scopes: the module roster pattern for everything else.

The module ACL (roster + company_ids + can_write) proved the shape; AgentScope
applies it to projects, knowledge, and channels. Semantics per resource kind:

- no rows: unrestricted (default open, matching the module pattern)
- any row: the kind becomes an allowlist of resource ids
- ``can_write`` false on a row: read-only access to that resource

Enforced centrally in the tool executor (see ``check_tool_scope``), not just
in prompt snapshots.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.module_agent import AgentScope

SCOPE_KINDS = ("project", "knowledge", "channel")


async def list_agent_scopes(
    session: AsyncSession, tenant_id: UUID, agent_id: UUID
) -> dict[str, list[dict[str, Any]]]:
    rows = (
        await session.execute(
            select(AgentScope).where(
                AgentScope.tenant_id == tenant_id, AgentScope.agent_id == agent_id
            )
        )
    ).scalars().all()
    out: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        out.setdefault(row.resource_kind, []).append(
            {"resource_id": row.resource_id, "can_write": bool(row.can_write)}
        )
    return out


async def set_agent_scope(
    session: AsyncSession,
    tenant_id: UUID,
    agent_id: UUID,
    resource_kind: str,
    entries: list[dict[str, Any]] | None,
) -> dict[str, list[dict[str, Any]]]:
    """Replace one kind's allowlist. ``entries=None`` or empty clears the
    restriction (back to unrestricted)."""
    if resource_kind not in SCOPE_KINDS:
        raise ValueError(f"Unknown scope kind: {resource_kind}")
    await session.execute(
        delete(AgentScope).where(
            AgentScope.tenant_id == tenant_id,
            AgentScope.agent_id == agent_id,
            AgentScope.resource_kind == resource_kind,
        )
    )
    for entry in entries or []:
        resource_id = str(entry.get("resource_id") or "").strip()
        if not resource_id:
            continue
        session.add(
            AgentScope(
                tenant_id=tenant_id,
                agent_id=agent_id,
                resource_kind=resource_kind,
                resource_id=resource_id,
                can_write=bool(entry.get("can_write", True)),
            )
        )
    await session.commit()
    return await list_agent_scopes(session, tenant_id, agent_id)


async def agent_scope_allows(
    session: AsyncSession,
    tenant_id: UUID,
    agent_id: UUID,
    resource_kind: str,
    resource_id: str,
    *,
    write: bool = False,
) -> bool:
    rows = (
        await session.execute(
            select(AgentScope).where(
                AgentScope.tenant_id == tenant_id,
                AgentScope.agent_id == agent_id,
                AgentScope.resource_kind == resource_kind,
            )
        )
    ).scalars().all()
    if not rows:
        return True  # unrestricted
    match = next((r for r in rows if r.resource_id == str(resource_id)), None)
    if match is None:
        return False
    return bool(match.can_write) if write else True


async def check_tool_scope(
    session: AsyncSession,
    tenant_id: UUID,
    agent: Any | None,
    tool_input: dict[str, Any],
    *,
    project_id: UUID | None = None,
    write: bool = False,
) -> str | None:
    """Central executor hook: deny reason when the call leaves the agent's
    scoped resources, else None. Checks the project the call targets."""
    if agent is None or getattr(agent, "id", None) is None:
        return None
    target = str(tool_input.get("project_id") or project_id or "").strip()
    if target and not await agent_scope_allows(
        session, tenant_id, agent.id, "project", target, write=write
    ):
        return (
            "This agent's scope does not include that project. An operator can "
            "widen it under the agent's access settings."
        )
    return None
