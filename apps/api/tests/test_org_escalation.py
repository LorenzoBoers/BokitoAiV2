"""A decision on a node goes to its accountable person, else up the tree to the owner."""

from httpx import AsyncClient
from org_tree import build_org
from sqlalchemy import select

from app.models.auth import Membership, User
from app.models.notification import DecisionRequest
from app.services import teams as teams_svc
from app.services.addressee import resolve_addressee
from app.services.department_escalation import accountable_up
from scripts.seed import TEST_EMAIL


async def test_accountable_up_walks_to_the_owner(client: AsyncClient, session_override):
    org = await build_org(session_override)
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user_id = user.id
    membership = (
        await session_override.execute(select(Membership).where(Membership.user_id == user_id))
    ).scalar_one()
    membership.role = "owner"
    await session_override.commit()

    person, node = await accountable_up(session_override, org.billing)
    assert person == user_id and node is not None and node.id == org.root.id

    await teams_svc.set_department_crew(
        session_override,
        org.support,
        [
            {"kind": "agent", "id": str(org.sam.id), "role": "contact"},
            {"kind": "user", "id": str(user_id), "role": "accountable"},
        ],
    )
    await session_override.commit()
    person, node = await accountable_up(session_override, org.billing)
    assert person == user_id and node.id == org.support.id


async def test_decision_keeps_its_department_and_names_the_route(client: AsyncClient, session_override):
    org = await build_org(session_override)
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user_id = user.id
    await teams_svc.set_department_crew(
        session_override,
        org.support,
        [
            {"kind": "agent", "id": str(org.sam.id), "role": "contact"},
            {"kind": "user", "id": str(user_id), "role": "accountable"},
        ],
    )
    await session_override.commit()

    addressee = await resolve_addressee(
        session_override, org.tenant_id, to={"kind": "department", "id": str(org.billing.id)}
    )
    assert addressee.kind == "user" and addressee.user_id == user_id and addressee.via == "Billing"
    decision = DecisionRequest(tenant_id=org.tenant_id, title="Refund 40 euro?")
    addressee.apply(decision)
    assert decision.addressee_user_id == user_id
    assert decision.addressee_department_id == org.billing.id
