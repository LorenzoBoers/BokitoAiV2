"""Widget image attachments must reach the model as vision blocks.

Regression: old widget bundles send attachments as bare ``{id, url}`` without
a mime; the loop must still inline the image instead of degrading it to a
"[Attached files: ...]" text note.
"""

import base64

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.services.agent.loop import AgentLoop, _attachment_mime, _sniff_image_mime

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 16


def test_sniff_image_mime():
    assert _sniff_image_mime(PNG_BYTES) == "image/png"
    assert _sniff_image_mime(JPEG_BYTES) == "image/jpeg"
    assert _sniff_image_mime(b"GIF89a") == "image/gif"
    assert _sniff_image_mime(b"RIFF\x00\x00\x00\x00WEBP") == "image/webp"
    assert _sniff_image_mime(b"%PDF-1.7") is None


def test_attachment_mime_fallbacks():
    assert _attachment_mime({"mime": "image/png"}) == "image/png"
    assert _attachment_mime({"url": "https://x/api/uploads/files/t/abc_photo.jpg"}) == "image/jpeg"
    assert _attachment_mime({"name": "scan.png"}) == "image/png"
    assert _attachment_mime({"url": "https://x/files/no-extension"}) == ""


@pytest.mark.asyncio
async def test_bare_url_attachment_becomes_image_block(
    client: AsyncClient, session_override, monkeypatch
):
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()

    async def fake_fetch(url: str) -> bytes | None:
        return PNG_BYTES

    import app.services.storage as storage

    monkeypatch.setattr(storage, "fetch_attachment_bytes", fake_fetch)

    loop = AgentLoop(session_override, tenant.id, None)
    messages = [{"role": "user", "content": "Wat heb je?"}]
    # Old widget payload: no mime, extension-less URL.
    attachments = [{"id": "a1", "url": "https://app.bokito.ai/api/uploads/files/t/a1_upload"}]

    updated = await loop._apply_attachments_to_messages(messages, attachments)
    content = updated[-1]["content"]
    assert isinstance(content, list)
    image_blocks = [b for b in content if b.get("type") == "image"]
    assert len(image_blocks) == 1
    assert image_blocks[0]["source"]["media_type"] == "image/png"
    assert base64.b64decode(image_blocks[0]["source"]["data"]) == PNG_BYTES
    # The text must not degrade into an "[Attached files: ...]" note.
    text_blocks = [b for b in content if b.get("type") == "text"]
    assert text_blocks and "Attached files" not in text_blocks[0]["text"]


@pytest.mark.asyncio
async def test_non_image_attachment_stays_note(client: AsyncClient, session_override, monkeypatch):
    tenant = (
        await session_override.execute(select(Tenant).where(Tenant.slug == "test"))
    ).scalar_one()

    async def fake_fetch(url: str) -> bytes | None:
        return b"%PDF-1.7 not an image"

    import app.services.storage as storage

    monkeypatch.setattr(storage, "fetch_attachment_bytes", fake_fetch)

    loop = AgentLoop(session_override, tenant.id, None)
    messages = [{"role": "user", "content": "Zie bijlage"}]
    attachments = [{"id": "a2", "url": "https://app.bokito.ai/api/uploads/files/t/a2_doc"}]

    updated = await loop._apply_attachments_to_messages(messages, attachments)
    content = updated[-1]["content"]
    text = content if isinstance(content, str) else content[0]["text"]
    assert "Attached files" in text
