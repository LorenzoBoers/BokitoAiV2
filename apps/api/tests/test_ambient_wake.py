"""Ambient wake logs activity and does not repeat a recent check-in."""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.core.time import utcnow
from app.models.agent import Agent, AgentRun
from app.models.auth import Tenant, User
from app.models.signal import Signal, SignalEvent, SignalTag, SignalTagLink
from app.models.trigger import Trigger
from app.models.workspace import DocSection, KnowledgeEvidence, WorkspaceDoc
from app.services import presence
from app.services.ambient import next_wake_at, process_ambient_wakes


@pytest.mark.asyncio
async def test_ambient_wake_logs_activity_and_skips_a_recent_checkin(client, session_override):
    del client
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    agent = Agent(
        tenant_id=tenant.id,
        name="Ambient",
        slug=f"ambient-{uuid4().hex[:6]}",
        settings_json='{"awareness": {"mode": "daily", "next_wake_at": "2000-01-01T00:00:00"}}',
    )
    other = Agent(
        tenant_id=tenant.id,
        name="Other",
        slug=f"other-{uuid4().hex[:6]}",
        settings_json='{"awareness": {"mode": "daily", "next_wake_at": "2000-01-01T00:00:00"}}',
    )
    tag = SignalTag(tenant_id=tenant.id, name=f"orders-{uuid4().hex[:6]}")
    session_override.add(agent)
    session_override.add(other)
    session_override.add(tag)
    await session_override.flush()
    signal = Signal(tenant_id=tenant.id, channel="email", status="open", subject="Order")
    session_override.add(signal)
    doc = WorkspaceDoc(tenant_id=tenant.id, path=f"lessen-{uuid4().hex[:4]}.md", title="Lessen", kind="skill")
    session_override.add(doc)
    await session_override.flush()
    session_override.add(SignalTagLink(signal_id=signal.id, tag_id=tag.id, tenant_id=tenant.id))
    section = DocSection(
        tenant_id=tenant.id,
        doc_id=doc.id,
        anchor="orders",
        heading="Orders",
        content="body " * 40,
        status="draft",
    )
    session_override.add(section)
    await session_override.flush()
    session_override.add(
        KnowledgeEvidence(
            tenant_id=tenant.id,
            section_id=section.id,
            kind="intuition",
            signal_id=signal.id,
            source_ref=f"message:{uuid4()}",
            agent_id=agent.id,
            tag_ids_json=f'["{tag.id}"]',
        )
    )
    await session_override.commit()

    fired = await process_ambient_wakes(session_override)
    assert fired >= 1
    runs = (
        await session_override.execute(
            select(func.count()).select_from(AgentRun).where(AgentRun.trigger_type == "ambient")
        )
    ).scalar_one()
    assert runs >= 1
    triggers = (
        await session_override.execute(select(func.count()).select_from(Trigger))
    ).scalar_one()
    assert triggers == 0
    checks = (
        await session_override.execute(
            select(func.count()).select_from(SignalEvent).where(SignalEvent.event_type == "checkin")
        )
    ).scalar_one()
    assert checks == 1

    other.settings_json = '{"awareness": {"mode": "daily", "next_wake_at": "2000-01-01T00:00:00"}}'
    session_override.add(
        KnowledgeEvidence(
            tenant_id=tenant.id,
            section_id=section.id,
            kind="intuition",
            signal_id=signal.id,
            source_ref=f"message:{uuid4()}",
            agent_id=other.id,
            tag_ids_json=f'["{tag.id}"]',
        )
    )
    session_override.add(other)
    await session_override.commit()
    await process_ambient_wakes(session_override, now=utcnow() + timedelta(minutes=30))
    again = (
        await session_override.execute(
            select(func.count()).select_from(SignalEvent).where(SignalEvent.event_type == "checkin")
        )
    ).scalar_one()
    assert again == 1


@pytest.mark.asyncio
async def test_wake_is_scheduled_without_a_trigger(client, session_override):
    del client
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    agent = Agent(
        tenant_id=tenant.id,
        name="Scheduled",
        slug=f"sched-{uuid4().hex[:6]}",
        settings_json="{}",
    )
    session_override.add(agent)
    await session_override.commit()
    assert await process_ambient_wakes(session_override) == 0
    await session_override.refresh(agent)
    when = next_wake_at(agent)
    assert when is not None and when > utcnow()
    runs = (
        await session_override.execute(
            select(func.count()).select_from(AgentRun).where(AgentRun.agent_id == agent.id)
        )
    ).scalar_one()
    assert runs == 0
    triggers = (
        await session_override.execute(
            select(func.count()).select_from(Trigger).where(Trigger.purpose == "orientation")
        )
    ).scalar_one()
    assert triggers == 0


def test_daily_drops_a_leftover_custom_cron():
    from app.services.agent_awareness import DEFAULT_CHECKIN_CRON, set_awareness
    from app.services.ambient import next_wake_at

    agent = Agent(
        name="Cadence",
        slug="cadence",
        settings_json='{"awareness": {"mode": "custom", "cron": "*/5 * * * *", "next_wake_at": "2026-10-22T21:10:00"}}',
    )
    config = set_awareness(agent, {"mode": "daily", "cron": "*/5 * * * *"})
    assert config["mode"] == "daily"
    assert config["cron"] == DEFAULT_CHECKIN_CRON
    when = next_wake_at(agent)
    assert when is not None
    assert (when.hour, when.minute) == (7, 30)
    assert when.weekday() < 5


def test_unavailable_is_not_a_call_target():
    user = User(email="a@b.c", password_hash="x", availability="unavailable")
    assert presence.user_status(user) == "unavailable"
    user.availability = "away"
    assert presence.user_status(user) == "away"
    from app.services.agent_calls import _person_available

    assert _person_available(user, set(), now=utcnow()) is False
    user.availability = "online"
    user.away = False
    user.last_seen_at = utcnow()
    assert _person_available(user, set(), now=utcnow()) is True


@pytest.mark.asyncio
async def test_ladder_skips_unavailable(client, session_override):
    del client
    from app.services.reach import without_unavailable

    user = (await session_override.execute(select(User))).scalars().first()
    user.availability = "unavailable"
    session_override.add(user)
    await session_override.flush()
    assert await without_unavailable(session_override, [user.id]) == []
    user.availability = "online"
    user.away = False
    session_override.add(user)
    await session_override.flush()
    assert await without_unavailable(session_override, [user.id]) == [user.id]
