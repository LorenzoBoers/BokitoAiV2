"""Knowledge document ingestion: text extraction + upload -> WorkspaceDoc -> search."""

import io

import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.services.doc_ingest import extract_text


async def _headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _minimal_pdf(text: str) -> bytes:
    """Build a tiny single-page PDF with one text object and a valid xref."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
        ),
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for index, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n%s\nendobj\n" % (index, body))
    xref_at = out.tell()
    out.write(b"xref\n0 %d\n" % (len(objects) + 1))
    out.write(b"0000000000 65535 f \n")
    for offset in offsets:
        out.write(b"%010d 00000 n \n" % offset)
    out.write(
        b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF"
        % (len(objects) + 1, xref_at)
    )
    return out.getvalue()


def _minimal_docx(paragraphs: list[str]) -> bytes:
    import docx

    document = docx.Document()
    for text in paragraphs:
        document.add_paragraph(text)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


# --- extraction unit tests ------------------------------------------------------


def test_extract_plain_text():
    assert extract_text("notes.txt", b"Refund window is 30 days.") == "Refund window is 30 days."


def test_extract_pdf_text():
    data = _minimal_pdf("Shipping takes 3 business days.")
    assert "Shipping takes 3 business days." in extract_text("shipping.pdf", data)


def test_extract_docx_text():
    data = _minimal_docx(["Support hours are 9 to 5.", "Weekend support is email only."])
    text = extract_text("support.docx", data)
    assert "Support hours are 9 to 5." in text
    assert "Weekend support is email only." in text


def test_extract_rejects_unsupported_type():
    with pytest.raises(HTTPException) as exc:
        extract_text("photo.png", b"\x89PNG....")
    assert exc.value.status_code == 415


def test_extract_rejects_unreadable_pdf():
    with pytest.raises(HTTPException) as exc:
        extract_text("broken.pdf", b"not a pdf at all")
    assert exc.value.status_code == 422


# --- upload endpoint ------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_document_ingests_and_is_searchable(client: AsyncClient):
    headers = await _headers(client)

    resp = await client.post(
        "/api/workspace/docs/upload",
        headers=headers,
        files={"file": ("Return-Policy.txt", b"Returns are accepted within 14 days.", "text/plain")},
    )
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    assert doc["path"] == "docs/uploads/return-policy.md"
    assert doc["kind"] == "doc"
    assert doc["title"] == "Return Policy"
    assert doc["frontmatter"]["source_file"] == "Return-Policy.txt"
    assert doc["frontmatter"]["source_url"]

    search = await client.post(
        "/api/workspace/search",
        headers=headers,
        json={"query": "returns accepted days", "top_k": 5},
    )
    assert search.status_code == 200
    hits = search.json()["results"]
    assert any("Returns are accepted within 14 days." in h["content"] for h in hits)


@pytest.mark.asyncio
async def test_reupload_same_filename_updates_doc(client: AsyncClient):
    headers = await _headers(client)

    first = await client.post(
        "/api/workspace/docs/upload",
        headers=headers,
        files={"file": ("faq.txt", b"Old answer.", "text/plain")},
    )
    assert first.status_code == 200, first.text
    second = await client.post(
        "/api/workspace/docs/upload",
        headers=headers,
        files={"file": ("faq.txt", b"New answer.", "text/plain")},
    )
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first.json()["id"]

    fetched = await client.get(f"/api/workspace/docs/{first.json()['id']}", headers=headers)
    assert fetched.status_code == 200
    assert "New answer." in fetched.json()["content"]
    assert "Old answer." not in fetched.json()["content"]


@pytest.mark.asyncio
async def test_upload_docx_document(client: AsyncClient):
    headers = await _headers(client)

    data = _minimal_docx(["Enterprise plan includes SSO and audit logs."])
    resp = await client.post(
        "/api/workspace/docs/upload",
        headers=headers,
        files={
            "file": (
                "plans.docx",
                data,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert resp.status_code == 200, resp.text

    fetched = await client.get(f"/api/workspace/docs/{resp.json()['id']}", headers=headers)
    assert "Enterprise plan includes SSO and audit logs." in fetched.json()["content"]


@pytest.mark.asyncio
async def test_upload_rejects_unsupported_and_empty(client: AsyncClient):
    headers = await _headers(client)

    resp = await client.post(
        "/api/workspace/docs/upload",
        headers=headers,
        files={"file": ("image.png", b"\x89PNG", "image/png")},
    )
    assert resp.status_code == 415

    resp = await client.post(
        "/api/workspace/docs/upload",
        headers=headers,
        files={"file": ("empty.txt", b"", "text/plain")},
    )
    assert resp.status_code == 400
