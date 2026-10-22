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


def test_chat_turn_is_one_bubble_with_the_work_above_it():
    [planned] = plan_turn_messages(_segments(), CHAT)
    assert planned["text"] == "Let me check your order.\n\nFound it.\n\nIt ships today."
    assert [a["id"] for a in planned["activity"]] == ["think-1", "lookup", "status"]


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
async def test_a_turn_is_one_bubble_across_paragraphs_and_tools():
    from app.services.agent.turn import TurnRecorder
    from app.services.agent.turn_persist import plan_turn_messages

    events: list[tuple[str, dict]] = []

    async def publish(event: str, data: dict) -> None:
        events.append((event, data))

    author = {"kind": "agent", "id": "a1", "name": "Boekhouder"}
    turn = TurnRecorder(publish, stream_id="s1", author=author)
    await turn.speech("Eerste zin.\n\nTweede zin.")
    item = await turn.tool_start("search_index", {"q": "x"})
    await turn.tool_end(item, {"hits": []})
    await turn.speech("Gevonden.")
    await turn.finish()

    assert [name for name, _ in events].count("message.start") == 1
    bubbles = {data["segment_id"] for name, data in events if name.startswith("message.")}
    assert len(bubbles) == 1
    assert all(data.get("author") == author for _, data in events)
    surface = events[-1][1]["surface"]
    spoken = [block["text"] for block in surface["blocks"] if block["type"] == "speech"]
    assert spoken == ["Eerste zin.\n\nTweede zin.\n\nGevonden."]
    planned = plan_turn_messages(turn.segments, "chat")
    assert [b["text"] for b in planned] == ["Eerste zin.\n\nTweede zin.\n\nGevonden."]
    assert [a["tool"] for a in planned[0]["activity"]] == ["search_index"]


@pytest.mark.asyncio
async def test_a_pass_is_never_published():
    from app.services.agent.turn import TurnRecorder

    events: list[tuple[str, dict]] = []

    async def publish(event: str, data: dict) -> None:
        events.append((event, data))

    turn = TurnRecorder(publish, stream_id="s1")
    for piece in ("pa", "ss"):
        await turn.speech(piece)
    await turn.finish()
    names = [name for name, _ in events]
    assert "message.start" not in names
    assert "message.delta" not in names
    assert events[-1] == ("agent.turn", events[-1][1])
    assert events[-1][1]["outcome"] == "silent"


@pytest.mark.asyncio
async def test_text_that_starts_like_pass_streams_once_it_cannot_be_pass():
    from app.services.agent.turn import TurnRecorder

    events: list[tuple[str, dict]] = []

    async def publish(event: str, data: dict) -> None:
        events.append((event, data))

    turn = TurnRecorder(publish, stream_id="s1")
    await turn.speech("Pa")
    assert not any(name == "message.start" for name, _ in events)
    await turn.speech("sst prima.")
    await turn.finish()
    deltas = "".join(data["delta"] for name, data in events if name == "message.delta")
    assert deltas == "Passt prima."
    assert "outcome" not in events[-1][1]


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
async def test_persist_turn_appends_one_message_named_by_segment(client: AsyncClient, session_override):
    from app.services.agent.turn_persist import persist_agent_turn

    _ = client
    tenant, agent = await _tenant_agent(session_override)
    signal = Signal(tenant_id=tenant.id, channel="assistant", source="test", subject="Canvas", status="open")
    session_override.add(signal)
    await session_override.commit()

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
    )
    await session_override.commit()
    assert len(bubbles) == 1
    meta = json.loads(bubbles[0].metadata_json)
    assert meta["turn_id"] == "turn-live"
    assert meta["segment_id"] == "s1"
    assert "in_progress" not in meta
    rows = (
        await session_override.execute(select(SignalMessage).where(SignalMessage.signal_id == signal.id))
    ).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_end_dead_turns_closes_the_turn_and_leaves_one_error_bubble(
    client: AsyncClient, session_override
):
    """A crash mid-tool ends the turn on the log; the work it did stays, sealed."""
    from app.services import thread_log
    from app.services.agent.turn_persist import end_dead_turns

    _ = client
    thread_log.memory.reset()
    tenant, agent = await _tenant_agent(session_override)
    signal = Signal(tenant_id=tenant.id, channel="assistant", source="test", subject="Wealth map", status="open")
    session_override.add(signal)
    await session_override.commit()

    surface = {
        "blocks": [
            {"type": "activity", "id": "a1", "items": [_work("update_folder_canvas", status="running")]},
        ]
    }
    await thread_log.append(
        tenant.id,
        signal.id,
        "agent.turn",
        {
            "stream_id": "turn-crash",
            "phase": "start",
            "author": {"id": str(agent.id), "name": agent.name},
            "surface": surface,
            "audience": "operator",
        },
    )
    assert [r["data"]["stream_id"] for r in await thread_log.live(signal.id)] == ["turn-crash"]

    made = await end_dead_turns(
        session_override,
        signal,
        error_text="The assistant encountered an error while generating a reply.",
    )
    await session_override.commit()
    assert len(made) == 1
    meta = json.loads(made[0].metadata_json)
    assert meta["turn_id"] == "turn-crash"
    assert meta["error"] is True
    assert [a.get("status") for a in meta.get("activity") or []] == ["error"]
    assert made[0].author_agent_id == agent.id
    assert await thread_log.live(signal.id) == []
    events, _ = await thread_log.read_after(signal.id, "")
    types = [e["data"]["type"] for e in events]
    assert types[-2:] == ["turn.completed", "message.saved"]
    assert events[-2]["data"]["stop_reason"] == "error"


