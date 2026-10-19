"""Module install owns one department; retrieval sees that scope only."""

import pytest
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.orchestra import Workstream
from app.models.team import Department, is_root_department
from app.models.workspace import WorkspaceDoc
from app.services.module_department import (
    archive_module_department,
    bind_module_department,
    doc_in_agent_scope,
    require_one_scope,
)
from app.services.module_origin import get_module_department, module_is_installed


def test_scope_rules():
    from uuid import uuid4

    dept, agent, other = uuid4(), uuid4(), uuid4()
    require_one_scope(department_id=dept, agent_id=None)
    require_one_scope(department_id=None, agent_id=agent)
    with pytest.raises(ValueError):
        require_one_scope(department_id=None, agent_id=None)
    with pytest.raises(ValueError):
        require_one_scope(department_id=dept, agent_id=agent)
    assert doc_in_agent_scope(
        doc_department_id=dept,
        doc_agent_id=None,
        membership={dept},
        agent_id=agent,
    )
    assert doc_in_agent_scope(
        doc_department_id=None,
        doc_agent_id=agent,
        membership=set(),
        agent_id=agent,
    )
    assert not doc_in_agent_scope(
        doc_department_id=None,
        doc_agent_id=None,
        membership={dept},
        agent_id=agent,
    )
    assert not doc_in_agent_scope(
        doc_department_id=other,
        doc_agent_id=None,
        membership={dept},
        agent_id=agent,
    )


async def test_install_binds_accounting_department(client, session_override):
    del client
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    tenant_id = tenant.id

    department = await bind_module_department(session_override, tenant_id, "accounting")
    department_id = department.id
    assert department.name == "Accounting"
    assert department.parent_id is not None
    assert not is_root_department(department)
    assert department.origin_module_slug == "accounting"
    assert await module_is_installed(session_override, tenant_id, "accounting")

    skill = (
        await session_override.execute(
            select(WorkspaceDoc).where(
                WorkspaceDoc.tenant_id == tenant_id,
                WorkspaceDoc.path == "modules/accounting/skill.md",
            )
        )
    ).scalar_one()
    assert skill.department_id == department.id
    assert skill.agent_id is None

    flows = (
        await session_override.execute(
            select(Workstream).where(
                Workstream.tenant_id == tenant_id,
                Workstream.module_slug == "accounting",
            )
        )
    ).scalars().all()
    assert {row.template_slug for row in flows} == {
        "vat-filing-prep",
        "monthly-close-review",
    }
    assert all(row.department_id == department.id for row in flows)

    # Create-once: second bind must not overwrite skill content.
    skill.content = "operator edited"
    session_override.add(skill)
    await session_override.commit()
    await bind_module_department(session_override, tenant_id, "accounting")
    session_override.expire_all()
    skill_again = (
        await session_override.execute(
            select(WorkspaceDoc).where(
                WorkspaceDoc.tenant_id == tenant_id,
                WorkspaceDoc.path == "modules/accounting/skill.md",
            )
        )
    ).scalar_one()
    assert skill_again.content == "operator edited"

    await archive_module_department(session_override, tenant_id, "accounting")
    session_override.expire_all()
    trashed = await session_override.get(Department, department_id)
    assert trashed is not None and trashed.deleted_at is not None
    assert await get_module_department(session_override, tenant_id, "accounting") is None
    assert not await module_is_installed(session_override, tenant_id, "accounting")
