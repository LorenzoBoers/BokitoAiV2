"""Platform check-in: one heartbeat trigger posting into the agent's own channel.

Findings land in the channel of the assistant that runs the check-in — the
conversation operators open at `/communication/agent/{agent_id}` — so a
check-in reads as the assistant talking, not as a separate ops mailbox. The
channel thread is tenant-wide (`owner_user_id` stays null), so every member
sees the same history. Existing disabled heartbeats are never flipped on
automatically.
"""

from __future__ import annotations

from datetime import datetime
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
from app.services.triggers import compute_next_run, resolve_trigger_agent, serialize_trigger

# Pre-migration tenants stored the shared ops thread here. The key is dropped
# the first time that thread is folded into the assistant channel.
OPERATIONS_SETTINGS_KEY = "operations_signal_id"
# Marks the one shared, tenant-wide conversation of an agent, next to the
# per-user chats (source="chat") and inline sessions (source="agent_session").
AGENT_CHANNEL_SOURCE = "agent_channel"
PLATFORM_CHECKIN_INTERVAL_MINUTES = 60
# Names earlier versions gave the seeded trigger; renamed on sight.
_LEGACY_TRIGGER_NAMES = ("Heartbeat", "Platform check-in")
_CHECKIN_NAME_PREFIX = "Check-in"


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def checkin_trigger_name(agent: Agent | None) -> str:
    """Label the check-in after the agent that runs it, not fixed product copy.

    The dashboard recognizes the row by `kind == "heartbeat"` and renders its
    own translated label, so this string is only a fallback in raw listings.
    """
    return f"{_CHECKIN_NAME_PREFIX}: {agent.name}" if agent else _CHECKIN_NAME_PREFIX


def _is_seeded_name(name: str) -> bool:
    """Did the platform name this trigger itself? Then it may be refreshed.

    A trigger an operator renamed to something of their own keeps that name.
    """
    value = name.strip()
    return value in _LEGACY_TRIGGER_NAMES or value.startswith(_CHECKIN_NAME_PREFIX)


async def lead_assistant(session: AsyncSession, tenant_id: UUID) -> Agent | None:
    """The assistant that owns the workspace channel.

    Mirrors the trigger resolution (`triggers.resolve_trigger_agent`) so the
    thread the check-in is bound to is the thread it will post into.
    """
    agent = (
        await session.execute(
            select(Agent)
            .where(
                Agent.tenant_id == tenant_id,
                Agent.kind == "company",
                Agent.role == "assistant",
                Agent.is_active == True,  # noqa: E712
            )
            .order_by(Agent.created_at)
            .limit(1)
        )
    ).scalars().first()
    if agent:
        return agent
    from app.services.lead_agent import get_lead_agent

    return await get_lead_agent(session, tenant_id)


def _legacy_thread_id(settings: dict[str, Any]) -> UUID | None:
    raw = settings.get(OPERATIONS_SETTINGS_KEY)
    if not raw:
        return None
    try:
        return UUID(str(raw))
    except ValueError:
        return None


async def ensure_agent_channel(
    session: AsyncSession, tenant_id: UUID, *, agent: Agent | None = None
) -> Signal:
    """The shared channel thread of `agent` (the lead assistant by default).

    Reuses the existing channel, otherwise folds a pre-migration Platform
    check-in thread into it so its history survives, otherwise creates one.
    """
    tenant = await session.get(Tenant, tenant_id)
    if not tenant:
        raise ValueError(f"tenant {tenant_id} not found")

    channel_agent = agent or await lead_assistant(session, tenant_id)
    query = select(Signal).where(
        Signal.tenant_id == tenant_id,
        Signal.channel == "assistant",
        Signal.source == AGENT_CHANNEL_SOURCE,
        Signal.owner_user_id.is_(None),
    )
    if channel_agent:
        query = query.where(Signal.agent_id == channel_agent.id)
    existing = (await session.execute(query.order_by(Signal.created_at).limit(1))).scalars().first()
    if existing:
        await _drop_legacy_key(session, tenant, existing.id)
        return existing

    settings = tenant_settings(tenant)
    legacy_id = _legacy_thread_id(settings)
    legacy = await session.get(Signal, legacy_id) if legacy_id else None
    if legacy and legacy.tenant_id != tenant_id:
        legacy = None
    if legacy and channel_agent:
        # The old shared thread belongs to the lead assistant. Another agent
        # asking for its own channel gets a fresh one.
        lead = await lead_assistant(session, tenant_id)
        if lead and lead.id != channel_agent.id:
            legacy = None

    if legacy:
        # Keep the messages, move the thread: same rows, new home.
        legacy.channel = "assistant"
        legacy.source = AGENT_CHANNEL_SOURCE
        legacy.owner_user_id = None
        if channel_agent:
            legacy.agent_id = channel_agent.id
            legacy.subject = channel_agent.name
            legacy.contact_name = channel_agent.name
        session.add(legacy)
        await session.flush()
        await _drop_legacy_key(session, tenant, legacy.id)
        return legacy

    signal = Signal(
        tenant_id=tenant_id,
        channel="assistant",
        source=AGENT_CHANNEL_SOURCE,
        subject=channel_agent.name if channel_agent else "Assistant",
        contact_name=channel_agent.name if channel_agent else "Assistant",
        agent_id=channel_agent.id if channel_agent else None,
        status="open",
        priority="normal",
        has_unread=False,
        last_message_at=datetime.utcnow(),
    )
    session.add(signal)
    await session.flush()
    await _drop_legacy_key(session, tenant, signal.id)
    return signal


