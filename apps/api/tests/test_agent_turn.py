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
    activity_from_segments,
    assign_bubble_showcases,
    attach_activity_to_message,
    message_activity,
    plan_customer_bubbles,
    plan_turn_messages,
    prepare_choice_repair,
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
    assert split_chat_messages("Je\n\nJe dashboardtaal is Nederlands.") == [
        "Je dashboardtaal is Nederlands."
    ]
    assert split_chat_messages("Ok\n\nIk regel dat vandaag.") == ["Ok\nIk regel dat vandaag."]
    parts = split_chat_messages("\n\n".join(f"part {i}" for i in range(7)), max_messages=5)
    assert len(parts) == 5
    assert parts[-1] == "part 4 part 5 part 6"
    assert split_chat_messages("Run:\n\n```\na\n\nb\n```") == ["Run:", "```\na\n\nb\n```"]


def test_split_chat_messages_drops_blocks_without_text():
    text = "Hier zijn suggesties:\n\n---\n\n#### Actietags\n- #feature\n\n***\n\n**"
    assert split_chat_messages(text, max_messages=0) == [
        "Hier zijn suggesties:",
        "#### Actietags",
        "#feature",
    ]


def test_split_chat_messages_gives_each_list_item_its_own_bubble():
    text = (
        "Besluitpunten die wachten:\n\n"
        "1. Koppelingen voor de workspace.\n\n"
        "1. Open beslissingen in het overzicht.\n\n"
        "Ik zet ze als kaarten neer."
    )
    assert split_chat_messages(text, max_messages=0) == [
        "Besluitpunten die wachten:",
        "Koppelingen voor de workspace.",
        "Open beslissingen in het overzicht.",
        "Ik zet ze als kaarten neer.",
    ]


def test_split_chat_messages_strips_heartbeat_prefix():
    assert split_chat_messages("HEARTBEAT_OK — De workspace is actief.") == [
        "De workspace is actief.",
    ]
    assert split_chat_messages("HEARTBEAT_OK") == []


def test_live_tail_stays_a_growing_prefix():
    chunks = ["Belang", "rijke documenten.", "\n\nNog een zin"]
    buf = ""
    prev: list[str] = []
    for chunk in chunks:
        buf += chunk
        parts = split_chat_messages(buf, max_messages=0, settle=False)
        for index, part in enumerate(parts):
            if index < len(prev):
                assert part.startswith(prev[index])
        prev = parts
    assert split_chat_messages(buf, max_messages=0) == [
        "Belangrijke documenten.",
        "Nog een zin",
    ]
    text = (
        "Er zijn 2 open tickets:\n\n"
        "- Live chat: product demo\n"
        "- Receipt from Mistral\n\n"
        "Wil je dat ik die tag verwijder?"
    )
    parts = split_chat_messages(text, max_messages=0)
    assert parts == [
        "Er zijn 2 open tickets:",
        "Live chat: product demo",
        "Receipt from Mistral",
        "Wil je dat ik die tag verwijder?",
    ]
    fenced = split_chat_messages("Kijk:\n\n```\n- keep this\n```", max_messages=0)
    assert fenced == ["Kijk:", "```\n- keep this\n```"]


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


def test_live_segments_include_open_tools():
    from app.services.agent.turn import TurnRecorder

    turn = TurnRecorder(lambda *_: None, stream_id="s1")
    turn.segments = []
    turn._pending = [_work("create_canvas", status="running")]
    turn._speech_text = ""
    turn._speech_id = None
    live = turn.live_segments()
    assert live[0]["activity"][0]["id"] == "create_canvas"
    turn.segments = [{"id": "s1", "text": "Even kijken.", "activity": [_work("think-1", kind="think")]}]
    turn._pending = [_work("update_folder_canvas", status="running")]
    live = turn.live_segments()
    assert live[0]["text"] == "Even kijken."
    assert live[0]["activity_after"][0]["id"] == "update_folder_canvas"


@pytest.mark.asyncio
async def test_blank_line_opens_a_second_bubble_before_save():
    from app.services.agent.turn import TurnRecorder

    events: list[tuple[str, dict]] = []

    async def publish(event: str, data: dict) -> None:
        events.append((event, data))

    turn = TurnRecorder(publish, stream_id="s1")
    await turn.speech("Eerste zin.\n\nTweede zin.")
    await turn.finish()
    assert [seg["text"] for seg in turn.segments] == ["Eerste zin.", "Tweede zin."]
    surface = events[-1][1]["surface"]
    spoken = [block["text"] for block in surface["blocks"] if block["type"] == "speech"]
    assert spoken == ["Eerste zin.", "Tweede zin."]
    segments = {data["segment_id"] for name, data in events if name == "message.delta"}
    assert len(segments) == 2


