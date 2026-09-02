"""Inline session checkout: the agent proposes, the operator ends or continues."""

import json
from datetime import datetime, timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict:
    r = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _customer_thread(session: AsyncSession) -> Signal:
    from app.models.auth import Tenant

    tenant = (await session.execute(select(Tenant))).scalars().first()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Invoice question",
        contact_email="klant@example.com",
        contact_name="Klant",
    )
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal


async def _started_session(
    client: AsyncClient, session: AsyncSession, headers: dict, thread: Signal
) -> tuple[Signal, Agent]:
    """Start a session on the thread and exchange one turn (mock LLM)."""
    r = await client.post(f"/api/signals/{thread.id}/sessions", headers=headers, json={})
    assert r.status_code == 200, r.text
    session_id = UUID(r.json()["id"])
    r = await client.post(
        f"/api/signals/conversations/{session_id}/messages",
        headers=headers,
        json={"content": "Kun je deze klant helpen?"},
    )
    assert r.status_code == 200, r.text
    conversation = (
        await session.execute(select(Signal).where(Signal.id == session_id))
    ).scalar_one()
    agent = (
        await session.execute(select(Agent).where(Agent.id == conversation.agent_id))
    ).scalar_one()
    return conversation, agent


async def _propose(session: AsyncSession, thread: Signal, agent: Agent, **kwargs) -> dict:
    from app.tools import execute_tool

    return await execute_tool(
        session,
        thread.tenant_id,
        None,
        "propose_session_checkout",
        {"summary": "Factuur gecrediteerd en klant geinformeerd.", **kwargs},
        signal_id=thread.id,
        agent=agent,
    )


@pytest.mark.asyncio
async def test_propose_checkout_creates_decision_on_host_thread(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)
    conversation, agent = await _started_session(client, session_override, headers, thread)

    result = await _propose(session_override, thread, agent)
    assert result.get("ok") is True, result
    assert result["session_id"] == str(conversation.id)
    assert result["thread_id"] == str(thread.id)

    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.id == UUID(result["decision_request_id"]))
        )
    ).scalar_one()
    # The card belongs to the customer thread, not the private session.
    assert decision.signal_id == thread.id
    assert decision.status == "awaiting_human"
    assert "gecrediteerd" in decision.summary

    options = json.loads(decision.options_json)
    kinds = [o["payload"]["kind"] for o in options]
    assert "end_only" in kinds and "continue" in kinds
    assert all(o["payload"]["session_checkout"] for o in options)
    assert all(o["payload"]["session_id"] == str(conversation.id) for o in options)

    # Proposing does not close: the operator still owns the decision.
    await session_override.refresh(conversation)
    assert conversation.session_state == "active"
    outcome = json.loads(conversation.session_outcome_json or "{}")
    assert outcome["checkout_decision_id"] == str(decision.id)
    assert outcome["checkout_summary"].startswith("Factuur")


@pytest.mark.asyncio
async def test_agent_options_keep_end_and_continue(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)
    _, agent = await _started_session(client, session_override, headers, thread)

    result = await _propose(
        session_override,
        thread,
        agent,
        options=[{"id": "apply", "label": "Verstuur en sluit af", "kind": "apply_actions"}],
    )
    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.id == UUID(result["decision_request_id"]))
        )
    ).scalar_one()
    options = json.loads(decision.options_json)
    assert [o["payload"]["kind"] for o in options] == ["apply_actions", "end_only", "continue"]
    assert options[0]["label"] == "Verstuur en sluit af"


@pytest.mark.asyncio
async def test_resolving_end_only_closes_the_session(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)
    conversation, agent = await _started_session(client, session_override, headers, thread)
    result = await _propose(session_override, thread, agent)

    r = await client.post(
        f"/api/notifications/decisions/{result['decision_request_id']}/approve",
        headers=headers,
        json={"option_id": "end_only"},
    )
    assert r.status_code == 200, r.text

    await session_override.refresh(conversation)
    assert conversation.session_state == "closed"
    assert conversation.session_closed_at is not None
    outcome = json.loads(conversation.session_outcome_json or "{}")
    # The agent's checkout wording becomes the session outcome on the thread.
    assert outcome["summary"].startswith("Factuur")

    detail = (await client.get(f"/api/signals/{thread.id}", headers=headers)).json()
    assert detail["sessions"][0]["state"] == "closed"
    assert any(e["event_type"] == "agent_session_closed" for e in detail["events"])