async def _drop_legacy_key(session: AsyncSession, tenant: Tenant, channel_id: UUID) -> None:
    """Forget `operations_signal_id` once its thread became the agent channel.

    A tenant that points the key at another thread (the trading webhook target)
    keeps it: only the migrated thread is cleaned up.
    """
    settings = tenant_settings(tenant)
    if _legacy_thread_id(settings) != channel_id:
        return
    settings.pop(OPERATIONS_SETTINGS_KEY, None)
    tenant.settings_json = serialize_settings(settings)
    session.add(tenant)


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
    # Bind to the channel of the agent that will actually run the check-in.
    agent = (
        await resolve_trigger_agent(session, existing)
        if existing
        else await lead_assistant(session, tenant_id)
    ) or await lead_assistant(session, tenant_id)
    channel = await ensure_agent_channel(session, tenant_id, agent=agent)
    name = checkin_trigger_name(agent)

    if existing:
        if existing.name.strip() != name and _is_seeded_name(existing.name):
            existing.name = name
            session.add(existing)
        if existing.signal_id != channel.id:
            existing.signal_id = channel.id
            session.add(existing)
        return existing

    trigger = Trigger(
        tenant_id=tenant_id,
        name=name,
        kind="heartbeat",
        interval_minutes=PLATFORM_CHECKIN_INTERVAL_MINUTES,
        agent_role="assistant",
        enabled=enable_if_created,
        signal_id=channel.id,
    )
    trigger.next_run_at = compute_next_run(trigger) if enable_if_created else None
    session.add(trigger)
    await session.flush()
    return trigger


def serialize_watch_status(trigger: Trigger, channel_signal_id: UUID | None) -> dict[str, Any]:
    return {
        "enabled": bool(trigger.enabled),
        "trigger_id": str(trigger.id),
        "name": trigger.name,
        "interval_minutes": trigger.interval_minutes,
        "next_run_at": _iso(trigger.next_run_at),
        "last_status": trigger.last_status,
        # The conversation the findings land in: the assistant's own channel.
        "signal_id": str(channel_signal_id) if channel_signal_id else None,
        "trigger": serialize_trigger(trigger),
    }


async def watch_status(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    trigger = await ensure_heartbeat_trigger(session, tenant_id, enable_if_created=False)
    return serialize_watch_status(trigger, trigger.signal_id)


async def set_platform_watch(
    session: AsyncSession, tenant_id: UUID, enabled: bool
) -> dict[str, Any]:
    """Enable or pause only the seeded platform check-in."""
    trigger = await ensure_heartbeat_trigger(session, tenant_id, enable_if_created=False)
    trigger.enabled = bool(enabled)
    trigger.next_run_at = compute_next_run(trigger) if trigger.enabled else None
    session.add(trigger)
    await session.flush()
    return serialize_watch_status(trigger, trigger.signal_id)


async def bootstrap_new_tenant(session: AsyncSession, tenant_id: UUID) -> Trigger:
    """New workspace: assistant channel + enabled hourly check-in."""
    return await ensure_heartbeat_trigger(session, tenant_id, enable_if_created=True)


async def ensure_platform_watch(session: AsyncSession) -> None:
    """Startup backfill: agent channel + check-in row. Never enable an existing one.

    Idempotent: a tenant already on the agent channel is left alone, and a
    pre-migration Platform check-in thread is folded in exactly once.
    """
    tenants = (await session.execute(select(Tenant))).scalars().all()
    for tenant in tenants:
        await ensure_heartbeat_trigger(session, tenant.id, enable_if_created=False)
    await session.commit()