@pytest.mark.asyncio
async def test_think_text_rides_the_operator_surface_only():
    from app.services.agent.turn import TurnRecorder

    events: list[tuple[str, dict]] = []

    async def publish(event: str, data: dict) -> None:
        events.append((event, data))

    turn = TurnRecorder(publish, stream_id="s1")
    await turn.thinking("Hallo")
    await turn.thinking(" daar")
    think = events[-1][1]["surface"]["blocks"][0]["items"][0]
    assert think["text"] == "Hallo daar"
    await turn.speech("Hoi")
    speech = [data for name, data in events if name == "message.delta"][-1]
    leaked = [
        item
        for block in speech["surface"]["blocks"]
        if block["type"] == "activity"
        for item in block["items"]
        if item.get("kind") == "think"
    ]
    assert leaked
    assert "text" not in leaked[0]
    assert leaked[0]["has_text"] is True


async def test_say_closes_a_check_in_bubble():
    from app.services.agent.turn import TurnRecorder

    events: list[tuple[str, dict]] = []

    async def publish(event: str, data: dict) -> None:
        events.append((event, data))

    turn = TurnRecorder(publish, stream_id="s1")
    await turn.say("Found the folder. Building the dashboard now.")
    assert turn.segments[0]["text"] == "Found the folder. Building the dashboard now."
    assert turn.has_open_speech is False
    assert any(name == "message.delta" for name, _ in events)
    turn.discard_open_speech()
    assert turn.has_open_speech is False
    assert turn.open_speech_text == ""


@pytest.mark.asyncio
async def test_thinking_after_speech_does_not_close_the_bubble():
    from app.services.agent.turn import TurnRecorder

    events: list[tuple[str, dict]] = []

    async def publish(event: str, data: dict) -> None:
        events.append((event, data))

    turn = TurnRecorder(publish, stream_id="s1")
    await turn.speech("Er was eens")
    segment = turn.current_segment_id
    await turn.thinking("more plot")
    assert turn.current_segment_id == segment
    assert turn.open_speech_text == "Er was eens"
    assert not any(name == "agent.activity" and (data.get("item") or {}).get("kind") == "think" for name, data in events)
    await turn.speech(" een platform.")
    assert turn.current_segment_id == segment
    assert turn.open_speech_text == "Er was eens een platform."


def test_progress_allowed_waits_then_gaps():
    from app.services.agent.loop import is_progress_filler, progress_allowed

    assert progress_allowed(elapsed=5, since_last=None, count=0) is False
    assert progress_allowed(elapsed=15, since_last=None, count=0) is True
    assert progress_allowed(elapsed=40, since_last=10, count=1) is False
    assert progress_allowed(elapsed=40, since_last=20, count=1) is True
    assert progress_allowed(elapsed=80, since_last=30, count=3) is False
    assert is_progress_filler("Still working on it.")
    assert is_progress_filler("working on this")
    assert not is_progress_filler("I filed the invoice in Facturen.")


def test_activity_from_segments_flattens_mail_turn_for_suggestion_card():
    """Assisted inbound often saves only a decision_request — keep the tool trail."""
    items = activity_from_segments(_segments())
    # Mail planning folds earlier speech into a note, then keeps tool work.
    assert [a["id"] for a in items if a.get("id")] == ["think-1", "note-s1", "lookup", "status"]
    assert any(a.get("label") == "note" for a in items)


def test_attach_activity_to_message_is_idempotent():
    msg = SimpleNamespace(metadata_json="{}")
    assert attach_activity_to_message(msg, [_work("a"), _work("b")]) is True
    meta = json.loads(msg.metadata_json)
    assert [a["id"] for a in meta["activity"]] == ["a", "b"]
    assert attach_activity_to_message(msg, [_work("b"), _work("c")]) is True
    meta = json.loads(msg.metadata_json)
    assert [a["id"] for a in meta["activity"]] == ["a", "b", "c"]
    assert attach_activity_to_message(msg, []) is False


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


