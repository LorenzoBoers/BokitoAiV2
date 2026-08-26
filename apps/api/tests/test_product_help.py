"""Platform product-help: public /api/docs, AI surfaces, and assistant search."""

from pathlib import Path

import pytest
from httpx import AsyncClient

from app.services.product_help import (
    LANGS,
    SECTIONS,
    get_article,
    keyword_search,
    list_articles,
    reset_product_help_cache,
    resolve_product_help_dir,
    search_product_help,
)


def _repo_docs() -> Path:
    return Path(__file__).resolve().parents[3] / "docs" / "product-help"


def _packaged() -> Path:
    return Path(__file__).resolve().parents[1] / "app" / "data" / "product_help"


def _tree(root: Path, lang: str) -> dict[str, str]:
    return {
        p.relative_to(root / lang).as_posix(): p.read_text(encoding="utf-8")
        for p in (root / lang).rglob("*.md")
    }


def test_packaged_product_help_mirrors_docs():
    docs = _repo_docs()
    packaged = _packaged()
    assert docs.is_dir()
    assert packaged.is_dir()
    for lang in LANGS:
        doc_files = _tree(docs, lang)
        pkg_files = _tree(packaged, lang)
        assert doc_files, f"missing docs/product-help/{lang}"
        assert doc_files == pkg_files, "run: python apps/api/scripts/dev/sync_product_help.py"


def test_en_nl_parity_and_frontmatter():
    reset_product_help_cache()
    per_lang = {lang: {a.slug: a for a in list_articles(lang)} for lang in LANGS}
    assert set(per_lang["en"]) == set(per_lang["nl"])
    for lang in LANGS:
        for slug, article in per_lang[lang].items():
            assert article.section in SECTIONS, f"{lang}/{slug}"
            assert article.description, f"{lang}/{slug}: description is required"
            assert article.keywords, f"{lang}/{slug}: keywords are required"
    for slug, en_article in per_lang["en"].items():
        assert en_article.section == per_lang["nl"][slug].section, slug


def test_resolve_dir_finds_sectioned_articles():
    reset_product_help_cache()
    root = resolve_product_help_dir()
    assert (root / "en" / "getting-started" / "cockpit.md").is_file()
    slugs = {item.slug for item in list_articles("en")}
    assert slugs >= {
        "welcome",
        "quickstart",
        "setup-guide",
        "tour",
        "cockpit",
        "communication",
        "channels",
        "contacts",
        "widget",
        "agents",
        "decisions",
        "knowledge",
        "projects",
        "agenda",
        "govern",
        "autonomy",
        "models",
        "integrations",
        "mcp",
        "api-overview",
        "authentication",
        "api-signals",
        "webhooks",
        "mcp-endpoint",
        "widget-embed",
        "rate-limits",
    }
    article = get_article("channels", "nl")
    assert article is not None
    assert article.section == "inbox"
    assert article.path == "inbox/channels"


@pytest.mark.asyncio
async def test_product_help_index_and_article_are_public(client: AsyncClient):
    reset_product_help_cache()
    index = await client.get("/api/docs", params={"lang": "en"})
    assert index.status_code == 200, index.text
    body = index.json()
    assert body["lang"] == "en"
    section_ids = [s["id"] for s in body["sections"]]
    assert section_ids == [s for s in SECTIONS if s in section_ids]
    assert "getting-started" in section_ids
    assert "developers" in section_ids
    slugs = [a["slug"] for a in body["articles"]]
    assert "welcome" in slugs
    assert "api-overview" in slugs
    cockpit = next(a for a in body["articles"] if a["slug"] == "cockpit")
    assert cockpit["section"] == "getting-started"
    assert cockpit["path"] == "getting-started/cockpit"
    assert cockpit["description"]

    article = await client.get("/api/docs/cockpit", params={"lang": "en"})
    assert article.status_code == 200, article.text
    art = article.json()
    assert art["slug"] == "cockpit"
    assert art["section"] == "getting-started"
    assert art["content"]

    missing = await client.get("/api/docs/not-a-real-slug")
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_public_keyword_search_endpoint(client: AsyncClient):
    reset_product_help_cache()
    res = await client.get("/api/docs/search", params={"q": "connect Gmail mailbox", "lang": "en"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["query"] == "connect Gmail mailbox"
    slugs = {r["slug"] for r in body["results"]}
    assert "channels" in slugs
    top = body["results"][0]
    assert top["path"].count("/") == 1
    assert top["snippet"]

    empty = await client.get("/api/docs/search", params={"q": "zzzzqqqq"})
    assert empty.status_code == 200
    assert empty.json()["results"] == []


def test_keyword_search_is_embedding_free():
    reset_product_help_cache()
    hits = keyword_search("webhook signature", lang="en", top_k=5)
    assert hits
    assert {"webhooks"} & {h["slug"] for h in hits}


@pytest.mark.asyncio
async def test_raw_markdown_endpoint(client: AsyncClient):
    reset_product_help_cache()
    res = await client.get("/api/docs/channels.md", params={"lang": "en"})
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/markdown")
    assert res.text.startswith("---\n")
    assert "title: " in res.text
    assert "## " in res.text

    missing = await client.get("/api/docs/not-a-real-slug.md")
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_sitemap_and_public_openapi(client: AsyncClient):
    reset_product_help_cache()
    sitemap = await client.get("/api/docs/sitemap.xml")
    assert sitemap.status_code == 200
    assert sitemap.headers["content-type"].startswith("application/xml")
    assert "/docs/getting-started/welcome" in sitemap.text
    assert "/docs/api" in sitemap.text

    spec = await client.get("/api/docs/openapi.json")
    assert spec.status_code == 200, spec.text
    schema = spec.json()
    assert schema["info"]["title"] == "Bokito Public API"
    paths = schema["paths"]
    assert "/api/public/v1/signals" in paths
    assert "/api/mcp" in paths
    # Internal-only routers must not leak into the public schema.
    assert not any("/auth/" in p for p in paths)
    assert not any("/workforce" in p for p in paths)
    assert "apiToken" in schema["components"]["securitySchemes"]


@pytest.mark.asyncio
async def test_llms_txt_endpoints(client: AsyncClient):
    reset_product_help_cache()
    llms = await client.get("/llms.txt")
    assert llms.status_code == 200
    assert llms.text.startswith("# Bokito")
    assert "/api/docs/welcome.md" in llms.text

    full = await client.get("/llms-full.txt")
    assert full.status_code == 200
    assert "Signals API" in full.text or "Signals-API" in full.text


@pytest.mark.asyncio
async def test_product_help_search_finds_how_to_tasks():
    reset_product_help_cache()
    hits = await search_product_help("connect Gmail mailbox", lang="en", top_k=5)
    assert hits
    slugs = {h["slug"] for h in hits}
    assert "channels" in slugs
    assert all(h["source_type"] == "product_help" for h in hits)
