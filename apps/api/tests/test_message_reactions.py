"""Stacked message reactions (LinkedIn-style) and learning bridge."""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.message_reaction import MessageReaction
from app.models.signal import Signal, SignalMessage
from app.tools.builtin import _react_to_message
from app.tools.registry import ToolContext


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _seed_thread_with_message(client: AsyncClient, headers: dict[str, str]) -> tuple[str, str]:
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "mock",
            "subject": "Reaction test",
            "body_text": "Original question",
            "contact_email": "react@test.com",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]
    thread = await client.get(f"/api/signals/{signal_id}", headers=headers)
    assert thread.status_code == 200
    message_id = thread.json()["messages"][0]["id"]
    return signal_id, message_id


@pytest.mark.asyncio
async def test_reaction_put_toggle_and_thread_exposure(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    signal_id, message_id = await _seed_thread_with_message(client, headers)

    up = await client.put(
        f"/api/messages/{message_id}/reactions",
        headers=headers,
        json={"kind": "up"},
    )
    assert up.status_code == 200
    body = up.json()
    assert body["mine"] == "up"
    assert any(k["kind"] == "up" and k["count"] >= 1 for k in body["kinds"])

    # Same kind again clears (LinkedIn toggle).
    cleared = await client.put(
        f"/api/messages/{message_id}/reactions",
        headers=headers,
        json={"kind": "up"},
    )
    assert cleared.status_code == 200
    assert cleared.json()["mine"] is None
    assert cleared.json()["kinds"] == []

    hundred = await client.put(
        f"/api/messages/{message_id}/reactions",
        headers=headers,
        json={"kind": "hundred"},
    )
    assert hundred.status_code == 200
    assert hundred.json()["mine"] == "hundred"

    thread = await client.get(f"/api/signals/{signal_id}", headers=headers)
    message = next(m for m in thread.json()["messages"] if m["id"] == message_id)
    assert message["reactions"]["mine"] == "hundred"
    assert message["my_feedback"] == {"score": 5, "sentiment": "up"}


@pytest.mark.asyncio
async def test_reaction_delete_and_validation(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    _signal_id, message_id = await _seed_thread_with_message(client, headers)

    await client.put(
        f"/api/messages/{message_id}/reactions",
        headers=headers,
        json={"kind": "thinking"},
    )
    deleted = await client.delete(
        f"/api/messages/{message_id}/reactions", headers=headers
    )
    assert deleted.status_code == 200
    assert deleted.json()["mine"] is None

    bad = await client.put(
        f"/api/messages/{message_id}/reactions",
        headers=headers,
        json={"kind": "sparkles"},
    )
    assert bad.status_code == 400

    agent_only = await client.put(
        f"/api/messages/{message_id}/reactions",
        headers=headers,
        json={"kind": "investigating"},
    )
    assert agent_only.status_code == 403


@pytest.mark.asyncio
async def test_legacy_feedback_maps_to_reactions(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    signal_id, message_id = await _seed_thread_with_message(client, headers)

    up = await client.post(
        f"/api/messages/{message_id}/feedback", headers=headers, json={"sentiment": "up"}
    )
    assert up.status_code == 200
    assert up.json()["score"] == 5
    assert up.json()["reactions"]["mine"] == "up"

    thread = await client.get(f"/api/signals/{signal_id}", headers=headers)
    message = next(m for m in thread.json()["messages"] if m["id"] == message_id)
    assert message["reactions"]["mine"] == "up"
    assert message["my_feedback"] == {"score": 5, "sentiment": "up"}


@pytest.mark.asyncio
async def test_react_tool_resolves_latest_when_id_is_not_a_message(session_override: AsyncSession):
    tenant = Tenant(slug=f"react-{uuid4().hex[:8]}", name="React")
    session_override.add(tenant)
    await session_override.commit()
    agent = Agent(tenant_id=tenant.id, name="Assistant", kind="personal")
    signal = Signal(
        tenant_id=tenant.id, channel="assistant", source="chat", subject="Thumbs", status="open"
    )
    session_override.add_all([agent, signal])
    await session_override.commit()
    older = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="user_message",
        direction="inbound",
        role="user",
        body_text="earlier",
    )
    latest = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="user_message",
        direction="inbound",
        role="user",
        body_text="Kan je mijn bericht een thumbs up geven",
    )
    session_override.add_all([older, latest])
    await session_override.commit()

    ctx = ToolContext(
        session=session_override,
        tenant_id=tenant.id,
        user_id=None,
        agent=agent,
        signal_id=signal.id,
    )
    invented = await _react_to_message(
        ctx, {"message_id": "u34_1792089045", "kind": "up", "signal_id": "u34_1792089045"}
    )
    assert invented["ok"] is True
    assert invented["message_id"] == str(latest.id)
    assert invented["resolved"] == "latest_user_message"

    # Same kind again toggles off; conversation id must not 404 the turn.
    cleared = await _react_to_message(ctx, {"message_id": str(signal.id), "kind": "up"})
    assert cleared["ok"] is True
    assert cleared["message_id"] == str(latest.id)
    assert cleared["reactions"]["mine"] is None

    targeted = await _react_to_message(ctx, {"message_id": str(older.id), "kind": "up"})
    assert targeted["ok"] is True
    assert targeted["message_id"] == str(older.id)
    assert "resolved" not in targeted

    rows = (
        await session_override.execute(
            select(MessageReaction).where(MessageReaction.message_id == older.id)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].kind == "up"
