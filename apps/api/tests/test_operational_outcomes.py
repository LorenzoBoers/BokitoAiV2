"""Tests for operational outcomes and report webhook ingestion."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.outcome import OperationalOutcome
from app.models.trigger import Trigger
from app.services.outcomes import ingest_trading_report, list_recent_outcomes
from app.services.triggers import fire_trigger


@pytest.mark.asyncio
async def test_ingest_trading_report(session_override):
    tenant = Tenant(slug="outcome-test", name="Outcome Test")
    session_override.add(tenant)
    await session_override.commit()

    payload = {
        "kind": "report",
        "subtype": "trade_closed",
        "setup_id": "setup-1",
        "pnl_r": 1.5,
        "notes": "Target hit",
    }
    outcome = await ingest_trading_report(
        session_override, tenant.id, payload, source="trading_webhook"
    )
    assert outcome.kind == "trade_closed"
    assert outcome.subtype == "trade_closed"

    rows = await list_recent_outcomes(session_override, tenant.id, days=7)
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_fire_trigger_report_webhook(session_override):
    tenant = Tenant(
        slug="report-hook",
        name="Report Hook",
        settings_json=json.dumps({"operations_signal_id": str(uuid4())}),
    )
    session_override.add(tenant)
    await session_override.flush()

    from app.models.agent import Agent

    agent = Agent(
        tenant_id=tenant.id,
        name="Trader",
        role="assistant",
        slug="trader",
        model="claude-haiku-4-5-20251001",
        system_prompt="Reply briefly.",
    )
    session_override.add(agent)
    await session_override.flush()

    trigger = Trigger(
        tenant_id=tenant.id,
        name="MMXM pipeline webhook",
        kind="webhook",
        agent_id=agent.id,
        instructions="Handle webhook.",
        webhook_secret="test-secret",
        enabled=True,
    )
    session_override.add(trigger)
    await session_override.commit()

    from unittest.mock import AsyncMock, patch

    with patch("app.services.agent.loop.AgentLoop.run_chat", new=AsyncMock(return_value=("Digest posted.", 10))):
        result = await fire_trigger(
            session_override,
            trigger,
            payload={
                "kind": "report",
                "subtype": "session_summary",
                "notes": "Flat day",
                "pnl_r": 0,
            },
        )

    assert result["status"] in ("reported", "ok")
    outcomes = (
        await session_override.execute(
            select(OperationalOutcome).where(OperationalOutcome.tenant_id == tenant.id)
        )
    ).scalars().all()
    assert len(outcomes) == 1
    assert outcomes[0].kind == "session_summary"
