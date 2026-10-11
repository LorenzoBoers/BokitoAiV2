"""Heartbeat check-ins: report only changes, never the same post twice."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import SignalMessage
from app.models.trigger import Trigger
from app.services.triggers import (
    fire_trigger,
    heartbeat_report_similarity,
    is_repeat_heartbeat_report,
)

FIRST = """**Aandachtspunten heartbeat**

Er staan 62 openstaande beslissingen. Twee threads verdienen aandacht:
- "FW: Benodigde gegevens aangifte IB 2025" — opvolging nodig.
- "Bedrijfsbezoek SoestNetwerkt" — kan gesloten worden.
Banking is niet geïnstalleerd; overweeg de module."""

SECOND = """**Aandachtspunten heartbeat**

Er staan 65 openstaande beslissingen. Twee threads verdienen aandacht:
- "FW: Benodigde gegevens aangifte IB 2025" — opvolging nodig.
- "Bedrijfsbezoek SoestNetwerkt" — kan gesloten worden.
Banking is niet geïnstalleerd; overweeg de module."""

DIFFERENT = """Nieuw sinds de vorige check-in: de Belastingdienst stuurde een vragenbrief
over Oosterengweg (ref 47.07.953); de klant moet de brieven ontvangen. Verder
niets nieuws."""


def test_similarity_ignores_counts_and_spacing():
    assert heartbeat_report_similarity(FIRST, SECOND) > 0.95
    assert is_repeat_heartbeat_report(FIRST, SECOND)
    assert not is_repeat_heartbeat_report(FIRST, DIFFERENT)
    assert not is_repeat_heartbeat_report("", DIFFERENT)
    assert not is_repeat_heartbeat_report(None, DIFFERENT)


async def _setup(session, slug: str) -> Trigger:
    tenant = Tenant(slug=slug, name=slug, settings_json="{}")
    session.add(tenant)
    await session.flush()
    agent = Agent(
        tenant_id=tenant.id,
        name="Kantoor AI",
        role="assistant",
        kind="company",
        slug="kantoor-ai",
        model="claude-haiku-4-5-20251001",
        system_prompt="Reply briefly.",
        is_lead=True,
    )
    session.add(agent)
    await session.flush()
    trigger = Trigger(
        tenant_id=tenant.id,
        name="Check-in: Kantoor AI",
        kind="heartbeat",
        interval_minutes=1440,
        agent_id=agent.id,
        enabled=True,
    )
    session.add(trigger)
    await session.commit()
    return trigger


@pytest.mark.asyncio
async def test_repeat_report_is_not_posted_twice(session_override):
    trigger = await _setup(session_override, "hb-repeat")

    with patch("app.services.agent.loop.AgentLoop.run_chat", new=AsyncMock(return_value=(FIRST, 10))):
        first = await fire_trigger(session_override, trigger)
    assert first["status"] == "reported"
    assert trigger.signal_id is not None

    with patch("app.services.agent.loop.AgentLoop.run_chat", new=AsyncMock(return_value=(SECOND, 10))):
        second = await fire_trigger(session_override, trigger)
    assert second["status"] == "unchanged"
    assert second["suppressed"] is True

    with patch("app.services.agent.loop.AgentLoop.run_chat", new=AsyncMock(return_value=(DIFFERENT, 10))):
        third = await fire_trigger(session_override, trigger)
    assert third["status"] == "reported"

    posted = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == trigger.signal_id,
                SignalMessage.kind == "agent_message",
            )
        )
    ).scalars().all()
    bodies = [m.body_text for m in posted]
    assert FIRST in bodies
    assert DIFFERENT in bodies
    assert SECOND not in bodies
    for message in posted:
        assert json.loads(message.metadata_json)["trigger_id"] == str(trigger.id)


@pytest.mark.asyncio
async def test_previous_report_is_fed_back_into_the_prompt(session_override):
    trigger = await _setup(session_override, "hb-context")
    seen: list[str] = []

    async def fake_run_chat(self, messages, *args, **kwargs):
        seen.append(messages[0]["content"])
        return (FIRST if len(seen) == 1 else DIFFERENT, 10)

    with patch("app.services.agent.loop.AgentLoop.run_chat", new=fake_run_chat):
        await fire_trigger(session_override, trigger)
        await fire_trigger(session_override, trigger)

    assert "Previous report" not in seen[0]
    assert "Previous report" in seen[1]
    assert "Bedrijfsbezoek SoestNetwerkt" in seen[1]
    assert "mention only what is new" in seen[1]


@pytest.mark.asyncio
async def test_credit_failure_opens_block_and_skips_next_run(session_override):
    from app.models.agent import AgentRun
    from app.services.run_errors import LLM_BLOCK_SETTINGS_KEY

    trigger = await _setup(session_override, "hb-block")
    tenant = await session_override.get(Tenant, trigger.tenant_id)

    boom = RuntimeError("Your credit balance is too low to access the Anthropic API")
    with patch("app.services.agent.loop.AgentLoop.run_chat", new=AsyncMock(side_effect=boom)):
        first = await fire_trigger(session_override, trigger)
    assert first["status"] == "blocked"
    assert first["block"] == "provider_credits"

    run = (
        await session_override.execute(
            select(AgentRun).where(AgentRun.tenant_id == trigger.tenant_id)
        )
    ).scalar_one()
    assert run.status == "failed"
    result = json.loads(run.result_json or "{}")
    assert result["error_code"] == "provider_credits"
    assert "credit balance" in result["error"]

    await session_override.refresh(tenant)
    assert LLM_BLOCK_SETTINGS_KEY in json.loads(tenant.settings_json)

    # While blocked, the trigger does not start a run at all.
    run_chat = AsyncMock(return_value=(FIRST, 10))
    with patch("app.services.agent.loop.AgentLoop.run_chat", new=run_chat):
        second = await fire_trigger(session_override, trigger)
    assert second["status"] == "blocked"
    run_chat.assert_not_awaited()
    assert trigger.last_status == "blocked:provider_credits"
