"""Holder rule: only the holder, an agent it asked, or a take-over acts on a conversation."""

from httpx import AsyncClient
from org_tree import build_org, conversation
from sqlalchemy import select

from app.models.agent_turn import AgentAsk
from app.models.signal import SignalEvent
from app.services.work_holder import may_act, take_over
from app.tools.executor import execute_tool


async def test_holder_acts_others_are_refused_with_the_route(client: AsyncClient, session_override):
    org = await build_org(session_override)
    signal = await conversation(session_override, org, org.support, holder=org.sam)

    assert (await may_act(session_override, signal, org.sam))[0] is True
    allowed, refusal = await may_act(session_override, signal, org.kim)
    assert allowed is False
    assert "Support" in refusal and "Sam" in refusal and "ask_agent" in refusal
    assert (await may_act(session_override, signal, org.kim, operator_asked=True))[0] is True


async def test_department_contact_holds_when_no_agent_is_pinned(client: AsyncClient, session_override):
    org = await build_org(session_override)
    signal = await conversation(session_override, org, org.support)
    assert (await may_act(session_override, signal, org.sam))[0] is True
    assert (await may_act(session_override, signal, org.boekito))[0] is False


async def test_an_agent_the_holder_asked_may_act(client: AsyncClient, session_override):
    org = await build_org(session_override)
    signal = await conversation(session_override, org, org.support, holder=org.sam)
    session_override.add(
        AgentAsk(tenant_id=org.tenant_id, signal_id=signal.id, from_agent_id=org.sam.id, to_agent_id=org.kim.id)
    )
    await session_override.commit()
    assert (await may_act(session_override, signal, org.kim))[0] is True


async def test_take_over_only_from_the_branch_or_above(client: AsyncClient, session_override):
    org = await build_org(session_override)
    signal = await conversation(session_override, org, org.billing, holder=org.bill)

    refused = await take_over(session_override, signal, org.boekito)
    assert refused["ok"] is False

    taken = await take_over(session_override, signal, org.sam)
    await session_override.commit()
    assert taken["ok"] is True and taken["from_department"] == "Billing"
    assert signal.assignee_kind == "agent" and signal.assignee_id == org.sam.id
    assert (await may_act(session_override, signal, org.sam))[0] is True
    assert (await may_act(session_override, signal, org.bill))[0] is False
    events = (
        await session_override.execute(select(SignalEvent).where(SignalEvent.signal_id == signal.id))
    ).scalars().all()
    assert any(e.event_type == "taken_over" for e in events)

    assert (await take_over(session_override, signal, org.lead))["ok"] is True


async def test_executor_refuses_a_mutating_tool_only_while_org_rules_are_on(client: AsyncClient, session_override):
    from app.services.org_rules import set_org_rules

    org = await build_org(session_override)
    signal = await conversation(session_override, org, org.support, holder=org.sam)
    result = await execute_tool(
        session_override, org.tenant_id, None, "close_thread", {"signal_id": str(signal.id)},
        signal_id=signal.id, agent=org.kim,
    )
    assert result.get("reason") == "not_holder"

    note = await execute_tool(
        session_override, org.tenant_id, None, "post_internal_note", {"body_text": "Context for Sam"},
        signal_id=signal.id, agent=org.kim,
    )
    assert note.get("reason") != "not_holder"

    await set_org_rules(session_override, org.tenant_id, "off")
    await session_override.commit()
    result = await execute_tool(
        session_override, org.tenant_id, None, "close_thread", {"signal_id": str(signal.id)},
        signal_id=signal.id, agent=org.kim,
    )
    assert result.get("reason") != "not_holder"
