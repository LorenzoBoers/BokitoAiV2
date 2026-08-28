"""Inline agent sessions: start, chat, checkout, and timeline exposure."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal, SignalEvent, SignalMessage
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


@pytest.mark.asyncio
async def test_session_lifecycle(client: AsyncClient, session_override: AsyncSession):
    headers = await _login(client)
    thread = await _customer_thread(session_override)

    # Start: creates an assistant conversation bound to the thread.
    r = await client.post(f"/api/signals/{thread.id}/sessions", headers=headers, json={})
    assert r.status_code == 200, r.text
    started = r.json()
    assert started["state"] == "active"
    assert started["thread_id"] == str(thread.id)
    assert started["agent_name"]
    session_id = started["id"]

    # Starting again reuses the caller's active session (idempotent).
    r2 = await client.post(f"/api/signals/{thread.id}/sessions", headers=headers, json={})
    assert r2.status_code == 200
    assert r2.json()["id"] == session_id

    # The session conversation accepts chat turns (mock LLM in tests).
    r = await client.post(
        f"/api/chat/conversations/{session_id}/messages",
        headers=headers,
        json={"content": "Wat weet je over deze klant?"},
    )
    assert r.status_code == 200, r.text

    # Thread detail exposes the active session + started event.
    detail = (await client.get(f"/api/signals/{thread.id}", headers=headers)).json()
    assert len(detail["sessions"]) == 1
    assert detail["sessions"][0]["state"] == "active"
    assert any(e["event_type"] == "agent_session_started" for e in detail["events"])

    # Checkout: session closes with an outcome.
    r = await client.post(
        f"/api/signals/{thread.id}/sessions/{session_id}/close", headers=headers
    )
    assert r.status_code == 200, r.text
    closed = r.json()
    assert closed["state"] == "closed"
    assert closed["message_count"] >= 2  # user turn + agent reply
    assert closed["closed_at"]

    detail = (await client.get(f"/api/signals/{thread.id}", headers=headers)).json()
    assert detail["sessions"][0]["state"] == "closed"
    assert any(e["event_type"] == "agent_session_closed" for e in detail["events"])

    # Closing twice stays idempotent.
    r = await client.post(
        f"/api/signals/{thread.id}/sessions/{session_id}/close", headers=headers
    )
    assert r.status_code == 200
    events = (
        await session_override.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == thread.id,
                SignalEvent.event_type == "agent_session_closed",
            )
        )
    ).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_session_outcome_extracts_actions(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)

    r = await client.post(f"/api/signals/{thread.id}/sessions", headers=headers, json={})
    session_id = r.json()["id"]

    from uuid import UUID

    conversation = (
        await session_override.execute(select(Signal).where(Signal.id == UUID(session_id)))
    ).scalar_one()
    # Simulate an agent message whose trace contains a consequential MCP call
    # and a read-only research call.
    session_override.add(
        SignalMessage(
            signal_id=conversation.id,
            tenant_id=conversation.tenant_id,
            kind="agent_message",
            direction="internal",
            role="assistant",
            body_text="Ik heb de openstaande facturen opgezocht en een taak aangemaakt.",
            metadata_json=json.dumps(
                {
                    "steps": [
                        {"step_type": "tool_call", "name": "search_index", "payload": {}},
                        {
                            "step_type": "tool_call",
                            "name": "call_mcp_tool",
                            "payload": {"input": {"tool": "list_invoices"}},
                        },
                    ]
                }
            ),
        )
    )
    await session_override.commit()

    r = await client.post(
        f"/api/signals/{thread.id}/sessions/{session_id}/close", headers=headers
    )
    closed = r.json()
    assert closed["summary"].startswith("Ik heb de openstaande facturen")
    tools = [a["tool"] for a in closed["actions"]]
    assert "call_mcp_tool" in tools
    assert "search_index" not in tools  # read-only research is not an action
    assert closed["actions"][0]["detail"] == "list_invoices"


@pytest.mark.asyncio
async def test_agent_candidates_rank_channel_agent_first(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)

    r = await client.get(f"/api/signals/{thread.id}/agent-candidates", headers=headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items, "at least the channel agent and the personal assistant"
    assert items[0]["reason"] == "channel"
    assert items[-1]["reason"] == "personal"
    assert len({row["id"] for row in items}) == len(items)  # no duplicates

    # An explicit candidate becomes the session agent.
    picked = items[0]
    r = await client.post(
        f"/api/signals/{thread.id}/sessions", headers=headers, json={"agent_id": picked["id"]}
    )
    assert r.status_code == 200, r.text
    assert r.json()["agent_id"] == picked["id"]


@pytest.mark.asyncio
async def test_cancel_before_first_turn_leaves_no_trace(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)

    session_id = (
        await client.post(f"/api/signals/{thread.id}/sessions", headers=headers, json={})
    ).json()["id"]

    detail = (await client.get(f"/api/signals/{thread.id}", headers=headers)).json()
    assert detail["sessions"][0]["message_count"] == 0

    r = await client.delete(
        f"/api/signals/{thread.id}/sessions/{session_id}", headers=headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["discarded"] is True

    detail = (await client.get(f"/api/signals/{thread.id}", headers=headers)).json()
    assert detail["sessions"] == []
    assert not any(e["event_type"] == "agent_session_started" for e in detail["events"])


@pytest.mark.asyncio
async def test_cancel_after_first_turn_checks_out_instead(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)

    session_id = (
        await client.post(f"/api/signals/{thread.id}/sessions", headers=headers, json={})
    ).json()["id"]
    await client.post(
        f"/api/chat/conversations/{session_id}/messages",
        headers=headers,
        json={"content": "Wat is hier aan de hand?"},
    )

    detail = (await client.get(f"/api/signals/{thread.id}", headers=headers)).json()
    assert detail["sessions"][0]["message_count"] >= 1

    r = await client.delete(
        f"/api/signals/{thread.id}/sessions/{session_id}", headers=headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["discarded"] is False
    assert body["session"]["state"] == "closed"


@pytest.mark.asyncio
async def test_suggest_thread_reply_proposes_on_host_thread(
    client: AsyncClient, session_override: AsyncSession
):
    """A sparring agent proposes; the operator still approves."""
    await _login(client)
    thread = await _customer_thread(session_override)

    from app.models.agent import Agent
    from app.models.notification import DecisionRequest
    from app.tools import execute_tool

    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == thread.tenant_id, Agent.kind == "company")
        )
    ).scalars().first()

    result = await execute_tool(
        session_override,
        thread.tenant_id,
        None,
        "suggest_thread_reply",
        {"body_text": "De factuur is vorige week gecrediteerd."},
        signal_id=thread.id,
        agent=agent,
    )
    assert result.get("ok") is True
    assert result.get("awaiting_approval") is True

    decision = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == thread.id)
        )
    ).scalars().first()
    assert decision is not None
    assert decision.status == "awaiting_human"
    assert "gecrediteerd" in decision.summary


@pytest.mark.asyncio
async def test_take_over_conversation_pins_the_agent(
    client: AsyncClient, session_override: AsyncSession
):
    await _login(client)
    thread = await _customer_thread(session_override)
    thread.ai_paused = True
    await session_override.commit()

    from app.models.agent import Agent
    from app.services.routing import resolve_agent_for_signal
    from app.tools import execute_tool

    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == thread.tenant_id, Agent.kind == "company")
        )
    ).scalars().first()

    result = await execute_tool(
        session_override,
        thread.tenant_id,
        None,
        "take_over_conversation",
        {"reason": "Teammate asked me to continue"},
        signal_id=thread.id,
        agent=agent,
        approved=True,
    )
    assert result.get("ok") is True
    assert result.get("ai_paused") is False

    await session_override.refresh(thread)
    assert thread.ai_paused is False
    assert thread.agent_id == agent.id
    # Inbound routing now keeps the conversation with that agent.
    routed = await resolve_agent_for_signal(session_override, thread)
    assert routed is not None and routed.id == agent.id


@pytest.mark.asyncio
async def test_personal_assistant_cannot_take_over(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    thread = await _customer_thread(session_override)

    from app.models.agent import Agent
    from app.tools import execute_tool

    # Listing candidates provisions the caller's personal assistant.
    await client.get(f"/api/signals/{thread.id}/agent-candidates", headers=headers)
    personal = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == thread.tenant_id, Agent.kind == "personal")
        )
    ).scalars().first()
    assert personal is not None

    result = await execute_tool(
        session_override,
        thread.tenant_id,
        None,
        "take_over_conversation",
        {},
        signal_id=thread.id,
        agent=personal,
        approved=True,
    )
    assert "error" in result


@pytest.mark.asyncio
async def test_session_rejected_on_assistant_thread(
    client: AsyncClient, session_override: AsyncSession
):
    headers = await _login(client)
    r = await client.post(
        "/api/chat/conversations", headers=headers, json={"title": "Losse chat"}
    )
    conversation_id = r.json()["id"]
    r = await client.post(f"/api/signals/{conversation_id}/sessions", headers=headers, json={})
    assert r.status_code == 400
