"""Module knowledge sources: platform packs, tenant URLs, shallow indexing."""

from __future__ import annotations

import json
import logging
import time
from collections import deque
from datetime import datetime, timedelta
from html.parser import HTMLParser
from io import BytesIO
from typing import Any
from urllib.parse import parse_qsl, urldefrag, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.module_source import ModuleSource
from app.modules.catalog import get_module

logger = logging.getLogger(__name__)

USER_AGENT = "BokitoModuleSourceBot/1.0 (+https://bokito.ai)"
FETCH_DELAY_S = 1.0
PLATFORM_PAGE_CAP = 20
TENANT_PAGE_CAP = 12
PAGE_CHAR_CAP = 80_000
DOC_CHAR_CAP = 400_000
MIN_TEXT_CHARS = 80
HTTP_TIMEOUT_S = 25
STALE_INDEXING_AFTER = timedelta(minutes=15)

_LOGIN_HINTS = (
    "/login",
    "/inloggen",
    "/signin",
    "/sign-in",
    "/account/login",
    "/auth/",
    "/sso",
)
_SKIP_PREFIXES = ("mailto:", "javascript:", "tel:", "data:")
_SKIP_EXT = (
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".css",
    ".js",
    ".zip",
    ".mp4",
    ".woff",
    ".woff2",
)

# Curated public start pages. Shallow same-origin follow fills the rest (cap).
ACCOUNTING_PLATFORM_SEEDS: tuple[dict[str, Any], ...] = (
    {
        "title": "Belastingdienst",
        "url": "https://www.belastingdienst.nl/",
        "seed_key": "belastingdienst",
        "start_urls": [
            "https://www.belastingdienst.nl/",
            "https://www.belastingdienst.nl/wps/wcm/connect/nl/ondernemers/ondernemers",
            "https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/btw",
            "https://www.belastingdienst.nl/wps/wcm/connect/nl/inkomstenbelasting/inkomstenbelasting",
            "https://www.belastingdienst.nl/wps/wcm/connect/nl/vennootschapsbelasting/vennootschapsbelasting",
            "https://www.belastingdienst.nl/wps/wcm/connect/nl/loonheffingen/loonheffingen",
        ],
    },
    {
        "title": "NBA — Handleiding Regelgeving Accountancy (HRA)",
        "url": "https://www.nba.nl/wet-en-regelgeving/hra/",
        "seed_key": "nba_hra",
        "start_urls": [
            "https://www.nba.nl/wet-en-regelgeving/hra/",
            "https://www.nba.nl/wet--en-regelgeving/hra/",
            "https://www.nba.nl/over-de-nba/regelgeving/",
        ],
    },
    {
        "title": "RJNet — Richtlijnen voor de Jaarverslaggeving",
        "url": "https://www.rjnet.nl/",
        "seed_key": "rjnet",
        "start_urls": [
            "https://www.rjnet.nl/",
        ],
    },
    {
        "title": "KvK — Jaarrekening deponeren",
        "url": "https://www.kvk.nl/inschrijven-en-wijzigen/deponeren/jaarrekening-deponeren/",
        "seed_key": "kvk_jaarrekening",
        "start_urls": [
            "https://www.kvk.nl/inschrijven-en-wijzigen/deponeren/jaarrekening-deponeren/",
            "https://www.kvk.nl/jaarstukken-deponeren/",
        ],
    },
    {
        "title": "wetten.nl — BW2 Titel 9 Jaarrekening",
        "url": "https://wetten.overheid.nl/BWBR0003045/",
        "seed_key": "bw2_titel9",
        "start_urls": [
            "https://wetten.overheid.nl/BWBR0003045/",
            "https://wetten.overheid.nl/BWBR0003045/#Titeldeel9",
        ],
    },
)

PLATFORM_SEEDS: dict[str, tuple[dict[str, Any], ...]] = {
    "accounting": ACCOUNTING_PLATFORM_SEEDS,
}


class _HtmlExtract(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []
        self._skip = False
        self._in_title = False
        self.title = ""
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style", "noscript", "svg"):
            self._skip = True
        if tag == "title":
            self._in_title = True
        if tag == "a":
            href = next((v for k, v in attrs if k == "href" and v), None)
            if href:
                self.hrefs.append(href)
        if tag == "meta":
            props = {k: v or "" for k, v in attrs}
            if props.get("property") == "og:title" and props.get("content") and not self.title:
                self.title = props["content"].strip()

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript", "svg"):
            self._skip = False
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if not text:
            return
        if self._in_title:
            if not self.title:
                self.title = text
            return
        if self._skip:
            return
        self._chunks.append(text)

    def text(self) -> str:
        return "\n".join(self._chunks)


def _http_get(url: str, *, timeout: int = HTTP_TIMEOUT_S) -> tuple[bytes, str, str]:
    """Return (body, content_type, final_url). Patchable in tests."""
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=timeout) as resp:  # noqa: S310 — operator-configured URLs
        raw = resp.read()
        content_type = (resp.headers.get("Content-Type") or "").lower()
        final = str(resp.geturl() or url)
    return raw, content_type, final


