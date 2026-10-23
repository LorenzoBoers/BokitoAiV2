"""Department orientation: the snapshot, the prompt and the platform watch fold."""

import json
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Membership, Tenant, User
from app.models.orchestra import Workstream
from app.models.signal import Signal, SignalTag
from app.models.trigger import Trigger
from app.services.awareness import department_snapshot, ensure_orientations, render_snapshot
from app.services.platform_watch import set_platform_watch, watch_status
from app.services.teams import create_team, set_team_members
from scripts.seed import TEST_EMAIL

STAGES = [
    {"key": "captions", "name": "Captions", "kind": "open", "fields": [{"name": "Kanaal", "required": True}]},
    {"key": "klant-akkoord", "name": "Klant akkoord", "kind": "waiting", "waiting_on": "customer", "checkup_minutes": 60},
    {"key": "ingepland", "name": "Ingepland", "kind": "done"},
]


async def _setup(session):
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    owner = (await session.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    membership = (
        await session.execute(select(Membership).where(Membership.user_id == owner.id, Membership.tenant_id == tenant.id))
    ).scalar_one()
    membership.hours_per_week = 4
    agent = (await session.execute(select(Agent).where(Agent.tenant_id == tenant.id))).scalars().first()
    team = await create_team(session, tenant.id, name="Content", description="", pickup="people", members=[])
    await set_team_members(
        session,
        team,
        [{"kind": "agent", "id": str(agent.id), "duty": "primary"}, {"kind": "user", "id": str(owner.id), "duty": "primary"}],
    )
    flow = Workstream(tenant_id=tenant.id, name="Maandcontent", department_id=team.id, stages_json=json.dumps(STAGES))
    session.add(flow)
    await session.flush()
    label = SignalTag(tenant_id=tenant.id, name="maandcontent", workstream_id=flow.id)
    session.add(label)
    await session.flush()
    old = datetime.utcnow() - timedelta(days=2)
    session.add_all([
        Signal(
            tenant_id=tenant.id, channel="email", source="email", subject="Captions mei",
            ticket_tag_id=label.id, ticket_status="open", stage_key="captions",
            due_at=old, assignee_kind="user", assignee_id=owner.id,
            ticket_fields_json=json.dumps({"hours": "6"}),
        ),
        Signal(
            tenant_id=tenant.id, channel="email", source="email", subject="Akkoord posts",
            ticket_tag_id=label.id, ticket_status="waiting", stage_key="klant-akkoord",
            ticket_filed_at=old, created_at=old,
        ),
    ])
    await session.commit()
    return tenant, team, agent


@pytest.mark.asyncio
async def test_snapshot_lists_what_asks_for_action(client: AsyncClient, session_override):
    tenant, team, _agent = await _setup(session_override)
    snap = await department_snapshot(session_override, tenant.id, team.id)
    assert snap["open_tickets"] == 2
    assert [r["subject"] for r in snap["overdue"]] == ["Captions mei"]
    assert [r["subject"] for r in snap["waiting_on_customer"]] == ["Akkoord posts"]
    assert snap["incomplete"][0]["missing"] == ["Kanaal"]
    assert snap["capacity"][0]["planned_hours"] == 6.0 and snap["capacity"][0]["over"] is True
    text = render_snapshot(snap)
    assert "Past the deadline" in text and "Captions mei" in text


@pytest.mark.asyncio
async def test_orientation_is_not_an_agenda_item(client: AsyncClient, session_override):
    tenant, _team, _agent = await _setup(session_override)
    rows = await ensure_orientations(session_override, tenant.id)
    await session_override.commit()
    assert rows == []
    stored = (
        await session_override.execute(
            select(Trigger).where(Trigger.tenant_id == tenant.id, Trigger.purpose == "orientation")
        )
    ).scalars().all()
    assert stored == []


@pytest.mark.asyncio
async def test_platform_watch_uses_orientations_with_departments(client: AsyncClient, session_override):
    tenant, _team, _agent = await _setup(session_override)
    status = await set_platform_watch(session_override, tenant.id, True)
    await session_override.commit()
    assert status["enabled"] is True
    heartbeat = (
        await session_override.execute(select(Trigger).where(Trigger.tenant_id == tenant.id, Trigger.kind == "heartbeat"))
    ).scalars().first()
    orientations = (
        await session_override.execute(
            select(Trigger).where(Trigger.tenant_id == tenant.id, Trigger.purpose == "orientation")
        )
    ).scalars().all()
    assert orientations == []
    assert heartbeat is not None and heartbeat.enabled is True
    assert (await watch_status(session_override, tenant.id))["trigger"]["id"] == status["trigger_id"]
    off = await set_platform_watch(session_override, tenant.id, False)
    assert off["enabled"] is False
