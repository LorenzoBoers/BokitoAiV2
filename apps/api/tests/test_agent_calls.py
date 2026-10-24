"""Agent calls ring only for an available addressee and never close the card."""

import asyncio
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.agent_call import AgentCall
from app.models.auth import Tenant, User
from app.models.notification import DecisionRequest
from app.models.signal import Signal
from app.config import get_settings
from app.exceptions import AppError
from app.services.agent_calls import (
    choice_action,
    end_call,
    expire_rings,
    match_option,
    maybe_ring_for_decision,
    resume_call,
    run_call_tool,
    start_voice_call,
    update_call_settings,
)
from app.services.agent_call_voice import (
    _TOOLS,
    apply_agent_call_defaults,
    preview_call_voice,
    resolve_call_prefs,
    voice_instructions,
)
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


@pytest.fixture(autouse=True)
def _calls_on(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(get_settings(), "agent_calls_enabled", True)
    # Quiet hours (default 22:00-07:00) must not make these tests time-of-day flaky.
    monkeypatch.setattr("app.services.reach.in_quiet_hours", lambda *_a, **_k: False)


def test_choice_maps_reject_and_approve():
    approve = {"id": "approve", "label": "Yes"}
    reject = {"id": "reject", "label": "No"}
    assert choice_action(approve) == "approved"
    assert choice_action(reject) == "rejected"
    options = [approve, reject]
    assert match_option(options, option_id="reject", label=None)["label"] == "No"
    assert match_option(options, option_id=None, label="Yes")["id"] == "approve"
    assert match_option(options, option_id="missing", label="missing") is None


def test_voice_speaks_the_profile_language():
    dutch = voice_instructions(
        agent_name="Bokito",
        title="Send the invoice?",
        summary="",
        options=[],
        language="nl",
    )
    english = voice_instructions(
        agent_name="Bokito",
        title="Send the invoice?",
        summary="",
        options=[],
        language="en",
    )
    assert "Speak only Dutch" in dutch
    assert "Speak only English" in english
    assert "Speak only English" not in dutch
    assert "only voice on this call" in dutch
    assert "Answer from the conversation" in dutch
    assert "Do not say you are looking" in dutch
    assert "say you are checking" not in dutch
    grounded = voice_instructions(
        agent_name="Bokito",
        title="",
        summary="",
        options=[],
        conversation=True,
        thread="Person: Twee tickets staan open.",
        learned="Q: tickets\nA: Twee open.",
    )
    assert "Twee tickets staan open." in grounded
    assert "Do not look them up again" in grounded
    consult = next(tool for tool in _TOOLS if tool["name"] == "consult_run")
    assert "Say nothing while this runs." in consult["description"]


@pytest.mark.asyncio
async def test_one_consult_per_call(monkeypatch: pytest.MonkeyPatch):
    from app.services import agent_calls

    agent_calls._consulting.clear()

    async def _quiet(_call_id, _question):
        await asyncio.sleep(0.05)

    monkeypatch.setattr(agent_calls, "_consult_run", _quiet)
    call_id = uuid4()
    assert agent_calls._schedule_consult(call_id, "Wat staat er open?") is True
    assert agent_calls._schedule_consult(call_id, "Nog een keer") is False
    assert agent_calls._spoken_for_call("Kort antwoord.") == "Kort antwoord."
    long = "Eerste zin. " + ("woord " * 90)
    spoken = agent_calls._spoken_for_call(long)
    assert len(spoken) < 400
    assert spoken.endswith(".")
    await asyncio.sleep(0.1)
    assert call_id not in agent_calls._consulting


@pytest.mark.asyncio
async def test_consult_timeout_then_remembers_the_answer(client: AsyncClient, session_override, monkeypatch):
    await _login(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user.settings_json = '{"ui_language": "nl"}'
    session_override.add(user)
    agent = Agent(tenant_id=tenant.id, name="Extra test agent")
    session_override.add(agent)
    await session_override.flush()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="internal",
        subject="Naamloze chat",
        status="open",
        agent_id=agent.id,
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    async def fake_secret(instructions: str, *, language: str = "nl", **_extra: object) -> dict[str, str]:
        return {"value": "sek"}

    monkeypatch.setattr("app.services.agent_call_voice.create_realtime_secret", fake_secret)
    started = await start_voice_call(session_override, tenant.id, user.id, signal.id)
    from app.services import agent_calls

    heard: dict[str, str] = {}

    async def slow(*_args, **_kwargs):
        await asyncio.sleep(1)
        return {"text": "te laat"}

    async def capture(_call, **kwargs):
        heard["text"] = str(kwargs.get("text") or "")
        heard["instructions"] = str(kwargs.get("instructions") or "")

    monkeypatch.setattr(agent_calls, "CONSULT_SECONDS", 0.05)
    monkeypatch.setattr("app.services.chat_runtime.start_agent_turn", slow)
    monkeypatch.setattr(agent_calls, "publish_call", capture)
    await agent_calls._consult_on(session_override, UUID(started["call_id"]), "Welke tickets?")
    assert heard["text"] == "Dat heb ik nu niet bij de hand."
    assert "Facts you already looked up" not in heard["instructions"]

    async def fast(*_args, **_kwargs):
        return {"text": "Er staan twee tickets open."}

    monkeypatch.setattr("app.services.chat_runtime.start_agent_turn", fast)
    monkeypatch.setattr(agent_calls, "CONSULT_SECONDS", 20)
    await agent_calls._consult_on(session_override, UUID(started["call_id"]), "Welke tickets?")
    assert "twee tickets" in heard["text"].lower()
    assert "twee tickets" in heard["instructions"].lower()


@pytest.mark.asyncio
async def test_no_second_call_while_one_is_open(client: AsyncClient, session_override, monkeypatch):
    await _login(client)
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
    first_decision = await _open_decision(session_override, user=user, tenant=tenant)
    assert await maybe_ring_for_decision(session_override, tenant.id, first_decision) is None


@pytest.mark.asyncio
async def test_voice_mode_starts_a_live_line(client: AsyncClient, session_override, monkeypatch):
    await _login(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user.settings_json = '{"ui_language": "nl"}'
    session_override.add(user)
    agent = Agent(tenant_id=tenant.id, name="Extra test agent")
    session_override.add(agent)
    await session_override.flush()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="internal",
        subject="Naamloze chat",
        status="open",
        agent_id=agent.id,
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    seen: dict[str, str] = {}

    async def fake_secret(instructions: str, *, language: str = "nl", **_extra: object) -> dict[str, str]:
        seen["text"] = instructions
        seen["language"] = language
        return {"value": "sek"}

    monkeypatch.setattr("app.services.agent_call_voice.create_realtime_secret", fake_secret)
    payload = await start_voice_call(session_override, tenant.id, user.id, signal.id)
    assert payload["status"] == "live"
    assert payload["client_secret"] == "sek"
    assert payload["decision_id"] is None
    assert "voice mode" in seen["text"]
    assert seen["language"] == "nl"
    with pytest.raises(AppError) as raised:
        await start_voice_call(session_override, tenant.id, user.id, signal.id)
    assert raised.value.status_code == 409
    text = voice_instructions(
        agent_name="Bokito",
        title="Send the invoice?",
        summary="Customer asked today.",
        options=[{"id": "approve", "label": "Send"}, {"id": "reject", "label": "Hold"}],
    )
    assert "Bokito" in text
    assert "Send the invoice?" in text
    assert "id: approve" in text
    assert "Speak only Dutch" in text
    names = {tool["name"] for tool in _TOOLS}
    assert names == {"consult_run", "confirm_choice", "hang_up"}
    assert "hang_up" in text


@pytest.mark.asyncio
async def test_second_tab_cannot_open_the_voice_line(client, session_override, monkeypatch):
    _ = client  # seeds the test tenant and user
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    agent = Agent(tenant_id=tenant.id, name="Extra test agent")
    session_override.add(agent)
    await session_override.flush()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="internal",
        subject="Naamloze chat",
        status="open",
        agent_id=agent.id,
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    async def fake_secret(*_args, **_kwargs):
        return {"value": "sek"}

    monkeypatch.setattr("app.services.agent_call_voice.create_realtime_secret", fake_secret)
    started = await start_voice_call(
        session_override, tenant.id, user.id, signal.id, client_id="tab-a"
    )
    call_id = UUID(started["call_id"])
    same = await resume_call(session_override, tenant.id, user.id, call_id, client_id="tab-a")
    assert same["client_secret"] == "sek"
    with pytest.raises(AppError) as raised:
        await resume_call(session_override, tenant.id, user.id, call_id, client_id="tab-b")
    assert raised.value.status_code == 409
    assert "another tab" in str(raised.value.detail)
    stale = await session_override.get(AgentCall, call_id)
    assert stale is not None
    stale.voice_seen_at = datetime.utcnow() - timedelta(seconds=120)
    await session_override.flush()
    taken = await resume_call(session_override, tenant.id, user.id, call_id, client_id="tab-b")
    assert taken["client_secret"] == "sek"


@pytest.mark.asyncio
async def test_call_settings_language_speed_and_voice(client: AsyncClient, session_override, monkeypatch):
    await _login(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user.settings_json = '{"ui_language": "nl"}'
    session_override.add(user)
    agent = Agent(tenant_id=tenant.id, name="Extra test agent")
    session_override.add(agent)
    await session_override.flush()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="internal",
        subject="Naamloze chat",
        status="open",
        agent_id=agent.id,
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    seen: dict[str, object] = {}

    async def fake_secret(instructions: str, *, language: str = "nl", voice: str | None = None, speed: float | None = None, **_extra: object) -> dict[str, str]:
        seen["text"] = instructions
        seen["language"] = language
        seen["voice"] = voice
        seen["speed"] = speed
        return {"value": "sek2"}

    monkeypatch.setattr("app.services.agent_call_voice.create_realtime_secret", fake_secret)
    started = await start_voice_call(session_override, tenant.id, user.id, signal.id)
    call_id = UUID(started["call_id"])
    assert started["language"] == "nl"
    assert started["speed"] == 1.0
    assert any(row["id"] == "marin" for row in started["voices"])

    tuned = await update_call_settings(
        session_override,
        tenant.id,
        user.id,
        call_id,
        language="en",
        speed=1.25,
    )
    assert tuned["reconnect"] is False
    assert tuned["language"] == "en"
    assert tuned["speed"] == 1.25
    assert "Speak only English" in tuned["instructions"]
    assert "client_secret" not in tuned

    voiced = await update_call_settings(
        session_override,
        tenant.id,
        user.id,
        call_id,
        voice="cedar",
    )
    assert voiced["reconnect"] is True
    assert voiced["voice"] == "cedar"
    assert voiced["client_secret"] == "sek2"
    assert seen["voice"] == "cedar"
    await session_override.refresh(user)
    await session_override.refresh(agent)
    assert "cedar" in (user.settings_json or "")
    assert "call_overrides" in (user.settings_json or "")
    assert "cedar" not in (agent.settings_json or "")
    overridden = resolve_call_prefs(
        user.settings_json, agent_settings=agent.settings_json, agent_id=agent.id
    )
    assert overridden["voice"] == "cedar"
    assert overridden["language"] == "en"

    with pytest.raises(AppError) as raised:
        await update_call_settings(
            session_override,
            tenant.id,
            user.id,
            call_id,
            voice="aurora",
        )
    assert raised.value.status_code == 422


@pytest.mark.asyncio
async def test_call_starts_on_the_agent_voice(client, session_override, monkeypatch):
    _ = client  # seeds the test tenant and user
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user.settings_json = '{"ui_language": "nl", "call_voice": "alloy"}'
    session_override.add(user)
    agent = Agent(
        tenant_id=tenant.id,
        name="Extra test agent",
        settings_json='{"call_voice": "sage", "call_speed": 0.75, "call_language": "en"}',
    )
    session_override.add(agent)
    await session_override.flush()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="internal",
        subject="Naamloze chat",
        status="open",
        agent_id=agent.id,
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)

    async def fake_secret(*_args, **_kwargs):
        return {"value": "sek"}

    monkeypatch.setattr("app.services.agent_call_voice.create_realtime_secret", fake_secret)
    started = await start_voice_call(session_override, tenant.id, user.id, signal.id)
    assert started["voice"] == "sage"
    assert started["speed"] == 0.75
    assert started["language"] == "en"
    heard = resolve_call_prefs(
        '{"ui_language": "nl"}', agent_settings=agent.settings_json, agent_id=agent.id
    )
    assert heard["voice"] == "sage"


def test_agent_call_defaults_reject_an_unknown_voice():
    stored = apply_agent_call_defaults("{}", voice="marin", speed=1, language="nl")
    assert "marin" in stored
    with pytest.raises(ValueError):
        apply_agent_call_defaults(stored, voice="aurora")


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
    assert await maybe_ring_for_decision(session_override, tenant.id, decision) is None
    await session_override.refresh(decision)
    assert decision.status == "awaiting_human"
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
    assert await maybe_ring_for_decision(session_override, tenant.id, decision) is None
    assert await expire_rings(session_override) == 0
    await session_override.refresh(decision)
    assert decision.status == "awaiting_human"


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
        lambda: type("S", (), {"openai_api_key": "", "openai_realtime_model": "gpt-realtime-mini", "openai_realtime_voice": "marin", "agent_call_ring_seconds": 25})(),
    )
    decision = await _open_decision(session_override, user=user, tenant=tenant)
    assert await maybe_ring_for_decision(session_override, tenant.id, decision) is None
    await session_override.refresh(decision)
    assert decision.status == "awaiting_human"
    del headers


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


@pytest.mark.asyncio
async def test_hang_up_ends_the_live_call(client: AsyncClient, session_override):
    await _login(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    decision = await _open_decision(session_override, user=user, tenant=tenant)
    call = AgentCall(
        tenant_id=tenant.id,
        signal_id=decision.signal_id,
        decision_id=decision.id,
        user_id=user.id,
        status="live",
        answered_at=datetime.utcnow(),
    )
    session_override.add(call)
    await session_override.commit()
    await session_override.refresh(call)
    result = await run_call_tool(
        session_override,
        tenant.id,
        user.id,
        call.id,
        name="hang_up",
        arguments={"transcript": [{"role": "assistant", "text": "Tot zo."}]},
    )
    await session_override.commit()
    assert result["status"] == "ended"
    await session_override.refresh(call)
    assert call.status == "ended"
    assert call.ended_at is not None
    await end_call(
        session_override,
        tenant.id,
        user.id,
        call.id,
        transcript=[{"role": "user", "text": "Doei."}],
    )
    await session_override.commit()
    from app.models.signal import SignalMessage

    import json

    messages = (
        await session_override.execute(
            select(SignalMessage).where(SignalMessage.signal_id == decision.signal_id)
        )
    ).scalars().all()
    logs = [m for m in messages if m.kind == "system_event"]
    assert len(logs) == 1
    record = json.loads(logs[0].metadata_json)["call_log"]
    texts = [line["text"] for line in record["lines"]]
    assert "Tot zo." in texts
    assert "Doei." in texts
    assert isinstance(record["duration_seconds"], int)
    assert record["started_at"].endswith("Z")


@pytest.mark.asyncio
async def test_live_call_survives_reload(client: AsyncClient, session_override, monkeypatch):
    headers = await _login(client)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    user.settings_json = '{"ui_language": "nl"}'
    session_override.add(user)
    decision = await _open_decision(session_override, user=user, tenant=tenant)
    decision.status = "approved"
    session_override.add(decision)
    call = AgentCall(
        tenant_id=tenant.id,
        signal_id=decision.signal_id,
        decision_id=decision.id,
        user_id=user.id,
        status="live",
        answered_at=datetime.utcnow(),
    )
    session_override.add(call)
    await session_override.commit()
    await session_override.refresh(call)

    listed = await client.get("/api/calls/ringing", headers=headers)
    assert listed.status_code == 200
    body = listed.json()
    assert [row["call_id"] for row in body] == [str(call.id)]
    assert body[0]["status"] == "live"

    seen: dict[str, str] = {}

    async def fake_secret(instructions: str, *, language: str = "nl", **_extra: object) -> dict[str, str]:
        seen["text"] = instructions
        seen["language"] = language
        return {"value": "sek"}

    monkeypatch.setattr("app.services.agent_call_voice.create_realtime_secret", fake_secret)
    resumed = await client.post(f"/api/calls/{call.id}/resume", headers=headers, json={"client_id": ""})
    assert resumed.status_code == 200
    payload = resumed.json()
    assert payload["client_secret"] == "sek"
    assert payload["status"] == "live"
    assert "page reload" in seen["text"]
    assert "Speak only Dutch" in seen["text"]
    assert seen["language"] == "nl"
    await session_override.refresh(call)
    assert call.status == "live"

    ringing = AgentCall(
        tenant_id=tenant.id,
        signal_id=decision.signal_id,
        decision_id=decision.id,
        user_id=user.id,
        status="ringing",
    )
    session_override.add(ringing)
    await session_override.commit()
    await session_override.refresh(ringing)
    refused = await client.post(f"/api/calls/{ringing.id}/resume", headers=headers, json={"client_id": ""})
    assert refused.status_code == 409


@pytest.mark.asyncio
async def test_voice_preview_rejects_an_unknown_voice():
    with pytest.raises(AppError) as raised:
        await preview_call_voice(voice="aurora", speed=1, language="nl", name="Ada")
    assert raised.value.status_code == 422


def test_push_to_talk_waits_for_the_person():
    heard = voice_instructions(
        agent_name="Ada",
        title="",
        summary="",
        options=[],
        conversation=True,
        push_to_talk=True,
    )
    assert "holds a button" in heard
    assert "Open with one short sentence" not in heard

