"""Agents ask along the tree; off the tree they get the route, and ping-pong is refused."""

from httpx import AsyncClient
from org_tree import build_org, conversation

from app.models.agent_turn import AgentAsk
from app.services.agent_turns import create_ask, talk_line_refusal


async def test_own_crew_parent_and_child_contacts_are_reachable(client: AsyncClient, session_override):
    org = await build_org(session_override)
    signal = await conversation(session_override, org, org.support, holder=org.sam)
    assert await talk_line_refusal(session_override, signal, org.kim, org.sam) is None
    assert await talk_line_refusal(session_override, signal, org.sam, org.bill) is None
    assert await talk_line_refusal(session_override, signal, org.bill, org.sam) is None
    assert await talk_line_refusal(session_override, signal, org.sam, org.lead) is None


async def test_off_the_tree_names_the_point_of_contact_to_ask(client: AsyncClient, session_override):
    org = await build_org(session_override)
    signal = await conversation(session_override, org, org.billing, holder=org.bill)
    refusal = await talk_line_refusal(session_override, signal, org.bill, org.boekito)
    assert refusal is not None and "Boekito" in refusal
    assert str(org.lead.id) in refusal


async def test_organization_crew_asks_anyone(client: AsyncClient, session_override):
    org = await build_org(session_override)
    signal = await conversation(session_override, org, org.billing)
    assert await talk_line_refusal(session_override, signal, org.lead, org.bill) is None


async def test_ping_pong_and_off_tree_asks_are_refused(client: AsyncClient, session_override):
    org = await build_org(session_override)
    signal = await conversation(session_override, org, org.support, holder=org.sam)
    session_override.add(
        AgentAsk(tenant_id=org.tenant_id, signal_id=signal.id, from_agent_id=org.kim.id, to_agent_id=org.sam.id)
    )
    await session_override.commit()
    back = await create_ask(session_override, signal, from_agent=org.sam, peer=org.kim, question="Which invoice?")
    assert back["ok"] is False and "waiting for your answer" in back["error"]

    off = await create_ask(session_override, signal, from_agent=org.kim, peer=org.boekito, question="VAT?")
    assert off["ok"] is False and "outside your part" in off["error"]
