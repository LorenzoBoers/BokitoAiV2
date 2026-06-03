import pytest
from httpx import AsyncClient


async def _headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_workspace_doc_tree(client: AsyncClient):
    headers = await _headers(client)
    resp = await client.get("/api/workforce/workspace/doc", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "workspace_doc" in data
    assert isinstance(data["pages"], list)


@pytest.mark.asyncio
async def test_workspace_doc_block_ops(client: AsyncClient):
    headers = await _headers(client)
    tree = await client.get("/api/workforce/workspace/doc", headers=headers)
    doc_id = tree.json()["workspace_doc"]["id"]
    pages = tree.json()["pages"]
    if not pages:
        created = await client.post(
            "/api/workforce/workspace/doc/pages",
            headers=headers,
            json={
                "workspace_doc_id": doc_id,
                "title": "Test page",
                "slug": "test-page",
                "kind": "notes",
            },
        )
        page_id = created.json()["id"]
    else:
        page_id = pages[0]["id"]

    create = await client.post(
        f"/api/workforce/workspace/doc/pages/{page_id}/blocks",
        headers=headers,
        json={
            "ops": [
                {
                    "op": "create",
                    "type": "paragraph",
                    "text": [{"text": "Hello blueprint editor"}],
                    "position": 0,
                }
            ],
            "actor_label": "Test",
        },
    )
    assert create.status_code == 200
    assert len(create.json()["applied"]) == 1

    blocks = await client.get(
        f"/api/workforce/workspace/doc/pages/{page_id}/blocks",
        headers=headers,
    )
    assert blocks.status_code == 200
    assert any("Hello blueprint editor" in str(b.get("text")) for b in blocks.json()["blocks"])
