"""Chat proposal UX: unknown actions fail loudly; choice echo is stripped."""

from __future__ import annotations

import json
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage, SignalTag
from app.services.agent.turn_persist import strip_choice_echo
from app.services.assistant_threads import append_signal_chat_message, signal_chat_history
from app.services.notifications import DecisionActionError, resolve_decision
from app.tools.builtin import _propose_action
from app.tools.registry import ToolContext


def test_strip_choice_echo_removes_kies_hieronder():
    text = (
        "Wil je de tag #lol verwijderen?\n\n"
        "Kies hieronder:\n"
        "- **Ja, verwijder #lol**\n"
        "- **Nee, hou aan**"
    )
    assert strip_choice_echo(text) == "Wil je de tag #lol verwijderen?"
    assert strip_choice_echo("Kies hieronder:\n- Ja\n- Nee") == ""


async def _login(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.mark.asyncio
async def test_unknown_action_type_reopens_decision(client: AsyncClient, session_override):
    await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user_id = None
    signal = Signal(tenant_id=tenant.id, channel="assistant", source="chat", subject="UX")
    session_override.add(signal)
    await session_override.flush()
    decision = DecisionRequest(
        tenant_id=tenant.id,
        signal_id=signal.id,
        title="Delete?",
        summary="Delete?",
        status="awaiting_human",
        options_json=json.dumps(
            [
                {"id": "approve", "label": "Ja", "action_type": "remove_tag", "payload": {"name": "x"}},
                {"id": "reject", "label": "Nee", "action_type": "reject"},
            ]
        ),
    )
    session_override.add(decision)
    await session_override.flush()
    msg = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="decision_request",
        direction="inbound",
        role="assistant",
        body_text="Delete?",
        decision_id=decision.id,
    )
    session_override.add(msg)
    await session_override.commit()

    with pytest.raises(DecisionActionError):
        await resolve_decision(
            session_override,
            tenant.id,
            decision.id,
            "approve",
            "approved",
            user_id=user_id,
        )
    await session_override.refresh(decision)
    assert decision.status == "awaiting_human"


@pytest.mark.asyncio
async def test_approve_delete_defers_duplicate_ask(client: AsyncClient, session_override):
    await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))
    ).scalars().first()
    assert agent is not None
    tag = SignalTag(tenant_id=tenant.id, name=f"dup-{uuid4().hex[:5]}")
    signal = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        source="chat",
        subject="Tags",
        agent_id=agent.id,
    )
    session_override.add(tag)
    session_override.add(signal)
    await session_override.flush()
    ctx = ToolContext(
        session=session_override,
        tenant_id=tenant.id,
        user_id=None,
        agent=agent,
        signal_id=signal.id,
    )
    first = await _propose_action(
        ctx,
        {
            "question": f"Delete #{tag.name}?",
            "action": "delete_tag",
            "payload": {"name": tag.name},
        },
    )
    second = await _propose_action(
        ctx,
        {
            "question": f"Really delete #{tag.name}?",
            "action": "delete_tag",
            "payload": {"name": tag.name},
        },
    )
    d1 = await session_override.get(DecisionRequest, __import__("uuid").UUID(first["decision_request_id"]))
    d2 = await session_override.get(DecisionRequest, __import__("uuid").UUID(second["decision_request_id"]))
    assert d1 and d2
    await resolve_decision(session_override, tenant.id, d1.id, "approve", "approved")
    await session_override.refresh(d2)
    assert d2.status == "deferred"
    assert d2.chosen_option_id == "superseded"
    gone = await session_override.get(SignalTag, tag.id)
    assert gone is None


@pytest.mark.asyncio
async def test_every_tool_card_can_teach_always(client: AsyncClient, session_override):
    """Cards from any producer (here the label plan) offer "always" on the tool option."""
    from app.tools.builtin import _create_decision_request

    await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))
    ).scalars().first()
    signal = Signal(tenant_id=tenant.id, channel="assistant", source="chat", subject="Plan")
    session_override.add(signal)
    await session_override.flush()
    ctx = ToolContext(
        session=session_override, tenant_id=tenant.id, user_id=None, agent=agent, signal_id=signal.id
    )
    made = await _create_decision_request(
        ctx,
        {
            "title": "#test",
            "options": [
                {"id": "approve", "label": "Toepassen", "action_type": "apply_label_plan", "payload": {}},
                {"id": "reject", "label": "Nee", "action_type": "reject"},
            ],
        },
    )
    decision = await session_override.get(DecisionRequest, __import__("uuid").UUID(made["decision_request_id"]))
    options = json.loads(decision.options_json)
    assert options[0]["learn"]["tool"] == "apply_label_plan"
    assert options[0]["learn"]["agent_id"] == str(agent.id)
    assert "learn" not in options[1]


@pytest.mark.asyncio
async def test_resolved_card_tells_history_its_outcome(client: AsyncClient, session_override):
    """The card row is the log: a wake after approve sees the action already ran."""
    await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    signal = Signal(tenant_id=tenant.id, channel="assistant", source="chat", subject="Hist")
    session_override.add(signal)
    await session_override.flush()
    decision = DecisionRequest(
        tenant_id=tenant.id,
        signal_id=signal.id,
        title="Delete #demo",
        status="approved",
        options_json="[]",
    )
    session_override.add(decision)
    await session_override.flush()
    card = await append_signal_chat_message(
        session_override,
        signal,
        role="assistant",
        content="Delete #demo",
    )
    card.kind = "decision_request"
    card.decision_id = decision.id
    session_override.add(card)
    await session_override.commit()
    history = await signal_chat_history(session_override, signal.id)
    last = history[-1]["content"]
    assert last.startswith("Delete #demo")
    assert "approved by the operator" in last
    assert "already ran" in last
    rows = (
        await session_override.execute(select(SignalMessage).where(SignalMessage.signal_id == signal.id))
    ).scalars().all()
    assert [r.kind for r in rows] == ["decision_request"]
