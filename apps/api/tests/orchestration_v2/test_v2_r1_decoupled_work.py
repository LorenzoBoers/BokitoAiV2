"""Rule 1: decouple conversation from work.

A long task runs in the background as a queued turn with an id. The person
hears a short ack within ACK_BUDGET_MS of the end of their utterance, never
silence, and the real result comes back later as a separate voice note.

Pass criteria (each test asserts them literally):
  R1.1  handle_utterance returns before the work runs: an AgentTurn row
        (cause_kind="intercom", status="queued") exists for the utterance,
        and response["working"] is True.
  R1.2  An ack voice note (kind="ack") is published <= ACK_BUDGET_MS after
        the recording was handed in (mocked STT 150 ms, router 250 ms, TTS 200 ms).
  R1.3  The ack is not an echo of the sentence and does not claim completion.
  R1.4  No result note exists while the turn is still queued.
  R1.5  When the backend result arrives (speak_turn_result) exactly one
        result note is published, after the ack, carrying the result text.
  R1.6  The API response exposes the background task id (turn_id/task_id).
  R1.7  A slow router (1.6 s) must not delay the ack past ACK_BUDGET_MS:
        filler first, routing later.
  R1.8  A newer ask supersedes older queued turns on the same lane:
        after 5 asks only one turn is queued.
  R1.9  During a long turn a progress filler (kind="progress") is spoken and
        never claims an outcome.
  R1.10 The periodic sweep speaks that filler for a spoken ask that has been
        running > PROGRESS_AFTER_S, once per PROGRESS_EVERY_S, and not for a
        fresh turn.
"""

from __future__ import annotations

import re

import pytest
from sqlalchemy import select

from _v2_support import ACK_BUDGET_MS, REPEATS, SUCCESS_CLAIM

DUTCH_ASKS = [
    "Zoek uit welke offertes voor Bakkerij De Vries nog openstaan.",
    "Kun je de debiteurenlijst van Café Luna nakijken?",
    "Plan een afspraak met Installatiebedrijf Jansen volgende week dinsdag.",
    "Vraag Bram of de jaarrekening van Studio Noord al klaar is.",
    "Zet de openstaande facturen van deze maand op een rij.",
]
RESULTS = [
    "Er staan twee offertes open voor Bakkerij De Vries, samen 3.480 euro.",
    "Café Luna heeft nog één openstaande factuur van 1.250 euro.",
    "Ik heb dinsdag om tien uur voorgesteld aan Installatiebedrijf Jansen.",
    "Bram zegt dat de jaarrekening van Studio Noord vrijdag af is.",
    "Er staan deze maand vier facturen open, samen 7.900 euro.",
]


def _scenario(run: int) -> tuple[str, str]:
    return DUTCH_ASKS[run % len(DUTCH_ASKS)], RESULTS[run % len(RESULTS)]


async def _utter(seeded, fake_voice, timeline, text: str):
    from app.services.intercom import handle_utterance

    fake_voice.transcript = text
    timeline.reset()
    timeline.mark("utterance_end", text)
    res = await handle_utterance(
        seeded.session,
        seeded.tenant.id,
        seeded.user,
        agent_id=seeded.agent.id,
        audio=b"\x1aE\xdf\xa3fake-webm-recording",
        filename="note.webm",
        mime="audio/webm",
    )
    timeline.mark("http_return")
    return res


async def _turn_for(session, message_id: str):
    from uuid import UUID

    from app.models.agent_turn import AgentTurn

    return (
        await session.execute(select(AgentTurn).where(AgentTurn.cause_message_id == UUID(message_id)))
    ).scalars().all()


async def _notes(session, signal_id):
    from app.models.voice_note import VoiceNote

    return (
        await session.execute(
            select(VoiceNote).where(VoiceNote.signal_id == signal_id).order_by(VoiceNote.created_at)
        )
    ).scalars().all()


@pytest.mark.parametrize("run", range(REPEATS))
async def test_r1_ack_fast_work_queued_result_later(run, seeded, fake_voice, timeline, route_fake):
    from uuid import UUID

    from app.services.intercom import speak_turn_result

    ask, result = _scenario(run)
    res = await _utter(seeded, fake_voice, timeline, ask)
    trace = timeline.dump()

    # R1.1
    assert res.get("working") is True, (res, trace)
    turns = await _turn_for(seeded.session, res["message_id"])
    assert len(turns) == 1, f"expected one background turn, got {len(turns)}\n{trace}"
    turn = turns[0]
    assert turn.cause_kind == "intercom" and turn.status == "queued", (turn.cause_kind, turn.status)

    # R1.2
    ack_t = timeline.first("note_ack")
    assert ack_t is not None, f"no ack note published\n{trace}"
    assert ack_t <= ACK_BUDGET_MS, f"ack after {ack_t:.0f} ms > budget {ACK_BUDGET_MS} ms\n{trace}"

    # R1.3
    ack = res.get("ack") or ""
    assert ack.strip(), "empty ack = silence"
    assert ack.strip().lower() != ask.strip().lower()
    assert not re.search(SUCCESS_CLAIM, ack), f"ack claims completion before the work ran: {ack!r}"

    # R1.4
    notes = await _notes(seeded.session, UUID(res["thread_id"]))
    assert [n.kind for n in notes] == ["ack"], [n.kind for n in notes]

    # R1.5 backend confirms -> the result is spoken once, after the ack.
    await speak_turn_result(seeded.session, turn, result)
    notes = await _notes(seeded.session, UUID(res["thread_id"]))
    kinds = [n.kind for n in notes]
    assert kinds == ["ack", "result"], kinds
    assert notes[1].created_at >= notes[0].created_at
    key_words = [w.strip(".,") for w in result.split() if len(w.strip(".,")) > 6]
    assert any(w in (notes[1].text or "") for w in key_words), (notes[1].text, result)
    assert timeline.first("note_result") is not None and timeline.first("note_result") > ack_t


