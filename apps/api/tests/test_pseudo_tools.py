"""Pseudo tool calls in chat text are detected and removed, never executed."""

from app.services.agent.pseudo_tools import find_pseudo_calls, release_speech, strip_pseudo_calls

NAMES = {"create_canvas", "edit_canvas", "finish_canvas"}


def test_finds_a_call_inside_and_outside_a_fence():
    text = "```javascript\ncreate_canvas(\n  title: 'x'\n)\n```\nedit_canvas({id: 1})\n"
    assert find_pseudo_calls(text, NAMES) == ["create_canvas", "edit_canvas"]


def test_release_holds_an_open_call_and_keeps_the_sentence():
    shown, held = release_speech("Ik begin.\ncreate_canvas(\n  title: 'x'\n", NAMES)
    assert shown == "Ik begin.\n"
    assert held.startswith("create_canvas(")


def test_release_drops_a_closed_call():
    shown, held = release_speech("Ik begin.\ncreate_canvas(\n  title: 'x'\n)\nKlaar.", NAMES)
    assert held == ""
    assert "create_canvas" not in shown
    assert "Ik begin." in shown
    assert "Klaar." in shown


def test_strip_drops_a_fenced_call_and_keeps_prose():
    text = (
        "Hier is de code voor het dashboard:\n\n"
        "```javascript\n"
        "create_canvas(\n"
        "  title: 'Getallen'\n"
        ")\n"
        "```\n"
        "Ik voeg dit nu toe.\n"
    )
    cleaned, dropped = strip_pseudo_calls(text, NAMES)
    assert dropped
    assert "create_canvas" not in cleaned
    assert "Ik voeg dit nu toe." in cleaned
    assert "```" not in cleaned


def test_unclosed_call_is_dropped_when_the_message_ends():
    cleaned, dropped = strip_pseudo_calls("Eerst dit.\ncreate_canvas(\n  title: 'x'", NAMES)
    assert dropped
    assert cleaned == "Eerst dit."


def test_prose_after_an_unclosed_call_stays():
    cleaned, dropped = strip_pseudo_calls(
        "Eerst dit.\ncreate_canvas(\n  title: 'x'\nIk voeg dit nu toe.",
        NAMES,
    )
    assert dropped
    assert "create_canvas" not in cleaned
    assert "Ik voeg dit nu toe." in cleaned


def test_ordinary_prose_is_unchanged():
    text = "Het gemiddelde is 4,5."
    cleaned, dropped = strip_pseudo_calls(text, NAMES)
    assert cleaned == text
    assert not dropped
