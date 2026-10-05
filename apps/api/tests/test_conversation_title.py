from app.services.conversation_title import (
    intent_title,
    is_placeholder_subject,
    maybe_apply_intent_title,
)


def test_placeholder_subjects():
    assert is_placeholder_subject("New conversation")
    assert is_placeholder_subject("Website chat")
    assert is_placeholder_subject("  ")
    assert not is_placeholder_subject("Invoice check")


def test_intent_title_compresses_long_first_line():
    long = (
        "Can you walk through the whole onboarding for Acme including the "
        "token budget, the project agent, and how queue items move?"
    )
    title = intent_title(long)
    assert title
    assert title != long
    assert len(title) <= 48
    assert "onboarding" in title.lower() or "walk" in title.lower()


def test_intent_title_keeps_a_short_request():
    assert intent_title("Check the Acme invoice") == "Check the Acme invoice"


def test_intent_title_strips_greeting():
    assert intent_title("Hoi, kun je de factuur van Acme checken?") == "kun je de factuur van Acme checken?"


def test_maybe_apply_writes_once():
    class Row:
        subject = "New conversation"

    row = Row()
    assert maybe_apply_intent_title(row, "Help with invoices please and also the budget")
    first = row.subject
    assert first != "New conversation"
    assert not maybe_apply_intent_title(row, "A completely different follow-up")
    assert row.subject == first
