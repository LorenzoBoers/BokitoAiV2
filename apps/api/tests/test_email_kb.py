"""Phase 5 wiring: email ai-config, routing rules, and knowledge base."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

API = "/api"


async def _login(client: AsyncClient) -> str:
    res = await client.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return res.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _mailbox_id(client: AsyncClient, headers: dict[str, str]) -> int:
    accounts = await client.get(f"{API}/email/accounts", headers=headers)
    assert accounts.status_code == 200
    rows = accounts.json()
    assert rows
    return rows[0]["id"]


@pytest.mark.asyncio
async def test_email_ai_config_roundtrip(client: AsyncClient):
    headers = _auth(await _login(client))
    mailbox_id = await _mailbox_id(client, headers)

    saved = await client.put(
        f"{API}/email/connections/{mailbox_id}/ai-config",
        headers=headers,
        json={"ai_config": {"suggestions_enabled": False, "tone": "informeel"}},
    )
    assert saved.status_code == 200

    got = await client.get(f"{API}/email/connections/{mailbox_id}/ai-config", headers=headers)
    assert got.status_code == 200
    assert got.json()["ai_config"]["suggestions_enabled"] is False
    assert got.json()["ai_config"]["tone"] == "informeel"


@pytest.mark.asyncio
async def test_routing_rules_crud(client: AsyncClient):
    headers = _auth(await _login(client))
    mailbox_id = await _mailbox_id(client, headers)

    created = await client.post(
        f"{API}/email/routing-rules",
        headers=headers,
        json={
            "mailbox_id": mailbox_id,
            "priority": 10,
            "condition_type": "sender_domain",
            "condition_value": "acme.com",
            "labels": ["vip"],
            "is_active": True,
        },
    )
    assert created.status_code == 200
    rule_id = created.json()["id"]
    assert created.json()["labels"] == ["vip"]

    listed = await client.get(f"{API}/email/routing-rules?mailbox_id={mailbox_id}", headers=headers)
    assert listed.status_code == 200
    assert any(r["id"] == rule_id for r in listed.json()["items"])

    patched = await client.patch(
        f"{API}/email/routing-rules/{rule_id}",
        headers=headers,
        json={"priority": 5, "is_active": False},
    )
    assert patched.status_code == 200
    assert patched.json()["priority"] == 5
    assert patched.json()["is_active"] is False

    deleted = await client.delete(f"{API}/email/routing-rules/{rule_id}", headers=headers)
    assert deleted.status_code == 200


@pytest.mark.asyncio
async def test_kb_collections_documents_and_search(client: AsyncClient):
    headers = _auth(await _login(client))

    collection = await client.post(
        f"{API}/kb/collections",
        headers=headers,
        json={"name": "Handbook", "description": "Company docs"},
    )
    assert collection.status_code == 200
    collection_id = collection.json()["id"]

    doc = await client.post(
        f"{API}/kb/collections/{collection_id}/documents",
        headers=headers,
        json={
            "filename": "onboarding.pdf",
            "file_url": "https://files.local/onboarding.pdf",
            "file_type": "pdf",
            "file_size_bytes": 1024,
        },
    )
    assert doc.status_code == 200
    assert doc.json()["collection_id"] == collection_id
    # Unfetchable file -> honest failure instead of a fake "indexed".
    assert doc.json()["index_status"] == "failed"
    assert doc.json()["index_error"]

    docs = await client.get(f"{API}/kb/collections/{collection_id}/documents", headers=headers)
    assert docs.status_code == 200
    assert len(docs.json()["items"]) == 1

    collections = await client.get(f"{API}/kb/collections", headers=headers)
    target = next(c for c in collections.json()["items"] if c["id"] == collection_id)
    assert target["document_count"] == 1

    search = await client.get(f"{API}/kb/search?query=onboarding&limit=5", headers=headers)
    assert search.status_code == 200
    assert any(item["filename"] == "onboarding.pdf" for item in search.json()["items"])

    document_id = doc.json()["id"]
    removed = await client.delete(f"{API}/kb/documents/{document_id}", headers=headers)
    assert removed.status_code == 200

    gone = await client.delete(f"{API}/kb/collections/{collection_id}", headers=headers)
    assert gone.status_code == 200
    collections = await client.get(f"{API}/kb/collections", headers=headers)
    assert all(c["id"] != collection_id for c in collections.json()["items"])


@pytest.mark.asyncio
async def test_kb_document_real_ingestion(client: AsyncClient, monkeypatch):
    """Fetchable text file is extracted, chunked, and searchable by content."""
    headers = _auth(await _login(client))

    async def _fake_fetch(url: str) -> bytes | None:
        return b"# Refund policy\n\nCustomers can request a refund within 30 days."

    monkeypatch.setattr("app.services.storage.fetch_attachment_bytes", _fake_fetch)

    collection = await client.post(
        f"{API}/kb/collections",
        headers=headers,
        json={"name": "Policies", "description": None},
    )
    collection_id = collection.json()["id"]

    doc = await client.post(
        f"{API}/kb/collections/{collection_id}/documents",
        headers=headers,
        json={
            "filename": "refunds.md",
            "file_url": "/api/uploads/refunds.md",
            "file_type": "md",
            "file_size_bytes": 64,
        },
    )
    assert doc.status_code == 200
    assert doc.json()["index_status"] == "indexed"
    assert doc.json()["index_error"] is None

    # Chunks were written, so the collection reports real chunk counts.
    collections = await client.get(f"{API}/kb/collections", headers=headers)
    target = next(c for c in collections.json()["items"] if c["id"] == collection_id)
    assert target["document_count"] == 1
    assert target["total_chunks"] >= 1

    # Content (not just the filename) is searchable.
    search = await client.get(f"{API}/kb/search?query=refund&limit=5", headers=headers)
    assert any(item["filename"] == "refunds.md" for item in search.json()["items"])

    # Deleting the document also removes its chunks.
    document_id = doc.json()["id"]
    removed = await client.delete(f"{API}/kb/documents/{document_id}", headers=headers)
    assert removed.status_code == 200
    collections = await client.get(f"{API}/kb/collections", headers=headers)
    target = next(c for c in collections.json()["items"] if c["id"] == collection_id)
    assert target["total_chunks"] == 0
