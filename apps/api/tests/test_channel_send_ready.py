"""Inbound AI must not draft/auto-send when the channel cannot deliver."""

from __future__ import annotations

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.channels.outbound import deliver_outbound
from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.channel_registry import account_can_send, can_send, resolve_channel
from app.services.inbound_agent import persist_inbound_agent_reply
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_account_can_send_false_without_credentials():
    account = ChannelAccount(
        channel="email",
        provider="outlook",
        address="noreply@example.com",
        display_name="Broken",
    )
    row = resolve_channel(account)
    assert row["state"] == "action_required"
    assert can_send(row) is False
    assert account_can_send(account) is False


def test_account_can_send_true_when_connecting_with_credentials():
    account = ChannelAccount(
        channel="email",
        provider="gmail",
        address="ready@example.com",
        display_name="Ready",
        credentials_json=json.dumps({"access_token": "tok"}),
    )
    assert account_can_send(account) is True


def test_account_can_send_false_when_disabled():
    account = ChannelAccount(
        channel="email",
        provider="gmail",
        address="paused@example.com",
        display_name="Paused",
        is_enabled=False,
        credentials_json=json.dumps({"access_token": "tok"}),
    )
    assert account_can_send(account) is False
    assert account_can_send(None) is False


@pytest.mark.asyncio
async def test_deliver_outbound_rejects_non_sendable_account(client: AsyncClient, session_override):
    await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        provider="outlook",
        address="broken@example.com",
        display_name="Broken mailbox",
        # No credentials → action_required → cannot send.
    )
    session_override.add(account)
    await session_override.flush()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="test",
        subject="Hello",
        contact_email="customer@example.com",
        channel_account_id=account.id,
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()

    result = await deliver_outbound(session_override, signal, body_text="Thanks.")
    assert result.status == "failed:cannot_send"


@pytest.mark.asyncio
async def test_persist_suggest_skips_when_channel_cannot_send(client: AsyncClient, session_override):
    await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalars().first()
    assert agent is not None

    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        provider="outlook",
        address="setup@example.com",
        display_name="Needs setup",
    )
    session_override.add(account)
    await session_override.flush()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="test",
        subject="Quote request",
        contact_email="buyer@example.com",
        channel_account_id=account.id,
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()

    result = await persist_inbound_agent_reply(
        session_override,
        tenant.id,
        signal,
        agent,
        reply_text="Thanks for your request. Happy to help.",
        mode="suggest",
    )
    assert result.get("kind") == "channel_not_ready"
    assert result.get("delivery") == "channel_not_ready"

    decisions = (
        await session_override.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == signal.id)
        )
    ).scalars().all()
    assert decisions == []

    notes = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.kind == "internal_note",
            )
        )
    ).scalars().all()
    assert len(notes) == 1
    assert "cannot send" in (notes[0].body_text or "").lower()

    events = (
        await session_override.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == signal.id,
                SignalEvent.event_type == "channel_not_ready",
            )
        )
    ).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_persist_auto_skips_customer_bubble_when_channel_cannot_send(
    client: AsyncClient, session_override
):
    await _login(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalars().first()
    assert agent is not None

    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        provider="outlook",
        address="blocked-auto@example.com",
        display_name="Blocked auto",
    )
    session_override.add(account)
    await session_override.flush()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="test",
        subject="Need help",
        contact_email="person@example.com",
        channel_account_id=account.id,
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()

    result = await persist_inbound_agent_reply(
        session_override,
        tenant.id,
        signal,
        agent,
        reply_text="We will get back to you shortly.",
        mode="auto",
    )
    assert result.get("reason") in ("credentials", "cannot_send", "action_required") or result.get(
        "kind"
    ) == "channel_not_ready"
    assert result.get("delivery") == "channel_not_ready"

    outbound = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.direction == "outbound",
            )
        )
    ).scalars().all()
    assert outbound == []

    notes = (
        await session_override.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.kind == "internal_note",
            )
        )
    ).scalars().all()
    assert len(notes) == 1
