"""Who a message speaks to, and who it only names (services/addressing.py)."""

from __future__ import annotations

import uuid

from app.services.addressing import resolve, turn_line
from app.services.pass_stick import decide_stick

ANA = uuid.uuid4()
BO = uuid.uuid4()


def m(name: str, ref: uuid.UUID, kind: str = "agent") -> str:
    return f"@[{name}]({kind}:{ref})"


def addressed(text: str) -> list[uuid.UUID]:
    return [ref for _kind, ref in resolve(text).addressed("agent")]


def referenced(text: str) -> list[uuid.UUID]:
    return [ref for _kind, ref in resolve(text).referenced("agent")]


def test_mention_at_the_start_addresses():
    assert addressed(f"{m('Ana', ANA)} kun je de factuur sturen?") == [ANA]


def test_greeting_before_the_mention_still_addresses():
    assert addressed(f"Hoi {m('Ana', ANA)}, kun je kijken?") == [ANA]


def test_mention_at_the_end_addresses():
    assert addressed(f"Kun je de factuur sturen {m('Ana', ANA)}?") == [ANA]


def test_mention_mid_sentence_is_a_reference():
    text = f"Vraag {m('Boekhouder', BO)} even of de factuur klopt en laat het weten."
    assert addressed(text) == []
    assert referenced(text) == [BO]


def test_vocative_mid_message_addresses():
    assert addressed(f"Prima. {m('Ana', ANA)}, wil jij het oppakken?") == [ANA]


def test_addressed_and_referenced_in_one_message():
    text = f"{m('Ana', ANA)} kun je met {m('Bo', BO)} de cijfers checken?"
    assert addressed(text) == [ANA]
    assert referenced(text) == [BO]


def test_plural_addresses_everyone_named():
    text = f"Wat denken jullie, {m('Ana', ANA)} en {m('Bo', BO)} over dit voorstel van gisteren?"
    assert addressed(text) == [ANA, BO]


def test_team_mentions_follow_the_same_rule():
    team = uuid.uuid4()
    result = resolve(f"Kun je {m('Sales', team, 'team')} vragen of het klopt?")
    assert result.addressed("team") == []
    assert result.referenced("team") == [("team", team)]


def test_turn_line_tells_the_agent_who_was_only_named():
    text = f"{m('Ana', ANA)} kun je met {m('Bo', BO)} de cijfers checken?"
    line = turn_line(text, ANA)
    assert "addressed directly" in line
    assert "Bo" in line and "ask_agent" in line
    assert "named in passing" in turn_line(f"Vraag {m('Ana', ANA)} even of het klopt, dank.", ANA)
    assert turn_line("Hoi", ANA) == ""


def test_decide_stick_falls_back_to_the_holder_when_nobody_is_addressed():
    holder = uuid.uuid4()
    choice = decide_stick(
        author_kind="user",
        mentioned_agent_ids=[],
        mentioned_human_ids=[],
        text="Vraag Bo even of het klopt.",
        holder_id=holder,
        wake_default=False,
        channel_agent_id=None,
    )
    assert choice["action"] == "give"
    assert choice["agent_ids"] == [holder]
    assert choice["reason"] == "follow_up"