@pytest.mark.asyncio
async def test_checkpoint_then_persist_keeps_one_message(client: AsyncClient, session_override):
    from app.services.agent.turn_persist import persist_agent_turn, upsert_turn_checkpoint

    tenant, agent = await _tenant_agent(session_override)
    signal = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        source="test",
        subject="Canvas",
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()

    first = await upsert_turn_checkpoint(
        session_override,
        signal,
        message_id=None,
        author_agent_id=agent.id,
        turn_id="turn-live",
        segments=[{"id": "s1", "text": "", "activity": [_work("create_canvas", status="running")]}],
    )
    await session_override.commit()
    assert first.body_text == "Working on this."
    assert json.loads(first.metadata_json)["in_progress"] is True

    second = await upsert_turn_checkpoint(
        session_override,
        signal,
        message_id=first.id,
        author_agent_id=agent.id,
        turn_id="turn-live",
        segments=[
            {
                "id": "s1",
                "text": "",
                "activity": [_work("create_canvas"), _work("update_folder_canvas")],
            }
        ],
    )
    await session_override.commit()
    assert second.id == first.id

    bubbles = await persist_agent_turn(
        session_override,
        signal,
        segments=[
            {
                "id": "s1",
                "text": "Dashboard staat klaar.",
                "activity": [_work("create_canvas"), _work("update_folder_canvas")],
            }
        ],
        reply_mode=CHAT,
        author_agent_id=agent.id,
        turn_id="turn-live",
        replace_message_id=first.id,
    )
    await session_override.commit()
    assert [b.id for b in bubbles] == [first.id]
    assert bubbles[0].body_text == "Dashboard staat klaar."
    assert "in_progress" not in json.loads(bubbles[0].metadata_json)
    rows = (
        await session_override.execute(select(SignalMessage).where(SignalMessage.signal_id == signal.id))
    ).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_seal_in_progress_rewrites_checkpoint_as_error(client: AsyncClient, session_override):
    """Crash mid-tool must not leave a live Update-folder-canvas trail after refresh."""
    from app.services.agent.turn_persist import seal_in_progress_checkpoints, upsert_turn_checkpoint

    _ = client
    tenant, agent = await _tenant_agent(session_override)
    signal = Signal(
        tenant_id=tenant.id,
        channel="assistant",
        source="test",
        subject="Wealth map",
        status="open",
    )
    session_override.add(signal)
    await session_override.commit()

    checkpoint = await upsert_turn_checkpoint(
        session_override,
        signal,
        message_id=None,
        author_agent_id=agent.id,
        turn_id="turn-crash",
        segments=[
            {
                "id": "s1",
                "text": "",
                "activity": [
                    _work("create_canvas"),
                    _work("update_folder_canvas", status="running"),
                ],
            }
        ],
    )
    await session_override.commit()
    assert json.loads(checkpoint.metadata_json)["in_progress"] is True

    sealed = await seal_in_progress_checkpoints(
        session_override,
        signal,
        error_text="The assistant encountered an error while generating a reply.",
        author_agent_id=agent.id,
        replace_with_error=True,
        checkpoint_message_id=checkpoint.id,
    )
    await session_override.commit()
    assert len(sealed) == 1
    await session_override.refresh(checkpoint)
    meta = json.loads(checkpoint.metadata_json)
    assert "in_progress" not in meta
    assert meta.get("error") is True
    assert checkpoint.body_text.startswith("The assistant encountered")
    statuses = [a.get("status") for a in meta.get("activity") or []]
    assert "running" not in statuses
    assert statuses.count("error") >= 1


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

    async def fake_stream(self, messages, extra_context="", attachments=None, **kwargs):
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
    decision = DecisionRequest(
        tenant_id=tenant.id,
        signal_id=signal.id,
        title="Restore trash item",
        summary="Wait",
    )
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
    await session_override.flush()
    # Card already revealed mid-turn; link message_id so place_turn_decisions
    # repositions this row instead of revealing a duplicate.
    decision.message_id = card.id
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
    # The proposal rides on the turn's last bubble; the card points back to it.
    assert json.loads(second.metadata_json)["proposal"]["decision_id"] == str(decision.id)
    assert "proposal" not in json.loads(first.metadata_json)
    assert json.loads(card.metadata_json)["attached_to_message_id"] == str(second.id)

    from app.models.auth import Membership
    from app.services.signal_threads import get_thread

    member = (
        await session_override.execute(select(Membership).where(Membership.tenant_id == tenant.id))
    ).scalars().first()
    thread = await get_thread(session_override, tenant.id, member.user_id, signal.id)
    rows = {row["id"]: row for row in thread["messages"]}
    proposal = rows[str(second.id)]["payload"]["proposal"]
    assert proposal["status"] == "awaiting_human"
    assert rows[str(card.id)]["payload"]["attached_to_message_id"] == str(second.id)


