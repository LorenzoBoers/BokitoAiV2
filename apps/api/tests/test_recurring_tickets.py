"""Recurring ticket: one new conversation per period on a flow, in a folder."""

import json
from datetime import datetime
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.orchestra import Workstream
from app.models.signal import Signal, SignalTag
from app.services.recurring_tickets import open_recurring_ticket, period_key, render_title, upsert_recurring_ticket
from app.services.triggers import get_trigger


async def _flow(session):
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (await session.execute(select(Agent).where(Agent.tenant_id == tenant.id))).scalars().first()
    flow = Workstream(
        tenant_id=tenant.id,
        name="Maandcontent",
        stages_json=json.dumps([{"key": "ideeen", "name": "Ideeen", "kind": "open"}, {"key": "klaar", "name": "Klaar", "kind": "done"}]),
    )
    session.add(flow)
    await session.flush()
    session.add(SignalTag(tenant_id=tenant.id, name="maandcontent", workstream_id=flow.id))
    await session.commit()
    return tenant, agent


def test_title_and_period():
    now = datetime(2026, 11, 1, 7, 0)
    assert render_title("Maandcontent {maand}", now) == "Maandcontent november 2026"
    assert render_title("Report {week}", now) == "Report 2026-W44"

    class T:
        cron_expr = ""

    t = T()
    t.cron_expr = "0 7 1 * *"
    assert period_key(t, now) == "2026-11"
    t.cron_expr = "0 8 * * 1"
    assert period_key(t, now) == "2026-W44"
    t.cron_expr = "30 7 * * 1-5"
    assert period_key(t, now) == "2026-11-01"


@pytest.mark.asyncio
async def test_recurring_ticket_opens_once_per_period(client: AsyncClient, session_override):
    tenant, agent = await _flow(session_override)
    out = await upsert_recurring_ticket(
        session_override, tenant.id, flow="#maandcontent", cron="0 7 1 * *",
        title="Maandcontent {maand}", agent_id=agent.id,
    )
    assert out["created"] is True
    again = await upsert_recurring_ticket(
        session_override, tenant.id, flow="maandcontent", cron="0 6 1 * *", title="Content {maand}", agent_id=agent.id,
    )
    assert again["updated"] is True and again["trigger"]["id"] == out["trigger"]["id"]
    trigger = await get_trigger(session_override, tenant.id, UUID(out["trigger"]["id"]))
    assert trigger.signal_id is None

    now = datetime(2026, 11, 1, 6, 0)
    first = await open_recurring_ticket(session_override, trigger, now=now)
    assert first["status"] == "opened"
    second = await open_recurring_ticket(session_override, trigger, now=now)
    assert second == {"status": "exists", "signal_id": first["signal_id"]}
    signal = await session_override.get(Signal, UUID(first["signal_id"]))
    assert signal.subject == "Content november 2026"
    assert signal.ticket_tag_id is not None and signal.ticket_status == "open"
    assert signal.assignee_kind == "agent" and signal.assignee_id == agent.id


@pytest.mark.asyncio
async def test_unknown_flow_is_refused(client: AsyncClient, session_override):
    tenant, _agent = await _flow(session_override)
    out = await upsert_recurring_ticket(session_override, tenant.id, flow="nope", cron="0 7 1 * *")
    assert out["error"] == "flow_not_found"
