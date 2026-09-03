"""Platform check-in: seed, toggle, and the assistant's own channel thread."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import Signal, SignalMessage
from app.models.trigger import Trigger
from app.services.platform_watch import (
    AGENT_CHANNEL_SOURCE,
    OPERATIONS_SETTINGS_KEY,
    checkin_trigger_name,
    ensure_agent_channel,
    ensure_platform_watch,
    set_platform_watch,
    watch_status,
)
from app.services.triggers import _surface_result
from app.tools.registry import get_tool_spec


@pytest.mark.asyncio
async def test_signup_enables_platform_watch(client: AsyncClient, session_override):
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": "watch@example.com",
            "password": "test-password",
            "tenant_slug": "watch-co",
            "tenant_name": "Watch Co",
        },
    )
    assert signup.status_code == 200
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "watch-co"))
    ).scalar_one()
    settings = json.loads(tenant.settings_json or "{}")
    # A fresh workspace never carries the pre-migration ops-thread key.
    assert OPERATIONS_SETTINGS_KEY not in settings

    assistant = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalar_one()
    trigger = (
        await session_override.execute(
            select(Trigger).where(Trigger.tenant_id == tenant.id, Trigger.kind == "heartbeat")
        )
    ).scalar_one()
    assert trigger.enabled is True
    assert trigger.name == checkin_trigger_name(assistant)
    assert trigger.interval_minutes == 60

    channel = await session_override.get(Signal, trigger.signal_id)
    assert channel is not None
    # The check-in posts into the assistant channel behind /communication/agent.
    assert channel.channel == "assistant"
    assert channel.source == AGENT_CHANNEL_SOURCE
    assert channel.agent_id == assistant.id
    # Tenant-wide: no owner, so every member reads the same history.
    assert channel.owner_user_id is None


@pytest.mark.asyncio
async def test_ensure_does_not_enable_existing_heartbeat(
    client: AsyncClient, session_override: AsyncSession
):
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    assistant = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalar_one()
    existing = Trigger(
        tenant_id=tenant.id,
        name="Heartbeat",
        kind="heartbeat",
        interval_minutes=30,
        agent_role="assistant",
        enabled=False,
    )
    session_override.add(existing)
    await session_override.commit()

    await ensure_platform_watch(session_override)
    row = (
        await session_override.execute(
            select(Trigger).where(Trigger.tenant_id == tenant.id, Trigger.kind == "heartbeat")
        )
    ).scalar_one()
    assert row.enabled is False
    assert row.name == checkin_trigger_name(assistant)
    assert row.signal_id is not None


@pytest.mark.asyncio
async def test_backfill_migrates_legacy_operations_thread(
    client: AsyncClient, session_override: AsyncSession
):
    """An existing Platform check-in thread becomes the assistant channel."""
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    assistant = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalar_one()
    legacy = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="workforce",
        subject="Platform check-in",
        contact_name="Assistant",
        status="open",
    )
    session_override.add(legacy)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=legacy.id,
            tenant_id=tenant.id,
            kind="message",
            direction="inbound",
            role="assistant",
            body_text="Inbox is backing up",
        )
    )
    settings = json.loads(tenant.settings_json or "{}")
    settings[OPERATIONS_SETTINGS_KEY] = str(legacy.id)
    tenant.settings_json = json.dumps(settings)
    session_override.add(tenant)
    await session_override.commit()

    await ensure_platform_watch(session_override)

    await session_override.refresh(legacy)
    await session_override.refresh(tenant)
    # Same row, new home: the history is kept, not copied.
    assert legacy.channel == "assistant"
    assert legacy.source == AGENT_CHANNEL_SOURCE
    assert legacy.agent_id == assistant.id
    assert legacy.owner_user_id is None
    messages = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.signal_id == legacy.id)
        )
    ).scalars().all()
    assert len(messages) == 1
    assert OPERATIONS_SETTINGS_KEY not in json.loads(tenant.settings_json or "{}")

    trigger = (
        await session_override.execute(
            select(Trigger).where(Trigger.tenant_id == tenant.id, Trigger.kind == "heartbeat")
        )
    ).scalar_one()
    assert trigger.signal_id == legacy.id

    # Running the backfill twice creates no second channel.
    await ensure_platform_watch(session_override)
    channels = (
        await session_override.execute(
            select(Signal).where(
                Signal.tenant_id == tenant.id, Signal.source == AGENT_CHANNEL_SOURCE
            )
        )
    ).scalars().all()
    assert [c.id for c in channels] == [legacy.id]


@pytest.mark.asyncio
async def test_set_platform_watch_toggles(client: AsyncClient, session_override: AsyncSession):
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    assistant = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalar_one()
    off = await set_platform_watch(session_override, tenant.id, False)
    assert off["enabled"] is False
    on = await set_platform_watch(session_override, tenant.id, True)
    assert on["enabled"] is True
    assert on["signal_id"]
    status = await watch_status(session_override, tenant.id)
    assert status["enabled"] is True
    assert status["name"] == checkin_trigger_name(assistant)


@pytest.mark.asyncio
async def test_heartbeat_findings_land_in_agent_channel(
    client: AsyncClient, session_override: AsyncSession
):
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalar_one()
    first = await set_platform_watch(session_override, tenant.id, True)
    from uuid import UUID

    trigger = await session_override.get(Trigger, UUID(first["trigger"]["id"]))
    assert trigger is not None

    await _surface_result(session_override, trigger, agent, "Inbox is backing up")
    await session_override.commit()
    await _surface_result(session_override, trigger, agent, "A decision is still waiting")
    await session_override.commit()

    channel = await ensure_agent_channel(session_override, tenant.id)
    assert str(channel.id) == first["signal_id"]
    # Both findings share the one channel thread.
    channels = (
        await session_override.execute(
            select(Signal).where(
                Signal.tenant_id == tenant.id, Signal.source == AGENT_CHANNEL_SOURCE
            )
        )
    ).scalars().all()
    assert len(channels) == 1
    messages = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.signal_id == channel.id)
        )
    ).scalars().all()
    bodies = [m.body_text for m in messages]
    assert "Inbox is backing up" in bodies
    assert "A decision is still waiting" in bodies


@pytest.mark.asyncio
async def test_agent_channel_visible_in_conversations(
    client: AsyncClient, session_override: AsyncSession
):
    """The shared channel has no owner, so it lists for every member."""
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    channel = await ensure_agent_channel(session_override, tenant.id)
    await session_override.commit()

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    listed = await client.get("/api/signals/conversations", headers=headers)
    assert listed.status_code == 200
    assert any(row["id"] == str(channel.id) for row in listed.json())


def test_platform_watch_tools_registered():
    get_spec = get_tool_spec("get_platform_watch")
    set_spec = get_tool_spec("set_platform_watch")
    assert get_spec is not None
    assert set_spec is not None
    assert get_spec.gated is False
    # Mutating tools must go through the policy engine (no governance bypass).
    assert set_spec.gated is True
    assert set_spec.mutating is True
