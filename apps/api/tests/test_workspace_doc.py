import pytest
from httpx import AsyncClient


async def _headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_workspace_docs_crud(client: AsyncClient):
    headers = await _headers(client)

    created = await client.post(
        "/api/workspace/docs",
        headers=headers,
        json={
            "path": "skills/triage",
            "content": "---\nname: Triage\ndescription: Categorize inbound threads\n---\n# Triage\n\nSteps to triage inbound messages.",
        },
    )
    assert created.status_code == 200
    doc = created.json()
    assert doc["path"] == "skills/triage.md"
    assert doc["kind"] == "skill"
    assert doc["frontmatter"]["name"] == "Triage"
    assert doc["content"].startswith("# Triage")

    listing = await client.get("/api/workspace/docs", headers=headers, params={"kind": "skill"})
    assert listing.status_code == 200
    paths = [d["path"] for d in listing.json()["docs"]]
    assert "skills/triage.md" in paths

    updated = await client.patch(
        f"/api/workspace/docs/{doc['id']}",
        headers=headers,
        json={"content": "# Triage\n\nUpdated body."},
    )
    assert updated.status_code == 200
    assert "Updated body." in updated.json()["content"]

    fetched = await client.get(f"/api/workspace/docs/{doc['id']}", headers=headers)
    assert fetched.status_code == 200

    deleted = await client.delete(f"/api/workspace/docs/{doc['id']}", headers=headers)
    assert deleted.status_code == 200

    gone = await client.get(f"/api/workspace/docs/{doc['id']}", headers=headers)
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_workspace_hybrid_search(client: AsyncClient):
    headers = await _headers(client)

    await client.post(
        "/api/workspace/docs",
        headers=headers,
        json={
            "path": "docs/refunds.md",
            "content": "# Refund policy\n\nCustomers can request a refund within 30 days of purchase.",
        },
    )

    resp = await client.post(
        "/api/workspace/search",
        headers=headers,
        json={"query": "refund policy days", "top_k": 5},
    )
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert results
    assert any("refund" in r["content"].lower() for r in results)


@pytest.mark.asyncio
async def test_doc_sections_crud_and_render(client: AsyncClient):
    """Sections are the atomic unit: CRUD per section, page render derived."""
    headers = await _headers(client)

    created = await client.post(
        "/api/workspace/docs",
        headers=headers,
        json={
            "path": "docs/handbook.md",
            "content": "# Handbook\n\n## Onboarding\n\nWelcome new people.\n\n## Offboarding\n\nRevoke access.\n",
        },
    )
    assert created.status_code == 200
    doc_id = created.json()["id"]

    fetched = await client.get(f"/api/workspace/docs/{doc_id}", headers=headers)
    sections = fetched.json()["sections"]
    assert [s["heading"] for s in sections] == ["", "Onboarding", "Offboarding"]
    assert all(s["status"] == "draft" for s in sections)
    onboarding = sections[1]

    # Patch one section's content: page render updates, status stays draft.
    patched = await client.patch(
        f"/api/workspace/docs/{doc_id}/sections/{onboarding['id']}",
        headers=headers,
        json={"content": "Welcome new people warmly."},
    )
    assert patched.status_code == 200
    page = await client.get(f"/api/workspace/docs/{doc_id}", headers=headers)
    assert "Welcome new people warmly." in page.json()["content"]

    # Maturity transitions and the edited-final-drops-to-review rule.
    to_final = await client.patch(
        f"/api/workspace/docs/{doc_id}/sections/{onboarding['id']}",
        headers=headers,
        json={"status": "final"},
    )
    assert to_final.json()["status"] == "final"
    edited = await client.patch(
        f"/api/workspace/docs/{doc_id}/sections/{onboarding['id']}",
        headers=headers,
        json={"content": "Changed again."},
    )
    assert edited.json()["status"] == "review"

    # New section lands at the end of the page.
    added = await client.post(
        f"/api/workspace/docs/{doc_id}/sections",
        headers=headers,
        json={"heading": "Equipment", "content": "Laptop on day one."},
    )
    assert added.status_code == 200
    page = await client.get(f"/api/workspace/docs/{doc_id}", headers=headers)
    assert page.json()["content"].rstrip().endswith("Laptop on day one.")

    # Delete a section: gone from the render.
    removed = await client.delete(
        f"/api/workspace/docs/{doc_id}/sections/{added.json()['id']}", headers=headers
    )
    assert removed.status_code == 200
    page = await client.get(f"/api/workspace/docs/{doc_id}", headers=headers)
    assert "Equipment" not in page.json()["content"]


@pytest.mark.asyncio
async def test_section_search_returns_section_refs(client: AsyncClient):
    headers = await _headers(client)
    await client.post(
        "/api/workspace/docs",
        headers=headers,
        json={
            "path": "docs/shipping.md",
            "content": "# Shipping\n\n## Carriers\n\nWe ship with PostNL and DHL.\n",
        },
    )
    resp = await client.post(
        "/api/workspace/search",
        headers=headers,
        json={"query": "PostNL carriers shipping", "top_k": 5},
    )
    assert resp.status_code == 200
    hit = next(r for r in resp.json()["results"] if "PostNL" in r["content"])
    assert hit["section_id"]


@pytest.mark.asyncio
async def test_workspace_default_docs_seeded(client: AsyncClient):
    headers = await _headers(client)
    listing = await client.get("/api/workspace/docs", headers=headers)
    assert listing.status_code == 200
    paths = [d["path"] for d in listing.json()["docs"]]
    assert "company.md" in paths
