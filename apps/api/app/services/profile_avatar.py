"""User profile photo validation and packing for data-URI storage."""

from __future__ import annotations

import base64
import re

# Incoming upload ceiling (FE compresses; this is a safety net).
MAX_AVATAR_UPLOAD_BYTES = 2_000_000
# Stored raster decode ceiling (signatures / public avatar route).
MAX_AVATAR_STORED_BYTES = 2_000_000

_ALLOWED_MIME = frozenset(
    {
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
    }
)


def sniff_image_mime(raw: bytes) -> str | None:
    """Detect raster image type from magic bytes. SVG/HEIC are refused."""
    if len(raw) < 12:
        return None
    if raw[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return None


def pack_avatar_data_uri(raw: bytes, *, content_type: str | None = None) -> str:
    """Validate bytes and return a ``data:image/...;base64,...`` URI."""
    if not raw:
        raise ValueError("Empty image")
    if len(raw) > MAX_AVATAR_UPLOAD_BYTES:
        raise ValueError("Image too large (max 2 MB)")
    mime = sniff_image_mime(raw)
    if mime is None:
        # Fall back to declared type only when sniff fails but type is allowed
        # (some tiny valid files); still require a known family.
        declared = (content_type or "").split(";")[0].strip().lower()
        if declared == "image/jpg":
            declared = "image/jpeg"
        if declared not in _ALLOWED_MIME:
            raise ValueError("Unsupported image type. Use JPG, PNG, GIF, or WebP.")
        mime = declared
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


_RASTER_DATA_RE = re.compile(
    r"^data:image/(png|jpe?g|gif|webp);base64,(.+)$",
    re.IGNORECASE | re.DOTALL,
)


def decode_raster_avatar(url: str | None) -> tuple[str, bytes] | None:
    """Decode a stored raster data URI. SVG is refused."""
    match = _RASTER_DATA_RE.match((url or "").strip())
    if not match:
        return None
    mime = match.group(1).lower()
    if mime == "jpg":
        mime = "jpeg"
    try:
        data = base64.b64decode(re.sub(r"\s+", "", match.group(2)))
    except Exception:
        return None
    if not data or len(data) > MAX_AVATAR_STORED_BYTES:
        return None
    return f"image/{mime}", data