def _pdf_text(raw: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(raw))
    parts: list[str] = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001
            continue
    return "\n".join(parts)


def _normalize_url(url: str, *, base: str | None = None) -> str:
    joined = urljoin(base, url) if base else url
    joined, _frag = urldefrag(joined)
    parts = urlsplit(joined)
    if parts.scheme not in ("http", "https"):
        return ""
    path = parts.path or "/"
    query_pairs = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith("utm_")
        and k.lower() not in ("fbclid", "gclid", "mc_cid", "mc_eid")
    ]
    query = "&".join(f"{k}={v}" for k, v in query_pairs) if query_pairs else ""
    host = parts.netloc.lower()
    return urlunsplit((parts.scheme, host, path, query, ""))


def _same_origin(a: str, b: str) -> bool:
    pa, pb = urlsplit(a), urlsplit(b)
    return pa.scheme == pb.scheme and pa.netloc.lower() == pb.netloc.lower()


def _should_skip_url(url: str, *, start: bool) -> bool:
    if not url:
        return True
    lower = url.lower()
    if lower.startswith(_SKIP_PREFIXES):
        return True
    path = urlsplit(url).path.lower()
    if any(path.endswith(ext) for ext in _SKIP_EXT):
        return True
    if not start and any(hint in lower for hint in _LOGIN_HINTS):
        return True
    if not start and len(parse_qsl(urlsplit(url).query)) > 3:
        return True
    return False


class _RobotsCache:
    def __init__(self) -> None:
        self._fetched_hosts: set[str] = set()
        self._parser_by_host: dict[str, Any] = {}

    def allowed(self, url: str) -> bool:
        from urllib.robotparser import RobotFileParser

        parts = urlsplit(url)
        host_key = f"{parts.scheme}://{parts.netloc.lower()}"
        if host_key not in self._fetched_hosts:
            self._fetched_hosts.add(host_key)
            robots_url = f"{host_key}/robots.txt"
            parser = RobotFileParser()
            try:
                raw, _, _ = _http_get(robots_url, timeout=10)
                text = raw.decode("utf-8", errors="replace")
                parser.parse(text.splitlines())
                self._parser_by_host[host_key] = parser
            except Exception:  # noqa: BLE001
                self._parser_by_host[host_key] = None
        parser = self._parser_by_host.get(host_key)
        if parser is None:
            return True
        try:
            return bool(parser.can_fetch(USER_AGENT, url))
        except Exception:  # noqa: BLE001
            return True


def _parse_html(raw: bytes, url: str) -> tuple[str, str, list[str]]:
    parser = _HtmlExtract()
    try:
        parser.feed(raw.decode("utf-8", errors="replace"))
    except Exception:  # noqa: BLE001
        text = raw.decode("utf-8", errors="replace")[:PAGE_CHAR_CAP]
        return url, text, []
    title = parser.title or url
    text = parser.text()[:PAGE_CHAR_CAP]
    links: list[str] = []
    for href in parser.hrefs:
        norm = _normalize_url(href, base=url)
        if norm:
            links.append(norm)
    return title, text, links


def fetch_page(url: str) -> dict[str, Any]:
    """Fetch one URL: html or pdf. Returns title, text, links, error."""
    try:
        raw, content_type, final = _http_get(url)
    except Exception as exc:  # noqa: BLE001
        return {"url": url, "title": url, "text": "", "links": [], "error": str(exc)[:300]}
    final = _normalize_url(final) or url
    if "pdf" in content_type or url.lower().endswith(".pdf"):
        try:
            text = _pdf_text(raw)[:PAGE_CHAR_CAP]
        except Exception as exc:  # noqa: BLE001
            return {"url": final, "title": url, "text": "", "links": [], "error": str(exc)[:300]}
        return {"url": final, "title": url.rsplit("/", 1)[-1], "text": text, "links": [], "error": ""}
    is_html = (
        "html" in content_type
        or url.rstrip("/").endswith((".html", ".htm"))
        or b"<html" in raw[:800].lower()
    )
    if is_html:
        title, text, links = _parse_html(raw, final)
        return {"url": final, "title": title, "text": text, "links": links, "error": ""}
    text = raw.decode("utf-8", errors="replace")[:PAGE_CHAR_CAP]
    return {"url": final, "title": url, "text": text, "links": [], "error": ""}


