"""Work lands on a node: its point of contact, else its people, else one level up."""

from httpx import AsyncClient
from org_tree import build_org, conversation
from sqlalchemy import select

from app.models.auth import User
from app.models.channel import ChannelAccount
from app.models.signal import Signal
from app.models.team import Department
from app.services import teams as teams_svc
from app.services.channel_access import agent_can_handle
from app.services.org_routing import route_to_node
from app.services.routing import resolve_inbound_agent_for_signal
from scripts.seed import TEST_EMAIL


async def test_deep_contact_picks_up(client: AsyncClient, session_override):
    org = await build_org(session_override)
    route = await route_to_node(session_override, org.tenant_id, org.billing)
    assert route.agent is not None and route.agent.id == org.bill.id
    assert not route.walked_up


async def test_people_pick_up_before_walking_up(client: AsyncClient, session_override):
    org = await build_org(session_override)
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user_id = user.id
    empty = Department(tenant_id=org.tenant_id, name="Content", kind="custom", parent_id=org.support.id)
    session_override.add(empty)
    await session_override.flush()
    route = await route_to_node(session_override, org.tenant_id, empty)
    assert route.agent is not None and route.agent.id == org.sam.id and route.walked_up

    await teams_svc.set_department_crew(session_override, empty, [{"kind": "user", "id": str(user_id), "role": "member"}])
    await session_override.commit()
    route = await route_to_node(session_override, org.tenant_id, empty)
    assert route.agent is None and route.people == [user_id]


async def test_inbound_lands_on_the_channel_home_or_the_organization(client: AsyncClient, session_override):
    org = await build_org(session_override)
    account = ChannelAccount(
        tenant_id=org.tenant_id, channel="email", provider="mock", address="books@example.com",
        routing_department_id=org.accounting.id,
    )
    session_override.add(account)
    await session_override.flush()
    signal = Signal(
        tenant_id=org.tenant_id, channel="email", source="mock", subject="Invoice", channel_account_id=account.id
    )
    session_override.add(signal)
    await session_override.commit()
    agent = await resolve_inbound_agent_for_signal(session_override, signal)
    assert agent is not None and agent.id == org.boekito.id

    account.routing_department_id = None
    await session_override.commit()
    agent = await resolve_inbound_agent_for_signal(session_override, signal)
    from app.services.lead_agent import get_lead_agent

    lead = await get_lead_agent(session_override, org.tenant_id)
    assert agent is not None and lead is not None and agent.id == lead.id


async def test_responsible_crew_may_reply_without_channel_access(client: AsyncClient, session_override):
    org = await build_org(session_override)
    account = ChannelAccount(
        tenant_id=org.tenant_id, channel="email", provider="mock", address="closed@example.com",
        settings_json='{"access":[{"kind":"team","id":"people","level":"handle"}]}',
    )
    session_override.add(account)
    await session_override.flush()
    signal = await conversation(session_override, org, org.support)
    assert not await agent_can_handle(session_override, account, org.kim.id)
    assert await agent_can_handle(session_override, account, org.kim.id, signal=signal)
    assert not await agent_can_handle(session_override, account, org.boekito.id, signal=signal)
