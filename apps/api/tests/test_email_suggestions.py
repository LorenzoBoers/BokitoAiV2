"""Tests for suggest-mode inbound AI reply suggestions."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.services.channel_ai import resolve_ai_mode
from app.services.inbound_agent import create_reply_suggestion, persist_inbound_agent_reply


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_email_inbound_creates_suggestion_not_auto_send(client: AsyncClient, session_override):
    await _auth_headers(client)  # ensures the seeded tenant exists via login
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    account = (
        await session_override.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant.id,
                ChannelAccount.channel == "email",
            )
        )
    ).scalar_one()

    from app.models.agent import Agent

    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalars().first()
    assert agent is not None

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Invoice question",
        contact_email="customer@example.com",
        channel_account_id=account.id,
        status="open",
    )
    session_override.add(signal)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            kind="user_message",
            direction="inbound",
            role="user",
            body_text="Can you explain my invoice?",
            body_preview="Can you explain my invoice?",
            from_address="customer@example.com",
        )
    )
    await session_override.commit()

    result = await persist_inbound_agent_reply(
        session_override,
        tenant.id,
        signal,
        agent,
        reply_text="Thanks for your message. Here is an explanation of your invoice.",
    )
    assert result.get("suggestion") is True
    assert result.get("delivery") == "pending_approval"
    assert "decision_id" in result

    decision = await session_override.get(DecisionRequest, __import__("uuid").UUID(result["decision_id"]))
    assert decision is not None
    assert decision.status == "awaiting_human"
    options = json.loads(decision.options_json)
    assert any(o.get("id") == "send" and o.get("action_type") == "send_reply" for o in options)
    assert any(o.get("id") == "edit" for o in options)
    assert any(o.get("id") == "escalate" for o in options)

    outbound = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.direction == "outbound",
                SignalMessage.kind != "decision_request",
            )
        )
    ).scalars().all()
    assert outbound == []


@pytest.mark.asyncio
async def test_resolve_ai_mode_precedence(session_override):
    tenant = Tenant(slug="mode-test", name="Mode Test", settings_json="{}")

    # Built-in defaults.
    assert resolve_ai_mode(tenant, None, "email") == "suggest"
    assert resolve_ai_mode(tenant, None, "widget") == "auto"
    assert resolve_ai_mode(None, None, "whatsapp") == "suggest"

    # Tenant-level channel_ai_modes override the defaults.
    tenant.settings_json = json.dumps({"channel_ai_modes": {"widget": "suggest", "email": "off"}})
    assert resolve_ai_mode(tenant, None, "widget") == "suggest"
    assert resolve_ai_mode(tenant, None, "email") == "off"

    # Account-level ai_config.mode wins over tenant settings.
    account = ChannelAccount(
        tenant_id=__import__("uuid").uuid4(),
        channel="email",
        provider="mock",
        address="a@b.com",
        settings_json=json.dumps({"ai_config": {"mode": "auto"}}),
    )
    assert resolve_ai_mode(tenant, account, "email") == "auto"

    # Legacy per-mailbox suggestions toggle maps to off.
    account.settings_json = json.dumps({"ai_config": {"suggestions_enabled": False}})
    assert resolve_ai_mode(tenant, account, "email") == "off"


@pytest.mark.asyncio
async def test_ai_paused_skips_suggestion(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    from app.models.agent import Agent

    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalars().first()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Paused",
        contact_email="c@test.com",
        ai_paused=True,
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()

    result = await persist_inbound_agent_reply(
        session_override,
        tenant.id,
        signal,
        agent,
        reply_text="This should not become a suggestion.",
    )
    assert result.get("skipped") is True


@pytest.mark.asyncio
async def test_resolve_send_option_with_edited_body(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    from app.models.agent import Agent

    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalars().first()
    account = (
        await session_override.execute(
            select(ChannelAccount).where(ChannelAccount.tenant_id == tenant.id)
        )
    ).scalars().first()

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Need reply",
        contact_email="customer@example.com",
        channel_account_id=account.id if account else None,
        status="open",
    )
    session_override.add(signal)
    await session_override.flush()
    result = await create_reply_suggestion(
        session_override,
        tenant.id,
        signal,
        agent,
        reply_text="Original draft reply.",
    )
    message_id = result["message_id"]

    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{message_id}/resolve",
        headers=headers,
        json={
            "action": "approved",
            "option_id": "send",
            "body": "Edited draft reply that should be sent.",
        },
    )
    assert resolve.status_code == 200

    decision = await session_override.get(DecisionRequest, __import__("uuid").UUID(result["decision_id"]))
    await session_override.refresh(decision)
    assert decision.status == "approved"
    assert decision.chosen_option_id == "send"


@pytest.mark.asyncio
async def test_resolve_escalate_pauses_ai(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    from app.models.agent import Agent
    from app.models.signal import SignalEvent

    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalars().first()

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Need human",
        contact_email="customer@example.com",
        status="open",
        ai_paused=False,
    )
    session_override.add(signal)
    await session_override.flush()
    result = await create_reply_suggestion(
        session_override,
        tenant.id,
        signal,
        agent,
        reply_text="Draft that will be escalated.",
    )
    message_id = result["message_id"]

    resolve = await client.post(
        f"/api/signals/{signal.id}/messages/{message_id}/resolve",
        headers=headers,
        json={"action": "rejected", "option_id": "escalate"},
    )
    assert resolve.status_code == 200

    await session_override.refresh(signal)
    assert signal.ai_paused is True
    events = (
        await session_override.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == signal.id, SignalEvent.event_type == "escalated"
            )
        )
    ).scalars().all()
    assert len(events) >= 1


@pytest.mark.asyncio
async def test_ai_modes_settings_roundtrip(client: AsyncClient):
    headers = await _auth_headers(client)

    got = await client.get("/api/settings/ai-modes", headers=headers)
    assert got.status_code == 200
    modes = got.json()["channel_ai_modes"]
    assert modes["email"] in ("suggest", "auto", "off")
    assert modes["widget"] in ("suggest", "auto", "off")

    saved = await client.put(
        "/api/settings/ai-modes",
        headers=headers,
        json={"channel_ai_modes": {"widget": "suggest"}},
    )
    assert saved.status_code == 200
    assert saved.json()["channel_ai_modes"]["widget"] == "suggest"

    got = await client.get("/api/settings/ai-modes", headers=headers)
    assert got.json()["channel_ai_modes"]["widget"] == "suggest"

    invalid = await client.put(
        "/api/settings/ai-modes",
        headers=headers,
        json={"channel_ai_modes": {"widget": "sometimes"}},
    )
    assert invalid.status_code == 400


@pytest.mark.asyncio
async def test_draft_endpoint_returns_text(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()

    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="mock",
        subject="Refund request",
        contact_email="customer@example.com",
        status="open",
    )
    session_override.add(signal)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            kind="user_message",
            direction="inbound",
            role="user",
            body_text="I would like a refund for my last order.",
            body_preview="I would like a refund for my last order.",
            from_address="customer@example.com",
        )
    )
    await session_override.commit()

    resp = await client.post(f"/api/signals/{signal.id}/draft", headers=headers, json={})
    assert resp.status_code == 200
    payload = resp.json()
    assert isinstance(payload.get("draft"), str)
    assert payload["draft"].strip() != ""

    # Draft-only: nothing was sent or persisted on the thread.
    outbound = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.direction == "outbound",
            )
        )
    ).scalars().all()
    assert outbound == []


@pytest.mark.asyncio
async def test_email_list_hides_mock_accounts(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    # Seed fixture may include a mock account; list endpoint must hide it.
    mock = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        provider="mock",
        address="phantom@bokito.ai",
        is_enabled=True,
        credentials_json="{}",
    )
    session_override.add(mock)
    await session_override.commit()

    resp = await client.get("/api/email/accounts", headers=headers)
    assert resp.status_code == 200
    rows = resp.json()
    assert all(r.get("provider") in ("gmail", "outlook") for r in rows)
    assert all(r.get("email_address") != "phantom@bokito.ai" for r in rows)