@pytest.mark.asyncio
async def test_fresh_open_turn_is_not_closed_on_thread_load(client: AsyncClient, session_override):
    from datetime import timedelta

    from app.services import thread_log
    from app.services.agent.turn_persist import end_dead_turns

    _ = client
    thread_log.memory.reset()
    tenant, _agent = await _tenant_agent(session_override)
    signal = Signal(tenant_id=tenant.id, channel="assistant", source="test", subject="Follow up", status="open")
    session_override.add(signal)
    await session_override.commit()
    await thread_log.append(
        tenant.id, signal.id, "agent.turn", {"stream_id": "turn-live", "phase": "start", "audience": "operator"}
    )
    made = await end_dead_turns(session_override, signal, older_than=timedelta(minutes=15))
    assert made == []
    assert len(await thread_log.live(signal.id)) == 1

@pytest.mark.asyncio
async def test_silent_decision_follow_up_replaces_placeholder(client: AsyncClient, session_override):
    from app.services.assistant_threads import append_signal_chat_message
    from app.services.signal_threads import _fill_silent_decision_follow_up

    _ = client
    tenant, agent = await _tenant_agent(session_override)
    signal = Signal(
        tenant_id=tenant.id, channel="assistant", source="chat", subject="Rule", status="open"
    )
    session_override.add(signal)
    await session_override.commit()
    placeholder = await append_signal_chat_message(
        session_override,
        signal,
        role="assistant",
        content="Done.",
        author_agent_id=agent.id,
        metadata={"turn_id": "wake"},
    )
    await session_override.commit()
    await _fill_silent_decision_follow_up(
        session_override,
        signal,
        [placeholder],
        agent.id,
        [{"action": "approved", "label": "Ja, altijd"}],
    )
    await session_override.refresh(placeholder)
    assert placeholder.body_text == "Gedaan: Ja, altijd."
    assert "in_progress" not in json.loads(placeholder.metadata_json)


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
async def test_widget_stream_breaks_bubbles_between_segments(client: AsyncClient, autonomous_workspace):
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
            {"id": "rule", "decision_ids": ["dec-2"], "result": '{"rule": "truncated'},
        ]
    }
    assert decision_ids_in_activity(meta) == {"dec-1", "dec-2"}


def test_settings_link_bubble_drops_when_the_turn_raised_a_card():
    from app.services.agent.turn_persist import drop_redundant_rule_link

    planned = drop_redundant_rule_link(
        [
            {
                "text": "Ik stel een regel voor.",
                "activity": [{"decision_ids": ["dec-1"], "result": "truncated"}],
            },
            {
                "text": "U kunt de regel nu bevestigen via [Automatiseringsregels](/settings/channels#automation-rules).",
                "activity": [],
            },
        ]
    )
    assert len(planned) == 1
    assert "stel een regel" in planned[0]["text"]


