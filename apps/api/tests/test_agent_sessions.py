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
