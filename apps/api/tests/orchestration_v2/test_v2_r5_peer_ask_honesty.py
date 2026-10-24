"""R5: a spoken ask of a colleague really reaches that colleague.

Dev chain runs (CH3, CH6, CH11, CH18, CH20, 2026-10-24) showed Ada writing the
peer call as plain text ("intercom_agent Katel", "Handoff_to Dirk",
"intercom_agent ask_agent Bram"), ending the turn "done/spoke" without any
tool call, and often inventing the colleague's answer. Root cause: agent turns
skip the tenant snapshot, so the model never had a colleague agent_id, while
intercom_agent required one; a fixed name tuple and sheet/lookup rules also
dropped the tool for real asks, and STT near misses (Katel/Kato/Tato for Cato)
never matched a colleague.

Everything here is mocked: no LLM, STT, TTS, storage or network.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import select

from _v2_support import REPEATS

pytestmark = [pytest.mark.orch_v2]

TOOL_WORDS = ("intercom_agent", "ask_agent", "handoff_to", "handoff to", "agent_id")


def _agents(*names: str) -> list[SimpleNamespace]:
    return [SimpleNamespace(id=uuid4(), name=f"[TEST] {name}") for name in names]


# -- pure helpers ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "heard,expected",
    [
        ("Ada, vraag Katel of dinsdagmiddag nog vrij is.", "Ada, vraag Cato of dinsdagmiddag nog vrij is."),
        ("Ada, vraag Kato of dinsdagmiddag nog vrij is.", "Ada, vraag Cato of dinsdagmiddag nog vrij is."),
        ("Vraag Tato van planning wanneer de monteur komt.", "Vraag Cato van planning wanneer de monteur komt."),
        ("Ada, vraach Dirk wat Studio Noord open heeft.", "Ada, vraag Dirk wat Studio Noord open heeft."),
    ],
)
def test_r5_stt_near_miss_becomes_known_colleague(heard, expected):
    from app.services.colleague_names import repair_heard_names

    agents = _agents("Ada", "Bram", "Cato", "Dirk")
    for _ in range(REPEATS):
        assert repair_heard_names(heard, agents) == expected


@pytest.mark.parametrize(
    "heard",
    [
        "Ik vraag me af of het morgen regent.",
        "Vraag Henk of hij morgen kan.",  # no agent called Henk: untouched
        "Maak een dashboard Omzet Q3.",
        "Wat zei Bram over de offerte?",
    ],
)
def test_r5_name_repair_only_for_known_agents_in_an_ask(heard):
    from app.services.colleague_names import repair_heard_names

    agents = _agents("Ada", "Bram", "Cato", "Dirk")
    assert repair_heard_names(heard, agents) == heard


def test_r5_asked_colleague_needs_an_ask_and_a_known_name():
    from app.services.colleague_names import asked_colleague, named_colleague

    ada, bram, cato, dirk = _agents("Ada", "Bram", "Cato", "Dirk")
    pool = [ada, bram, cato, dirk]
    assert asked_colleague("vraag Kato of dinsdag kan", pool, exclude_id=ada.id)[0] is cato
    assert asked_colleague("wil je Bram even vragen of De Vries betaald heeft", pool, exclude_id=ada.id)[0] is bram
    assert asked_colleague("vraag Henk of het kan", pool, exclude_id=ada.id)[0] is None
    assert asked_colleague("Maak een folder Projecten", pool, exclude_id=ada.id)[0] is None
    # Named but not asked: no ask, still a named colleague.
    assert asked_colleague("Wat zei Bram ook alweer?", pool, exclude_id=ada.id)[0] is None
    assert named_colleague("Wat zei Bram ook alweer?", pool, exclude_id=ada.id) is bram
    # Never the agent itself.
    assert asked_colleague("vraag Ada of het kan", pool, exclude_id=ada.id)[0] is None


@pytest.mark.parametrize(
    "text,who",
    [
        ("intercom_agent Cato *Dinsdag is vrij.*", "Cato"),
        ("Handoff_to Dirk", "Dirk"),
        ("intercom_agent ask_agent Bram", "Bram"),
        ("intercom_agent **Cato** Ze zegt dat het kan.", "Cato"),
        ("intercom_agent Katel", "Cato"),
    ],
)
def test_r5_text_form_tool_calls_are_detected_and_stripped(text, who):
    from app.services.colleague_names import leaked_peer_call, short_name, strip_tool_words

    agents = _agents("Ada", "Bram", "Cato", "Dirk")
    hit = leaked_peer_call(text, agents, exclude_id=agents[0].id)
    assert hit is not None and short_name(hit.name) == who
    cleaned = strip_tool_words(text).lower()
    for word in TOOL_WORDS:
        assert word not in cleaned


def test_r5_answer_claims_are_recognised():
    from app.services.colleague_names import claims_answer_from

    (bram,) = _agents("Bram")
    assert claims_answer_from("Bram heeft gezegd dat de offerte klaar is.", bram)
    assert claims_answer_from("Zoals Bram heeft aangegeven, is dat betaald.", bram)
    assert not claims_answer_from("Ik heb het aan Bram gevraagd.", bram)


@pytest.mark.parametrize(
    "ack,heard,off",
    [
        ("Ik check of Dirk de openingstijden van Café Luna kan delen.", "Vraag Bram of De Vries de offerte heeft.", True),
        ("Ik check of Bram de offerte heeft.", "Vraag Cato of dinsdag vrij is.", True),
        ("Ik kijk wat Studio Noord nog open heeft voor Bram.", "Vraag Dirk wat Café Luna open heeft.", True),
        ("Ik vraag het Bram.", "Vraag Bram of De Vries de offerte heeft.", False),
        ("Ik maak het dashboard.", "Maak een dashboard Omzet.", False),
        ("Ik leg het aan Cato voor.", "Vraag Kato of dinsdag kan.", False),
    ],
)
def test_r5_stale_ack_from_lane_is_caught(ack, heard, off):
    from app.services.colleague_names import repair_heard_names
    from app.services.intercom import _ack_off_topic

    ada, *rest = _agents("Ada", "Bram", "Cato", "Dirk")
    pool = [ada, *rest]
    heard = repair_heard_names(heard, pool)
    for _ in range(REPEATS):
        assert _ack_off_topic(ack, heard, ada, pool) is off, (ack, heard)


def test_r5_decide_prompt_forbids_lane_names_and_tool_words():
    from app.services.intercom import _DECIDE

    assert "lane lines are earlier work" in _DECIDE
    assert "Never write a tool name" in _DECIDE


# -- execute_turn with a fake model ----------------------------------------------------


class _FakeTurn:
    def __init__(self, text: str, activity: list[dict[str, Any]] | None = None) -> None:
        self.segments = [{"text": text}] if text else []
        self._activity = list(activity or [])

    def all_activity(self) -> list[dict[str, Any]]:
        return list(self._activity)

    def tool_names(self) -> list[str]:
        return [str(item.get("tool")) for item in self._activity]

    async def finish(self, outcome: str) -> None:
        return None


class _FakeLoop:
    """Stands in for AgentLoop: no provider, records what the turn asked for."""

    ALL_TOOLS = (
        "intercom_agent",
        "search_product_help",
        "start_conversation",
        "list_canvases",
        "get_folder_canvas",
        "edit_canvas",
        "finish_canvas",
        "list_threads",
        "list_contacts",
        "get_contact",
        "send_reply",
    )

    def __init__(self, text: str, activity: list[dict[str, Any]] | None = None) -> None:
        self.turn = _FakeTurn(text, activity)
        self.tools = [{"name": name} for name in self.ALL_TOOLS]
        self._allowed_tool_names: set[str] | None = None
        self.max_loops = 10
        self.agent_turn_id = None
        self.extra_context = ""
        self.tools_at_stream: list[str] = []
        self.persisted: list[str] = []

    async def stream_chat(self, history, *, extra_context="", attachments=None, skip_rag=False):
        self.extra_context = extra_context
        self.tools_at_stream = [t["name"] for t in self.tools]
        yield {"type": "done", "usage": {"input_tokens": 1, "output_tokens": 1}}

    def thinking_payload(self):
        return None

    async def persist_turn(self, signal, *, fallback_text="", final_metadata=None):
        texts = [str(seg.get("text") or "") for seg in self.turn.segments if str(seg.get("text") or "").strip()]
        self.persisted.append(" ".join(texts) or fallback_text)


async def _setup(seeded):
    from app.models.agent import Agent
    from app.models.signal import Signal

    session = seeded.session
    tag = uuid4().hex[:6]
    peers = {}
    for name in ("Bram", "Cato", "Dirk"):
        peer = Agent(
            tenant_id=seeded.tenant.id,
            name=f"[TEST] {name}",
            slug=f"test-{name.lower()}-{tag}",
            is_active=True,
        )
        session.add(peer)
        peers[name] = peer
    signal = Signal(
        tenant_id=seeded.tenant.id,
        channel="assistant",
        source="chat",
        subject=f"v2-peer-ask-{tag}",
        agent_id=seeded.agent.id,
    )
    session.add(signal)
    await session.flush()
    await session.commit()
    return signal, peers


async def _run_turn(seeded, monkeypatch, signal, heard: str, loop: _FakeLoop, via=None, agent=None):
    from app.models.agent_turn import AgentTurn
    from app.services import agent_turns
    from app.services.intercom import _turn_prompt

    monkeypatch.setattr("app.services.chat_runtime.build_agent_loop", lambda *a, **k: loop)
    spoken: list[str] = []

    async def _speak(_session, _turn, final):
        spoken.append(final)

    monkeypatch.setattr("app.services.intercom.speak_turn_result", _speak)
    user_name = getattr(seeded.user, "display_name", "") or "Tester"
    turn = AgentTurn(
        tenant_id=seeded.tenant.id,
        signal_id=signal.id,
        agent_id=(agent or seeded.agent).id,
        cause_kind="intercom",
        requested_by_kind="user",
        requested_by_id=seeded.user.id,
        prompt=_turn_prompt(user_name or "Tester", heard, None, via),
        status="running",
        idempotency_key=f"v2-r5-{uuid4().hex}",
    )
    seeded.session.add(turn)
    await seeded.session.commit()
    result = await agent_turns.execute_turn(seeded.session, turn)
    return turn, result, spoken


async def _peer_turns(session, signal_id, agent_id):
    from app.models.agent_turn import AgentTurn

    return (
        await session.execute(
            select(AgentTurn.id, AgentTurn.prompt, AgentTurn.cause_kind).where(
                AgentTurn.signal_id == signal_id, AgentTurn.agent_id == agent_id
            )
        )
    ).all()


@pytest.mark.parametrize(
    "heard,leak,who,topic",
    [
        ("Ada, vraag Cato of dinsdagmiddag nog vrij is voor De Vries.", "intercom_agent Cato *Dinsdagmiddag is vrij.*", "Cato", "dinsdagmiddag"),
        ("Ada, wil je Bram even vragen of de offerte van De Vries klaar is?", "intercom_agent ask_agent Bram", "Bram", "offerte"),
        ("Ada, vraag Dirk wat Studio Noord nog open heeft staan.", "Handoff_to Dirk Studio Noord heeft twee facturen open.", "Dirk", "studio noord"),
        ("Ada, vraag Cato of donderdag kan.", "intercom_agent **Cato** Ze zegt dat donderdag kan.", "Cato", "donderdag"),
    ],
)
async def test_r5_text_form_call_becomes_a_real_peer_turn(heard, leak, who, topic, seeded, monkeypatch):
    signal, peers = await _setup(seeded)
    loop = _FakeLoop(leak)
    _turn, result, spoken = await _run_turn(seeded, monkeypatch, signal, heard, loop)

    assert result["ok"] and result["outcome"] in ("spoke", "stalled"), result
    rows = await _peer_turns(seeded.session, signal.id, peers[who].id)
    assert len(rows) == 1, rows
    assert rows[0].cause_kind == "intercom"
    assert topic in rows[0].prompt.lower(), rows[0].prompt
    # Nothing else was asked.
    for name, peer in peers.items():
        if name != who:
            assert not await _peer_turns(seeded.session, signal.id, peer.id)
    said = " ".join(loop.persisted + spoken)
    low = said.lower()
    for word in TOOL_WORDS:
        assert word not in low, said
    assert "gevraagd" in low and who.lower() in low, said
    # No answer put in the colleague's mouth.
    for invented in ("is vrij", "twee facturen", "zegt dat", "kan."):
        assert invented not in low, said
    # The model was given the colleague ids it needs to call the tool for real.
    assert str(peers[who].id) in loop.extra_context
    assert "intercom_agent" in loop.tools_at_stream


async def test_r5_stt_near_miss_still_asks_cato(seeded, monkeypatch):
    signal, peers = await _setup(seeded)
    loop = _FakeLoop("intercom_agent Katel")
    await _run_turn(seeded, monkeypatch, signal, "Ada, vraag Katel of dinsdagmiddag nog vrij is.", loop)
    assert len(await _peer_turns(seeded.session, signal.id, peers["Cato"].id)) == 1
    assert "intercom_agent" in loop.tools_at_stream


async def test_r5_real_tool_call_is_not_doubled(seeded, monkeypatch):
    from app.services.intercom import handoff_to_agent

    signal, peers = await _setup(seeded)
    # The model really called the tool (the peer turn exists) and said so.
    await handoff_to_agent(
        seeded.session,
        seeded.tenant.id,
        user_id=seeded.user.id,
        from_agent=seeded.agent,
        to_agent_id=peers["Cato"].id,
        thread_id=signal.id,
        message="Is dinsdagmiddag nog vrij?",
    )
    activity = [{"tool": "intercom_agent", "status": "ok", "input": {"agent_id": str(peers["Cato"].id)}}]
    loop = _FakeLoop("Ik heb het aan Cato gevraagd.", activity)
    _t, result, spoken = await _run_turn(seeded, monkeypatch, signal, "Ada, vraag Cato of dinsdagmiddag nog vrij is.", loop)
    assert len(await _peer_turns(seeded.session, signal.id, peers["Cato"].id)) == 1
    assert "intercom_agent" not in " ".join(loop.persisted + spoken).lower()


async def test_r5_sheet_ask_keeps_intercom_for_a_named_colleague(seeded, monkeypatch):
    signal, _peers = await _setup(seeded)
    loop = _FakeLoop("Ik heb het aan Dirk gevraagd.", [{"tool": "intercom_agent", "status": "ok"}])
    await _run_turn(seeded, monkeypatch, signal, "Ada, vraag Dirk wat Studio Noord nog open heeft staan.", loop)
    assert "intercom_agent" in loop.tools_at_stream


async def test_r5_no_colleague_named_no_peer_tool_and_no_ask(seeded, monkeypatch):
    signal, peers = await _setup(seeded)
    loop = _FakeLoop("Het dashboard Omzet staat klaar.", [{"tool": "edit_canvas", "status": "ok"}])
    await _run_turn(seeded, monkeypatch, signal, "Ada, maak een dashboard Omzet en zet de titel erin.", loop)
    for peer in peers.values():
        assert not await _peer_turns(seeded.session, signal.id, peer.id)
    assert "Het dashboard Omzet staat klaar." in " ".join(loop.persisted)


async def test_r5_leaked_call_without_ask_is_not_spoken(seeded, monkeypatch):
    """A tool name in the line never reaches the person, even with no target."""
    signal, _peers = await _setup(seeded)
    loop = _FakeLoop("search_product_help Je maakt een folder via Mappen.", [{"tool": "x", "status": "ok"}])
    _t, _r, spoken = await _run_turn(seeded, monkeypatch, signal, "Ada, hoe maak ik een folder?", loop)
    said = " ".join(loop.persisted + spoken).lower()
    assert "search_product_help" not in said
    assert "mappen" in said


async def test_r5_relayed_ask_is_answered_not_passed_on(seeded, monkeypatch):
    """Dev CH1: Ada asked Bram; Bram's relay turn asked Dirk, Dirk asked Bram."""
    signal, peers = await _setup(seeded)
    loop = _FakeLoop("intercom_agent Dirk Dirk zegt dat het kan.")
    _t, result, spoken = await _run_turn(
        seeded,
        monkeypatch,
        signal,
        "Kun je laten weten of de offerte voor De Vries deze week de deur uit kan?",
        loop,
        via=seeded.agent,
        agent=peers["Bram"],
    )
    assert "intercom_agent" not in loop.tools_at_stream
    assert str(peers["Dirk"].id) not in loop.extra_context
    for peer in peers.values():
        assert not await _peer_turns(seeded.session, signal.id, peer.id) or peer is peers["Bram"]
    rows = await _peer_turns(seeded.session, signal.id, peers["Bram"].id)
    assert len(rows) == 1  # only the relay turn itself
    said = " ".join(loop.persisted + spoken).lower()
    assert "intercom_agent" not in said and "zegt dat het kan" not in said, said