@pytest.mark.asyncio
async def test_resolving_continue_keeps_the_session_active(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)
    conversation, agent = await _started_session(client, session_override, headers, thread)
    result = await _propose(session_override, thread, agent)

    r = await client.post(
        f"/api/notifications/decisions/{result['decision_request_id']}/approve",
        headers=headers,
        json={"option_id": "continue"},
    )
    assert r.status_code == 200, r.text

    await session_override.refresh(conversation)
    assert conversation.session_state == "active"
    outcome = json.loads(conversation.session_outcome_json or "{}")
    assert "checkout_decision_id" not in outcome


@pytest.mark.asyncio
async def test_second_proposal_supersedes_the_pending_card(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)
    _, agent = await _started_session(client, session_override, headers, thread)

    first = await _propose(session_override, thread, agent)
    second = await _propose(session_override, thread, agent)
    assert first["decision_request_id"] != second["decision_request_id"]

    stale = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.id == UUID(first["decision_request_id"]))
        )
    ).scalar_one()
    assert stale.status == "deferred"


@pytest.mark.asyncio
async def test_starting_a_session_closes_another_operators_session(
    client: AsyncClient, session_override: AsyncSession
):
    """One meta per thread: a second operator inherits, never duplicates."""
    headers = await _login(client)
    thread = await _customer_thread(session_override)

    from app.models.auth import Membership, User
    from app.services.agent_sessions import start_session
    from app.services.auth import hash_password

    colleague = User(
        email="collega@test.local",
        password_hash=hash_password(TEST_PASSWORD),
        display_name="Collega",
        email_verified=True,
    )
    session_override.add(colleague)
    await session_override.commit()
    await session_override.refresh(colleague)
    session_override.add(
        Membership(tenant_id=thread.tenant_id, user_id=colleague.id, role="member")
    )
    await session_override.commit()

    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == thread.tenant_id, Agent.kind == "company")
        )
    ).scalars().first()
    theirs = await start_session(
        session_override, thread.tenant_id, colleague, thread.id, agent
    )

    mine = (
        await client.post(f"/api/signals/{thread.id}/sessions", headers=headers, json={})
    ).json()
    assert mine["id"] != theirs["id"]

    previous = (
        await session_override.execute(select(Signal).where(Signal.id == UUID(theirs["id"])))
    ).scalar_one()
    assert previous.session_state == "closed"

    detail = (await client.get(f"/api/signals/{thread.id}", headers=headers)).json()
    active = [s for s in detail["sessions"] if s["state"] == "active"]
    assert len(active) == 1 and active[0]["id"] == mine["id"]


@pytest.mark.asyncio
async def test_idle_session_gets_one_server_side_nudge(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)
    conversation, _ = await _started_session(client, session_override, headers, thread)

    from app.services.agent_sessions import nudge_idle_sessions

    stale = datetime.utcnow() - timedelta(minutes=30)
    for message in (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.signal_id == conversation.id)
        )
    ).scalars().all():
        message.created_at = stale
        session_override.add(message)
    conversation.updated_at = stale
    session_override.add(conversation)
    await session_override.commit()

    out = await nudge_idle_sessions(session_override, idle_seconds=300)
    assert out["nudged"] == 1

    decisions = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == thread.id)
        )
    ).scalars().all()
    assert len(decisions) == 1
    options = json.loads(decisions[0].options_json)
    assert {o["payload"]["kind"] for o in options} == {"end_only", "continue"}

    await session_override.refresh(conversation)
    outcome = json.loads(conversation.session_outcome_json or "{}")
    assert outcome["idle_nudge_at"]
    assert conversation.session_state == "active"

    # One nudge per session, even while the card stays unanswered.
    again = await nudge_idle_sessions(session_override, idle_seconds=300)
    assert again["nudged"] == 0
