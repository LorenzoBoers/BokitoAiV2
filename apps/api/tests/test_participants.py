"""SignalParticipant roster + serialize."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.channel import Contact
from app.models.signal import Signal
from app.models.signal_participant import SignalParticipant
from app.services.ownership import apply_owner
from app.services.participants import (
    ensure_participant,
    leave_participant,
    serialize_participants,
    sync_signal_baseline,
)


@pytest.mark.asyncio
async def test_ensure_and_serialize_participants(client, session_override):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User).limit(1))).scalar_one()
    agent = Agent(
        tenant_id=tenant.id,
        name=f"Part Agent {uuid4().hex[:6]}",
        role="assistant",
        kind="company",
        is_active=True,
        slug=f"part-{uuid4().hex[:8]}",
        tools_json="[]",
        settings_json="{}",
    )
    session_override.add(agent)
    now = datetime.utcnow()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="test",
        subject="Participants",
        status="open",
        created_at=now,
        updated_at=now,
        last_message_at=now,
    )
    session_override.add(signal)
    await session_override.flush()

    await apply_owner(session_override, signal, "user", user.id, by_user_id=user.id)
    await ensure_participant(
        session_override,
        signal,
        kind="agent",
        ref_id=agent.id,
        role="member",
        joined_via="invite",
    )
    await session_override.commit()

    rows = (
        await session_override.execute(
            select(SignalParticipant).where(
                SignalParticipant.signal_id == signal.id,
                SignalParticipant.left_at.is_(None),
            )
        )
    ).scalars().all()
    kinds = {r.kind for r in rows}
    assert "user" in kinds
    assert "agent" in kinds

    payload = await serialize_participants(session_override, tenant.id, signal.id)
    assert any(p["kind"] == "agent" and p["ref_id"] == str(agent.id) for p in payload)
    assert any(p["role"] == "owner" for p in payload)

    left = await leave_participant(
        session_override, signal, kind="agent", ref_id=agent.id
    )
    assert left is True
    await session_override.commit()
    after = await serialize_participants(session_override, tenant.id, signal.id)
    assert not any(p["ref_id"] == str(agent.id) for p in after)


@pytest.mark.asyncio
async def test_sync_baseline_adds_agent(client, session_override):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = Agent(
        tenant_id=tenant.id,
        name=f"Baseline {uuid4().hex[:6]}",
        role="assistant",
        kind="company",
        is_active=True,
        slug=f"base-{uuid4().hex[:8]}",
        tools_json="[]",
        settings_json="{}",
    )
    session_override.add(agent)
    now = datetime.utcnow()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="test",
        subject="Baseline",
        status="open",
        agent_id=agent.id,
        created_at=now,
        updated_at=now,
        last_message_at=now,
    )
    session_override.add(signal)
    await session_override.flush()
    await sync_signal_baseline(session_override, signal)
    await session_override.commit()
    payload = await serialize_participants(session_override, tenant.id, signal.id)
    assert any(p["ref_id"] == str(agent.id) for p in payload)


@pytest.mark.asyncio
async def test_serialize_contact_participant_uses_display_name(client, session_override):
    """Contact has display_name/address — not name/email (that AttributeError 500'd detail)."""
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    contact = Contact(
        tenant_id=tenant.id,
        channel="email",
        address="buyer@example.com",
        display_name="Buyer Example",
        status="approved",
    )
    session_override.add(contact)
    now = datetime.utcnow()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="test",
        subject="Contact participant",
        status="open",
        created_at=now,
        updated_at=now,
        last_message_at=now,
    )
    session_override.add(signal)
    await session_override.flush()
    await ensure_participant(
        session_override,
        signal,
        kind="contact",
        ref_id=contact.id,
        role="member",
        joined_via="backfill",
    )
    await session_override.commit()
    payload = await serialize_participants(session_override, tenant.id, signal.id)
    row = next(p for p in payload if p["kind"] == "contact")
    assert row["name"] == "Buyer Example"
    assert row["email"] == "buyer@example.com"