# -- the tool itself -------------------------------------------------------------------


async def test_r5_intercom_agent_accepts_a_colleague_name(seeded, monkeypatch):
    from app.tools.messaging import _intercom_agent
    from app.tools.registry import ToolContext

    signal, peers = await _setup(seeded)
    seen: dict[str, Any] = {}

    async def _handoff(session, tenant_id, **kw):
        seen.update(kw)
        return {"ok": True, "agent_id": str(kw["to_agent_id"])}

    monkeypatch.setattr("app.services.intercom.handoff_to_agent", _handoff)
    ctx = ToolContext(
        session=seeded.session,
        tenant_id=seeded.tenant.id,
        user_id=seeded.user.id,
        agent=seeded.agent,
        signal_id=signal.id,
    )
    for raw in ("Cato", "[TEST] Cato", "**Cato**", "Kato"):
        seen.clear()
        out = await _intercom_agent(ctx, {"agent_id": raw, "message": "Is dinsdag vrij?"})
        assert out.get("ok"), (raw, out)
        assert seen["to_agent_id"] == peers["Cato"].id
    out = await _intercom_agent(ctx, {"agent_id": "Henk", "message": "Is dinsdag vrij?"})
    assert "error" in out


def test_r5_intercom_agent_schema_offers_a_name():
    import app.tools.messaging  # noqa: F401 - registers the tool
    from app.tools.registry import get_tool_spec

    spec = get_tool_spec("intercom_agent")
    props = spec.input_schema["properties"]
    assert "agent_name" in props
    assert "colleague list" in props["agent_id"]["description"]