@pytest.mark.asyncio
async def test_customer_thread_keeps_the_standalone_card(client: AsyncClient, session_override):
    from app.services.agent.turn_persist import persist_agent_turn

    await _login(client)
    tenant, agent = await _tenant_agent(session_override)
    signal = Signal(tenant_id=tenant.id, channel="whatsapp", source="test", subject="Order", status="open")
    session_override.add(signal)
    await session_override.flush()
    decision = DecisionRequest(tenant_id=tenant.id, title="Refund", summary="Wait")
    session_override.add(decision)
    await session_override.flush()
    card = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="decision_request",
        role="assistant",
        body_text="Refund",
        decision_id=decision.id,
    )
    session_override.add(card)
    await session_override.commit()
    bubbles = await persist_agent_turn(
        session_override,
        signal,
        segments=[
            {
                "id": "s1",
                "text": "I asked a colleague.",
                "activity": [_work("refund", result={"decision_request_id": str(decision.id)})],
            }
        ],
        reply_mode=CHAT,
        author_agent_id=agent.id,
    )
    await session_override.commit()
    assert "proposal" not in json.loads(bubbles[-1].metadata_json or "{}")
    assert "attached_to_message_id" not in json.loads(card.metadata_json or "{}")


@pytest.mark.asyncio
async def test_place_turn_decisions_does_not_drag_old_cards_into_new_turn(
    client: AsyncClient, session_override
):
    """Regression: an approved Bin restore card must not jump into a later turn."""
    from datetime import datetime, timedelta

    from app.models.notification import DecisionRequest
    from app.services.agent.reply_mode import CHAT
    from app.services.agent.turn_persist import persist_agent_turn

    await _login(client)
    tenant, agent = await _tenant_agent(session_override)
    signal = Signal(
        tenant_id=tenant.id, channel="assistant", source="test", subject="Bin again", status="open"
    )
    session_override.add(signal)
    await session_override.flush()

    old_time = datetime.utcnow() - timedelta(hours=4)
    decision = DecisionRequest(
        tenant_id=tenant.id,
        title="Approve: Restore trash item",
        summary="The agent wants to restore trash item.\n- Id: old-item",
        status="approved",
        resolved_at=old_time + timedelta(minutes=10),
    )
    session_override.add(decision)
    await session_override.flush()
    # Simulate the old bug: received_at already dragged into "now".
    dragged = datetime.utcnow()
    card = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        kind="decision_request",
        role="assistant",
        body_text=decision.summary,
        decision_id=decision.id,
        created_at=old_time,
        received_at=dragged,
    )
    session_override.add(card)
    await session_override.commit()

    bubbles = await persist_agent_turn(
        session_override,
        signal,
        segments=[
            {
                "id": "s1",
                "text": "Hier is een willekeurig item uit de prullenbak:",
                "activity": [_work("list", result={"items": [{"id": "new-item"}]})],
            },
            {"id": "s2", "text": "Wil je deze terugzetten?", "activity": []},
        ],
        reply_mode=CHAT,
        author_agent_id=agent.id,
    )
    await session_override.commit()
    await session_override.refresh(card)

    # Healed back to created_at — not sitting between the new bubbles.
    assert card.received_at == card.created_at
    assert card.received_at < bubbles[0].received_at
    # The old card stays with its own turn: no proposal on the new bubbles.
    assert all("proposal" not in json.loads(b.metadata_json or "{}") for b in bubbles)
    assert "attached_to_message_id" not in json.loads(card.metadata_json or "{}")


def test_choice_repair_turns_tag_bullets_into_options():
    bubbles = [
        {
            "text": "Er is al een contact voor Lorenzo Boers (lorenzo_boers@outlook.com).",
            "activity": [
                {
                    "tool": "get_contact",
                    "result": {
                        "items": [
                            {
                                "type": "contact",
                                "id": "c1",
                                "title": "Lorenzo Boers",
                            }
                        ]
                    },
                }
            ],
        },
        {
            "text": "De beschikbare ticketcategorieën zijn:\n- bug (voor problemen)\n- feature (voor nieuwe functionaliteit)",
            "activity": [
                {
                    "tool": "list_tags",
                    "result": {
                        "tags": [
                            {"id": "t-bug", "name": "bug", "kind": "action_tag"},
                            {"id": "t-feature", "name": "feature", "kind": "action_tag"},
                        ]
                    },
                }
            ],
        },
        {"text": "Welke categorie past het beste bij het issue?", "activity": []},
    ]
    cleaned, options = prepare_choice_repair(bubbles)
    assert [row["id"] for row in options] == ["t-bug", "t-feature"]
    speech = "\n".join(row["text"] for row in cleaned)
    assert "- bug" not in speech
    assert "Welke categorie" in speech
    groups = assign_bubble_showcases(cleaned)
    assert groups[0][0]["id"] == "c1"
    assert all(item.get("type") != "contact" for item in groups[-1])


def test_assign_showcases_skips_contact_on_the_question_bubble():
    bubbles = [
        {
            "text": "Welke categorie past het beste?",
            "activity": [
                {
                    "tool": "get_contact",
                    "result": {
                        "items": [{"type": "contact", "id": "c1", "title": "Lorenzo Boers"}]
                    },
                }
            ],
        }
    ]
    groups = assign_bubble_showcases(bubbles)
    assert groups == [[]]