def test_decision_option_already_ran_includes_resolver_actions():
    from app.services.signal_threads import _decision_option_already_ran

    assert _decision_option_already_ran("approved", "activate_inbox_rule") is True
    assert _decision_option_already_ran("approved", "defer") is False
    assert _decision_option_already_ran("rejected", "activate_inbox_rule") is False


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
    [second] = bubbles
    assert second.seq < card.seq
    # The proposal rides on the turn's bubble; the card points back to it.
    assert json.loads(second.metadata_json)["proposal"]["decision_id"] == str(decision.id)
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


def test_contact_showcase_stays_off_the_question():
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
    groups = assign_bubble_showcases(bubbles)
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


def test_question_to_a_peer_is_said_once():
    """The model often repeats the ask_agent question; the second copy is dropped."""
    import asyncio

    from app.services.agent.turn import TurnRecorder

    async def run():
        turn = TurnRecorder()
        await turn.say("@[Boekito](agent:1) Kun je een zelfportret maken?")
        turn.note_said("@[Boekito](agent:1) Kun je een zelfportret maken?")
        await turn.speech("Boekito, kun je een zelfportret maken?")
        await turn.finish()
        return [seg.get("text") for seg in turn.segments if seg.get("text")]

    texts = asyncio.run(run())
    assert texts == ["@[Boekito](agent:1) Kun je een zelfportret maken?"]


@pytest.mark.asyncio
async def test_agent_prompt_says_a_mention_wakes_nobody(session_override):
    from app.models.agent import Agent
    from app.models.auth import Tenant
    from app.services.agent.loop import AgentLoop

    tenant = Tenant(slug="mention-rule", name="Mention Rule")
    session_override.add(tenant)
    await session_override.flush()
    agent = Agent(tenant_id=tenant.id, name="Extra", role="specialist")
    session_override.add(agent)
    await session_override.commit()

    loop = AgentLoop(session_override, tenant.id, None, agent=agent)
    loop.tools = [*loop.tools, {"name": "ask_agent"}]
    prompt = await loop._build_system_prompt()
    assert "call ask_agent" in prompt
    assert "start a bubble with their chip" not in prompt
    assert "An @mention is only a link" in prompt


def test_asking_a_peer_ends_the_turn():
    """After ask_agent the model is not called again, so no 'I asked him' line follows."""
    import asyncio
    from unittest.mock import AsyncMock
    from uuid import uuid4

    from app.services.agent.loop import AgentLoop

    loop = AgentLoop(AsyncMock(), uuid4(), None)
    loop.max_loops = 4
    calls = []
    replies = [
        {
            "content": [
                {"type": "tool_use", "id": "t1", "name": "ask_agent", "input": {"question": "Zelfportret?"}}
            ],
            "usage": {},
        },
        {"content": [{"type": "text", "text": "Ok, ik heb het gevraagd."}], "usage": {}},
    ]

    async def llm_chat(_messages, _max_tokens):
        calls.append(1)
        return replies[len(calls) - 1]

    async def tools(_messages, tool_uses, stream_id=None):
        await loop._speak_peer_request(
            "ask_agent",
            tool_uses[0]["input"],
            {"ok": True, "said": "@[Boekito](agent:1) Zelfportret?"},
        )
        return [{"type": "tool_result", "tool_use_id": "t1", "content": "{}"}]

    loop._prepare_chat = AsyncMock(return_value=([], {"input_tokens": 0, "output_tokens": 0}))
    loop._llm_chat = llm_chat
    loop._execute_tool_loop = tools
    loop._is_cancelled = AsyncMock(return_value=False)
    loop._log_event = AsyncMock()
    loop._record_usage = AsyncMock()
    loop.begin_inline_turn = AsyncMock()

    text, _ = asyncio.run(loop.run_chat([{"role": "user", "content": "vraag Boekito"}]))

    assert len(calls) == 1
    assert text == "@[Boekito](agent:1) Zelfportret?"
