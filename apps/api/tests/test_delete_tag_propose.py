"""delete_tag tool + propose_action learn wiring + continue after approve."""

from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage, SignalTag
from app.tools.registry import ToolContext, get_tool_spec


async def _login(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


def test_delete_tag_is_registered_gated():
    spec = get_tool_spec("delete_tag")
    assert spec is not None
    assert spec.gated is True
    assert spec.mutating is True
    assert spec.category == "messaging"


@pytest.mark.asyncio
async def test_propose_action_with_delete_tag_carries_learn(client: AsyncClient, session_override):
    await _login(client)
    tenant = await _tenant(session_override)
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))
    ).scalars().first()
    assert agent is not None
    signal = Signal(tenant_id=tenant.id, channel="assistant", source="test", subject="Tags")
    session_override.add(signal)
    await session_override.flush()

    from app.tools.builtin import _propose_action

    ctx = ToolContext(
        session=session_override,
        tenant_id=tenant.id,
        user_id=None,
        agent=agent,
        signal_id=signal.id,
    )
    result = await _propose_action(
        ctx,
        {
            "question": "Delete #lol?",
            "action": "delete_tag",
            "payload": {"name": "lol"},
            "approve_label": "Ja, verwijder #lol",
            "reject_label": "Nee, hou aan",
        },
    )
    assert result.get("ok") is not False
    decision_id = result.get("decision_request_id")
    assert decision_id
    decision = await session_override.get(DecisionRequest, UUID(str(decision_id)))
    assert decision is not None

    options = json.loads(decision.options_json or "[]")
    approve = next(o for o in options if o.get("id") == "approve")
    assert approve["action_type"] == "delete_tag"
    assert approve["payload"]["name"] == "lol"
    assert approve.get("learn", {}).get("tool") == "delete_tag"
    assert approve.get("learn", {}).get("agent_id") == str(agent.id)


@pytest.mark.asyncio
async def test_delete_tag_removes_row(client: AsyncClient, session_override):
    await _login(client)
    tenant = await _tenant(session_override)
    tag = SignalTag(tenant_id=tenant.id, name=f"tmp-{uuid4().hex[:6]}")
    session_override.add(tag)
    await session_override.flush()

    from app.tools.builtin import _delete_tag

    ctx = ToolContext(session=session_override, tenant_id=tenant.id, user_id=None)
    out = await _delete_tag(ctx, {"name": tag.name})
    assert out.get("ok") is True
    gone = await session_override.get(SignalTag, tag.id)
    assert gone is None


@pytest.mark.asyncio
async def test_approve_delete_tag_removes_and_wakes_agent(
    client: AsyncClient, session_override, monkeypatch
):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))
    ).scalars().first()
    assert agent is not None
    tag = SignalTag(tenant_id=tenant.id, name=f"lol-{uuid4().hex[:6]}")
    signal = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        source="agent_session",
        subject="Tags",
        agent_id=agent.id,
    )
    session_override.add(tag)
    session_override.add(signal)
    await session_override.flush()

    from app.tools.builtin import _propose_action

    ctx = ToolContext(
        session=session_override,
        tenant_id=tenant.id,
        user_id=None,
        agent=agent,
        signal_id=signal.id,
    )
    proposed = await _propose_action(
        ctx,
        {
            "question": f"Delete #{tag.name}?",
            "action": "delete_tag",
            "payload": {"name": tag.name},
            "approve_label": f"Ja, verwijder #{tag.name}",
        },
    )
    decision_id = UUID(str(proposed["decision_request_id"]))
    msg = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.decision_id == decision_id,
            )
        )
    ).scalar_one()

    wakes: list[UUID] = []

    def capture_schedule(tenant_id, user_id, signal_id, **_kwargs):
        wakes.append(signal_id)

    async def capture_generate(_session, tenant_id, user_id, sig, **_kwargs):
        wakes.append(sig.id)

    import app.services.signal_threads as threads_svc

    monkeypatch.setattr(threads_svc, "_schedule_agent_reply", capture_schedule)
    monkeypatch.setattr(threads_svc, "_generate_agent_reply", capture_generate)

    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{msg.id}/resolve",
        headers=headers,
        json={"action": "approved", "option_id": "approve"},
    )
    assert resolve.status_code == 200, resolve.text

    gone = await session_override.get(SignalTag, tag.id)
    assert gone is None

    decision = await session_override.get(DecisionRequest, decision_id)
    await session_override.refresh(decision)
    assert decision.status == "approved"
    # Tool already ran: short confirm bubble, no LLM wake (avoids re-propose storm).
    assert wakes == []
    confirm = (
        await session_override.execute(
            select(SignalMessage)
            .where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.role == "assistant",
                SignalMessage.kind != "decision_request",
            )
            .order_by(SignalMessage.created_at.desc())
        )
    ).scalars().first()
    assert confirm is not None
    assert tag.name in (confirm.body_text or "")
    assert "verwijderd" in (confirm.body_text or "").lower()


@pytest.mark.asyncio
async def test_soft_option_approve_still_wakes_agent(
    client: AsyncClient, session_override, monkeypatch
):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))
    ).scalars().first()
    assert agent is not None
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="chat",
        subject="Soft",
        agent_id=agent.id,
    )
    session_override.add(signal)
    await session_override.flush()

    from app.tools.builtin import _propose_action

    ctx = ToolContext(
        session=session_override,
        tenant_id=tenant.id,
        user_id=None,
        agent=agent,
        signal_id=signal.id,
    )
    proposed = await _propose_action(
        ctx,
        {
            "question": "Delete the tag?",
            "options": [
                {"id": "yes", "label": "Ja, verwijder"},
                {"id": "reject", "label": "Nee"},
            ],
        },
    )
    decision_id = UUID(str(proposed["decision_request_id"]))
    msg = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.decision_id == decision_id,
            )
        )
    ).scalar_one()

    wakes: list[UUID] = []

    def capture_schedule(_tenant_id, _user_id, signal_id, **_kwargs):
        wakes.append(signal_id)

    async def capture_generate(_session, _tenant_id, _user_id, sig, **_kwargs):
        wakes.append(sig.id)

    import app.services.signal_threads as threads_svc

    monkeypatch.setattr(threads_svc, "_schedule_agent_reply", capture_schedule)
    monkeypatch.setattr(threads_svc, "_generate_agent_reply", capture_generate)

    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{msg.id}/resolve",
        headers=headers,
        json={"action": "approved", "option_id": "yes"},
    )
    assert resolve.status_code == 200, resolve.text
    assert wakes == [signal.id]
