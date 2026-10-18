"""A module install is one department. Shipped items hang on that row.

Exclusivity (exactly one of department_id or agent_id) is checked here for
rows the install writes. It is not a table CHECK: older docs may have neither.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.module_install import ModuleInstall
from app.models.module_source import ModuleSource
from app.models.orchestra import Workstream
from app.models.signal import SignalTag
from app.models.team import Department, DepartmentMember, is_root_department
from app.models.workspace import WorkspaceDoc


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
    """True when an agent run may score this document.

    Membership is the agent's departments plus ancestors (All included when
    they belong to a child). A null department and a null agent stay out.
    """
    if doc_department_id is None and doc_agent_id is None:
        return True
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
    """Create or reuse the department this install owns."""
    from app.modules.catalog import MODULE_BY_SLUG
    from app.services.teams import create_team, get_team

    module = MODULE_BY_SLUG[slug]
    install = (
        await session.execute(
            select(ModuleInstall).where(
                ModuleInstall.tenant_id == tenant_id,
                ModuleInstall.module_slug == slug,
            )
        )
    ).scalar_one_or_none()
    if install is None:
        raise ValueError("Module install not found")
    if install.department_id:
        current = await get_team(session, tenant_id, install.department_id)
        if current is not None and not is_root_department(current):
            return current
    named = (
        await session.execute(
            select(Department).where(
                Department.tenant_id == tenant_id,
                Department.name == module.name,
                Department.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if named is not None and not is_root_department(named):
        install.department_id = named.id
        session.add(install)
        await session.flush()
        return named
    created = await create_team(
        session,
        tenant_id,
        name=module.name,
        description=module.description[:300],
    )
    install.department_id = created.id
    session.add(install)
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


async def _copy_skill(
    session: AsyncSession, tenant_id: UUID, slug: str, department_id: UUID
) -> None:
    from app.modules.catalog import MODULE_SKILL_DIR
    from app.services.workspace import upsert_doc

    path = MODULE_SKILL_DIR / f"{slug}.md"
    if not path.is_file():
        return
    require_one_scope(department_id=department_id, agent_id=None)
    doc = await upsert_doc(
        session,
        tenant_id,
        path=f"modules/{slug}/skill.md",
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


async def _copy_flows(
    session: AsyncSession, tenant_id: UUID, slug: str, department_id: UUID
) -> None:
    from app.modules.catalog import module_workstream_templates
    from app.services.setup_links import sync_flow_stages

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
        if existing is None:
            existing = Workstream(
                tenant_id=tenant_id,
                name=template.name,
                description=template.description,
                enabled=True,
                module_slug=slug,
                template_slug=template.slug,
                department_id=department_id,
                stages_json=json.dumps(stages),
            )
            session.add(existing)
            await session.flush()
        else:
            existing.department_id = department_id
            if not (existing.stages_json or "").strip() or existing.stages_json == "[]":
                existing.stages_json = json.dumps(stages)
            session.add(existing)
            await session.flush()
        await sync_flow_stages(session, existing)


async def bind_module_department(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    agent_id: UUID | None = None,
) -> Department:
    """Point the install, sources, skill, label and flows at one department.

    Platform source rows are seeded by the install write. This stamps them;
    it does not start another crawl.
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
        source.department_id = department.id
        session.add(source)
        if source.workspace_doc_id:
            doc = await session.get(WorkspaceDoc, source.workspace_doc_id)
            if doc is not None:
                doc.department_id = department.id
                doc.agent_id = None
                session.add(doc)
    await _copy_skill(session, tenant_id, slug, department.id)
    tags = (
        await session.execute(
            select(SignalTag).where(
                SignalTag.tenant_id == tenant_id,
                SignalTag.module_slug == slug,
            )
        )
    ).scalars().all()
    for tag in tags:
        tag.department_id = department.id
        session.add(tag)
    await _copy_flows(session, tenant_id, slug, department.id)
    await session.commit()
    await session.refresh(department)
    return department


async def archive_module_department(
    session: AsyncSession, tenant_id: UUID, slug: str
) -> None:
    """Uninstall moves the install's department to the bin."""
    from app.services.teams import delete_team, get_team

    install = (
        await session.execute(
            select(ModuleInstall).where(
                ModuleInstall.tenant_id == tenant_id,
                ModuleInstall.module_slug == slug,
            )
        )
    ).scalar_one_or_none()
    if install is None or install.department_id is None:
        return
    department = await get_team(session, tenant_id, install.department_id)
    install.department_id = None
    install.updated_at = datetime.utcnow()
    session.add(install)
    await session.flush()
    if department is None or is_root_department(department):
        await session.commit()
        return
    await delete_team(session, department, permanent=False)
