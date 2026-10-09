"""Inbound auto-run requires an explicit channel agent (no lead fallback)."""

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from app.models.signal import Signal, SignalEvent
from app.services.interpretation import apply_thread_read
from app.services.routing import (
    resolve_agent_for_channel,
    resolve_inbound_agent_for_signal,
)
from app.services.signals import create_inbound_signal


@pytest.mark.asyncio
async def test_resolve_inbound_skips_lead_fallback(session_override):
    tenant = Tenant(slug="inbound-route", name="Inbound Route")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    lead = Agent(
        tenant_id=tenant.id,
        name="Lead",
        slug="lead-agent",
        kind="company",
        is_active=True,
        is_lead=True,
        acts_for_user=False,
    )
    session_override.add(lead)
    await session_override.commit()
    await session_override.refresh(lead)

    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        provider="mock",
        address="inbox@example.com",
        display_name="Inbox",
        is_enabled=True,
        default_agent_id=None,
    )
    session_override.add(account)
    await session_override.commit()
    await session_override.refresh(account)

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Hello",
        contact_email="a@test.com",
        status="open",
        channel_account_id=account.id,
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    assert await resolve_inbound_agent_for_signal(session_override, signal) is None
    # Bring-in / candidates may still resolve the lead.
    fallback = await resolve_agent_for_channel(
        session_override, tenant.id, "email", channel_account_id=account.id
    )
    assert fallback is not None
    assert fallback.id == lead.id


@pytest.mark.asyncio
async def test_resolve_inbound_uses_channel_default(session_override):
    tenant = Tenant(slug="inbound-default", name="Inbound Default")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    desk = Agent(
        tenant_id=tenant.id,
        name="Desk",
        slug="desk",
        kind="company",
        is_active=True,
        acts_for_user=False,
    )
    session_override.add(desk)
    await session_override.commit()
    await session_override.refresh(desk)

    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        provider="mock",
        address="desk@example.com",
        display_name="Desk",
        is_enabled=True,
        default_agent_id=desk.id,
    )
    session_override.add(account)
    await session_override.commit()
    await session_override.refresh(account)

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Help",
        contact_email="b@test.com",
        status="open",
        channel_account_id=account.id,
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    agent = await resolve_inbound_agent_for_signal(session_override, signal)
    assert agent is not None
    assert agent.id == desk.id


@pytest.mark.asyncio
async def test_apply_thread_read_writes_enriched_triaged_event(session_override):
    tenant = Tenant(slug="thread-read-event", name="Thread Read")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)
    signal = await create_inbound_signal(
        session_override,
        tenant.id,
        channel="email",
        source="mock",
        subject="Urgent invoice issue",
        body_text="Our invoice is wrong",
        contact_email="c@test.com",
    )
    agent = Agent(
        tenant_id=tenant.id,
        name="Reader",
        slug="reader",
        kind="company",
        is_active=True,
        acts_for_user=False,
    )
    session_override.add(agent)
    await session_override.commit()
    await session_override.refresh(agent)

    result = await apply_thread_read(
        session_override,
        tenant.id,
        signal.id,
        summary="Invoice dispute needs a fix today",
        certainty=85,
        category="billing",
        urgency=80,
        impact=60,
        priority="high",
        agent_id=agent.id,
        agent_name=agent.name,
    )
    assert result.get("summary")
    assert result.get("priority") == "high"
    row = (
        await session_override.execute(select(Signal).where(Signal.id == signal.id))
    ).scalar_one()
    assert row.triaged_at is not None
    assert row.summary == "Invoice dispute needs a fix today"
    event = (
        await session_override.execute(
            select(SignalEvent)
            .where(SignalEvent.signal_id == signal.id, SignalEvent.event_type == "triaged")
            .order_by(SignalEvent.created_at.desc())
        )
    ).scalars().first()
    assert event is not None
    import json

    payload = json.loads(event.payload_json or "{}")
    assert payload.get("summary") == "Invoice dispute needs a fix today"
    assert payload.get("agent_name") == "Reader"
    assert payload.get("priority") == "high"
