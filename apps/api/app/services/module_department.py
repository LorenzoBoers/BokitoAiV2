"""One-time module drop onto a department (origin_module_slug).

After the first materialization, operators own the island — no re-stamp,
skill overwrite, or flow stage rebuild on later calls.
See docs/architecture/module-one-time-drop.md.
"""

from __future__ import annotations

import json
import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.module_source import ModuleSource
from app.models.orchestra import Workstream
from app.models.signal import SignalTag
from app.models.team import Department, DepartmentMember, is_root_department
from app.models.workspace import WorkspaceDoc
from app.services.module_origin import get_module_department


def require_one_scope(
    *, department_id: UUID | None, agent_id: UUID | None
) -> None:
    """Module-created rows belong to a department or one agent."""
    if (department_id is None) == (agent_id is None):
        raise ValueError(
            "A module item needs exactly one of department_id or agent_id"
        )


def doc_in_agent_scope(
    *,
    doc_department_id: UUID | None,
    doc_agent_id: UUID | None,
    membership: set[UUID],
    agent_id: UUID | None,
) -> bool:
    """True when an agent run may score this document."""
    if agent_id is not None and doc_agent_id == agent_id:
        return True
    if doc_department_id is not None and doc_department_id in membership:
        return True
    return False


async def ensure_module_department(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
) -> Department:
    """Create or return the origin department for this module slug (idempotent)."""
    from app.modules.catalog import MODULE_BY_SLUG
    from app.services.teams import create_team

    existing = await get_module_department(session, tenant_id, slug)
    if existing is not None and not is_root_department(existing):
        return existing

    module = MODULE_BY_SLUG[slug]
    # Prefer an unused department that already has this name (legacy installs).
    named = (
        await session.execute(
            select(Department).where(
                Department.tenant_id == tenant_id,
                Department.name == module.name,
                Department.deleted_at.is_(None),
                Department.origin_module_slug.is_(None),
            )
        )
    ).scalar_one_or_none()
    if named is not None and not is_root_department(named):
        named.origin_module_slug = slug
        session.add(named)
        await session.flush()
        return named

    created = await create_team(
        session,
        tenant_id,
        name=module.name,
        description=module.description[:300],
    )
    created.origin_module_slug = slug
    session.add(created)
    await session.flush()
    return created


