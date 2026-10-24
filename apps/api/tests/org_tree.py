"""A small organization for the org-rule tests.

Organization (crew: Lead)
  Support (contact: Sam, member: Kim)
    Billing (contact: Bill)
  Accounting (contact: Boekito), shielded on request
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import Signal
from app.models.team import Department
from app.services import teams as teams_svc
from app.services.org_rules import set_org_rules


@dataclass
class Org:
    tenant_id: UUID
    root: Department
    support: Department
    billing: Department
    accounting: Department
    lead: Agent
    sam: Agent
    kim: Agent
    bill: Agent
    boekito: Agent


async def _agent(session, tenant_id: UUID, name: str) -> Agent:
    agent = Agent(tenant_id=tenant_id, name=name, kind="company", is_active=True)
    session.add(agent)
    await session.flush()
    return agent


async def _department(session, tenant_id: UUID, name: str, parent: Department, **extra) -> Department:
    dept = Department(tenant_id=tenant_id, name=name, kind="custom", parent_id=parent.id, **extra)
    session.add(dept)
    await session.flush()
    return dept


async def build_org(session, *, rules: str = "on", shield_accounting: bool = False) -> Org:
    tenant_id = (await session.execute(select(Tenant.id))).scalar_one()
    root = await teams_svc.ensure_org_root(session, tenant_id)
    lead, sam, kim, bill, boekito = [
        await _agent(session, tenant_id, name) for name in ("Lead", "Sam", "Kim", "Bill", "Boekito")
    ]
    support = await _department(session, tenant_id, "Support", root)
    billing = await _department(session, tenant_id, "Billing", support)
    accounting = await _department(
        session, tenant_id, "Accounting", root, visibility="shielded" if shield_accounting else "open"
    )
    crews = {
        root.id: [{"kind": "agent", "id": str(lead.id), "role": "contact"}],
        support.id: [
            {"kind": "agent", "id": str(sam.id), "role": "contact"},
            {"kind": "agent", "id": str(kim.id), "role": "member"},
        ],
        billing.id: [{"kind": "agent", "id": str(bill.id), "role": "contact"}],
        accounting.id: [{"kind": "agent", "id": str(boekito.id), "role": "contact"}],
    }
    for dept in (root, support, billing, accounting):
        await teams_svc.set_department_crew(session, dept, crews[dept.id])
    await set_org_rules(session, tenant_id, rules)
    await session.commit()
    return Org(tenant_id, root, support, billing, accounting, lead, sam, kim, bill, boekito)


async def conversation(session, org: Org, department: Department, *, holder: Agent | None = None) -> Signal:
    signal = Signal(tenant_id=org.tenant_id, channel="email", source="email", subject=f"Work for {department.name}")
    signal.assignee_kind = "department"
    signal.assignee_id = department.id
    if holder is not None:
        signal.agent_id = holder.id
    session.add(signal)
    await session.commit()
    return signal
