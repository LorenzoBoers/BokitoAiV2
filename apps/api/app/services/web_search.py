"""Open-web search via Brave Search API for the agent ``web_search`` tool."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import get_settings

BRAVE_WEB = "https://api.search.brave.com/res/v1/web/search"
BRAVE_IMAGES = "https://api.search.brave.com/res/v1/images/search"
MAX_COUNT = 10


def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").removeprefix("www.")
    except Exception:
        return ""


def _favicon(host: str) -> str | None:
    if not host:
        return None
    return f"https://www.google.com/s2/favicons?domain={host}&sz=32"


def _clip(value: Any, limit: int = 280) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _url_field(value: Any) -> str:
    """Brave sometimes nests image urls as ``{src, width, height}`` objects."""
    if isinstance(value, dict):
        for key in ("src", "url", "thumbnail"):
            nested = value.get(key)
            if isinstance(nested, str) and nested.strip():
                return nested.strip()
            if isinstance(nested, dict):
                found = _url_field(nested)
                if found:
                    return found
        return ""
    if isinstance(value, str):
        return value.strip()
    return ""


async def brave_search(
    query: str,
    *,
    count: int = 5,
    kind: str = "web",
) -> dict[str, Any]:
    """Run a Brave search. Returns ``{query, kind, results}`` or ``{error}``."""
    q = (query or "").strip()
    if not q:
        return {"error": "query_required", "message": "query is required"}
    settings = get_settings()
    api_key = (settings.brave_search_api_key or "").strip()
    if not api_key:
        return {
            "error": "web_search_not_configured",
            "message": "Web search is not configured for this workspace (missing BRAVE_SEARCH_API_KEY).",
        }
    n = max(1, min(int(count or 5), MAX_COUNT))
    kind_key = "images" if str(kind).lower() in ("images", "image", "img") else "web"
    url = BRAVE_IMAGES if kind_key == "images" else BRAVE_WEB
    params = {"q": q, "count": n}
    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": api_key,
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, params=params, headers=headers)
    except httpx.HTTPError as exc:
        return {"error": "web_search_failed", "message": str(exc)[:200]}
    if resp.status_code == 401 or resp.status_code == 403:
        return {
            "error": "web_search_unauthorized",
            "message": "Brave Search rejected the API key.",
        }
    if resp.status_code >= 400:
        return {
            "error": "web_search_failed",
            "message": f"Brave Search HTTP {resp.status_code}",
        }
    try:
        payload = resp.json()
    except ValueError:
        return {"error": "web_search_failed", "message": "Invalid JSON from Brave Search"}

    results: list[dict[str, Any]] = []
    if kind_key == "images":
        for row in (payload.get("results") or [])[:n]:
            if not isinstance(row, dict):
                continue
            href = _url_field(row.get("url")) or _url_field(row.get("page_url"))
            props = row.get("properties") if isinstance(row.get("properties"), dict) else {}
            image = (
                _url_field(row.get("src"))
                or _url_field(row.get("thumbnail"))
                or _url_field(props.get("url"))
                or _url_field(props.get("src"))
            )
            if not href and not image:
                continue
            host = _host(href or image)
            results.append(
                {
                    "title": _clip(row.get("title") or host or "Image", 120),
                    "url": href or image,
                    "image_url": image or href,
                    "host": host,
                    "favicon_url": _favicon(host),
                    "snippet": _clip(row.get("description") or "", 200),
                }
            )
    else:
        web = payload.get("web") if isinstance(payload.get("web"), dict) else {}
        for row in (web.get("results") or [])[:n]:
            if not isinstance(row, dict):
                continue
            href = str(row.get("url") or "").strip()
            if not href:
                continue
            host = _host(href)
            thumb = ""
            meta = row.get("thumbnail")
            if isinstance(meta, dict):
                thumb = str(meta.get("src") or "").strip()
            results.append(
                {
                    "title": _clip(row.get("title") or host, 120),
                    "url": href,
                    "host": host,
                    "favicon_url": _favicon(host),
                    "snippet": _clip(row.get("description") or "", 280),
                    "image_url": thumb or None,
                }
            )
    return {"query": q, "kind": kind_key, "count": len(results), "results": results}
