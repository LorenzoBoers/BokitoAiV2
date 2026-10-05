"""Agent turns: chat bubbles, activity on messages, chat delivery, last active."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage
from app.services.agent.reply_mode import (
    CHAT,
    MAIL,
    format_for_channel,
    reply_mode_for,
    split_chat_messages,
)
from app.services.agent.turn_persist import (
    message_activity,
    plan_customer_bubbles,
    plan_turn_messages,
)
from app.services.chat_delivery import MAX_PAUSE_S, MIN_PAUSE_S, typing_pause
from app.services.signal_threads import message_delivered_to_customer
from app.services.suggestion_format import clean_chat_bubbles


def _work(item_id: str, **extra) -> dict:
    return {"id": item_id, "kind": "work", "label": item_id, "status": "ok", **extra}


def _segments() -> list[dict]:
    return [
        {"id": "s1", "text": "Let me check your order.", "activity": [_work("think-1", kind="think")]},
        {"id": "s2", "text": "", "activity": [_work("lookup")]},
        {
            "id": "s3",
            "text": "Found it.\n\nIt ships today.",
            "activity": [_work("status")],
        },
    ]


# ── reply modes ────────────────────────────────────────────────────────────


def test_reply_mode_per_channel():
    assert reply_mode_for("email") == MAIL
    assert reply_mode_for("whatsapp") == CHAT
    assert reply_mode_for("assistant") == CHAT
    assert reply_mode_for(None) == "document"


def test_split_chat_messages_merges_fragments_and_caps():
    assert split_chat_messages("Hi\n\nok") == ["Hi\nok"]
    parts = split_chat_messages("\n\n".join(f"part {i}" for i in range(7)), max_messages=5)
    assert len(parts) == 5
    assert parts[-1] == "part 4\n\npart 5\n\npart 6"
    assert split_chat_messages("Run:\n\n```\na\n\nb\n```") == ["Run:", "```\na\n\nb\n```"]


def test_format_for_channel_converts_markup():
    text = "## Status\n**Shipped** ~~late~~ see [track](https://x.test/t)\n\n---"
    assert format_for_channel(text, "whatsapp") == "*Status*\n*Shipped* ~late~ see track: https://x.test/t"
    assert "<https://x.test/t|track>" in format_for_channel(text, "slack")
    assert format_for_channel(text, "email") == text


# ── planning a turn ────────────────────────────────────────────────────────


def test_chat_turn_becomes_bubbles_with_activity_before_each():
    planned = plan_turn_messages(_segments(), CHAT)
    assert [b["text"] for b in planned] == ["Let me check your order.", "Found it.", "It ships today."]
    assert [a["id"] for a in planned[0]["activity"]] == ["think-1"]
    # Activity without speech carries to the next bubble with text.
    assert [a["id"] for a in planned[1]["activity"]] == ["lookup", "status"]
    assert planned[2]["activity"] == []


def test_mail_turn_is_one_message_and_earlier_speech_becomes_a_note():
    [message] = plan_turn_messages(_segments(), MAIL)
    assert message["text"] == "Found it.\n\nIt ships today."
    kinds = [(a["kind"], a.get("label")) for a in message["activity"]]
    assert ("other", "note") in kinds
    note = next(a for a in message["activity"] if a.get("label") == "note")
    assert note["text"] == "Let me check your order."


def test_trailing_activity_hangs_under_the_last_bubble():
    planned = plan_turn_messages(
        [{"id": "a", "text": "Done.", "activity": []}, {"id": "b", "text": "", "activity": [_work("log")]}],
        CHAT,
    )
    assert len(planned) == 1
    assert [a["id"] for a in planned[0]["activity_after"]] == ["log"]


def test_customer_bubbles_send_only_the_final_speech():
    bubbles = plan_customer_bubbles(_segments())
    assert [b["text"] for b in bubbles] == ["Found it.", "It ships today."]
    assert any(a.get("label") == "note" for a in bubbles[0]["activity"])
    assert bubbles[1]["activity"] == []


def test_empty_turn_falls_back():
    assert plan_turn_messages([], CHAT, fallback_text="Done.")[0]["text"] == "Done."


# ── activity on saved messages ─────────────────────────────────────────────


def test_message_activity_lean_drops_detail():
    meta = {"activity": [_work("x", input={"q": 1}, result={"ok": True}, text="t")]}
    lean = message_activity(meta, detail=False)["activity"][0]
    assert "input" not in lean and "result" not in lean and "text" not in lean
    full = message_activity(meta, detail=True)["activity"][0]
    assert full["input"] == {"q": 1}


def test_message_activity_lean_keeps_note_text():
    note = {"id": "n", "kind": "other", "label": "note", "status": "ok", "text": "Even de prijzen opzoeken."}
    lean = message_activity({"activity": [note]}, detail=False)["activity"][0]
    assert lean["text"] == "Even de prijzen opzoeken."


def test_message_activity_maps_legacy_steps_and_thinking():
    meta = {
        "thinking": {"text": "hmm", "ms": 1200},
        "steps": [
            {"step_type": "tool_call", "name": "search_index", "payload": {"input": {"q": "a"}}},
            {"step_type": "tool_result", "name": "search_index", "payload": {"result": {"error": "x"}}},
        ],
    }
    items = message_activity(meta, detail=True)["activity"]
    assert [i["kind"] for i in items] == ["think", "work"]
    assert items[0]["duration_ms"] == 1200
    assert items[1]["tool"] == "search_index"
    assert items[1]["status"] == "error"


# ── suggestion cleaning, pacing, delivery label ────────────────────────────


def test_clean_chat_bubbles_moves_internal_note_out():
    clean, note = clean_chat_bubbles(["Hi Ann", "Ships today.\nINTERNAL_NOTE: check stock", "later"])
    assert clean == ["Hi Ann", "Ships today."]
    assert "check stock" in note and "later" in note


def test_typing_pause_scales_and_clamps():
    assert typing_pause("") == MIN_PAUSE_S
    assert typing_pause("x" * 5000) == MAX_PAUSE_S
    assert MIN_PAUSE_S < typing_pause("x" * 100) < MAX_PAUSE_S


def test_internal_channels_are_never_delivered_to_a_customer():
    kwargs = {"direction": "outbound", "auto_sent": False, "send_status": None, "is_mock": False}
    for channel in ("assistant", "internal", "team"):
        assert message_delivered_to_customer(**kwargs, channel=channel) is False
    assert message_delivered_to_customer(**kwargs, channel="widget") is True


# ── DB-backed delivery ─────────────────────────────────────────────────────


async def _tenant_agent(session) -> tuple[Tenant, Agent]:
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (
        await session.execute(select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant"))
    ).scalars().first()
    assert agent is not None
    return tenant, agent


async def _login(client: AsyncClient) -> None:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_autonomous_whatsapp_reply_sends_bubbles_in_order(client: AsyncClient, session_override):
    from app.services.inbound_agent import _deliver_chat_reply

    await _login(client)
    tenant, agent = await _tenant_agent(session_override)
    signal = Signal(
        tenant_id=tenant.id,
        channel="whatsapp",
        source="test",
        subject="Order",
        contact_phone="+31600000000",
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()

    sent: list[str] = []

    async def fake_deliver(_session, _signal, *, body_text, subject=None, **_kw):
        sent.append(body_text)
        return SimpleNamespace(status="sent")

    pause = AsyncMock()
    with (
        patch("app.services.inbound_agent.deliver_outbound", new=fake_deliver),
        patch("app.services.chat_delivery.pause_before", new=pause),
    ):
        result = await _deliver_chat_reply(
            session_override,
            tenant.id,
            signal,
            agent,
            bubbles=[
                {"text": "Hi Ann", "activity": [_work("lookup")]},
                {"text": "**Shipped** today."},
                {"text": "Tracking follows."},
            ],
            run_id=None,
            tokens=None,
            is_mock_reply=False,
        )

    assert sent == ["Hi Ann", "*Shipped* today.", "Tracking follows."]
    assert pause.await_count == 2
    assert len(result["message_ids"]) == 3
    assert result["delivered_to_customer"] is True

    rows = (
        await session_override.execute(
            select(SignalMessage)
            .where(SignalMessage.signal_id == signal.id, SignalMessage.role == "assistant")
            .order_by(SignalMessage.created_at)
        )
    ).scalars().all()
    metas = [json.loads(r.metadata_json or "{}") for r in rows]
    assert [r.body_text for r in rows] == ["Hi Ann", "**Shipped** today.", "Tracking follows."]
    assert metas[0]["activity"][0]["id"] == "lookup"
    assert all("ai_disclosure" not in m for m in metas[1:])
    assert all(r.auto_sent for r in rows)

    agent_row = await session_override.get(Agent, agent.id)
    await session_override.refresh(agent_row)
    assert agent_row.last_active_at is not None


@pytest.mark.asyncio
async def test_failed_send_stops_the_remaining_bubbles(client: AsyncClient, session_override):
    from app.services.inbound_agent import _deliver_chat_reply

    await _login(client)
    tenant, agent = await _tenant_agent(session_override)
    signal = Signal(tenant_id=tenant.id, channel="whatsapp", source="test", subject="x", status="open")
    session_override.add(signal)
    await session_override.commit()

    calls: list[str] = []

    async def failing(_session, _signal, *, body_text, **_kw):
        calls.append(body_text)
        return SimpleNamespace(status="failed:provider")

    with (
        patch("app.services.inbound_agent.deliver_outbound", new=failing),
        patch("app.services.chat_delivery.pause_before", new=AsyncMock()),
    ):
        result = await _deliver_chat_reply(
            session_override,
            tenant.id,
            signal,
            agent,
            bubbles=[{"text": "First message"}, {"text": "Second message"}],
            run_id=None,
            tokens=None,
            is_mock_reply=False,
        )
    assert calls == ["First message"]
    assert result["delivered_to_customer"] is False


@pytest.mark.asyncio
async def test_assisted_chat_suggestion_keeps_bubbles(client: AsyncClient, session_override):
    from app.services.inbound_agent import create_reply_suggestion

    await _login(client)
    tenant, agent = await _tenant_agent(session_override)
    signal = Signal(tenant_id=tenant.id, channel="whatsapp", source="test", subject="x", status="open")
    session_override.add(signal)
    await session_override.commit()

    await create_reply_suggestion(
        session_override,
        tenant.id,
        signal,
        agent,
        reply_text="Hi Ann\n\nIt ships today.",
        messages=["Hi Ann", "It ships today.\nINTERNAL_NOTE: stock is low"],
    )
    decision = (
        await session_override.execute(select(DecisionRequest).where(DecisionRequest.signal_id == signal.id))
    ).scalars().one()
    options = json.loads(decision.options_json or "[]")
    send = next(o for o in options if o.get("id") == "send")
    assert send["payload"]["messages"] == ["Hi Ann", "It ships today."]
    assert "stock is low" not in json.dumps(send["payload"]["messages"])


@pytest.mark.asyncio
async def test_mark_agent_activity_sets_last_active(client: AsyncClient, session_override):
    from app.services.workforce_runtime import mark_agent_activity, serialize_agent

    await _login(client)
    _tenant, agent = await _tenant_agent(session_override)
    agent.last_active_at = None
    session_override.add(agent)
    await session_override.commit()
    assert serialize_agent(agent, view="runtime")["last_active_at"] is None

    from uuid import uuid4

    thread_id = uuid4()
    pub = AsyncMock()
    with patch("app.gateway.publish.publish_agent_status", new=pub):
        await mark_agent_activity(
            session_override,
            agent,
            status="working",
            summary="Working",
            signal_id=thread_id,
        )
    payload = serialize_agent(agent, view="runtime")
    assert isinstance(payload["last_active_at"], int) and payload["last_active_at"] > 0
    assert payload["current_thread_id"] == str(thread_id)
    kwargs = pub.await_args.kwargs
    assert kwargs["status"] == "working"
    assert kwargs["summary"] == "Working"
    assert kwargs["thread_id"] == str(thread_id)


# ── widget stream ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_widget_stream_breaks_bubbles_between_segments(client: AsyncClient):
    start = await client.post(
        "/api/livechat/session/start",
        json={"agent_slug": "assistant", "auth_mode": "optional", "tenant_subdomain": "test"},
    )
    assert start.status_code == 200
    token = start.json()["session_token"]

    async def fake_stream(self, messages, extra_context="", attachments=None):
        yield {"type": "delta", "text": "Let me check.", "segment_id": "a"}
        yield {"type": "delta", "text": "It ships today.", "segment_id": "b"}
        yield {"type": "done", "text": "It ships today.", "usage": {}}

    frames: list[dict] = []
    with patch("app.services.agent.loop.AgentLoop.stream_chat", new=fake_stream):
        async with client.stream(
            "POST",
            "/api/livechat/stream-chat",
            headers={"Authorization": f"Bearer {token}"},
            json={"message_content": "Where is my order?", "conversation_id": "conv_turn_test"},
        ) as response:
            assert response.status_code == 200
            async for line in response.aiter_lines():
                if line.startswith("data:"):
                    frames.append(json.loads(line[5:].strip()))

    kinds = [f.get("type") or ("token" if "t" in f else "?") for f in frames]
    assert "message_break" in kinds
    assert kinds.index("message_break") < len(kinds) - 1
    done = frames[-1]
    assert done["type"] == "done"
    assert isinstance(done.get("messages"), list) and done["messages"]


# ── wait-for-OK card placement ─────────────────────────────────────────────


def test_decision_ids_are_read_from_nested_activity_results():
    from app.services.agent.turn_persist import decision_ids_in_activity

    meta = {
        "activity": [
            {"id": "list", "result": {"items": []}},
            {
                "id": "restore",
                "result": {"asked": {"decision_request_id": "dec-1", "status": "awaiting_human"}},
            },
        ]
    }
    assert decision_ids_in_activity(meta) == {"dec-1"}


@pytest.mark.asyncio
async def test_wait_for_ok_card_sits_after_the_tool_bubble(client: AsyncClient, session_override):
    from datetime import datetime, timedelta

    from app.models.notification import DecisionRequest
    from app.services.agent.reply_mode import CHAT
    from app.services.agent.turn_persist import persist_agent_turn

    await _login(client)
    tenant, agent = await _tenant_agent(session_override)
    signal = Signal(tenant_id=tenant.id, channel="internal", source="test", subject="Bin", status="open")
    session_override.add(signal)
    await session_override.flush()
    early = datetime.utcnow() - timedelta(seconds=5)
    user = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="chat",
        role="user",
        body_text="Zet dat item terug",
        received_at=early,
    )
    decision = DecisionRequest(tenant_id=tenant.id, title="Restore trash item", summary="Wait")
    session_override.add(decision)
    await session_override.flush()
    card = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="decision_request",
        role="assistant",
        body_text="Restore trash item",
        decision_id=decision.id,
        received_at=early + timedelta(seconds=1),
    )
    session_override.add_all([user, card])
    await session_override.commit()

    bubbles = await persist_agent_turn(
        session_override,
        signal,
        segments=[
            {
                "id": "s1",
                "text": "Even ophalen.",
                "activity": [
                    _work(
                        "restore",
                        result={"decision_request_id": str(decision.id), "status": "awaiting_human"},
                    )
                ],
            },
            {"id": "s2", "text": "Ik heb een herstelverzoek klaargezet.", "activity": []},
        ],
        reply_mode=CHAT,
        author_agent_id=agent.id,
    )
    await session_override.commit()
    await session_override.refresh(card)
    first, second = bubbles
    assert first.received_at < card.received_at < second.received_at

