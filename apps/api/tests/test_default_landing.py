from app.services.operator_prefs import normalize_default_landing


def test_normalize_default_landing_defaults_to_new():
    assert normalize_default_landing(None) == "new"
    assert normalize_default_landing("") == "new"
    assert normalize_default_landing("nope") == "new"


def test_normalize_default_landing_accepts_canonical():
    assert normalize_default_landing("new") == "new"
    assert normalize_default_landing("inbox") == "inbox"
    assert normalize_default_landing("agenda") == "agenda"
    assert normalize_default_landing("today") == "today"


def test_normalize_default_landing_maps_legacy():
    assert normalize_default_landing("chat") == "new"
    assert normalize_default_landing("communication") == "inbox"
    assert normalize_default_landing("overview") == "today"
