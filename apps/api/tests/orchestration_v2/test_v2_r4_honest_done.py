"""Rule 4: only report 'done' when the backend confirms.

A mock backend (``FakeBackend``) answers ok / slow / fail / timeout. The
harness models the two real exits of agent_turns.execute_turn:
  * backend confirmed -> turn done, speak_turn_result(final=<confirmation>)
  * backend failed / timed out -> agent_turns._fail_turn(turn_id, outcome)
    (the same path execute_turn's crash handler and the lease sweep use).

Pass criteria:
  R4.1  ok / slow: turn status "done"; exactly one result note after the ack,
        containing the backend's confirmation reference.
  R4.2  fail / timeout: turn status "failed"; NO voice note or agent message on
        the lane claims completion (SUCCESS_CLAIM regex).
  R4.3  fail / timeout: the person IS told, within FAILURE_NOTICE_BUDGET_MS, with
        a note whose text matches FAILURE_WORDS (silence is not honest).
  R4.4  While the backend is pending the ack must not claim completion even
        when the router's ack text does ("Klaar, de factuur is verstuurd.").
  R4.5  spoken_line keeps an honest failure sentence (does not filter it to
        nothing): Dutch failure lines stay audible and keep the failure words.
Each mode runs REPEATS (>= 5) times.
"""

from __future__ import annotations

import re
from uuid import UUID

import pytest
from sqlalchemy import select

from _v2_support import FAILURE_NOTICE_BUDGET_MS, FAILURE_WORDS, REPEATS, SUCCESS_CLAIM, FakeBackend

ASK = "Stuur de factuur van 1.250 euro naar Café Luna."


async def _start(seeded, fake_voice, timeline, route_fake):
    from app.models.agent_turn import AgentTurn
    from app.services.intercom import handle_utterance

    fake_voice.transcript = ASK
    res = await handle_utterance(
        seeded.session,
        seeded.tenant.id,
        seeded.user,
        agent_id=seeded.agent.id,
        audio=b"fake-webm",
        filename="n.webm",
        mime="audio/webm",
    )
    turn = (
        await seeded.session.execute(
            select(AgentTurn).where(AgentTurn.cause_message_id == UUID(res["message_id"]))
        )
    ).scalar_one()
    return res, turn


async def _finish_against_backend(seeded, turn, backend: FakeBackend):
    from app.core.time import utcnow
    from app.services.agent_turns import _fail_turn
    from app.services.intercom import speak_turn_result

    turn.status = "running"
    seeded.session.add(turn)
    await seeded.session.commit()
    status, detail = await backend.run()
    if status == "confirmed":
        turn.status, turn.outcome, turn.finished_at = "done", "spoke", utcnow()
        seeded.session.add(turn)
        await seeded.session.commit()
        await speak_turn_result(seeded.session, turn, detail)
    else:
        await _fail_turn(seeded.session, turn.id, "error" if status == "failed" else "timeout")
    return status


async def _lane_texts(session, signal_id):
    from app.models.signal import SignalMessage
    from app.models.voice_note import VoiceNote

    fresh = {"populate_existing": True}
    notes = (
        await session.execute(
            select(VoiceNote).where(VoiceNote.signal_id == signal_id).order_by(VoiceNote.created_at),
            execution_options=fresh,
        )
    ).scalars().all()
    msgs = (
        await session.execute(
            select(SignalMessage).where(SignalMessage.signal_id == signal_id, SignalMessage.role != "user"),
            execution_options=fresh,
        )
    ).scalars().all()
    return notes, msgs


@pytest.mark.parametrize("mode", ["ok", "slow"])
@pytest.mark.parametrize("run", range(REPEATS))
async def test_r4_confirmed_backend_reports_done(run, mode, seeded, fake_voice, timeline, route_fake):
    from app.models.agent_turn import AgentTurn

    res, turn = await _start(seeded, fake_voice, timeline, route_fake)
    backend = FakeBackend(mode=mode, timeline=timeline)
    assert await _finish_against_backend(seeded, turn, backend) == "confirmed"
    row = await seeded.session.get(AgentTurn, turn.id)
    assert row.status == "done"
    notes, _ = await _lane_texts(seeded.session, UUID(res["thread_id"]))
    results = [n for n in notes if n.kind == "result"]
    assert [n.kind for n in notes][0] == "ack"
    assert len(results) == 1, [n.kind for n in notes]
    assert "F-2026-0142" in (results[0].text or ""), results[0].text


