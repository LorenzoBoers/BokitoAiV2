"""Managed Communication contract: ai_handling, scoped decisions, previews."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.channel import ChannelAccount
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.services import signal_threads as threads_svc
from app.services.ai_handling import resolve_ai_handling


@pytest.mark.asyncio
async def test_serialize_thread_includes_ai_handling(client: AsyncClient, session_override):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    account = ChannelAccount(
        tenant_id=tenant.id,
        channel="email",
        address="support@test.local",
        provider="gmail",
        settings_json=json.dumps({"ai_config": {"ai_handling": {"mode": "autonomous"}}}),
    )
    session_override.add(account)
    await session_override.flush()
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Mode test",
        channel_account_id=account.id,
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()

    handling = resolve_ai_handling(tenant, account, None, signal)
    assert handling.requested == "autonomous"
    assert handling.source == "channel"
    payload = threads_svc.serialize_thread(signal, ai_handling=handling.to_payload())
    assert payload["ai_handling"]["requested"] == "autonomous"
    assert "ai_paused" not in payload


@pytest.mark.asyncio
async def test_latest_previews_prefer_non_placeholder(client: AsyncClient, session_override):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    signal = Signal(tenant_id=tenant.id, channel="email", subject="Preview", status="open")
    session_override.add(signal)
    await session_override.flush()
    older = datetime.utcnow() - timedelta(minutes=5)
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            kind="user_message",
            direction="inbound",
            role="user",
            body_text="Real customer question about billing",
            body_preview="Real customer question about billing",
            created_at=older,
        )
    )
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            kind="agent_message",
            direction="outbound",
            role="assistant",
            body_text="[mock] I received your message about: billing",
            body_preview="[mock] I received your message about: billing",
            created_at=datetime.utcnow(),
        )
    )
    await session_override.commit()

    previews = await threads_svc._latest_message_previews(
        session_override, tenant.id, [signal.id]
    )
    snippet, direction, by_agent = previews[signal.id]
    assert "billing" in snippet.lower() or "customer" in snippet.lower()
    assert direction in ("inbound", "outbound")
    assert by_agent is False


@pytest.mark.asyncio
async def test_latest_preview_flags_agent_author(client: AsyncClient, session_override):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = Agent(tenant_id=tenant.id, name="Desk", role="assistant")
    signal = Signal(tenant_id=tenant.id, channel="website_chat", subject="Agent reply", status="open")
    session_override.add_all([agent, signal])
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            kind="agent_message",
            direction="outbound",
            role="assistant",
            author_agent_id=agent.id,
            body_text="Your order ships tomorrow.",
            body_preview="Your order ships tomorrow.",
        )
    )
    await session_override.commit()

    previews = await threads_svc._latest_message_previews(session_override, tenant.id, [signal.id])
    snippet, direction, by_agent = previews[signal.id]
    assert "ships" in snippet
    assert direction == "outbound"
    assert by_agent is True
    assert threads_svc.serialize_thread(signal, last_by_agent=by_agent)["last_message_by_agent"] is True


@pytest.mark.asyncio
async def test_open_decisions_scoped_to_page_ids(client: AsyncClient, session_override):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User).limit(1))).scalar_one()

    in_page = Signal(tenant_id=tenant.id, channel="email", subject="In page", status="open")
    out_page = Signal(tenant_id=tenant.id, channel="email", subject="Out of page", status="open")
    session_override.add(in_page)
    session_override.add(out_page)
    await session_override.flush()

    for signal in (in_page, out_page):
        decision = DecisionRequest(
            tenant_id=tenant.id,
            title="Approve reply",
            summary="Send this",
            options_json=json.dumps(
                [{"id": "send", "label": "Send", "action_type": "send_reply"}]
            ),
            status="awaiting_human",
            signal_id=signal.id,
        )
        session_override.add(decision)
        await session_override.flush()
        session_override.add(
            SignalMessage(
                signal_id=signal.id,
                tenant_id=tenant.id,
                kind="decision_request",
                direction="internal",
                role="assistant",
                body_text="Suggested reply",
                decision_id=decision.id,
            )
        )
    await session_override.commit()

    scoped = await threads_svc._signals_with_open_decisions(
        session_override, tenant.id, signal_ids=[in_page.id]
    )
    assert in_page.id in scoped
    assert out_page.id not in scoped

    assert await threads_svc._signal_has_open_decision(
        session_override, tenant.id, in_page.id
    )
    counts = await threads_svc.attention_counts(session_override, tenant.id)
    assert counts["decisions"] >= 2
    _ = user


@pytest.mark.asyncio
async def test_list_messages_paginated(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    conv = await client.post(
        "/api/signals/conversations", json={"title": "Paged"}, headers=headers
    )
    conv_id = conv.json()["id"]
    listed = await client.get(
        f"/api/signals/conversations/{conv_id}/messages?limit=5", headers=headers
    )
    assert listed.status_code == 200
    body = listed.json()
    assert "items" in body
    assert "has_older" in body
    assert isinstance(body["items"], list)


@pytest.mark.asyncio
async def test_thread_detail_exposes_ai_handling(client: AsyncClient, session_override):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    signal = Signal(
        tenant_id=tenant.id,
        channel="widget",
        subject="Widget chat",
        status="open",
        contact_name="Visitor",
    )
    session_override.add(signal)
    await session_override.commit()

    detail = await client.get(f"/api/signals/{signal.id}", headers=headers)
    assert detail.status_code == 200
    thread = detail.json()["thread"]
    assert thread["ai_handling"]["effective"] in ("manual", "assisted", "autonomous")
    assert thread["ai_handling"]["source"] in ("workspace", "channel", "contact", "conversation")


@pytest.mark.asyncio
async def test_schedule_agent_reply_returns_before_generate(monkeypatch):
    """HTTP path schedules background work; generate runs after the handler returns."""
    import asyncio

    finished = asyncio.Event()
    calls: list[str] = []
    tenant_id = uuid4()
    signal_id = uuid4()

    async def fake_generate(*_args, **_kwargs):
        calls.append("generate_start")
        await asyncio.sleep(0.05)
        calls.append("generate_done")
        finished.set()

    monkeypatch.setattr(threads_svc, "_generate_agent_reply", fake_generate)

    class _FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, *_a, **_k):
            class _Sig:
                pass

            sig = _Sig()
            sig.tenant_id = tenant_id
            return sig

    class _Factory:
        def __call__(self):
            return _FakeSession()

    monkeypatch.setattr("app.db.session.async_session_factory", _Factory())
    threads_svc._schedule_agent_reply(tenant_id, uuid4(), signal_id)
    assert "generate_done" not in calls
    await asyncio.wait_for(finished.wait(), timeout=3.0)
    assert calls == ["generate_start", "generate_done"]


@pytest.mark.asyncio
async def test_schedule_agent_reply_coalesces_bursts(monkeypatch):
    """Stacked Ja/Nee must not spawn one agent turn per click."""
    import asyncio

    finished = asyncio.Event()
    calls: list[str] = []
    tenant_id = uuid4()
    signal_id = uuid4()
    user_id = uuid4()

    async def fake_generate(*_args, **_kwargs):
        calls.append("generate")
        finished.set()

    monkeypatch.setattr(threads_svc, "_generate_agent_reply", fake_generate)

    class _FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, *_a, **_k):
            class _Sig:
                pass

            sig = _Sig()
            sig.tenant_id = tenant_id
            return sig

    class _Factory:
        def __call__(self):
            return _FakeSession()

    monkeypatch.setattr("app.db.session.async_session_factory", _Factory())
    monkeypatch.setattr(threads_svc, "_AGENT_REPLY_COALESCE_S", 0.05)
    threads_svc._schedule_agent_reply(tenant_id, user_id, signal_id)
    threads_svc._schedule_agent_reply(tenant_id, user_id, signal_id)
    threads_svc._schedule_agent_reply(tenant_id, user_id, signal_id)
    await asyncio.wait_for(finished.wait(), timeout=2.0)
    await asyncio.sleep(0.08)
    assert calls == ["generate"]
