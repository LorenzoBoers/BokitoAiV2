"""Folder contents: type parsing and image vs file."""

from app.services.folder_contents import is_image_attachment, parse_contents_type


def test_parse_contents_type():
    assert parse_contents_type(None) == ("all", None)
    assert parse_contents_type("file") == ("file", None)
    assert parse_contents_type("canvas:sheet") == ("canvas", "sheet")


def test_parse_contents_type_rejects_unknown():
    try:
        parse_contents_type("canvas:nope")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 422
    else:
        raise AssertionError("expected 422")


def test_image_attachment_uses_type_then_extension():
    assert is_image_attachment("scan.bin", "image/png")
    assert is_image_attachment("photo.JPG", "")
    assert not is_image_attachment("brief.pdf", "application/pdf")
    assert not is_image_attachment("no-extension", "")