async def _add_agent_member(
    session: AsyncSession, tenant_id: UUID, department_id: UUID, agent_id: UUID
) -> None:
    existing = (
        await session.execute(
            select(DepartmentMember.id).where(
                DepartmentMember.department_id == department_id,
                DepartmentMember.member_kind == "agent",
                DepartmentMember.agent_id == agent_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return
    position = int(
        (
            await session.execute(
                select(DepartmentMember.position)
                .where(DepartmentMember.department_id == department_id)
                .order_by(DepartmentMember.position.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        or -1
    ) + 1
    session.add(
        DepartmentMember(
            tenant_id=tenant_id,
            department_id=department_id,
            member_kind="agent",
            agent_id=agent_id,
            duty="primary",
            position=position,
        )
    )


async def _copy_skill_once(
    session: AsyncSession, tenant_id: UUID, slug: str, department_id: UUID
) -> None:
    from app.modules.catalog import MODULE_SKILL_DIR
    from app.services.workspace import upsert_doc

    path = MODULE_SKILL_DIR / f"{slug}.md"
    if not path.is_file():
        return
    require_one_scope(department_id=department_id, agent_id=None)
    doc_path = f"modules/{slug}/skill.md"
    existing = (
        await session.execute(
            select(WorkspaceDoc).where(
                WorkspaceDoc.tenant_id == tenant_id,
                WorkspaceDoc.path == doc_path,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        # Create-once: never overwrite operator-edited skill content.
        if existing.department_id is None:
            existing.department_id = department_id
            existing.agent_id = None
            session.add(existing)
        return
    doc = await upsert_doc(
        session,
        tenant_id,
        path=doc_path,
        content=path.read_text(encoding="utf-8"),
        kind="skill",
        title=f"{slug} skill",
        created_by_type="system",
        created_by_id="module_install",
        commit=False,
    )
    doc.department_id = department_id
    doc.agent_id = None
    session.add(doc)


def _stage_kind(step_kind: str, *, last: bool) -> str:
    if step_kind == "wait_for_reply":
        return "waiting"
    if last:
        return "done"
    if step_kind == "ask_decision":
        return "waiting"
    return "open"


def _stage_key(name: str, index: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return (slug or f"stage-{index}")[:64]


async def _copy_flows_once(
    session: AsyncSession, tenant_id: UUID, slug: str, department_id: UUID
) -> None:
    from app.modules.catalog import module_workstream_templates

    require_one_scope(department_id=department_id, agent_id=None)
    for template in module_workstream_templates(slug):
        existing = (
            await session.execute(
                select(Workstream).where(
                    Workstream.tenant_id == tenant_id,
                    Workstream.module_slug == slug,
                    Workstream.template_slug == template.slug,
                    Workstream.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.department_id is None:
                existing.department_id = department_id
                session.add(existing)
            continue
        stages = []
        last = len(template.steps) - 1
        for index, step in enumerate(template.steps):
            name = str(step.get("name") or f"Stage {index + 1}")
            stages.append(
                {
                    "key": _stage_key(name, index),
                    "name": name,
                    "kind": _stage_kind(str(step.get("kind") or ""), last=index == last),
                }
            )
        flow = Workstream(
            tenant_id=tenant_id,
            name=template.name,
            description=template.description,
            module_slug=slug,
            template_slug=template.slug,
            department_id=department_id,
            stages_json=json.dumps(stages),
        )
        session.add(flow)


async def _create_folder_once(
    session: AsyncSession, tenant_id: UUID, slug: str, department_id: UUID
) -> None:
    """The module's folder with one Works in item: its connection, else a canvas.

    Create-once: a root folder with the same name is the operator's and stays.
    """
    from app.models.auth import Tenant
    from app.models.integration import IntegrationConnection
    from app.models.project import Project
    from app.models.project_canvas import OWNER_PROJECT
    from app.modules.catalog import MODULE_BY_SLUG, get_module_package
    from app.services import works_in
    from app.services.project_canvas import create_canvas
    from app.services.project_work import create_resource
    from app.services.projects import create_project

    package = get_module_package(slug)
    template = package.project if package else None
    if template is None:
        return
    language = works_in.workspace_language(await session.get(Tenant, tenant_id))
    name = template.folder_name(language)
    existing = (
        await session.execute(
            select(Project.id).where(
                Project.tenant_id == tenant_id,
                Project.parent_id.is_(None),
                Project.deleted_at.is_(None),
                Project.name == name,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return
    created = await create_project(session, tenant_id, name=name)
    folder_id = UUID(str(created["id"]))
    folder = await session.get(Project, folder_id)
    if folder is not None:
        folder.department_id = department_id
        session.add(folder)

    module = MODULE_BY_SLUG[slug]
    connection = (
        await session.execute(
            select(IntegrationConnection)
            .where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.status == "active",
                IntegrationConnection.provider.in_(
                    (*module.provider_slugs, *module.planned_provider_slugs)
                ),
            )
            .order_by(IntegrationConnection.created_at)
        )
    ).scalars().first()
    if connection is not None:
        await create_resource(
            session,
            tenant_id,
            folder_id,
            resource_type="connection",
            provider=connection.provider,
            label=connection.display_name or "",
            connection_id=connection.id,
            created_by_type="system",
            created_by_id="module_install",
        )
        return
    await create_canvas(
        session,
        tenant_id,
        owner_kind=OWNER_PROJECT,
        owner_id=folder_id,
        title=template.canvas_name(language),
        updated_by_type="system",
        updated_by_id="module_install",
        kick=False,
        force_new=True,
    )


async def bind_module_department(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    agent_id: UUID | None = None,
) -> Department:
    """One-time materialize: create origin dept + missing seeds/tags/flows/skill.

    Idempotent. Does not overwrite existing skill content or flow stages.
    Only stamps ``department_id`` on rows that still have none.
    """
    department = await ensure_module_department(session, tenant_id, slug)
    require_one_scope(department_id=department.id, agent_id=None)
    if agent_id is not None:
        await _add_agent_member(session, tenant_id, department.id, agent_id)

    sources = (
        await session.execute(
            select(ModuleSource).where(
                ModuleSource.tenant_id == tenant_id,
                ModuleSource.module_slug == slug,
            )
        )
    ).scalars().all()
    for source in sources:
        if source.department_id is None:
            source.department_id = department.id
            session.add(source)
        if source.workspace_doc_id:
            doc = await session.get(WorkspaceDoc, source.workspace_doc_id)
            if doc is not None and doc.department_id is None:
                doc.department_id = department.id
                doc.agent_id = None
                session.add(doc)

    await _copy_skill_once(session, tenant_id, slug, department.id)

    tags = (
        await session.execute(
            select(SignalTag).where(
                SignalTag.tenant_id == tenant_id,
                SignalTag.module_slug == slug,
            )
        )
    ).scalars().all()
    for tag in tags:
        if tag.department_id is None:
            tag.department_id = department.id
            session.add(tag)

    await _copy_flows_once(session, tenant_id, slug, department.id)
    await _create_folder_once(session, tenant_id, slug, department.id)
    await session.commit()
    await session.refresh(department)
    return department


async def archive_module_department(
    session: AsyncSession, tenant_id: UUID, slug: str
) -> None:
    """Soft-delete the origin department (module de-install)."""
    from app.services.teams import delete_team

    department = await get_module_department(session, tenant_id, slug)
    if department is None or is_root_department(department):
        return
    await delete_team(session, department, permanent=False)
