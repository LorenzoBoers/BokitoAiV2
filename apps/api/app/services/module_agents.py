"""Module tools follow the department: an agent in a module's department (or below) uses its tools.

A module grant (``ResourceGrant`` kind ``module``) to another department or one
agent opens the module there too. The organization-wide grant is for people
(who may open the module page), not for agents.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.relations import ResourceGrant
from app.models.team import Department, is_root_department
from app.modules.catalog import MODULE_BY_SLUG, MODULE_TOOL_PREFIXES

logger = logging.getLogger(__name__)


async def module_slugs_for_agent(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> set[str]:
    """Installed modules whose department (or a granted department) holds this agent or a parent of its seat."""
    from app.services.teams import department_chain, direct_department_ids

    above: set[UUID] = set()
    for department_id in await direct_department_ids(session, tenant_id, "agent", agent_id):
        above |= set(await department_chain(session, tenant_id, department_id))
    departments = (
        await session.execute(
            select(Department).where(
                Department.tenant_id == tenant_id,
                Department.origin_module_slug.is_not(None),
                Department.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    slugs = {d.origin_module_slug for d in departments if d.id in above and not is_root_department(d)}
    grants = (
        await session.execute(
            select(ResourceGrant).where(
                ResourceGrant.tenant_id == tenant_id,
                ResourceGrant.resource_kind == "module",
                ResourceGrant.module_slug.is_not(None),
            )
        )
    ).scalars().all()
    root_id = None
    if grants:
        from app.services.teams import org_root

        root_id = (await org_root(session, tenant_id)).id
    for grant in grants:
        if grant.agent_id == agent_id or (
            grant.department_id is not None and grant.department_id in above and grant.department_id != root_id
        ):
            slugs.add(grant.module_slug)
    return {s for s in slugs if s}


async def agent_has_module(session: AsyncSession, tenant_id: UUID, agent_id: UUID, slug: str) -> bool:
    return slug in await module_slugs_for_agent(session, tenant_id, agent_id)


async def module_summaries(session: AsyncSession, tenant_id: UUID) -> dict[str, dict[str, Any]]:
    """Map module_slug -> department crew size, point of contact and managed specialist."""
    from app.models.team import DepartmentMember
    from app.services.agent_avatar import avatar_payload
    from app.services.department_access import department_roles

    departments = {
        d.origin_module_slug: d
        for d in (
            await session.execute(
                select(Department).where(
                    Department.tenant_id == tenant_id,
                    Department.origin_module_slug.is_not(None),
                    Department.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        if d.origin_module_slug
    }
    specialist_by_slug: dict[str, Agent] = {}
    for agent in (
        await session.execute(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.slug.in_([f"module-{slug}" for slug in MODULE_BY_SLUG]),
                Agent.kind == "company",
                Agent.is_active.is_(True),
            )
        )
    ).scalars().all():
        slug = (agent.slug or "").removeprefix("module-").strip()
        if slug and slug not in specialist_by_slug:
            specialist_by_slug[slug] = agent

    out: dict[str, dict[str, Any]] = {}
    for slug in MODULE_BY_SLUG:
        dept = departments.get(slug)
        crew = 0
        contact: Agent | None = None
        if dept is not None:
            crew = len(
                (
                    await session.execute(
                        select(DepartmentMember.id).where(
                            DepartmentMember.department_id == dept.id,
                            DepartmentMember.member_kind == "agent",
                        )
                    )
                ).scalars().all()
            )
            contact_id = (await department_roles(session, tenant_id, dept.id))["contact_agent_id"]
            contact = await session.get(Agent, contact_id) if contact_id else None
        specialist = specialist_by_slug.get(slug)
        mark = avatar_payload(specialist) if specialist else {}
        out[slug] = {
            "department_id": str(dept.id) if dept else None,
            "department_name": dept.name if dept else None,
            "assigned_agent_count": crew,
            "default_agent_id": str(contact.id) if contact else None,
            "default_agent_name": contact.name if contact else None,
            "specialist_agent_id": str(specialist.id) if specialist else None,
            "specialist_agent_name": specialist.name if specialist else None,
            "specialist_job_title": (specialist.job_title or "") if specialist else None,
            "has_managed_specialist": specialist is not None,
            "specialist_avatar_kind": mark.get("avatar_kind"),
            "specialist_avatar_icon": mark.get("avatar_icon"),
            "specialist_avatar_color": mark.get("avatar_color"),
            "specialist_avatar_shape": mark.get("avatar_shape"),
            "specialist_avatar_image_url": mark.get("avatar_image_url"),
        }
    return out


def _module_specialist_slug(module_slug: str) -> str:
    return f"module-{module_slug}"


async def soft_archive_module_specialists(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> list[str]:
    """Soft-archive pack specialists for this module (keep history, Govern restore).

    Operator-assigned company agents stay active. Archives the pack agent by
    slug ``module-{slug}``.
    """
    from app.services.workforce_runtime import archive_agent

    agents = list(
        (
            await session.execute(
                select(Agent).where(
                    Agent.tenant_id == tenant_id,
                    Agent.slug == _module_specialist_slug(module_slug),
                    Agent.kind == "company",
                    Agent.is_active.is_(True),
                )
            )
        ).scalars().all()
    )
    archived: list[str] = []
    for agent in agents:
        try:
            await archive_agent(session, tenant_id, agent.id)
            archived.append(str(agent.id))
        except Exception:  # noqa: BLE001
            logger.warning("module agent archive failed", exc_info=True)
            continue
    return archived


async def managed_module_specialist(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> Agent | None:
    """Active pack specialist for a module, if hired (slug ``module-{slug}``)."""
    return (
        await session.execute(
            select(Agent).where(
                Agent.tenant_id == tenant_id,
                Agent.slug == _module_specialist_slug(module_slug),
                Agent.kind == "company",
                Agent.is_active.is_(True),
            )
        )
    ).scalars().first()


def is_module_tool(tool_name: str) -> str | None:
    """The module slug of a module verb tool (``{slug}_{verb}``), else None."""
    return next((slug for slug, prefix in MODULE_TOOL_PREFIXES.items() if tool_name.startswith(prefix)), None)


def filter_tools_for_agent_modules(
    tools: list[dict[str, Any]],
    *,
    enabled_slugs: set[str],
    reachable_slugs: set[str],
    all_tools: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Module tools only for installed modules the agent reaches through its department.

    With ``all_tools`` the reachable modules' tools are added even when the
    passport omits them: the department is what grants them.
    """
    allowed = enabled_slugs & reachable_slugs

    def opens(tool: dict[str, Any]) -> bool:
        slug = is_module_tool(str(tool.get("name") or ""))
        return slug is None or slug in allowed

    kept = [t for t in tools if opens(t)]
    if all_tools is None:
        return kept
    names = {str(t.get("name") or "") for t in kept}
    extra = [
        t
        for t in all_tools
        if is_module_tool(str(t.get("name") or "")) in allowed and t.get("name") not in names
    ]
    return [*kept, *extra]
