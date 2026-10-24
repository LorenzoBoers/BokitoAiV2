"""Job card: missing slots, resume, and grounded replies."""

from app.services.job_card import (
    classify,
    delegation_block,
    failure_text,
    ground_reply,
    lookup_argument,
    query_in_bounds,
    resolve,
    should_ask,
    tools_for,
    unpack,
    pack,
)


def test_invoice_without_a_customer_asks_and_names_nobody():
    card = classify("Kan je mij helpen een factuur op te zoeken?", "nl")
    assert card["job"] == "invoice"
    assert card["missing"] == ["customer"]
    assert should_ask(card)
    assert "Bakkerij" not in card["question"]
    assert "factuurnummer" in card["question"]


def test_a_prior_name_does_not_fill_a_new_invoice():
    earlier = classify("Er is een map Bakkerij De Korenaar", "nl")
    assert earlier["job"] != "invoice" or "Bakkerij" not in classify(
        "Kan je mij helpen een factuur op te zoeken?", "nl"
    )["slots"].get("customer", "")
    card = resolve("Kan je mij helpen een factuur op te zoeken?", None, "nl")
    assert "customer" not in card["slots"]


def test_a_name_resumes_the_open_invoice():
    open_job = classify("een factuur voor mij opzoeken?", "nl")
    assert open_job["status"] == "open"
    card = resolve("Bakkerij De Korenaar", open_job, "nl")
    assert card["job"] == "invoice"
    assert card["slots"]["customer"] == "Bakkerij De Korenaar"
    assert card["missing"] == []
    assert "Bakkerij De Korenaar" in card["brief"]
    assert "Geen andere klant" in card["brief"]


def test_phone_with_a_name_does_not_ask():
    card = classify("Zoek het telefoonnummer van Bakkerij De Korenaar", "nl")
    assert card["job"] == "contact"
    assert card["slots"]["customer"] == "Bakkerij De Korenaar"
    assert should_ask(card) is False


def test_email_has_no_lookup_and_delegation_blocks_a_bare_invoice():
    mail = classify("Stuur een mail naar de klant", "nl")
    assert mail["job"] == "email"
    assert should_ask(mail) is False
    blocked = delegation_block("zoek een factuur op", "nl")
    assert blocked is not None
    assert "factuurnummer" in blocked
    assert delegation_block("zoek de factuur van Bakkerij De Korenaar", "nl") is None


def test_lookup_query_must_use_the_sentence():
    sentence = "Kan je mij helpen een factuur op te zoeken?"
    assert query_in_bounds("Bakkerij De Korenaar", sentence, {}) is False
    assert query_in_bounds("", sentence, {}) is False
    assert query_in_bounds(
        "Bakkerij De Korenaar",
        "Zoek het telefoonnummer van Bakkerij De Korenaar",
        {},
    )


def test_reply_may_not_introduce_a_customer():
    card = classify("Kan je mij helpen een factuur op te zoeken?", "nl")
    reply = ground_reply(
        "Ik zoek de factuur op voor de klant Bakkerij De Korenaar.",
        "Kan je mij helpen een factuur op te zoeken?",
        card,
    )
    assert "Bakkerij" not in reply
    assert "factuurnummer" in reply
    kept = ground_reply(
        "Het nummer van Bakkerij De Korenaar is 06.",
        "Zoek het telefoonnummer van Bakkerij De Korenaar",
        classify("Zoek het telefoonnummer van Bakkerij De Korenaar"),
    )
    assert "Bakkerij De Korenaar" in kept


def test_pack_roundtrip_and_failed_call_marker():
    card = classify("factuur 2026-118", "nl")
    assert card["slots"].get("number")
    visible, loaded = unpack(pack("zoek die factuur", card))
    assert visible == "zoek die factuur"
    assert loaded["job"] == "invoice"
    assert "sentence" in loaded
    assert failure_text({"status": "denied", "error": "not available"}) == "not available"
    assert failure_text({"error": "a tool call failed", "hint": "Call the tool again with the same arguments."}) is None


def test_lookup_stays_inside_the_sentence():
    assert lookup_argument("list_contacts", {"query": "Bakkerij"}) == "Bakkerij"
    assert lookup_argument("list_contacts", {"contact_id": "abc"}) is None
    assert lookup_argument("list_contacts", {}) == ""
    assert lookup_argument("accounting_list_documents", {"query": "Bakkerij"}) is None
    blocked = delegation_block("zoek een factuur")
    assert blocked and "factuurnummer" in blocked
    assert delegation_block("factuur van Bakkerij De Korenaar") is None


def test_open_work_is_a_lookup_not_a_guess():
    card = classify("Wat is het openstaand werk dat we nu hebben?", "nl")
    assert card["job"] == "status"
    assert card["missing"] == []
    assert not should_ask(card)
    assert "list_threads" in tools_for(card)


def test_a_promise_to_keep_checking_is_not_the_answer():
    from app.services.intercom import drop_unfinished_promise, spoken_line

    reply = (
        "Er is momenteel geen openstaand werk in de pipeline. "
        "*Ik check nu of er nog andere acties zijn in de andere flows (bijv. onboarding of rapportage) – laat me even controleren.*"
    )
    assert "controleren" not in drop_unfinished_promise(reply)
    assert "pipeline" in drop_unfinished_promise(reply)
    heard = spoken_line(reply)
    assert "controleren" not in heard
    assert "bijv" not in heard