@pytest.mark.parametrize("run", range(REPEATS))
async def test_r1_response_exposes_task_id(run, seeded, fake_voice, timeline, route_fake):
    ask, _ = _scenario(run)
    res = await _utter(seeded, fake_voice, timeline, ask)
    turns = await _turn_for(seeded.session, res["message_id"])
    assert len(turns) == 1
    exposed = res.get("turn_id") or res.get("task_id")
    assert exposed, (
        "R1.6: the intercom response has no task id; a client cannot follow or cancel "
        f"the background work. keys={sorted(res)}"
    )
    assert str(exposed) == str(turns[0].id)


@pytest.mark.parametrize("run", range(REPEATS))
async def test_r1_slow_router_still_acks_within_budget(run, seeded, fake_voice, timeline, route_fake):
    route_fake.delay_s = 1.6  # LLM router is slow today
    ask, _ = _scenario(run)
    await _utter(seeded, fake_voice, timeline, ask)
    ack_t = timeline.first("note_ack")
    assert ack_t is not None, timeline.dump()
    assert ack_t <= ACK_BUDGET_MS, (
        f"R1.7: ack waited for the router: {ack_t:.0f} ms > {ACK_BUDGET_MS} ms "
        f"(router {route_fake.delay_s * 1000:.0f} ms)\n{timeline.dump()}"
    )


async def test_r1_newer_ask_supersedes_older_turns(seeded, fake_voice, timeline, route_fake):
    from app.models.agent_turn import AgentTurn

    lane_ids = set()
    for run in range(REPEATS):
        res = await _utter(seeded, fake_voice, timeline, _scenario(run)[0])
        lane_ids.add(res["thread_id"])
    assert len(lane_ids) == 1, "STAY asks should land on one lane"
    rows = (
        await seeded.session.execute(select(AgentTurn).where(AgentTurn.cause_kind == "intercom"))
    ).scalars().all()
    queued = [r for r in rows if r.status in ("queued", "running")]
    assert len(rows) == REPEATS
    assert len(queued) == 1, [(r.status, r.outcome) for r in rows]
    assert all(r.outcome == "superseded" for r in rows if r not in queued), [(r.status, r.outcome) for r in rows]


SILENCE_MAX_MS = 8000


@pytest.mark.parametrize("run", range(REPEATS))
async def test_r1_progress_filler_during_long_turn(run, seeded, fake_voice, timeline, route_fake):
    from app.services import intercom

    res = await _utter(seeded, fake_voice, timeline, _scenario(run)[0])
    turn = (await _turn_for(seeded.session, res["message_id"]))[0]
    speak_progress = getattr(intercom, "speak_progress")
    note = await speak_progress(seeded.session, turn)
    assert note.kind == "progress"
    assert note.text and not re.search(SUCCESS_CLAIM, note.text)


@pytest.mark.parametrize("run", range(REPEATS))
async def test_r1_sweep_speaks_progress_for_a_long_running_ask(run, seeded, fake_voice, timeline, route_fake):
    from datetime import timedelta

    from app.core.time import utcnow
    from app.services import agent_turns

    res = await _utter(seeded, fake_voice, timeline, _scenario(run)[0])
    turn = (await _turn_for(seeded.session, res["message_id"]))[0]
    turn.status = "running"
    turn.started_at = utcnow()
    turn.lease_until = utcnow() + timedelta(seconds=agent_turns.LEASE_S)
    seeded.session.add(turn)
    await seeded.session.commit()

    def progress():
        return [n for n in notes_now if n.kind == "progress"]

    await agent_turns.sweep(seeded.session)
    notes_now = await _notes(seeded.session, turn.signal_id)
    assert progress() == [], "fresh turn got a progress filler"

    turn.started_at = utcnow() - timedelta(seconds=agent_turns.PROGRESS_AFTER_S + 5)
    seeded.session.add(turn)
    await seeded.session.commit()
    await agent_turns.sweep(seeded.session)
    notes_now = await _notes(seeded.session, turn.signal_id)
    assert len(progress()) == 1, [(n.kind, n.text) for n in notes_now]
    assert not re.search(SUCCESS_CLAIM, progress()[0].text)

    await agent_turns.sweep(seeded.session)  # within PROGRESS_EVERY_S: no second filler
    notes_now = await _notes(seeded.session, turn.signal_id)
    assert len(progress()) == 1, [(n.kind, n.text) for n in notes_now]
