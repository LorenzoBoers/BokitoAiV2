from app.services.profile_avatar import (
    MAX_AVATAR_UPLOAD_BYTES,
    decode_raster_avatar,
    pack_avatar_data_uri,
    sniff_image_mime,
)

# Minimal 1x1 PNG
_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_sniff_png():
    assert sniff_image_mime(_PNG) == "image/png"


def test_sniff_rejects_svg_and_garbage():
    assert sniff_image_mime(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>") is None
    assert sniff_image_mime(b"not-an-image") is None


def test_pack_and_decode_roundtrip():
    uri = pack_avatar_data_uri(_PNG)
    assert uri.startswith("data:image/png;base64,")
    mime, data = decode_raster_avatar(uri)
    assert mime == "image/png"
    assert data == _PNG


def test_pack_rejects_oversized():
    raw = b"\xff\xd8\xff" + b"\x00" * (MAX_AVATAR_UPLOAD_BYTES + 8)
    try:
        pack_avatar_data_uri(raw)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "2 MB" in str(exc)
