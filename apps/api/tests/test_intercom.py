"""Intercom candidate query + silence / name-hallucination guards."""

from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.signal import Signal
from app.services.intercom import (
    _candidates,
    _name_only_transcript,
    _stt_prompt_echo,
    _wav_rms,
    spoken_line,
)
from scripts.seed import TEST_EMAIL


@pytest.mark.asyncio
async def test_candidates_uses_assignee_kind_not_compat_attr(client, session_override):
    _ = client  # seeds the test tenant, user and agents
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    agent = (
        await session_override.execute(select(Agent).where(Agent.tenant_id == tenant.id).limit(1))
    ).scalar_one()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="operator",
        subject="[TEST] candidate mine",
        agent_id=agent.id,
        owner_user_id=user.id,
        assignee_kind="user",
        assignee_id=user.id,
        last_message_at=datetime.utcnow(),
    )
    session_override.add(signal)
    await session_override.commit()

    rows = await _candidates(session_override, tenant.id, user.id, agent, [])
    assert any(r.id == signal.id for r in rows)


def test_name_only_transcript_flags_whisper_echo():
    agents = [
        SimpleNamespace(name="[TEST] Ada"),
        SimpleNamespace(name="[TEST] Bram"),
        SimpleNamespace(name="[TEST] Cato"),
    ]
    assert _name_only_transcript("Ada, Bram, Cato", agents) is True
    assert _name_only_transcript("Ada, wat is de status?", agents) is False


def test_stt_prompt_echo_flags_language_hint():
    assert _stt_prompt_echo("Gesproken Nederlands.") is True
    assert _stt_prompt_echo("Spoken English") is True
    assert _stt_prompt_echo("Maak een spreadsheet met omzet") is False


def test_sentence_names_thread_needs_a_title_word():
    from app.services.intercom import sentence_names_thread

    thread = SimpleNamespace(subject="Posts Fysio Nijkerk ter goedkeuring")
    assert sentence_names_thread("Voeg jij mij iets?", thread) is False
    assert sentence_names_thread("Hoe staat de goedkeuring bij Fysio?", thread) is True


def test_stock_ack_gives_way_to_the_sentence():
    from app.services.intercom import _ack_invents, _specific_ack, _stock_ack, spoken_line

    thread = SimpleNamespace(subject="Posts Fysio Nijkerk ter goedkeuring")
    assert _stock_ack("Ik zoek het uit.") is True
    # A short ask gets the short bliep, never an echo of the sentence.
    line = _specific_ack("Kijk in de map Bakkerij De Korenaar", "nl")
    assert line == "Oké."
    assert _stock_ack(line) is False
    assert _ack_invents(
        "Ik begrijp dat je iets wilt weten over de goedkeuring bij Fysio.",
        "Voeg jij mij iets?",
        thread,
    ) is True
    assert _ack_invents("Ik heb je gehoord.", "Voeg jij mij iets?", thread) is False
    assert spoken_line("Ik zoek het uit. De map Bakkerij staat klaar.") == "De map Bakkerij staat klaar."


def test_addressed_agent_misses_a_close_spelling():
    from app.services.intercom import addressed_agent

    lotty = SimpleNamespace(name="Lotty", id="1")
    found, _rest = addressed_agent("Lottie kan je mij een mop vertellen", [lotty])
    assert found is None


def test_agent_from_pick_accepts_the_model_id_and_rejects_unknown():
    from app.services.intercom import agent_from_pick

    lotty = SimpleNamespace(name="Lotty", id="lotty-id")
    other = SimpleNamespace(name="Ada", id="ada-id")
    heard = "Lottie kan je mij een mop vertellen"
    found, rest = agent_from_pick(
        '{"agent_id": "lotty-id", "rest": "kan je mij een mop vertellen"}',
        [lotty, other],
        heard,
    )
    assert found is lotty
    assert "mop" in rest
    assert agent_from_pick('{"agent_id": ""}', [lotty], heard)[0] is None
    assert agent_from_pick('{"agent_id": "nope"}', [lotty], heard)[0] is None
    found, rest = agent_from_pick('{"agent_id": "lotty-id", "rest": "Lotty"}', [lotty], heard)
    assert found is lotty
    assert rest == heard


def test_addressed_agent_matches_given_name_after_bracket_prefix():
    from app.services.intercom import addressed_agent

    a = SimpleNamespace(name="[TEST] Ada", id="1")
    b = SimpleNamespace(name="[TEST] Bram", id="2")
    found, rest = addressed_agent("Ada, kijk even", [a, b])
    assert found is a
    assert "kijk" in rest.lower()


def test_wav_rms_detects_silence():
    import io
    import struct
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00\x00" * 4800)
    silent = buf.getvalue()
    assert _wav_rms(silent) is not None
    assert _wav_rms(silent) < 0.01

    buf2 = io.BytesIO()
    with wave.open(buf2, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        frames = b"".join(struct.pack("<h", 8000) for _ in range(2400))
        w.writeframes(frames)
    assert (_wav_rms(buf2.getvalue()) or 0) > 0.05


def test_spoken_line_keeps_the_answer_and_drops_the_assignment():
    announcement = "Ik vraag het @[[TEST] Bram](agent:59c79ffe-92b5-4209-97bb-7ca40e57d723) even."
    assert spoken_line(announcement) == ""
    assert spoken_line("De offerte gaat donderdag de deur uit.") == "De offerte gaat donderdag de deur uit."
    promise = "Bram checkt nu of de offerte nog deze week kan. Ik laat je direct weten wat hij terugzendt."
    assert spoken_line(promise) == ""
    mixed = "De offerte gaat donderdag de deur uit. Ik check nu of een middag vrij is."
    assert spoken_line(mixed) == "De offerte gaat donderdag de deur uit."
    heard = spoken_line(
        "Zo verplaats je een gesprek naar een ander gesprek. Gebruik move_to_conversation daarvoor."
    )
    assert "move_to_conversation" not in heard
    assert "verplaats" in heard
    raw = "The agent wants to send reply. De offerte gaat donderdag de deur uit."
    assert spoken_line(raw) == "De offerte gaat donderdag de deur uit."
    assert spoken_line("De tool om producthandleidingen te zoeken reageerde niet binnen de tijdslimiet.") == ""