@pytest.mark.parametrize("mode", ["fail", "timeout"])
@pytest.mark.parametrize("run", range(REPEATS))
async def test_r4_failed_backend_never_claims_done(run, mode, seeded, fake_voice, timeline, route_fake):
    from app.models.agent_turn import AgentTurn

    res, turn = await _start(seeded, fake_voice, timeline, route_fake)
    status = await _finish_against_backend(seeded, turn, FakeBackend(mode=mode, timeline=timeline))
    assert status in ("failed", "timeout")
    row = await seeded.session.get(AgentTurn, turn.id)
    assert row.status == "failed", row.status
    notes, msgs = await _lane_texts(seeded.session, UUID(res["thread_id"]))
    claims = [n.text for n in notes if re.search(SUCCESS_CLAIM, n.text or "")]
    claims += [m.body_text for m in msgs if re.search(SUCCESS_CLAIM, m.body_text or "")]
    assert not claims, f"R4.2: success claimed although backend {status}: {claims}"


@pytest.mark.parametrize("mode", ["fail", "timeout"])
@pytest.mark.parametrize("run", range(REPEATS))
async def test_r4_failed_backend_is_reported_honestly(run, mode, seeded, fake_voice, timeline, route_fake):
    res, turn = await _start(seeded, fake_voice, timeline, route_fake)
    await _finish_against_backend(seeded, turn, FakeBackend(mode=mode, timeline=timeline))
    end_evt = "backend_failed" if mode == "fail" else "backend_timeout"
    t_fail = timeline.first(end_evt)
    notes, _ = await _lane_texts(seeded.session, UUID(res["thread_id"]))
    told = [n for n in notes if n.kind != "ack" and re.search(FAILURE_WORDS, n.text or "")]
    assert told, (
        f"R4.3: backend {mode} but the person heard nothing about it. notes="
        f"{[(n.kind, n.text) for n in notes]}\n{timeline.dump()}"
    )
    t_told = next((t for t, e, _ in timeline.events if e.startswith("note_") and e != "note_ack" and t >= (t_fail or 0)), None)
    assert t_told is not None and t_told - t_fail <= FAILURE_NOTICE_BUDGET_MS, timeline.dump()


@pytest.mark.parametrize("run", range(REPEATS))
async def test_r4_ack_never_claims_done_while_pending(run, seeded, fake_voice, timeline, route_fake):
    route_fake.ack = "Klaar, de factuur is verstuurd."
    res, turn = await _start(seeded, fake_voice, timeline, route_fake)
    assert turn.status == "queued"
    notes, msgs = await _lane_texts(seeded.session, UUID(res["thread_id"]))
    spoken = [n.text for n in notes] + [m.body_text for m in msgs]
    claims = [t for t in spoken if re.search(SUCCESS_CLAIM, t or "")]
    assert not claims, f"R4.4: claimed completion while the turn is still queued: {claims}"


HONEST_FAILURES = [
    "Bram reageerde niet binnen de tijdslimiet, dus de factuur is niet verstuurd.",
    "Het versturen is mislukt: de mailserver gaf een fout.",
    "De boeking is niet gelukt; het boekhoudsysteem gaf een time-out.",
    "Ik kreeg geen bevestiging van het boekhoudsysteem, dus het is nog niet gedaan.",
    "Dat lukte niet: Café Luna staat niet in de debiteurenlijst.",
]


@pytest.mark.parametrize("line", HONEST_FAILURES)
def test_r4_spoken_line_keeps_honest_failures(line):
    from app.services.intercom import spoken_line

    for _ in range(REPEATS):
        out = spoken_line(line)
        assert out.strip(), f"R4.5: honest failure filtered to silence: {line!r}"
        assert re.search(FAILURE_WORDS, out), (line, out)
        assert not re.search(SUCCESS_CLAIM, out), (line, out)