def crawl_source_pages(
    start_urls: list[str],
    *,
    page_cap: int,
    delay_s: float | None = None,
) -> dict[str, Any]:
    """BFS same-origin crawl from start_urls. Returns pages + skip counts."""
    delay = FETCH_DELAY_S if delay_s is None else delay_s
    robots = _RobotsCache()
    seen: set[str] = set()
    queue: deque[tuple[str, bool]] = deque()
    for raw in start_urls:
        norm = _normalize_url(raw)
        if norm and norm not in seen:
            seen.add(norm)
            queue.append((norm, True))

    pages: list[dict[str, str]] = []
    skipped_robots = 0
    skipped_other = 0
    last_request_at = 0.0
    origins = {f"{urlsplit(u).scheme}://{urlsplit(u).netloc.lower()}" for u, _ in queue}

    while queue and len(pages) < page_cap:
        url, is_start = queue.popleft()
        if _should_skip_url(url, start=is_start):
            skipped_other += 1
            continue
        if not robots.allowed(url):
            skipped_robots += 1
            continue
        origin = f"{urlsplit(url).scheme}://{urlsplit(url).netloc.lower()}"
        if origin not in origins:
            skipped_other += 1
            continue
        now = time.monotonic()
        wait = delay - (now - last_request_at)
        if wait > 0:
            time.sleep(wait)
        page = fetch_page(url)
        last_request_at = time.monotonic()
        text = (page.get("text") or "").strip()
        if text:
            pages.append(
                {
                    "url": str(page.get("url") or url),
                    "title": str(page.get("title") or url),
                    "text": text[:PAGE_CHAR_CAP],
                }
            )
        elif is_start and page.get("error"):
            skipped_other += 1
        for link in page.get("links") or []:
            if not isinstance(link, str):
                continue
            if link in seen:
                continue
            if not _same_origin(url, link):
                continue
            seen.add(link)
            queue.append((link, False))

    return {
        "pages": pages,
        "pages_fetched": len(pages),
        "pages_skipped": skipped_robots + skipped_other,
        "skipped_robots": skipped_robots,
    }


def pages_to_markdown(title: str, pages: list[dict[str, str]]) -> str:
    parts = [f"# {title}", ""]
    total = 0
    for page in pages:
        heading = (page.get("title") or page.get("url") or "Page").replace("\n", " ").strip()
        body = (page.get("text") or "").strip()
        block = f"## {heading}\n\nSource: {page.get('url', '')}\n\n{body}\n"
        if total + len(block) > DOC_CHAR_CAP:
            remain = DOC_CHAR_CAP - total - 80
            if remain > 200:
                parts.append(block[:remain] + "\n")
            break
        parts.append(block)
        total += len(block)
    return "\n".join(parts).strip() + "\n"


