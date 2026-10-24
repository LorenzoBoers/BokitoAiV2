"""Overlapping voice notes: one voice per lane.

A newer line from an agent on a lane replaces that agent's unheard filler
(ack/progress) on the same lane, in the queue itself (``speak``). The answer
is never dropped; another agent or another lane is never touched; a note that
was already played stays played.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

from _v2_support import REPEATS


async def _notes(session, signal_id):
    from app.models.voice_note import VoiceNote

    return (
        await session.execute(
            select(VoiceNote).where(VoiceNote.signal_id == signal_id).order_by(VoiceNote.created_at)
        )
    ).scalars().all()


async def _lane(seeded):
    from app.services.intercom import intercom_lane

    return await intercom_lane(seeded.session, seeded.tenant.id, seeded.user.id, seeded.agent, user_name="Test")


async def _say(seeded, lane_id, kind, text, *, agent="default", status="queued"):
    from app.services.intercom import speak

    note = await speak(
        seeded.session,
        tenant_id=seeded.tenant.id,
        user=seeded.user,
        agent=seeded.agent if agent == "default" else agent,
        signal_id=lane_id,
        message_id=None,
        kind=kind,
        text=text,
        status=status,
    )
    await seeded.session.commit()
    return note


@pytest.mark.parametrize("run", range(REPEATS))
async def test_answer_replaces_unheard_filler_and_stays_queued(run, seeded):
    lane = await _lane(seeded)
    ack = await _say(seeded, lane.id, "ack", "Oké.")
    progress = await _say(seeded, lane.id, "progress", "Ik ben er nog mee bezig.")
    result = await _say(seeded, lane.id, "result", f"De offerte gaat donderdag de deur uit ({run}).")
    by_id = {n.id: n for n in await _notes(seeded.session, lane.id)}
    assert by_id[ack.id].status == "skipped" and by_id[ack.id].played_at is not None
    assert by_id[progress.id].status == "skipped"
    assert by_id[result.id].status == "queued"
    queued = [n for n in by_id.values() if n.status == "queued"]
    assert [n.kind for n in queued] == ["result"]


async def test_question_and_failure_lines_also_replace_filler(seeded):
    lane = await _lane(seeded)
    ack = await _say(seeded, lane.id, "ack", "Oké.")
    q = await _say(seeded, lane.id, "question", "Voor welke klant?")
    await seeded.session.refresh(ack)
    assert ack.status == "skipped" and q.status == "queued"


async def test_progress_replaces_only_older_progress(seeded):
    lane = await _lane(seeded)
    ack = await _say(seeded, lane.id, "ack", "Oké.")
    p1 = await _say(seeded, lane.id, "progress", "Ik ben er nog mee bezig.")
    p2 = await _say(seeded, lane.id, "progress", "Ik ben er nog mee bezig.")
    for n in (ack, p1, p2):
        await seeded.session.refresh(n)
    assert (ack.status, p1.status, p2.status) == ("queued", "skipped", "queued")


async def test_a_new_ack_never_replaces_anything(seeded):
    lane = await _lane(seeded)
    result = await _say(seeded, lane.id, "result", "Klaar.")
    ack = await _say(seeded, lane.id, "ack", "Oké.")
    await seeded.session.refresh(result)
    assert (result.status, ack.status) == ("queued", "queued")


async def test_played_notes_other_lanes_and_other_agents_are_untouched(seeded):
    from app.models.agent import Agent

    lane = await _lane(seeded)
    played = await _say(seeded, lane.id, "ack", "Oké.")
    played.status = "played"
    seeded.session.add(played)
    await seeded.session.commit()
    other_agent = Agent(
        tenant_id=seeded.tenant.id, name="[TEST] Bram", slug=f"test-bram-{uuid4().hex[:6]}"
    )
    seeded.session.add(other_agent)
    await seeded.session.commit()
    bram_ack = await _say(seeded, lane.id, "ack", "Oké.", agent=other_agent)
    no_agent = await _say(seeded, lane.id, "ack", "Oké.", agent=None)
    await _say(seeded, lane.id, "result", "Klaar.")
    for n in (played, bram_ack, no_agent):
        await seeded.session.refresh(n)
    assert played.status == "played"
    assert bram_ack.status == "queued"
    assert no_agent.status == "queued"


async def test_a_skipped_result_does_not_replace_filler(seeded):
    lane = await _lane(seeded)
    ack = await _say(seeded, lane.id, "ack", "Oké.")
    await _say(seeded, lane.id, "result", "Klaar.", status="skipped")
    await seeded.session.refresh(ack)
    assert ack.status == "queued"


@pytest.mark.parametrize("run", range(REPEATS))
async def test_spoken_ask_ends_with_one_audible_answer(run, seeded, fake_voice, timeline, route_fake):
    """End to end (mocked): ack while working, then the turn result. The ack
    row stays (history) but only the answer is still waiting to be heard."""
    from uuid import UUID

    from app.models.agent_turn import AgentTurn
    from app.services.intercom import handle_utterance, speak_turn_result

    fake_voice.transcript = "Zoek uit welke offertes voor Bakkerij De Vries nog openstaan."
    res = await handle_utterance(
        seeded.session,
        seeded.tenant.id,
        seeded.user,
        agent_id=seeded.agent.id,
        audio=b"\x1aE\xdf\xa3fake-webm-recording",
        filename="note.webm",
        mime="audio/webm",
    )
    turn = (
        await seeded.session.execute(select(AgentTurn).where(AgentTurn.cause_message_id == UUID(res["message_id"])))
    ).scalars().one()
    await speak_turn_result(seeded.session, turn, f"Er staan twee offertes open ({run}).")
    notes = await _notes(seeded.session, turn.signal_id)
    assert [n.kind for n in notes] == ["ack", "result"]
    assert [n.kind for n in notes if n.status == "queued"] == ["result"]