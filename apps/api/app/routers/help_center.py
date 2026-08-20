"""Public help center: unauthenticated read access to published workspace docs.

Publishing is frontmatter-driven (`published` + `slug` on markdown docs of
kind `doc`), so there is no parallel article table — the same WorkspaceDoc
feeds agent RAG and the public help center.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.middleware.rate_limit import rate_limit
from app.models.auth import Tenant
from app.models.workspace import WorkspaceDoc
from app.services.help_articles import article_slug, doc_frontmatter, is_published

router = APIRouter(prefix="/help", tags=["help-center"])


def _description(frontmatter: dict[str, Any], content: str) -> str:
    explicit = str(frontmatter.get("description") or "").strip()
    if explicit:
        return explicit[:200]
    for line in content.splitlines():
        text = line.strip()
        if not text or text.startswith(("#", "```", "---", "|")):
            continue
        return text[:200]
    return ""


async def _resolve_tenant(session: AsyncSession, tenant_slug: str) -> Tenant:
    result = await session.execute(
        select(Tenant).where(Tenant.slug == tenant_slug.strip().lower())
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Help center not found")
    return tenant


async def _published_docs(
    session: AsyncSession, tenant_id: Any
) -> list[tuple[WorkspaceDoc, dict[str, Any]]]:
    result = await session.execute(
        select(WorkspaceDoc).where(
            WorkspaceDoc.tenant_id == tenant_id,
            WorkspaceDoc.kind == "doc",
        )
    )
    published: list[tuple[WorkspaceDoc, dict[str, Any]]] = []
    for doc in result.scalars().all():
        meta = doc_frontmatter(doc)
        if is_published(meta):
            published.append((doc, meta))
    published.sort(key=lambda pair: (pair[0].sort_order, pair[0].title.lower()))
    return published


@router.get(
    "/{tenant_slug}",
    dependencies=[Depends(rate_limit("help-center", limit=60))],
)
async def help_center_index(
    tenant_slug: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant = await _resolve_tenant(session, tenant_slug)
    docs = await _published_docs(session, tenant.id)
    return {
        "tenant": {"name": tenant.name, "slug": tenant.slug},
        "articles": [
            {
                "slug": article_slug(doc, meta),
                "title": doc.title,
                "description": _description(meta, doc.content),
                "updated_at": doc.updated_at.isoformat(),
            }
            for doc, meta in docs
        ],
    }


@router.get(
    "/{tenant_slug}/{slug}",
    dependencies=[Depends(rate_limit("help-center", limit=60))],
)
async def help_center_article(
    tenant_slug: str,
    slug: str,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant = await _resolve_tenant(session, tenant_slug)
    for doc, meta in await _published_docs(session, tenant.id):
        if article_slug(doc, meta) == slug:
            return {
                "tenant": {"name": tenant.name, "slug": tenant.slug},
                "slug": slug,
                "title": doc.title,
                "description": _description(meta, doc.content),
                "content": doc.content,
                "updated_at": doc.updated_at.isoformat(),
            }
    raise HTTPException(status_code=404, detail="Article not found")
