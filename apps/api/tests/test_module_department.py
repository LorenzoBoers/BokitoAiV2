"""Module install owns one department; retrieval sees that scope only."""

import pytest
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.module_install import ModuleInstall
from app.models.orchestra import Workstream
from app.models.team import Department, is_root_department
from app.models.workspace import WorkspaceDoc
from app.services.module_department import (
    archive_module_department,
    bind_module_department,
    doc_in_agent_scope,
    require_one_scope,
)


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
    session_override.add(
        ModuleInstall(tenant_id=tenant_id, module_slug="accounting", install_state="setup")
    )
    await session_override.commit()

    department = await bind_module_department(session_override, tenant_id, "accounting")
    assert department.name == "Accounting"
    assert department.parent_id is not None
    assert not is_root_department(department)

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

    department_id = department.id
    await archive_module_department(session_override, tenant_id, "accounting")
    session_override.expire_all()
    trashed = await session_override.get(Department, department_id)
    assert trashed is not None and trashed.deleted_at is not None
    install = (
        await session_override.execute(
            select(ModuleInstall).where(
                ModuleInstall.tenant_id == tenant_id,
                ModuleInstall.module_slug == "accounting",
            )
        )
    ).scalar_one()
    assert install.department_id is None
