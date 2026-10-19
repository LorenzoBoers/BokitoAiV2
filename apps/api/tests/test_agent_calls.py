"""Agent calls ring only for an available addressee and never close the card."""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent_call import AgentCall
from app.models.auth import Tenant, User
from app.models.notification import DecisionRequest
from app.models.signal import Signal
from app.config import get_settings
from app.services.agent_calls import (
    choice_action,
    decline_call,
    expire_rings,
    match_option,
    maybe_ring_for_decision,
    miss_call,
)
from app.services.agent_call_voice import _TOOLS, voice_instructions
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


@pytest.fixture(autouse=True)
def _calls_on(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(get_settings(), "agent_calls_enabled", True)


def test_choice_maps_reject_and_approve():
    approve = {"id": "approve", "label": "Yes"}
    reject = {"id": "reject", "label": "No"}
    assert choice_action(approve) == "approved"
    assert choice_action(reject) == "rejected"
    options = [approve, reject]
    assert match_option(options, option_id="reject", label=None)["label"] == "No"
    assert match_option(options, option_id=None, label="Yes")["id"] == "approve"
    assert match_option(options, option_id="missing", label="missing") is None


def test_voice_brief_names_options_and_hides_tools():
    text = voice_instructions(
        agent_name="Bokito",
        title="Send the invoice?",
        summary="Customer asked today.",
        options=[{"id": "approve", "label": "Send"}, {"id": "reject", "label": "Hold"}],
    )
    assert "Bokito" in text
    assert "Send the invoice?" in text
    assert "id: approve" in text
    names = {tool["name"] for tool in _TOOLS}
    assert names == {"consult_run", "confirm_choice"}


async def _login(client: AsyncClient) -> dict[str, str]:
    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def _open_decision(session, *, user: User, tenant: Tenant) -> DecisionRequest:
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="internal",
        subject="Need a decision",
        status="open",
    )
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    decision = DecisionRequest(
        tenant_id=tenant.id,
        signal_id=signal.id,
        message_id=uuid4(),
        title="Send the invoice?",
        summary="They asked this morning.",
        status="awaiting_human",
        options_json='[{"id":"approve","label":"Send"},{"id":"reject","label":"Hold"}]',
        addressee_kind="user",
        addressee_user_id=user.id,
    )
    session.add(decision)
    await session.commit()
    await session.refresh(decision)
    return decision


@pytest.mark.asyncio
async def test_ring_decline_and_miss_keep_the_card(client: AsyncClient, session_override, monkeypatch):
    headers = await _login(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user.last_seen_at = datetime.utcnow()
    user.away = False
    session_override.add(user)
    await session_override.commit()
    monkeypatch.setattr(
        "app.services.agent_calls.connected_user_ids_for",
        lambda _tenant_id: {str(user.id)},
    )
    decision = await _open_decision(session_override, user=user, tenant=tenant)
    call = await maybe_ring_for_decision(session_override, tenant.id, decision)
    assert call is not None
    assert call.status == "ringing"
    await session_override.commit()
    await session_override.refresh(decision)
    assert decision.status == "awaiting_human"

    declined = await decline_call(session_override, tenant.id, user.id, call.id)
    await session_override.commit()
    assert declined.status == "declined"
    await session_override.refresh(decision)
    assert decision.status == "awaiting_human"

    again = await _open_decision(session_override, user=user, tenant=tenant)
    second = await maybe_ring_for_decision(session_override, tenant.id, again)
    assert second is not None
    await session_override.commit()
    missed = await miss_call(session_override, tenant.id, user.id, second.id)
    await session_override.commit()
    assert missed.status == "missed"
    await session_override.refresh(again)
    assert again.status == "awaiting_human"

    ringing = await client.get("/api/calls/ringing", headers=headers)
    assert ringing.status_code == 200
    assert ringing.json() == []


@pytest.mark.asyncio
async def test_no_ring_when_offline_and_expire_misses(client: AsyncClient, session_override, monkeypatch):
    await _login(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user.last_seen_at = datetime.utcnow() - timedelta(hours=2)
    user.away = False
    session_override.add(user)
    await session_override.commit()
    monkeypatch.setattr(
        "app.services.agent_calls.connected_user_ids_for",
        lambda _tenant_id: set(),
    )
    decision = await _open_decision(session_override, user=user, tenant=tenant)
    assert await maybe_ring_for_decision(session_override, tenant.id, decision) is None

    monkeypatch.setattr(
        "app.services.agent_calls.connected_user_ids_for",
        lambda _tenant_id: {str(user.id)},
    )
    user.last_seen_at = datetime.utcnow()
    session_override.add(user)
    await session_override.commit()
    call = await maybe_ring_for_decision(session_override, tenant.id, decision)
    assert call is not None
    call.ring_until = datetime.utcnow() - timedelta(seconds=1)
    session_override.add(call)
    await session_override.commit()
    assert await expire_rings(session_override) == 1
    await session_override.refresh(call)
    assert call.status == "missed"
    await session_override.refresh(decision)
    assert decision.status == "awaiting_human"
    rows = (await session_override.execute(select(AgentCall))).scalars().all()
    assert rows and all(row.status == "missed" for row in rows)


@pytest.mark.asyncio
async def test_accept_without_voice_key_stays_ringing(client: AsyncClient, session_override, monkeypatch):
    headers = await _login(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user.last_seen_at = datetime.utcnow()
    session_override.add(user)
    await session_override.commit()
    monkeypatch.setattr(
        "app.services.agent_calls.connected_user_ids_for",
        lambda _tenant_id: {str(user.id)},
    )
    monkeypatch.setattr(
        "app.services.agent_call_voice.get_settings",
        lambda: type("S", (), {"openai_api_key": "", "openai_realtime_model": "gpt-realtime", "openai_realtime_voice": "marin", "agent_call_ring_seconds": 25})(),
    )
    decision = await _open_decision(session_override, user=user, tenant=tenant)
    call = await maybe_ring_for_decision(session_override, tenant.id, decision)
    assert call is not None
    await session_override.commit()
    accepted = await client.post(f"/api/calls/{call.id}/accept", headers=headers)
    assert accepted.status_code == 503
    await session_override.refresh(call)
    assert call.status == "ringing"


@pytest.mark.asyncio
async def test_calls_stay_off_without_the_flag(client: AsyncClient, session_override, monkeypatch):
    headers = await _login(client)
    monkeypatch.setattr(get_settings(), "agent_calls_enabled", False)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user.last_seen_at = datetime.utcnow()
    user.away = False
    session_override.add(user)
    await session_override.commit()
    monkeypatch.setattr(
        "app.services.agent_calls.connected_user_ids_for",
        lambda _tenant_id: {str(user.id)},
    )
    decision = await _open_decision(session_override, user=user, tenant=tenant)
    assert await maybe_ring_for_decision(session_override, tenant.id, decision) is None
    assert await expire_rings(session_override) == 0
    hidden = await client.get("/api/calls/ringing", headers=headers)
    assert hidden.status_code == 404
    me = await client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["agent_calls_enabled"] is False
