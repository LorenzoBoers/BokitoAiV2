"""Platform check-in: seed, toggle, and shared operations thread."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import Signal
from app.models.trigger import Trigger
from app.services.platform_watch import (
    OPERATIONS_SETTINGS_KEY,
    PLATFORM_CHECKIN_NAME,
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
    assert settings.get(OPERATIONS_SETTINGS_KEY)

    trigger = (
        await session_override.execute(
            select(Trigger).where(Trigger.tenant_id == tenant.id, Trigger.kind == "heartbeat")
        )
    ).scalar_one()
    assert trigger.enabled is True
    assert trigger.name == PLATFORM_CHECKIN_NAME
    assert trigger.interval_minutes == 60

    ops = await session_override.get(Signal, trigger.signal_id)
    assert ops is not None
    assert ops.subject == PLATFORM_CHECKIN_NAME
    assert str(ops.id) == settings[OPERATIONS_SETTINGS_KEY]


@pytest.mark.asyncio
async def test_ensure_does_not_enable_existing_heartbeat(
    client: AsyncClient, session_override: AsyncSession
):
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
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
    assert row.name == PLATFORM_CHECKIN_NAME
    assert row.signal_id is not None


@pytest.mark.asyncio
async def test_set_platform_watch_toggles(client: AsyncClient, session_override: AsyncSession):
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()
    off = await set_platform_watch(session_override, tenant.id, False)
    assert off["enabled"] is False
    on = await set_platform_watch(session_override, tenant.id, True)
    assert on["enabled"] is True
    assert on["operations_signal_id"]
    status = await watch_status(session_override, tenant.id)
    assert status["enabled"] is True
    assert status["name"] == PLATFORM_CHECKIN_NAME


@pytest.mark.asyncio
async def test_heartbeat_findings_reuse_operations_thread(
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

    threads = (
        await session_override.execute(
            select(Signal).where(
                Signal.tenant_id == tenant.id, Signal.subject == PLATFORM_CHECKIN_NAME
            )
        )
    ).scalars().all()
    assert len(threads) == 1
    assert str(threads[0].id) == first["operations_signal_id"]


def test_platform_watch_tools_registered():
    get_spec = get_tool_spec("get_platform_watch")
    set_spec = get_tool_spec("set_platform_watch")
    assert get_spec is not None
    assert set_spec is not None
    assert get_spec.gated is False
    assert set_spec.gated is False
    assert set_spec.mutating is True
