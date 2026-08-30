"""Unit tests for the suggestion splitter (clean draft + internal note)."""

from app.services.suggestion_format import split_suggestion


def test_sentinel_note_is_extracted():
    raw = (
        "Hallo Jan,\n\nBedankt voor je bericht. We komen hier snel op terug.\n\n"
        "INTERNAL_NOTE: Kennisbank bevat geen productinformatie; check company.md."
    )
    parts = split_suggestion(raw)
    assert parts.body == "Hallo Jan,\n\nBedankt voor je bericht. We komen hier snel op terug."
    assert "company.md" in parts.internal_note
    assert "INTERNAL_NOTE" not in parts.body


def test_preamble_without_divider_is_peeled_before_greeting():
    # Live leak: research text then greeting with no --- divider.
    raw = (
        "Het company doc is een stub met minimale inhoud. Op basis van de "
        "platformhulp kan ik een algemene beschrijving van Bokito opstellen.\n\n"
        "Hoi Sjaak,\n\n"
        "Bedankt voor je bericht! Bokito brengt berichten, agents en goedkeuringen "
        "samen in één systeem."
    )
    parts = split_suggestion(raw)
    assert parts.body.startswith("Hoi Sjaak,")
    assert "company doc" not in parts.body
    assert "platformhulp" not in parts.body
    assert "stub" in parts.internal_note
    assert "platformhulp" in parts.internal_note


def test_production_leak_pattern_is_fully_cleaned():
    # The exact shape that leaked to a contact: meta preamble, dividers,
    # legacy internal note block, and a model-written sign-off.
    raw = (
        "Het bedrijfsdocument (company.md) is een lege stub met slechts één zin. "
        "Er is geen verdere productbeschrijving beschikbaar. Hieronder staat een "
        "voorzichtige conceptreactie.\n"
        "---\n"
        "Hallo,\n\n"
        "Bedankt voor je interesse. Op dit moment kan ik je nog geen volledige "
        "productbeschrijving geven.\n\n"
        "Met vriendelijke groet,\n"
        "Bokito Assistent\n"
        "---\n"
        "**Interne notitie:** company.md moet nog gevuld worden."
    )
    parts = split_suggestion(raw)
    assert parts.body.startswith("Hallo,")
    assert "company.md" not in parts.body
    assert "Interne notitie" not in parts.body
    assert "Met vriendelijke groet" not in parts.body
    assert "Bokito Assistent" not in parts.body
    assert "---" not in parts.body
    # Both the preamble and the note block end up in the internal note.
    assert "lege stub" in parts.internal_note
    assert "gevuld" in parts.internal_note


def test_legacy_internal_note_block_without_divider():
    raw = (
        "Hi Sarah,\n\nYour refund has been processed.\n\n"
        "Internal note: refund issued via Stripe dashboard, ref 12345."
    )
    parts = split_suggestion(raw)
    assert parts.body == "Hi Sarah,\n\nYour refund has been processed."
    assert "Stripe" in parts.internal_note


def test_signoff_with_name_on_same_line():
    raw = "Beste Piet,\n\nWe plannen dit in.\n\nMet vriendelijke groet, Bokito Assistent"
    parts = split_suggestion(raw)
    assert parts.body == "Beste Piet,\n\nWe plannen dit in."


def test_signoff_multiline_with_name_and_role():
    raw = (
        "Hello,\n\nThe invoice was resent to your billing address.\n\n"
        "Kind regards,\nSupport Agent\nBokito Team"
    )
    parts = split_suggestion(raw)
    assert parts.body == "Hello,\n\nThe invoice was resent to your billing address."


def test_clean_text_passes_through_unchanged():
    raw = "Hallo Kim,\n\nJe account is geactiveerd. Je kunt direct inloggen."
    parts = split_suggestion(raw)
    assert parts.body == raw
    assert parts.internal_note == ""


def test_body_never_lost_when_cleaning_removes_everything():
    raw = "Met vriendelijke groet,\nBokito Assistent"
    parts = split_suggestion(raw)
    assert parts.body == raw  # falls back to the original text


def test_question_line_is_not_treated_as_signoff_name():
    raw = "Hallo,\n\nKun je het factuurnummer doorgeven?\nDan zoek ik het direct op."
    parts = split_suggestion(raw)
    assert parts.body == raw


def test_no_preamble_stripping_without_greeting_after_divider():
    raw = "Punt een.\n---\nPunt twee zonder aanhef."
    parts = split_suggestion(raw)
    # Divider noise is removed but no text is reclassified as preamble.
    assert "Punt een." in parts.body
    assert "Punt twee zonder aanhef." in parts.body
    assert parts.internal_note == ""


def test_empty_input():
    parts = split_suggestion("")
    assert parts.body == ""
    assert parts.internal_note == ""


def test_operator_prompt_prefix_is_stripped():
    raw = (
        "A teammate asked you to draft a reply to the customer in this thread. "
        "Return only the reply body text (no meta-commentary). "
        "Teammate's request: keep it short\n\n"
        "Hallo Sanne,\n\nHet bedrag klopt."
    )
    parts = split_suggestion(raw)
    assert parts.body.startswith("Hallo Sanne")
    assert "teammate" not in parts.body.lower()
    assert "meta-commentary" not in parts.body.lower()


def test_reviewer_note_line_is_stripped():
    raw = "Hallo Kim,\n\nJe account is geactiveerd.\n\n> Note for the reviewer: check company.md"
    parts = split_suggestion(raw)
    assert "Hallo Kim" in parts.body
    assert "reviewer" not in parts.body.lower()


def test_format_customer_email_rewrites_docs_markdown_link():
    from app.services.suggestion_format import format_customer_email_body

    plain, html = format_customer_email_body(
        "Meer info: [Widget](/docs/inbox/widget)",
        base="https://app.bokito.ai",
    )
    assert plain == "Meer info: Widget (https://app.bokito.ai/docs/inbox/widget)"
    assert 'href="https://app.bokito.ai/docs/inbox/widget"' in html
    assert "[Widget]" not in plain


def test_format_customer_email_rewrites_bare_app_path():
    from app.services.suggestion_format import format_customer_email_body

    plain, html = format_customer_email_body(
        "Open /settings/channels voor de koppeling.",
        base="https://app.bokito.ai",
    )
    assert "https://app.bokito.ai/settings/channels" in plain
    assert 'href="https://app.bokito.ai/settings/channels"' in html


def test_format_customer_email_expands_short_docs_slug():
    from app.services.suggestion_format import format_customer_email_body

    plain, _html = format_customer_email_body(
        "Lees meer: https://app.bokito.ai/docs/widget",
        base="https://app.bokito.ai",
    )
    assert "https://app.bokito.ai/docs/inbox/widget" in plain
    assert "/docs/widget" not in plain.replace("/docs/inbox/widget", "")
