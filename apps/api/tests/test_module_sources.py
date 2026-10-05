"""Module source crawl + index: curated packs, robots, multi-page docs."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.module_source import ModuleSource
from app.models.workspace import DocChunk, WorkspaceDoc
from app.services.module_sources import (
    ACCOUNTING_PLATFORM_SEEDS,
    crawl_source_pages,
    ensure_platform_seeds,
    index_source,
    pages_to_markdown,
)


def _html(title: str, body: str, links: list[str] | None = None) -> bytes:
    anchors = "".join(f'<a href="{href}">{href}</a>' for href in (links or []))
    return (
        f"<!doctype html><html><head><title>{title}</title></head>"
        f"<body><p>{body}</p>{anchors}</body></html>"
    ).encode("utf-8")


def _http_map(mapping: dict[str, tuple[bytes, str]]):
    def _get(url: str, *, timeout: int = 25):
        if url in mapping:
            raw, ctype = mapping[url]
            return raw, ctype, url
        raise OSError(f"unexpected url {url}")

    return _get


def test_accounting_seed_packs_have_start_urls():
    keys = {s["seed_key"] for s in ACCOUNTING_PLATFORM_SEEDS}
    assert {"belastingdienst", "nba_hra", "rjnet", "kvk_jaarrekening", "bw2_titel9"} <= keys
    for seed in ACCOUNTING_PLATFORM_SEEDS:
        assert seed["url"].startswith("https://")
        assert seed["start_urls"]
        assert seed["url"] in seed["start_urls"]


def test_crawl_follows_same_origin_and_robots():
    mapping = {
        "https://regs.example/robots.txt": (
            b"User-agent: *\nDisallow: /secret\nAllow: /\n",
            "text/plain",
        ),
        "https://regs.example/": (
            _html("Home", "BTW overview for companies.", ["/btw", "/secret", "https://other.example/x"]),
            "text/html",
        ),
        "https://regs.example/btw": (
            _html("BTW", "BTW rates and filing dates for the Netherlands."),
            "text/html",
        ),
        "https://regs.example/secret": (
            _html("Secret", "should not index"),
            "text/html",
        ),
    }
    with (
        patch("app.services.module_sources._http_get", side_effect=_http_map(mapping)),
        patch("app.services.module_sources.FETCH_DELAY_S", 0),
    ):
        out = crawl_source_pages(["https://regs.example/"], page_cap=20, delay_s=0)
    urls = {p["url"] for p in out["pages"]}
    assert "https://regs.example/" in urls
    assert "https://regs.example/btw" in urls
    assert "https://regs.example/secret" not in urls
    assert out["pages_fetched"] == 2
    assert out["skipped_robots"] >= 1
    md = pages_to_markdown("Regs", out["pages"])
    assert "## Home" in md
    assert "## BTW" in md
    assert "Source: https://regs.example/btw" in md


def test_crawl_empty_text_stays_empty():
    mapping = {
        "https://empty.example/robots.txt": (b"User-agent: *\nAllow: /\n", "text/plain"),
        "https://empty.example/": (_html("Empty", "   "), "text/html"),
    }
    with (
        patch("app.services.module_sources._http_get", side_effect=_http_map(mapping)),
        patch("app.services.module_sources.FETCH_DELAY_S", 0),
    ):
        out = crawl_source_pages(["https://empty.example/"], page_cap=5, delay_s=0)
    assert out["pages_fetched"] == 0


@pytest.mark.asyncio
async def test_index_source_writes_section_chunks(
    client, session_override: AsyncSession, monkeypatch
):
    async def _noop(_sid: str):
        return None

    monkeypatch.setattr("app.workers.tasks.enqueue_module_source_index", _noop)
    mapping = {
        "https://office.example/robots.txt": (b"User-agent: *\nAllow: /\n", "text/plain"),
        "https://office.example/regs": (
            _html("Office regs", "Filing calendar and VAT notes.", ["/regs/btw"]),
            "text/html",
        ),
        "https://office.example/regs/btw": (
            _html("Office BTW", "Nine percent and twenty-one percent VAT."),
            "text/html",
        ),
    }
    monkeypatch.setattr("app.services.module_sources._http_get", _http_map(mapping))
    monkeypatch.setattr("app.services.module_sources.FETCH_DELAY_S", 0)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    row = ModuleSource(
        tenant_id=tenant.id,
        module_slug="accounting",
        kind="web",
        origin="tenant",
        title="Office regs",
        url="https://office.example/regs",
        status="pending",
    )
    session_override.add(row)
    await session_override.commit()
    await session_override.refresh(row)

    indexed = await index_source(session_override, row.id)
    assert indexed.status == "ready"
    assert indexed.sync_error == ""
    assert indexed.workspace_doc_id is not None
    doc = await session_override.get(WorkspaceDoc, indexed.workspace_doc_id)
    assert doc is not None
    assert "Office BTW" in (doc.content or "")
    assert "Nine percent" in (doc.content or "")
    chunks = (
        await session_override.execute(select(DocChunk).where(DocChunk.doc_id == doc.id))
    ).scalars().all()
    assert len(chunks) >= 2


@pytest.mark.asyncio
async def test_index_source_errors_when_unreadable(
    client, session_override: AsyncSession, monkeypatch
):
    monkeypatch.setattr("app.services.module_sources._http_get", _http_map({
        "https://paywall.example/robots.txt": (b"User-agent: *\nAllow: /\n", "text/plain"),
        "https://paywall.example/": (_html("Login", "Log in"), "text/html"),
    }))
    monkeypatch.setattr("app.services.module_sources.FETCH_DELAY_S", 0)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    row = ModuleSource(
        tenant_id=tenant.id,
        module_slug="accounting",
        origin="platform",
        title="Paywall",
        url="https://paywall.example/",
        status="pending",
    )
    session_override.add(row)
    await session_override.commit()
    await session_override.refresh(row)
    indexed = await index_source(session_override, row.id)
    assert indexed.status == "error"
    assert "readable" in indexed.sync_error.lower()


@pytest.mark.asyncio
async def test_ensure_platform_seeds_queues_pending(
    client, session_override: AsyncSession, monkeypatch
):
    queued: list[str] = []

    async def capture(source_id: str):
        queued.append(source_id)

    monkeypatch.setattr("app.workers.tasks.enqueue_module_source_index", capture)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    existing = (
        await session_override.execute(
            select(ModuleSource).where(
                ModuleSource.tenant_id == tenant.id, ModuleSource.module_slug == "accounting"
            )
        )
    ).scalars().all()
    for row in existing:
        await session_override.delete(row)
    await session_override.commit()
    rows = await ensure_platform_seeds(session_override, tenant.id, "accounting")
    assert len(rows) >= len(ACCOUNTING_PLATFORM_SEEDS)
    assert len(queued) >= len(ACCOUNTING_PLATFORM_SEEDS)
    statuses = {row.status for row in rows}
    assert "indexing" in statuses
    # Second pass must not enqueue again while still indexing.
    queued.clear()
    await ensure_platform_seeds(session_override, tenant.id, "accounting")
    assert queued == []
