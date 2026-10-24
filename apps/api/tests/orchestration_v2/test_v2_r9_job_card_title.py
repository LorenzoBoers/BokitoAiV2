"""A quoted title fills the sheet slot; a new full request does not inherit an open question."""

from app.services.job_card import classify, resolve, should_ask


def test_quoted_lowercase_title_fills_sheet_slot():
    card = classify("Zet de punten op een dashboard met de titel 'Trends bakkerij'.")
    assert card["job"] == "sheet"
    assert card["slots"] == {"title": "Trends bakkerij"}
    assert not should_ask(card)


def test_double_and_curly_quotes_fill_the_title():
    assert classify('Maak een dashboard met de titel "omzet q3".')["slots"]["title"] == "omzet q3"
    assert classify("Maak een map met de naam \u201cklanten noord\u201d.")["slots"]["name"] == "klanten noord"


def test_unquoted_name_still_works_and_missing_title_still_asks():
    assert classify("Maak een dashboard met de titel Offerte de Vries")["slots"]["title"] == "Offerte de Vries"
    assert should_ask(classify("Maak een dashboard"))


def test_apostrophe_s_is_not_a_title():
    assert classify("Ik maak 's middags een map")["missing"] == ["name"]


def _open_sheet():
    card = classify("Maak een dashboard")
    return {**card, "status": "open"}


def test_short_reply_still_fills_the_open_question():
    out = resolve("Trends Bakkerij", _open_sheet())
    assert out["job"] == "sheet" and out["slots"]["title"] == "Trends Bakkerij"


def test_long_unrelated_request_starts_its_own_card():
    out = resolve("Ada, vraag aan Cato of de planning dinsdagmiddag vrij is waar jij was.", _open_sheet())
    assert out["job"] != "sheet"
    assert not should_ask(out)

def test_nameless_canvas_or_folder_list_is_not_a_name_search():
    from app.services.job_card import lookup_argument

    assert lookup_argument("list_canvases", {}) is None
    assert lookup_argument("list_folders", {}) is None
    assert lookup_argument("list_canvases", {"query": "Trends"}) == "Trends"
    assert lookup_argument("list_contacts", {}) == ""