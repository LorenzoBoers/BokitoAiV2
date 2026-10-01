"""Platform product-help articles (how to use Bokito).

Git source: ``docs/product-help/{en,nl}/{section}/*.md``. The API image also
ships a packaged copy at ``app/data/product_help`` so Docker builds with
context ``apps/api`` still resolve the same files (sync with
``scripts/dev/sync_product_help.py``). Articles are not tenant
``WorkspaceDoc`` rows — they are global operator docs for ``/docs``,
``/learn``, assistant RAG, and AI consumers (``llms.txt``, raw markdown).

Slugs are flat and globally unique; the folder name is the section.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from app.config import get_settings
from app.services.workspace import _keyword_score, _tokens, chunk_markdown, parse_frontmatter

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
LANGS = ("en", "nl")
SECTIONS = ("getting-started", "inbox", "ai", "govern", "integrations", "developers")
SOURCE_TYPE = "product_help"


@dataclass(frozen=True)
class ProductHelpArticle:
    slug: str
    lang: str
    section: str
    title: str
    intro: str
    description: str
    keywords: tuple[str, ...]
    sort: int
    related: tuple[str, ...]
    content: str
    mtime: float

    @property
    def path(self) -> str:
        return f"{self.section}/{self.slug}"


def normalize_lang(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if raw.startswith("en"):
        return "en"
    if raw.startswith("nl"):
        return "nl"
    fallback = (get_settings().platform_default_language or "nl").strip().lower()
    return "en" if fallback.startswith("en") else "nl"


def resolve_product_help_dir() -> Path:
    settings = get_settings()
    configured = (settings.product_help_dir or "").strip()
    if configured:
        path = Path(configured)
        if path.is_dir():
            return path
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "docs" / "product-help"
        if (candidate / "en").is_dir() and (candidate / "nl").is_dir():
            return candidate
    packaged = here.parents[1] / "data" / "product_help"
    if (packaged / "en").is_dir() and (packaged / "nl").is_dir():
        return packaged
    raise FileNotFoundError("Product-help articles not found (docs/product-help or app/data/product_help)")


def _parse_related(raw: str) -> tuple[str, ...]:
    items = []
    for part in raw.split(","):
        slug = part.strip().lower()
        if SLUG_RE.match(slug):
            items.append(slug)
    return tuple(items)


def _parse_keywords(raw: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in raw.split(",") if part.strip())[:12]


def _fallback_description(intro: str, content: str) -> str:
    if intro:
        return intro[:200]
    for line in content.splitlines():
        text = line.strip()
        if not text or text.startswith(("#", "```", "---", "|")):
            continue
        return text[:200]
    return ""


def _load_article(path: Path, lang: str, section: str) -> ProductHelpArticle | None:
    slug = path.stem.lower()
    if not SLUG_RE.match(slug):
        return None
    raw = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(raw)
    content = body.strip()
    if not content:
        return None
    title = (meta.get("title") or "").strip() or slug.replace("-", " ").title()
    intro = (meta.get("intro") or "").strip()
    description = (meta.get("description") or "").strip() or _fallback_description(intro, content)
    try:
        sort = int(str(meta.get("sort") or "100").strip())
    except ValueError:
        sort = 100
    return ProductHelpArticle(
        slug=slug,
        lang=lang,
        section=section,
        title=title,
        intro=intro,
        description=description,
        keywords=_parse_keywords(meta.get("keywords") or ""),
        sort=sort,
        related=_parse_related(meta.get("related") or ""),
        content=content,
        mtime=path.stat().st_mtime,
    )


@lru_cache(maxsize=1)
def _catalog(dir_key: str) -> dict[str, dict[str, ProductHelpArticle]]:
    root = Path(dir_key)
    catalog: dict[str, dict[str, ProductHelpArticle]] = {lang: {} for lang in LANGS}
    for lang in LANGS:
        folder = root / lang
        if not folder.is_dir():
            continue
        for section in SECTIONS:
            section_dir = folder / section
            if not section_dir.is_dir():
                continue
            for path in sorted(section_dir.glob("*.md")):
                article = _load_article(path, lang, section)
                if article and article.slug not in catalog[lang]:
                    catalog[lang][article.slug] = article
    return catalog


def _dir_key() -> str:
    return str(resolve_product_help_dir().resolve())


def _section_index(section: str) -> int:
    try:
        return SECTIONS.index(section)
    except ValueError:
        return len(SECTIONS)


def list_articles(lang: str | None = None) -> list[ProductHelpArticle]:
    resolved = normalize_lang(lang)
    items = list(_catalog(_dir_key()).get(resolved, {}).values())
    items.sort(key=lambda item: (_section_index(item.section), item.sort, item.title.lower()))
    return items


def get_article(slug: str, lang: str | None = None) -> ProductHelpArticle | None:
    clean = (slug or "").strip().lower().strip("/")
    if "/" in clean:
        clean = clean.rsplit("/", 1)[-1]
    if not SLUG_RE.match(clean):
        return None
    return _catalog(_dir_key()).get(normalize_lang(lang), {}).get(clean)


def serialize_summary(article: ProductHelpArticle) -> dict[str, Any]:
    return {
        "slug": article.slug,
        "section": article.section,
        "path": article.path,
        "title": article.title,
        "intro": article.intro,
        "description": article.description,
        "keywords": list(article.keywords),
        "sort": article.sort,
        "related": list(article.related),
        "updated_at": int(article.mtime),
    }


def serialize_article(article: ProductHelpArticle) -> dict[str, Any]:
    return {
        **serialize_summary(article),
        "content": article.content,
        "lang": article.lang,
    }


def nav_tree(lang: str | None = None) -> list[dict[str, Any]]:
    """Section → articles navigation, in fixed section order."""
    articles = list_articles(lang)
    sections: list[dict[str, Any]] = []
    for section in SECTIONS:
        items = [serialize_summary(a) for a in articles if a.section == section]
        if items:
            sections.append({"id": section, "articles": items})
    return sections


def raw_markdown(article: ProductHelpArticle) -> str:
    """Article as markdown with frontmatter (AI-friendly canonical form)."""
    front = [
        f"title: {article.title}",
        f"intro: {article.intro}",
        f"description: {article.description}",
        f"keywords: {', '.join(article.keywords)}",
        f"section: {article.section}",
        f"sort: {article.sort}",
    ]
    if article.related:
        front.append(f"related: {','.join(article.related)}")
    return "---\n" + "\n".join(front) + "\n---\n\n" + article.content + "\n"


# ---------------------------------------------------------------------------
# Public keyword search (no embeddings: cheap and abuse-safe on a public route)
# ---------------------------------------------------------------------------


@dataclass
class _KeywordChunk:
    slug: str
    section: str
    title: str
    heading: str
    content: str


_KEYWORD_CACHE: dict[str, list[_KeywordChunk]] = {}


def _keyword_chunks(lang: str) -> list[_KeywordChunk]:
    key = f"{_dir_key()}::{lang}"
    cached = _KEYWORD_CACHE.get(key)
    if cached is not None:
        return cached
    chunks: list[_KeywordChunk] = []
    for article in list_articles(lang):
        for heading, text in chunk_markdown(article.content):
            if not text.strip():
                continue
            chunks.append(
                _KeywordChunk(
                    slug=article.slug,
                    section=article.section,
                    title=article.title,
                    heading=heading or article.title,
                    content=text,
                )
            )
    _KEYWORD_CACHE[key] = chunks
    return chunks


def keyword_search(query: str, *, lang: str | None = None, top_k: int = 8) -> list[dict[str, Any]]:
    """Keyword-only search for the public docs site."""
    q = (query or "").strip()
    if not q:
        return []
    resolved = normalize_lang(lang)
    query_tokens = _tokens(q)
    by_slug: dict[str, ProductHelpArticle] = {a.slug: a for a in list_articles(resolved)}
    scored: list[tuple[float, _KeywordChunk]] = []
    for chunk in _keyword_chunks(resolved):
        article = by_slug.get(chunk.slug)
        keyword_meta = " ".join(article.keywords) if article else ""
        score = _keyword_score(
            query_tokens, f"{chunk.title}\n{keyword_meta}\n{chunk.heading}\n{chunk.content}"
        )
        if score > 0:
            scored.append((score, chunk))
    scored.sort(key=lambda item: item[0], reverse=True)
    results: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for score, chunk in scored:
        dedupe = (chunk.slug, chunk.heading)
        if dedupe in seen:
            continue
        seen.add(dedupe)
        results.append(
            {
                "slug": chunk.slug,
                "section": chunk.section,
                "path": f"{chunk.section}/{chunk.slug}",
                "title": chunk.title,
                "heading": chunk.heading,
                "snippet": chunk.content[:280],
                "score": round(score, 4),
            }
        )
        if len(results) >= max(1, min(top_k, 20)):
            break
    return results


# ---------------------------------------------------------------------------
# AI surfaces: llms.txt / llms-full.txt / sitemap.xml
# ---------------------------------------------------------------------------

_LLMS_SECTION_TITLES = {
    "getting-started": "Getting started",
    "inbox": "Inbox",
    "ai": "AI workforce",
    "govern": "Govern",
    "integrations": "Integrations",
    "developers": "Developers",
}


def _public_base_url() -> str:
    return (get_settings().public_app_url or "").rstrip("/")


def _api_base_url() -> str:
    return (get_settings().public_api_url or "").rstrip("/")


def build_llms_txt() -> str:
    """llms.txt index: one line per article with an absolute raw-markdown URL."""
    api_base = _api_base_url()
    lines = [
        "# Bokito",
        "",
        "> Bokito unifies customer conversations, AI agents and human approvals"
        " in one operations platform. These docs cover how to use the product"
        " and how to integrate with its public API.",
        "",
    ]
    articles = list_articles("en")
    for section in SECTIONS:
        items = [a for a in articles if a.section == section]
        if not items:
            continue
        lines.append(f"## {_LLMS_SECTION_TITLES.get(section, section)}")
        lines.append("")
        for article in items:
            url = f"{api_base}/api/docs/{article.slug}.md"
            lines.append(f"- [{article.title}]({url}): {article.description}")
        lines.append("")
    lines.append("## Optional")
    lines.append("")
    lines.append(
        f"- [Public API OpenAPI schema]({api_base}/api/docs/openapi.json):"
        " machine-readable reference for the REST endpoints"
    )
    return "\n".join(lines) + "\n"


def build_llms_full_txt() -> str:
    """Every English article concatenated, for full-context AI consumption."""
    parts = ["# Bokito documentation (full)", ""]
    for article in list_articles("en"):
        parts.append(f"<!-- {article.path} -->")
        parts.append(article.content)
        parts.append("")
    return "\n".join(parts)


def build_sitemap_xml() -> str:
    """Sitemap for public docs URLs on the dashboard origin."""
    base = _public_base_url()
    entries: list[str] = [f"{base}/docs", f"{base}/docs/api"]
    lastmods: dict[str, str] = {}
    for article in list_articles("en"):
        url = f"{base}/docs/{article.path}"
        entries.append(url)
        stamp = datetime.fromtimestamp(article.mtime, tz=timezone.utc)
        lastmods[url] = stamp.strftime("%Y-%m-%d")
    body = []
    for url in entries:
        lastmod = f"<lastmod>{lastmods[url]}</lastmod>" if url in lastmods else ""
        body.append(f"<url><loc>{escape(url)}</loc>{lastmod}</url>")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(body)
        + "\n</urlset>\n"
    )


# ---------------------------------------------------------------------------
# Assistant RAG (hybrid: embeddings + keywords)
# ---------------------------------------------------------------------------


@dataclass
class _IndexedChunk:
    slug: str
    section: str
    title: str
    heading: str
    content: str
    embedding: list[float]


_CHUNK_CACHE: dict[str, list[_IndexedChunk]] = {}


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


async def _index_lang(lang: str) -> list[_IndexedChunk]:
    from app.services.embeddings import embed_text

    key = f"{_dir_key()}::{lang}"
    cached = _CHUNK_CACHE.get(key)
    if cached is not None:
        return cached
    chunks: list[_IndexedChunk] = []
    for article in list_articles(lang):
        for heading, text in chunk_markdown(article.content):
            if not text.strip():
                continue
            embedding = await embed_text(text)
            chunks.append(
                _IndexedChunk(
                    slug=article.slug,
                    section=article.section,
                    title=article.title,
                    heading=heading or article.title,
                    content=text,
                    embedding=embedding,
                )
            )
    _CHUNK_CACHE[key] = chunks
    return chunks


async def search_product_help(
    query: str,
    *,
    lang: str | None = None,
    top_k: int = 5,
) -> list[dict[str, Any]]:
    """Hybrid search over platform product-help (not tenant workspace docs)."""
    from app.services.embeddings import embed_text

    q = (query or "").strip()
    if not q:
        return []
    resolved = normalize_lang(lang)
    chunks = await _index_lang(resolved)
    if not chunks:
        return []
    query_embedding = await embed_text(q)
    query_tokens = _tokens(q)
    scored: list[tuple[float, _IndexedChunk]] = []
    for chunk in chunks:
        vector = _cosine(query_embedding, chunk.embedding)
        keyword = _keyword_score(query_tokens, f"{chunk.title}\n{chunk.heading}\n{chunk.content}")
        score = 0.6 * vector + 0.4 * keyword
        if score > 0:
            scored.append((score, chunk))
    scored.sort(key=lambda item: item[0], reverse=True)
    base = (get_settings().public_app_url or "").rstrip("/")
    results: list[dict[str, Any]] = []
    for score, chunk in scored[: max(1, min(top_k, 12))]:
        path = f"{chunk.section}/{chunk.slug}"
        docs_path = f"/docs/{path}"
        results.append(
            {
                "source_type": SOURCE_TYPE,
                "source_id": chunk.slug,
                "slug": chunk.slug,
                "section": chunk.section,
                "path": path,
                "docs_path": docs_path,
                "public_url": f"{base}{docs_path}" if base else docs_path,
                "title": chunk.title,
                "heading": chunk.heading,
                "content": chunk.content,
                "score": round(score, 4),
            }
        )
    return results


def reset_product_help_cache() -> None:
    """Test helper: drop catalog and search caches."""
    _catalog.cache_clear()
    _CHUNK_CACHE.clear()
    _KEYWORD_CACHE.clear()


ASSET_EXTENSIONS = {".png", ".webp"}
IMAGE_REF_RE = re.compile(r"!\[[^\]]*\]\((/api/docs/assets/[^)]+)\)")
ASSET_URL_RE = re.compile(
    r"^/api/docs/assets/([a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?\.(?:png|webp))$",
    re.IGNORECASE,
)


def assets_dir() -> Path:
    return resolve_product_help_dir() / "assets"


def resolve_asset(rel: str) -> Path | None:
    """Resolve a screenshot under assets/. Rejects escapes and unknown types."""
    clean = (rel or "").strip().replace("\\", "/").lstrip("/")
    if not clean or ".." in clean.split("/"):
        return None
    if not ASSET_URL_RE.match(f"/api/docs/assets/{clean}"):
        return None
    root = assets_dir().resolve()
    path = (root / clean).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        return None
    if path.suffix.lower() not in ASSET_EXTENSIONS or not path.is_file():
        return None
    return path


def markdown_asset_paths(content: str) -> list[str]:
    """Relative asset paths referenced from markdown image srcs."""
    found: list[str] = []
    for src in IMAGE_REF_RE.findall(content or ""):
        match = ASSET_URL_RE.match(src)
        if match:
            found.append(match.group(1).replace("\\", "/"))
    return found
