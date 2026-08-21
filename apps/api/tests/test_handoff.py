"""Human handoff: external conversations can always escalate to the team."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.notification import Notification
from app.models.signal import Signal, SignalEvent
from app.services.agent.loop import AgentLoop
from app.services.agent.tools import execute_tool


async def _widget_signal(session, tenant_id) -> Signal:
    signal = Signal(
        tenant_id=tenant_id,
        channel="widget",
        source="widget",
        subject="Website chat",
        contact_name="Website visitor",
    )
    session.add(signal)
    await session.commit()
    return signal


@pytest.mark.asyncio
async def test_handoff_tool_pauses_thread_and_notifies(client: AsyncClient, session_override):
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))
    ).scalars().first()
    # Restrictive passport that omits the handoff tool: external trust must
    # still be allowed to escalate.
    agent.tools_json = json.dumps(["send_reply"])
    signal = await _widget_signal(session_override, tenant.id)

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "handoff_to_human",
        {"reason": "Visitor asked for an employee"},
        signal_id=signal.id,
        agent=agent,
        trust="external",
    )
    assert result.get("ok") is True, result
    assert result.get("ai_paused") is True

    await session_override.refresh(signal)
    assert signal.ai_paused is True
    assert signal.has_unread is True

    event = (
        await session_override.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == signal.id, SignalEvent.event_type == "ai_paused"
            )
        )
    ).scalars().first()
    assert event is not None
    payload = json.loads(event.payload_json)
    assert payload["via"] == "handoff_to_human"

    notification = (
        await session_override.execute(
            select(Notification).where(
                Notification.tenant_id == tenant.id, Notification.kind == "ops_alert"
            )
        )
    ).scalars().first()
    assert notification is not None
    assert "takeover" in notification.title.lower()


@pytest.mark.asyncio
async def test_handoff_denied_for_operator_sessions_outside_passport(
    client: AsyncClient, session_override
):
    """The passport exemption is scoped to external trust only."""
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))
    ).scalars().first()
    agent.tools_json = json.dumps(["send_reply"])
    signal = await _widget_signal(session_override, tenant.id)

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "handoff_to_human",
        {},
        signal_id=signal.id,
        agent=agent,
        trust="operator",
    )
    assert result.get("status") == "denied"


@pytest.mark.asyncio
async def test_external_loop_always_exposes_handoff_tool(client: AsyncClient, session_override):
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id))
    ).scalars().first()
    agent.tools_json = json.dumps(["send_reply"])

    external_loop = AgentLoop(session_override, tenant.id, None, agent=agent, trust="external")
    assert "handoff_to_human" in {t["name"] for t in external_loop.tools}

    operator_loop = AgentLoop(session_override, tenant.id, None, agent=agent, trust="operator")
    assert "handoff_to_human" not in {t["name"] for t in operator_loop.tools}
