"""Public help center: publish workspace docs and read them without auth."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

TENANT_SLUG = "test"


async def _headers(client: AsyncClient) -> dict[str, str]:
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _create_doc(
    client: AsyncClient, headers: dict, *, path: str, content: str, title: str | None = None
) -> dict:
    body = {"path": path, "content": content, "kind": "doc"}
    if title:
        body["title"] = title
    r = await client.post("/api/workspace/docs", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_publish_and_public_read(client: AsyncClient):
    headers = await _headers(client)
    doc = await _create_doc(
        client,
        headers,
        path="docs/help/returns.md",
        content="# Return policy\n\nReturns are accepted within 14 days.",
    )

    publish = await client.post(
        f"/api/workspace/docs/{doc['id']}/publish", headers=headers, json={"published": True}
    )
    assert publish.status_code == 200, publish.text
    fm = publish.json()["frontmatter"]
    assert fm["published"] == "true"
    slug = fm["slug"]
    assert slug

    # Public index lists the article without any auth header.
    index = await client.get(f"/api/help/{TENANT_SLUG}")
    assert index.status_code == 200, index.text
    body = index.json()
    assert body["tenant"]["slug"] == TENANT_SLUG
    slugs = [a["slug"] for a in body["articles"]]
    assert slug in slugs
    listed = next(a for a in body["articles"] if a["slug"] == slug)
    assert listed["title"] == "Return policy"
    assert "14 days" in listed["description"]

    # Public article returns the markdown body.
    article = await client.get(f"/api/help/{TENANT_SLUG}/{slug}")
    assert article.status_code == 200, article.text
    art = article.json()
    assert art["title"] == "Return policy"
    assert "Returns are accepted within 14 days." in art["content"]


@pytest.mark.asyncio
async def test_unpublished_docs_stay_private(client: AsyncClient):
    headers = await _headers(client)
    doc = await _create_doc(
        client,
        headers,
        path="docs/help/internal-pricing.md",
        content="# Internal pricing\n\nMargin details.",
    )

    index = await client.get(f"/api/help/{TENANT_SLUG}")
    assert index.status_code == 200
    assert "internal-pricing" not in [a["slug"] for a in index.json()["articles"]]

    direct = await client.get(f"/api/help/{TENANT_SLUG}/internal-pricing")
    assert direct.status_code == 404

    # Publish, then unpublish: article disappears again.
    await client.post(
        f"/api/workspace/docs/{doc['id']}/publish", headers=headers, json={"published": True}
    )
    unpublish = await client.post(
        f"/api/workspace/docs/{doc['id']}/publish", headers=headers, json={"published": False}
    )
    assert unpublish.status_code == 200
    assert "published" not in unpublish.json()["frontmatter"]
    gone = await client.get(f"/api/help/{TENANT_SLUG}/internal-pricing")
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_only_plain_docs_can_publish(client: AsyncClient):
    headers = await _headers(client)
    r = await client.post(
        "/api/workspace/docs",
        headers=headers,
        json={"path": "skills/triage.md", "content": "# Triage skill", "kind": "skill"},
    )
    assert r.status_code == 200
    skill_id = r.json()["id"]

    publish = await client.post(
        f"/api/workspace/docs/{skill_id}/publish", headers=headers, json={"published": True}
    )
    assert publish.status_code == 400


@pytest.mark.asyncio
async def test_slug_conflict_gets_suffix(client: AsyncClient):
    headers = await _headers(client)
    first = await _create_doc(
        client, headers, path="docs/help/faq-a.md", content="# FAQ\n\nFirst.", title="FAQ"
    )
    second = await _create_doc(
        client, headers, path="docs/help/faq-b.md", content="# FAQ\n\nSecond.", title="FAQ"
    )
    r1 = await client.post(
        f"/api/workspace/docs/{first['id']}/publish", headers=headers, json={"published": True}
    )
    r2 = await client.post(
        f"/api/workspace/docs/{second['id']}/publish", headers=headers, json={"published": True}
    )
    slug1 = r1.json()["frontmatter"]["slug"]
    slug2 = r2.json()["frontmatter"]["slug"]
    assert slug1 != slug2
    assert slug2.startswith(slug1)


@pytest.mark.asyncio
async def test_unknown_tenant_404(client: AsyncClient):
    r = await client.get("/api/help/no-such-tenant")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_widget_reply_links_published_articles(client: AsyncClient):
    """Deflection: a widget answer that drew on a published doc appends its link."""
    headers = await _headers(client)
    doc = await _create_doc(
        client,
        headers,
        path="docs/help/warranty.md",
        content="# Warranty\n\nZebra warranty covers quantum flux couplings for 5 years.",
    )
    publish = await client.post(
        f"/api/workspace/docs/{doc['id']}/publish", headers=headers, json={"published": True}
    )
    slug = publish.json()["frontmatter"]["slug"]

    start = await client.post(
        "/api/livechat/session/start",
        json={"agent_slug": "assistant", "auth_mode": "optional", "tenant_subdomain": TENANT_SLUG},
    )
    assert start.status_code == 200, start.text
    token = start.json()["session_token"]

    async with client.stream(
        "POST",
        "/api/livechat/stream-chat",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "message_content": "How long does the zebra warranty cover quantum flux couplings?",
            "conversation_id": "new",
        },
    ) as response:
        assert response.status_code == 200
        body = ""
        async for chunk in response.aiter_text():
            body += chunk
    assert "Related articles" in body, body[-2000:]
    assert f"/help/{TENANT_SLUG}/{slug}" in body


@pytest.mark.asyncio
async def test_widget_reply_skips_unpublished_docs(client: AsyncClient):
    """RAG hits on private docs must not leak links into visitor replies."""
    headers = await _headers(client)
    await _create_doc(
        client,
        headers,
        path="docs/help/private-margins.md",
        content="# Margins\n\nXylophone margin details for octopus procurement.",
    )

    start = await client.post(
        "/api/livechat/session/start",
        json={"agent_slug": "assistant", "auth_mode": "optional", "tenant_subdomain": TENANT_SLUG},
    )
    token = start.json()["session_token"]

    async with client.stream(
        "POST",
        "/api/livechat/stream-chat",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "message_content": "Tell me about xylophone margin octopus procurement",
            "conversation_id": "new",
        },
    ) as response:
        assert response.status_code == 200
        body = ""
        async for chunk in response.aiter_text():
            body += chunk
    assert "private-margins" not in body


@pytest.mark.asyncio
async def test_editing_published_doc_keeps_publish_state(client: AsyncClient):
    """Saving body-only content (the editor round-trip) must not wipe frontmatter."""
    headers = await _headers(client)
    doc = await _create_doc(
        client,
        headers,
        path="docs/help/shipping.md",
        content="# Shipping\n\nWe ship within 2 days.",
    )
    publish = await client.post(
        f"/api/workspace/docs/{doc['id']}/publish", headers=headers, json={"published": True}
    )
    slug = publish.json()["frontmatter"]["slug"]

    update = await client.patch(
        f"/api/workspace/docs/{doc['id']}",
        headers=headers,
        json={"content": "# Shipping\n\nWe ship within 1 day now."},
    )
    assert update.status_code == 200, update.text
    assert update.json()["frontmatter"].get("published") == "true"

    article = await client.get(f"/api/help/{TENANT_SLUG}/{slug}")
    assert article.status_code == 200
    assert "1 day" in article.json()["content"]
