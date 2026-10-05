"""Committed writes on tracked models publish one coalesced entity.changed."""

import asyncio
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.gateway.publish as publish_mod
from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.trigger import Trigger


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = (await session.execute(select(Tenant))).scalars().first()
    if tenant is None:
        tenant = Tenant(name="Entity Test", slug=f"entity-test-{uuid4().hex[:8]}")
        session.add(tenant)
        await session.commit()
        await session.refresh(tenant)
    return tenant


@pytest.mark.asyncio
async def test_trigger_writes_publish_entity_events(session_override: AsyncSession, monkeypatch):
    calls: list[dict] = []

    async def fake_publish(tenant_id, *, entity, id, op="updated", row=None):
        calls.append({"tenant_id": str(tenant_id), "entity": entity, "id": id, "op": op})

    monkeypatch.setattr(publish_mod, "publish_entity", fake_publish)
    tenant = await _tenant(session_override)

    trigger = Trigger(
        tenant_id=tenant.id,
        name="Live scan",
        kind="once",
        next_run_at=datetime.utcnow() + timedelta(hours=1),
    )
    session_override.add(trigger)
    await session_override.commit()
    await asyncio.sleep(0)
    assert {"entity": "trigger", "id": str(trigger.id), "op": "created"}.items() <= calls[-1].items()

    trigger.name = "Live scan renamed"
    session_override.add(trigger)
    await session_override.commit()
    await asyncio.sleep(0)
    assert calls[-1]["op"] == "updated"

    trigger.deleted_at = datetime.utcnow()
    session_override.add(trigger)
    await session_override.commit()
    await asyncio.sleep(0)
    assert calls[-1]["op"] == "deleted"


@pytest.mark.asyncio
async def test_agent_runtime_churn_is_not_an_entity_event(session_override: AsyncSession, monkeypatch):
    calls: list[dict] = []

    async def fake_publish(tenant_id, *, entity, id, op="updated", row=None):
        calls.append({"entity": entity, "id": id, "op": op})

    tenant = await _tenant(session_override)
    agent = Agent(tenant_id=tenant.id, name="Churn Agent")
    session_override.add(agent)
    await session_override.commit()
    await session_override.refresh(agent)

    monkeypatch.setattr(publish_mod, "publish_entity", fake_publish)
    agent.runtime_status = "working"
    agent.current_activity_summary = "Reading mail"
    session_override.add(agent)
    await session_override.commit()
    await asyncio.sleep(0)
    assert not [c for c in calls if c["entity"] == "agent"]

    agent.name = "Renamed Agent"
    session_override.add(agent)
    await session_override.commit()
    await asyncio.sleep(0)
    assert [c for c in calls if c["entity"] == "agent" and c["op"] == "updated"]


@pytest.mark.asyncio
async def test_team_member_change_publishes_its_team(session_override: AsyncSession, monkeypatch):
    from app.models.team import Team, TeamMember

    calls: list[dict] = []

    async def fake_publish(tenant_id, *, entity, id, op="updated", row=None):
        calls.append({"entity": entity, "id": id, "op": op})

    monkeypatch.setattr(publish_mod, "publish_entity", fake_publish)
    tenant = await _tenant(session_override)
    team = Team(tenant_id=tenant.id, name="Live Team")
    session_override.add(team)
    await session_override.commit()
    await session_override.refresh(team)
    calls.clear()

    session_override.add(
        TeamMember(tenant_id=tenant.id, team_id=team.id, member_kind="user")
    )
    await session_override.commit()
    await asyncio.sleep(0)
    assert {"entity": "team", "id": str(team.id), "op": "updated"} in calls


@pytest.mark.asyncio
async def test_notification_event_carries_the_bell_row(session_override: AsyncSession, monkeypatch):
    from app.models.notification import Notification

    sent: list[dict] = []

    async def fake_safe_publish(tenant_id, topics, event, data):
        sent.append({"topics": topics, "event": event, "data": data})

    monkeypatch.setattr(publish_mod, "_safe_publish", fake_safe_publish)
    tenant = await _tenant(session_override)
    row = Notification(tenant_id=tenant.id, kind="status_update", title="Done", body="All good", tier=2)
    session_override.add(row)
    await session_override.commit()
    await session_override.refresh(row)

    await publish_mod.publish_notification(row)
    payload = sent[-1]["data"]
    assert sent[-1]["event"] == "notification"
    assert payload["row"]["id"] == str(row.id)
    assert payload["row"]["body"] == "All good"
    assert payload["row"]["user_id"] is None