def _row_meta(row: ModuleSource) -> dict[str, Any]:
    try:
        meta = json.loads(row.metadata_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    return meta if isinstance(meta, dict) else {}


def _start_urls_for(row: ModuleSource) -> list[str]:
    meta = _row_meta(row)
    urls = meta.get("start_urls")
    found: list[str] = []
    if isinstance(urls, list):
        for item in urls:
            if isinstance(item, str) and item.strip():
                found.append(item.strip())
    if row.url and row.url not in found:
        found.insert(0, row.url)
    return found or ([row.url] if row.url else [])


def serialize_source(row: ModuleSource) -> dict[str, Any]:
    meta = _row_meta(row)
    return {
        "id": str(row.id),
        "tenant_id": str(row.tenant_id),
        "module_slug": row.module_slug,
        "kind": row.kind,
        "origin": row.origin,
        "title": row.title,
        "url": row.url,
        "status": row.status,
        "auto_reindex": bool(row.auto_reindex),
        "workspace_doc_id": str(row.workspace_doc_id) if row.workspace_doc_id else None,
        "last_synced_at": row.last_synced_at.isoformat() if row.last_synced_at else None,
        "sync_error": row.sync_error or "",
        "pages_fetched": int(meta.get("pages_fetched") or 0),
        "pages_skipped": int(meta.get("pages_skipped") or 0),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


async def list_sources(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> list[dict[str, Any]]:
    result = await session.execute(
        select(ModuleSource)
        .where(
            ModuleSource.tenant_id == tenant_id,
            ModuleSource.module_slug == module_slug,
        )
        .order_by(ModuleSource.origin.asc(), ModuleSource.title.asc())
    )
    return [serialize_source(row) for row in result.scalars().all()]


async def ensure_platform_seeds(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> list[ModuleSource]:
    """Copy platform seed catalog into the tenant on first open/enable."""
    seeds = PLATFORM_SEEDS.get(module_slug) or ()
    if not seeds:
        return []
    existing = (
        await session.execute(
            select(ModuleSource).where(
                ModuleSource.tenant_id == tenant_id,
                ModuleSource.module_slug == module_slug,
                ModuleSource.origin == "platform",
            )
        )
    ).scalars().all()
    by_key: dict[str, ModuleSource] = {}
    for row in existing:
        meta = _row_meta(row)
        key = str(meta.get("seed_key") or row.url)
        by_key[key] = row

    created: list[ModuleSource] = []
    changed = False
    for seed in seeds:
        key = str(seed["seed_key"])
        start_urls = list(seed.get("start_urls") or [seed["url"]])
        if key in by_key:
            row = by_key[key]
            meta = _row_meta(row)
            meta["seed_key"] = key
            meta["start_urls"] = start_urls
            row.metadata_json = json.dumps(meta)
            row.title = str(seed["title"])
            row.url = str(seed["url"])
            row.updated_at = datetime.utcnow()
            session.add(row)
            changed = True
            continue
        row = ModuleSource(
            tenant_id=tenant_id,
            module_slug=module_slug,
            kind="web",
            origin="platform",
            title=str(seed["title"]),
            url=str(seed["url"]),
            status="pending",
            auto_reindex=True,
            metadata_json=json.dumps({"seed_key": key, "start_urls": start_urls}),
        )
        session.add(row)
        created.append(row)
        changed = True
    if changed:
        await session.commit()
        for row in created:
            await session.refresh(row)
    rows = list(by_key.values()) + created
    await queue_idle_sources(session, rows)
    return rows


async def queue_idle_sources(
    session: AsyncSession, rows: list[ModuleSource], *, force: bool = False
) -> int:
    """Mark idle pending (or stale indexing) rows as indexing and enqueue."""
    queued = 0
    now = datetime.utcnow()
    for row in rows:
        if row.status == "disabled":
            continue
        stale_indexing = (
            row.status == "indexing"
            and row.updated_at
            and now - row.updated_at > STALE_INDEXING_AFTER
        )
        if row.status == "pending" or stale_indexing or force:
            if await queue_source_index(session, row, force=force or stale_indexing):
                queued += 1
    return queued


async def queue_source_index(
    session: AsyncSession, row: ModuleSource, *, force: bool = False
) -> bool:
    if row.status == "disabled":
        return False
    if row.status == "indexing" and not force:
        return False
    row.status = "indexing"
    row.sync_error = ""
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.commit()
    from app.workers.tasks import enqueue_module_source_index

    await enqueue_module_source_index(str(row.id))
    return True


async def create_tenant_source(
    session: AsyncSession,
    tenant_id: UUID,
    module_slug: str,
    *,
    title: str,
    url: str,
    auto_reindex: bool = True,
) -> ModuleSource:
    if get_module(module_slug) is None:
        raise ValueError(f"Unknown module '{module_slug}'")
    clean_url = (url or "").strip()
    if not clean_url.startswith("http://") and not clean_url.startswith("https://"):
        raise ValueError("URL must start with http:// or https://")
    row = ModuleSource(
        tenant_id=tenant_id,
        module_slug=module_slug,
        kind="web",
        origin="tenant",
        title=(title or "").strip() or clean_url,
        url=clean_url,
        status="pending",
        auto_reindex=auto_reindex,
        metadata_json=json.dumps({"start_urls": [clean_url]}),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def set_source_disabled(
    session: AsyncSession, tenant_id: UUID, source_id: UUID, *, disabled: bool
) -> ModuleSource:
    row = await session.get(ModuleSource, source_id)
    if row is None or row.tenant_id != tenant_id:
        raise ValueError("Source not found")
    row.status = "disabled" if disabled else ("ready" if row.workspace_doc_id else "pending")
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    if row.status == "pending":
        await queue_source_index(session, row)
        await session.refresh(row)
    return row


async def delete_tenant_source(
    session: AsyncSession, tenant_id: UUID, source_id: UUID
) -> None:
    row = await session.get(ModuleSource, source_id)
    if row is None or row.tenant_id != tenant_id:
        raise ValueError("Source not found")
    if row.origin == "platform":
        raise ValueError("Platform sources cannot be deleted; disable them instead")
    await session.delete(row)
    await session.commit()


async def index_source(session: AsyncSession, source_id: UUID) -> ModuleSource:
    """Crawl start URLs (shallow) into a WorkspaceDoc and reindex chunks."""
    from app.services.workspace import upsert_doc

    row = await session.get(ModuleSource, source_id)
    if row is None:
        raise ValueError("Source not found")
    if row.status == "disabled":
        return row

    row.status = "indexing"
    row.sync_error = ""
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.commit()

    cap = PLATFORM_PAGE_CAP if row.origin == "platform" else TENANT_PAGE_CAP
    try:
        crawled = await _crawl_in_thread(_start_urls_for(row), cap)
        pages = list(crawled.get("pages") or [])
        combined = "".join(p.get("text") or "" for p in pages).strip()
        if len(combined) < MIN_TEXT_CHARS:
            raise ValueError("No readable text at this URL")
        path = f"modules/{row.module_slug}/sources/{row.id}.md"
        content = pages_to_markdown(row.title, pages)
        doc = await upsert_doc(
            session,
            row.tenant_id,
            path=path,
            content=content,
            kind="doc",
            title=row.title,
            created_by_type="system",
            created_by_id="module_source",
        )
        from app.models.workspace import DocChunk

        chunks = (
            await session.execute(
                select(DocChunk).where(
                    DocChunk.tenant_id == row.tenant_id,
                    DocChunk.doc_id == doc.id,
                )
            )
        ).scalars().all()
        for chunk in chunks:
            try:
                meta = json.loads(chunk.metadata_json or "{}")
            except json.JSONDecodeError:
                meta = {}
            if not isinstance(meta, dict):
                meta = {}
            meta.update(
                {
                    "module_slug": row.module_slug,
                    "module_source_id": str(row.id),
                    "origin": row.origin,
                    "source_url": row.url,
                }
            )
            chunk.metadata_json = json.dumps(meta)
            session.add(chunk)

        meta = _row_meta(row)
        meta["pages_fetched"] = int(crawled.get("pages_fetched") or len(pages))
        meta["pages_skipped"] = int(crawled.get("pages_skipped") or 0)
        row.metadata_json = json.dumps(meta)
        row.workspace_doc_id = doc.id
        row.status = "ready"
        row.last_synced_at = datetime.utcnow()
        row.sync_error = ""
    except Exception as exc:
        logger.exception("module source index failed for %s", source_id)
        row.status = "error"
        row.sync_error = str(exc)[:500]
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def _crawl_in_thread(start_urls: list[str], page_cap: int) -> dict[str, Any]:
    import asyncio

    return await asyncio.to_thread(crawl_source_pages, start_urls, page_cap=page_cap)


async def reindex_due_sources(session: AsyncSession, *, limit: int = 40) -> int:
    """Cron helper: reindex platform + auto_reindex tenant sources."""
    result = await session.execute(
        select(ModuleSource)
        .where(
            ModuleSource.auto_reindex.is_(True),
            ModuleSource.status.in_(("pending", "ready", "error", "indexing")),
        )
        .order_by(ModuleSource.updated_at.asc())
        .limit(limit)
    )
    rows = list(result.scalars().all())
    count = 0
    now = datetime.utcnow()
    for row in rows:
        if row.status == "indexing" and row.updated_at and now - row.updated_at < STALE_INDEXING_AFTER:
            continue
        await index_source(session, row.id)
        count += 1
    return count


async def search_module_sources(
    session: AsyncSession,
    tenant_id: UUID,
    module_slug: str,
    query: str,
    *,
    top_k: int = 5,
) -> list[dict[str, Any]]:
    from app.services.workspace import hybrid_search

    doc_ids = {
        str(row.workspace_doc_id)
        for row in (
            await session.execute(
                select(ModuleSource).where(
                    ModuleSource.tenant_id == tenant_id,
                    ModuleSource.module_slug == module_slug,
                    ModuleSource.status == "ready",
                    ModuleSource.workspace_doc_id.is_not(None),
                )
            )
        ).scalars().all()
        if row.workspace_doc_id
    }
    if not doc_ids:
        return []
    hits = await hybrid_search(session, tenant_id, query, top_k=top_k * 4)
    filtered: list[dict[str, Any]] = []
    for hit in hits or []:
        if str(hit.get("doc_id") or "") in doc_ids:
            filtered.append(hit)
            if len(filtered) >= top_k:
                break
    return filtered
