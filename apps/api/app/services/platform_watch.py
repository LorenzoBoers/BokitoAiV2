"""Platform check-in: one heartbeat trigger + one Messages operations thread.

The assistant can turn watching on or off. Findings from the check-in land
in a single internal conversation so operators see them next to everything
else. Existing disabled heartbeats are never flipped on automatically.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import tenant_settings
from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import Signal
from app.models.trigger import Trigger
from app.services.tenant_bootstrap import serialize_settings
from app.services.triggers import compute_next_run, serialize_trigger

OPERATIONS_SETTINGS_KEY = "operations_signal_id"
PLATFORM_CHECKIN_NAME = "Platform check-in"
PLATFORM_CHECKIN_INTERVAL_MINUTES = 60
_LEGACY_HEARTBEAT_NAME = "Heartbeat"


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


async def ensure_operations_thread(session: AsyncSession, tenant_id: UUID) -> Signal:
    """Create or reuse the tenant-wide Platform check-in conversation."""
    from app.services.signal_decisions import get_or_create_internal_thread

    tenant = await session.get(Tenant, tenant_id)
    if not tenant:
        raise ValueError(f"tenant {tenant_id} not found")

    settings = tenant_settings(tenant)
    raw_id = settings.get(OPERATIONS_SETTINGS_KEY)
    existing_id: UUID | None = None
    if raw_id:
        try:
            existing_id = UUID(str(raw_id))
        except ValueError:
            existing_id = None

    assistant = (
        await session.execute(
            select(Agent)
            .where(Agent.tenant_id == tenant_id, Agent.role == "assistant")
            .limit(1)
        )
    ).scalars().first()

    signal = await get_or_create_internal_thread(
        session,
        tenant_id,
        subject=PLATFORM_CHECKIN_NAME,
        contact_name=assistant.name if assistant else "Assistant",
        agent_id=assistant.id if assistant else None,
        existing_signal_id=existing_id,
    )
    if str(settings.get(OPERATIONS_SETTINGS_KEY) or "") != str(signal.id):
        settings[OPERATIONS_SETTINGS_KEY] = str(signal.id)
        tenant.settings_json = serialize_settings(settings)
        session.add(tenant)
    return signal


async def get_heartbeat_trigger(session: AsyncSession, tenant_id: UUID) -> Trigger | None:
    return (
        await session.execute(
            select(Trigger).where(Trigger.tenant_id == tenant_id, Trigger.kind == "heartbeat")
        )
    ).scalars().first()


async def ensure_heartbeat_trigger(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    enable_if_created: bool,
) -> Trigger:
    """Return the seeded check-in trigger, creating it when missing.

    Never changes `enabled` on an existing row. New rows follow
    `enable_if_created` (True for brand-new tenants, False for backfill).
    """
    existing = await get_heartbeat_trigger(session, tenant_id)
    if existing:
        if existing.name.strip() == _LEGACY_HEARTBEAT_NAME:
            existing.name = PLATFORM_CHECKIN_NAME
            session.add(existing)
        ops = await ensure_operations_thread(session, tenant_id)
        if existing.signal_id != ops.id:
            existing.signal_id = ops.id
            session.add(existing)
        return existing

    ops = await ensure_operations_thread(session, tenant_id)
    trigger = Trigger(
        tenant_id=tenant_id,
        name=PLATFORM_CHECKIN_NAME,
        kind="heartbeat",
        interval_minutes=PLATFORM_CHECKIN_INTERVAL_MINUTES,
        agent_role="assistant",
        enabled=enable_if_created,
        signal_id=ops.id,
    )
    trigger.next_run_at = compute_next_run(trigger) if enable_if_created else None
    session.add(trigger)
    await session.flush()
    return trigger


def serialize_watch_status(trigger: Trigger, operations_signal_id: UUID) -> dict[str, Any]:
    return {
        "enabled": bool(trigger.enabled),
        "trigger_id": str(trigger.id),
        "name": trigger.name,
        "interval_minutes": trigger.interval_minutes,
        "next_run_at": _iso(trigger.next_run_at),
        "last_status": trigger.last_status,
        "operations_signal_id": str(operations_signal_id),
        "trigger": serialize_trigger(trigger),
    }


async def watch_status(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    trigger = await ensure_heartbeat_trigger(session, tenant_id, enable_if_created=False)
    ops = await ensure_operations_thread(session, tenant_id)
    return serialize_watch_status(trigger, ops.id)


async def set_platform_watch(
    session: AsyncSession, tenant_id: UUID, enabled: bool
) -> dict[str, Any]:
    """Enable or pause only the seeded platform check-in."""
    trigger = await ensure_heartbeat_trigger(session, tenant_id, enable_if_created=False)
    trigger.enabled = bool(enabled)
    trigger.next_run_at = compute_next_run(trigger) if trigger.enabled else None
    session.add(trigger)
    ops = await ensure_operations_thread(session, tenant_id)
    if trigger.signal_id != ops.id:
        trigger.signal_id = ops.id
        session.add(trigger)
    await session.flush()
    return serialize_watch_status(trigger, ops.id)


async def bootstrap_new_tenant(session: AsyncSession, tenant_id: UUID) -> Trigger:
    """New workspace: operations thread + enabled hourly check-in."""
    await ensure_operations_thread(session, tenant_id)
    return await ensure_heartbeat_trigger(session, tenant_id, enable_if_created=True)


async def ensure_platform_watch(session: AsyncSession) -> None:
    """Startup backfill: ops thread + check-in row. Never enable an existing one."""
    tenants = (await session.execute(select(Tenant))).scalars().all()
    for tenant in tenants:
        await ensure_operations_thread(session, tenant.id)
        await ensure_heartbeat_trigger(session, tenant.id, enable_if_created=False)
    await session.commit()
