"""Published help-center article helpers.

Publishing is frontmatter-driven (`published` + `slug` on markdown docs of
kind `doc`); these helpers are shared by the public help-center router and
the widget assistant (which appends "related article" links to replies).
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import Tenant
from app.models.workspace import WorkspaceDoc

_TRUTHY = {"true", "1", "yes", "on"}


def is_published(frontmatter: dict[str, Any]) -> bool:
    value = frontmatter.get("published")
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in _TRUTHY


def article_slug(doc: WorkspaceDoc, frontmatter: dict[str, Any]) -> str:
    explicit = str(frontmatter.get("slug") or "").strip()
    if explicit:
        return explicit
    stem = doc.path.rsplit("/", 1)[-1]
    return stem[:-3] if stem.endswith(".md") else stem


def doc_frontmatter(doc: WorkspaceDoc) -> dict[str, Any]:
    try:
        meta = json.loads(doc.frontmatter_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    return meta if isinstance(meta, dict) else {}


def article_url(tenant: Tenant, slug: str) -> str:
    base = get_settings().public_app_url.rstrip("/")
    return f"{base}/help/{tenant.slug}/{slug}"


async def related_published_articles(
    session: AsyncSession,
    tenant: Tenant,
    hits: list[dict[str, Any]],
    *,
    limit: int = 2,
) -> list[dict[str, str]]:
    """Resolve RAG hits to published help articles (deduped, ranked by hit order)."""
    doc_ids: list[UUID] = []
    for hit in hits:
        raw = hit.get("doc_id")
        if not raw:
            continue
        try:
            doc_id = UUID(str(raw))
        except ValueError:
            continue
        if doc_id not in doc_ids:
            doc_ids.append(doc_id)
    if not doc_ids:
        return []

    result = await session.execute(
        select(WorkspaceDoc).where(
            WorkspaceDoc.tenant_id == tenant.id,
            WorkspaceDoc.kind == "doc",
            WorkspaceDoc.id.in_(doc_ids),
        )
    )
    by_id = {doc.id: doc for doc in result.scalars().all()}

    articles: list[dict[str, str]] = []
    for doc_id in doc_ids:
        doc = by_id.get(doc_id)
        if not doc:
            continue
        meta = doc_frontmatter(doc)
        if not is_published(meta):
            continue
        slug = article_slug(doc, meta)
        articles.append({"title": doc.title, "slug": slug, "url": article_url(tenant, slug)})
        if len(articles) >= limit:
            break
    return articles


def format_related_articles(articles: list[dict[str, str]]) -> str:
    """Markdown block the widget renders below an assistant reply."""
    if not articles:
        return ""
    lines = "\n".join(f"- [{a['title']}]({a['url']})" for a in articles)
    return f"\n\n**Related articles**\n{lines}"
