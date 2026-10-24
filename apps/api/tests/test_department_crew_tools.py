"""Departments from the chat: the tree an agent reads, the crew change it proposes, the crew it delegates to."""

from uuid import UUID

from sqlalchemy import select

from app.models.agent import Agent
from app.models.audit import AuditEvent
from app.models.auth import Tenant, User
from app.models.platform_change import PlatformChange
from app.services import teams as teams_svc
from app.services.agent_awareness import aware_context
from app.services.platform_changes import accept_platform_change, rollback_platform_change
from app.tools.platform import _set_department_crew
from app.tools.registry import ToolContext
from app.tools.workspace_read import _list_teams
from scripts.seed import TEST_EMAIL


async def _setup(session):
    tenant = (await session.execute(select(Tenant))).scalar_one()
    owner = (await session.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    ava = Agent(tenant_id=tenant.id, name="Ava", kind="company", is_active=True)
    bram = Agent(tenant_id=tenant.id, name="Bram", kind="company", is_active=True)
    paused = Agent(tenant_id=tenant.id, name="Pim", kind="company", is_active=False)
    session.add_all([ava, bram, paused])
    await session.flush()
    support = await teams_svc.create_team(session, tenant.id, name="Support")
    await teams_svc.set_team_members(
        session,
        support,
        [
            {"kind": "agent", "id": str(ava.id), "duty": "primary"},
            {"kind": "agent", "id": str(bram.id), "duty": "member", "focus": "Refunds"},
            {"kind": "user", "id": str(owner.id), "duty": "primary"},
            {"kind": "agent", "id": str(paused.id), "duty": "member"},
        ],
    )
    await session.commit()
    return tenant, owner, support, ava, bram, paused


async def test_list_departments_is_a_tree_with_contact_and_crew(client, session_override):
    tenant, owner, support, ava, bram, paused = await _setup(session_override)
    ctx = ToolContext(session=session_override, tenant_id=tenant.id, user_id=owner.id)
    rows = (await _list_teams(ctx, {}))["departments"]
    org, dept = rows[0], next(r for r in rows if r["id"] == str(support.id))
    assert org["is_org"] is True and org["name"] == tenant.name and org["depth"] == 0
    assert str(support.id) in org["children"]
    assert dept["depth"] == 1 and dept["path"] == f"{tenant.name} / Support"
    assert dept["contact"] == {"id": str(ava.id), "name": "Ava", "implicit": False}
    assert dept["accountable"]["id"] == str(owner.id)
    crew = {m["id"]: (m["role"], m["focus"]) for m in dept["crew"]}
    assert crew[str(bram.id)] == ("member", "Refunds")
    assert str(paused.id) not in crew


async def test_agent_proposes_crew_change_and_it_applies_on_approval(client, session_override):
    tenant, owner, support, ava, bram, _paused = await _setup(session_override)
    ctx = ToolContext(session=session_override, tenant_id=tenant.id, user_id=None, agent=ava, mode="ask")

    refused = await _set_department_crew(
        ctx,
        {
            "department_id": str(support.id),
            "crew": [
                {"kind": "agent", "id": str(ava.id), "role": "contact"},
                {"kind": "agent", "id": str(bram.id), "role": "contact"},
            ],
        },
    )
    assert refused == {"error": "A department has one point of contact"}

    asked = await _set_department_crew(
        ctx,
        {
            "department_id": str(support.id),
            "crew": [
                {"kind": "agent", "id": str(bram.id), "role": "contact", "focus": "Refunds"},
                {"kind": "agent", "id": str(ava.id), "role": "member"},
            ],
        },
    )
    assert asked["status"] == "pending_review"
    await session_override.commit()
    roles = await teams_svc.crew_entries(session_override, support)
    assert next(e for e in roles if e["id"] == str(ava.id))["role"] == "contact"

    change_id = UUID(asked["change_id"])
    await accept_platform_change(session_override, tenant.id, change_id, owner.id)
    await session_override.commit()
    after = {e["id"]: e["role"] for e in await teams_svc.crew_entries(session_override, support)}
    assert after[str(bram.id)] == "contact" and after[str(ava.id)] == "member"
    assert str(owner.id) not in after
    audit = (
        await session_override.execute(select(AuditEvent).where(AuditEvent.action == "department:crew"))
    ).scalars().all()
    assert audit and audit[-1].agent_id == ava.id

    change = await session_override.get(PlatformChange, change_id)
    await rollback_platform_change(session_override, tenant.id, change.id, owner.id)
    await session_override.commit()
    restored = {e["id"]: e["role"] for e in await teams_svc.crew_entries(session_override, support)}
    assert restored[str(ava.id)] == "contact" and restored[str(owner.id)] == "accountable"


async def test_point_of_contact_sees_its_crew_and_how_to_delegate(client, session_override):
    _tenant, _owner, _support, ava, bram, paused = await _setup(session_override)
    text = await aware_context(session_override, ava)
    assert "## Your crew" in text
    assert f"@[Bram](agent:{bram.id}): Refunds" in text
    assert "(accountable)" in text
    assert "Pim" not in text
    assert "## Your crew" not in await aware_context(session_override, bram)
