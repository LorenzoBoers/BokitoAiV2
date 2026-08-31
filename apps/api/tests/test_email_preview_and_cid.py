"""Unit tests for email list-preview cleaning and CID HTML rewrite."""

from app.services.email_sync import normalize_content_id, rewrite_cid_urls
from app.services.signal_threads import clean_message_preview


def test_clean_message_preview_strips_zero_width_and_quotes():
    raw = (
        "Ok. Graag, fijne zondag.\u200b\n"
        "Op zo 30 aug. 2026 16:20 schreef Harold van Bourgondien <harold@x.nl>:\n"
        "Oh sorry Luce."
    )
    assert clean_message_preview(raw) == "Ok. Graag, fijne zondag."


def test_clean_message_preview_cuts_on_wrote_and_from():
    raw = (
        "9:30 is prima, tot vrijdag!\n"
        "From: Harold van Bourgondien <harold@x.nl>\n"
        "Sent: maandag 31 augustus 2026 15:45\n"
        "Aan: Fortune"
    )
    assert clean_message_preview(raw).startswith("9:30 is prima")
    assert "From:" not in clean_message_preview(raw)


def test_clean_message_preview_van_marker():
    raw = "Akkoord.\nVan: Harold <harold@x.nl>\nVerzonden: maandag"
    assert clean_message_preview(raw) == "Akkoord."


def test_rewrite_cid_urls_maps_bracketed_and_plain_ids():
    html = '<img src="cid:img001@foo"><img src=\'cid:<logo@bar>\'>'
    out = rewrite_cid_urls(
        html,
        {
            "img001@foo": "https://app.example/u/a.png",
            "logo@bar": "https://app.example/u/b.png",
        },
    )
    assert 'src="https://app.example/u/a.png"' in out
    assert "src='https://app.example/u/b.png'" in out
    assert "cid:" not in out


def test_normalize_content_id_strips_brackets():
    assert normalize_content_id("<abc@x>") == "abc@x"
    assert normalize_content_id(" abc@x ") == "abc@x"
