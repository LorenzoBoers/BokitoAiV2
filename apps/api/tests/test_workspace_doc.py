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
async def test_workspace_default_docs_seeded(client: AsyncClient):
    headers = await _headers(client)
    listing = await client.get("/api/workspace/docs", headers=headers)
    assert listing.status_code == 200
    paths = [d["path"] for d in listing.json()["docs"]]
    assert "company.md" in paths
