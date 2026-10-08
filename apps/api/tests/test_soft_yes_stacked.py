"""Soft Yes must not LLM-wake while other proposals are still open."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.services.signal_threads import resolve_message_decision
from app.tools.builtin import _propose_action
from app.tools.registry import ToolContext


async def _login(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.mark.asyncio
async def test_soft_yes_confirms_when_other_cards_open(client: AsyncClient, session_override):
    await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User).limit(1))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))
    ).scalars().first()
    assert agent is not None
    signal = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        source="chat",
        subject=f"soft-stack-{uuid4().hex[:6]}",
        agent_id=agent.id,
    )
    session_override.add(signal)
    await session_override.flush()
    ctx = ToolContext(
        session=session_override,
        tenant_id=tenant.id,
        user_id=user.id,
        agent=agent,
        signal_id=signal.id,
    )
    soft = await _propose_action(
        ctx,
        {
            "question": "Wil je koffie?",
            "options": [
                {"id": "yes", "label": "Ja graag"},
                {"id": "reject", "label": "Nee dank", "action_type": "reject"},
            ],
        },
    )
    other = await _propose_action(
        ctx,
        {
            "question": "Welke tags?",
            "selection": "multiple",
            "options": [
                {"id": "a", "label": "#a"},
                {"id": "reject", "label": "Geen", "action_type": "reject"},
            ],
        },
    )
    await session_override.commit()
    soft_id = soft["decision_request_id"]
    soft_msg = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.decision_id == __import__("uuid").UUID(soft_id))
        )
    ).scalar_one()

    result = await resolve_message_decision(
        session_override,
        tenant.id,
        user.id,
        signal.id,
        soft_msg.id,
        action="approve",
        option_id="yes",
    )
    assert result["ok"] is True

    bodies = [
        (m.body_text or "")
        for m in (
            await session_override.execute(
                select(SignalMessage).where(
                    SignalMessage.signal_id == signal.id,
                    SignalMessage.role == "assistant",
                )
            )
        ).scalars().all()
    ]
    # Short confirm, not a long LLM follow-up that stacks new asks.
    assert any(
        b.strip() in ("Oké.", "Gedaan.", "Gedaan: Ja graag.") or b.startswith("Gedaan:")
        for b in bodies
    ), bodies
    other_row = await session_override.get(DecisionRequest, __import__("uuid").UUID(other["decision_request_id"]))
    assert other_row is not None
    assert other_row.status == "awaiting_human"
