"""Module knowledge sources: platform seeds, tenant URLs, indexing."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from uuid import UUID
from html.parser import HTMLParser
from urllib.request import Request, urlopen

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.module_source import ModuleSource
from app.modules.catalog import get_module

logger = logging.getLogger(__name__)

# Harold / Bourgondiën accounting regs seed (public knowledge for agents).
ACCOUNTING_PLATFORM_SEEDS: tuple[dict[str, str], ...] = (
    {
        "title": "RJNet — Richtlijnen voor de Jaarverslaggeving",
        "url": "https://www.rjnet.nl/",
        "seed_key": "rjnet",
    },
    {
        "title": "NBA — Handleiding Regelgeving Accountancy (HRA)",
        "url": "https://www.nba.nl/wet--en-regelgeving/hra/",
        "seed_key": "nba_hra",
    },
    {
        "title": "Belastingdienst",
        "url": "https://www.belastingdienst.nl/",
        "seed_key": "belastingdienst",
    },
)

PLATFORM_SEEDS: dict[str, tuple[dict[str, str], ...]] = {
    "accounting": ACCOUNTING_PLATFORM_SEEDS,
}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []
        self._skip = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style", "noscript"):
            self._skip = True

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript"):
            self._skip = False

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        text = data.strip()
        if text:
            self._chunks.append(text)

    def text(self) -> str:
        return "\n".join(self._chunks)


def _fetch_url_text(url: str, *, timeout: int = 25) -> str:
    req = Request(url, headers={"User-Agent": "BokitoModuleSourceBot/1.0"})
    with urlopen(req, timeout=timeout) as resp:  # noqa: S310 — operator-configured URLs
        raw = resp.read()
        content_type = (resp.headers.get("Content-Type") or "").lower()
    if "html" in content_type or url.rstrip("/").endswith((".html", ".htm")) or b"<html" in raw[:500].lower():
        parser = _TextExtractor()
        try:
            parser.feed(raw.decode("utf-8", errors="replace"))
        except Exception:
            return raw.decode("utf-8", errors="replace")[:50_000]
        return parser.text()[:50_000]
    return raw.decode("utf-8", errors="replace")[:50_000]


def serialize_source(row: ModuleSource) -> dict[str, Any]:
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
    by_key = {}
    for row in existing:
        try:
            meta = json.loads(row.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        key = str(meta.get("seed_key") or row.url)
        by_key[key] = row

    created: list[ModuleSource] = []
    for seed in seeds:
        key = seed["seed_key"]
        if key in by_key:
            continue
        row = ModuleSource(
            tenant_id=tenant_id,
            module_slug=module_slug,
            kind="web",
            origin="platform",
            title=seed["title"],
            url=seed["url"],
            status="pending",
            auto_reindex=True,
            metadata_json=json.dumps({"seed_key": key}),
        )
        session.add(row)
        created.append(row)
    if created:
        await session.commit()
        for row in created:
            await session.refresh(row)
    return list(by_key.values()) + created


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
    """Fetch URL content into a WorkspaceDoc and reindex chunks."""
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

    try:
        text = await _fetch_in_thread(row.url)
        if not text.strip():
            raise ValueError("No readable text at this URL")
        path = f"modules/{row.module_slug}/sources/{row.id}.md"
        content = f"# {row.title}\n\nSource: {row.url}\n\n{text}"
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
        # Stamp module metadata on chunks for filtered search.
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


async def _fetch_in_thread(url: str) -> str:
    import asyncio

    return await asyncio.to_thread(_fetch_url_text, url)


async def reindex_due_sources(session: AsyncSession, *, limit: int = 40) -> int:
    """Cron helper: reindex platform + auto_reindex tenant sources."""
    result = await session.execute(
        select(ModuleSource)
        .where(
            ModuleSource.auto_reindex.is_(True),
            ModuleSource.status.in_(("pending", "ready", "error")),
        )
        .order_by(ModuleSource.updated_at.asc())
        .limit(limit)
    )
    rows = list(result.scalars().all())
    count = 0
    for row in rows:
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
