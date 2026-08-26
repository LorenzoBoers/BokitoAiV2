"""Public Bokito product-help: docs index, search, raw markdown, sitemap, OpenAPI."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, Response

from app.middleware.rate_limit import rate_limit
from app.services import product_help as svc
from app.services.public_openapi import build_public_openapi

router = APIRouter(prefix="/docs", tags=["product-help"])

_docs_limit = Depends(rate_limit("product-help", limit=60))


@router.get("", dependencies=[_docs_limit])
async def product_help_index(
    lang: Annotated[str | None, Query()] = None,
):
    articles = svc.list_articles(lang)
    return {
        "lang": svc.normalize_lang(lang),
        "sections": svc.nav_tree(lang),
        "articles": [svc.serialize_summary(item) for item in articles],
    }


@router.get("/search", dependencies=[_docs_limit])
async def product_help_search(
    q: Annotated[str, Query(min_length=1, max_length=200)],
    lang: Annotated[str | None, Query()] = None,
    top_k: Annotated[int, Query(ge=1, le=20)] = 8,
):
    return {
        "lang": svc.normalize_lang(lang),
        "query": q,
        "results": svc.keyword_search(q, lang=lang, top_k=top_k),
    }


@router.get("/sitemap.xml", dependencies=[_docs_limit], include_in_schema=False)
async def product_help_sitemap():
    return Response(content=svc.build_sitemap_xml(), media_type="application/xml")


@router.get("/openapi.json", dependencies=[_docs_limit], include_in_schema=False)
async def public_openapi_schema(request: Request):
    return build_public_openapi(request.app)


@router.get("/{slug}.md", dependencies=[_docs_limit], include_in_schema=False)
async def product_help_raw_markdown(
    slug: str,
    lang: Annotated[str | None, Query()] = None,
):
    article = svc.get_article(slug, lang)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    return PlainTextResponse(svc.raw_markdown(article), media_type="text/markdown; charset=utf-8")


@router.get("/{slug}", dependencies=[_docs_limit])
async def product_help_article(
    slug: str,
    lang: Annotated[str | None, Query()] = None,
):
    article = svc.get_article(slug, lang)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    return svc.serialize_article(article)
