"""Fetch a public URL as Markdown via self-hosted Crawl4AI (agent ``fetch_url``)."""

from __future__ import annotations

import logging
import ipaddress
import socket
from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

MAX_MARKDOWN_CHARS = 80_000
FETCH_TIMEOUT_S = 45.0

_BLOCKED_HOSTS = frozenset(
    {
        "localhost",
        "metadata.google.internal",
        "metadata.google.com",
        "169.254.169.254",
        "searxng",
        "crawl4ai",
        "postgres",
        "redis",
        "api",
        "worker",
        "web",
        "bokito-api",
    }
)


def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").removeprefix("www.")
    except Exception:
        logger.warning("web fetch failed", exc_info=True)
        return ""


def assert_public_http_url(url: str) -> str | None:
    """Return an error code if ``url`` is not a safe public http(s) target."""
    raw = (url or "").strip()
    if not raw:
        return "url_required"
    try:
        parsed = urlparse(raw)
    except Exception:
        logger.warning("web fetch URL validate failed", exc_info=True)
        return "url_invalid"
    if parsed.scheme not in ("http", "https"):
        return "url_scheme_blocked"
    if parsed.username or parsed.password:
        return "url_credentials_blocked"
    host = (parsed.hostname or "").strip().lower()
    if not host:
        return "url_invalid"
    if host in _BLOCKED_HOSTS or host.endswith(".local") or host.endswith(".internal"):
        return "url_host_blocked"
    # Literal IPs
    try:
        ip = ipaddress.ip_address(host)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return "url_private_blocked"
    except ValueError:
        # Hostname — resolve and check every address
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror:
            return "url_resolve_failed"
        for info in infos:
            addr = info[4][0]
            try:
                ip = ipaddress.ip_address(addr)
            except ValueError:
                continue
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_multicast
                or ip.is_reserved
                or ip.is_unspecified
            ):
                return "url_private_blocked"
    return None


def _clip_markdown(text: str, limit: int = MAX_MARKDOWN_CHARS) -> str:
    body = (text or "").strip()
    if len(body) <= limit:
        return body
    return body[: limit - 1].rstrip() + "…"


def _extract_markdown(payload: Any) -> str:
    if isinstance(payload, str):
        return payload
    if not isinstance(payload, dict):
        return ""
    for key in ("markdown", "md", "fit_markdown", "raw_markdown"):
        val = payload.get(key)
        if isinstance(val, str) and val.strip():
            return val
        if isinstance(val, dict):
            for nested in ("raw_markdown", "fit_markdown", "markdown", "md"):
                inner = val.get(nested)
                if isinstance(inner, str) and inner.strip():
                    return inner
    # Crawl /md sometimes nests under results[0]
    results = payload.get("results")
    if isinstance(results, list) and results:
        first = results[0]
        if isinstance(first, dict):
            return _extract_markdown(first)
    return ""


async def fetch_url_markdown(url: str) -> dict[str, Any]:
    """Fetch ``url`` as fit Markdown. Returns metadata + markdown or ``{error}``."""
    target = (url or "").strip()
    blocked = assert_public_http_url(target)
    if blocked:
        messages = {
            "url_required": "url is required",
            "url_invalid": "url is invalid",
            "url_scheme_blocked": "Only http and https URLs are allowed",
            "url_credentials_blocked": "URLs with credentials are not allowed",
            "url_host_blocked": "This host is not allowed",
            "url_private_blocked": "Private or local network URLs are not allowed",
            "url_resolve_failed": "Could not resolve the hostname",
        }
        return {"error": blocked, "message": messages.get(blocked, blocked)}

    settings = get_settings()
    base = (settings.crawl4ai_url or "").strip().rstrip("/")
    token = (settings.crawl4ai_api_token or "").strip()
    if not base:
        return {
            "error": "fetch_url_not_configured",
            "message": "Page fetch is not configured (missing CRAWL4AI_URL).",
        }
    if not token:
        return {
            "error": "fetch_url_not_configured",
            "message": "Page fetch is not configured (missing CRAWL4AI_API_TOKEN).",
        }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = {"url": target, "f": "fit"}
    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT_S) as client:
            resp = await client.post(f"{base}/md", headers=headers, json=body)
    except httpx.HTTPError as exc:
        return {"error": "fetch_url_failed", "message": str(exc)[:200]}

    if resp.status_code in (401, 403):
        return {
            "error": "fetch_url_unauthorized",
            "message": "Crawl4AI rejected the API token.",
        }
    if resp.status_code >= 400:
        detail = (resp.text or "")[:200]
        return {
            "error": "fetch_url_failed",
            "message": f"Crawl4AI HTTP {resp.status_code}: {detail}".strip(),
        }

    try:
        payload = resp.json()
    except ValueError:
        # Some builds return raw markdown text
        text = (resp.text or "").strip()
        if text:
            md = _clip_markdown(text)
            host = _host(target)
            return {
                "url": target,
                "host": host,
                "title": host or target,
                "markdown": md,
                "chars": len(md),
                "truncated": len(text) > MAX_MARKDOWN_CHARS,
            }
        return {"error": "fetch_url_failed", "message": "Invalid response from Crawl4AI"}

    raw_md = _extract_markdown(payload)
    if not raw_md.strip():
        return {
            "error": "fetch_url_empty",
            "message": "Crawl4AI returned no markdown for this URL.",
            "url": target,
            "host": _host(target),
        }

    md = _clip_markdown(raw_md)
    host = _host(target)
    title = ""
    if isinstance(payload, dict):
        title = str(payload.get("title") or "").strip()
        meta = payload.get("metadata")
        if not title and isinstance(meta, dict):
            title = str(meta.get("title") or "").strip()
    return {
        "url": target,
        "host": host,
        "title": title or host or target,
        "markdown": md,
        "chars": len(md),
        "truncated": len(raw_md) > MAX_MARKDOWN_CHARS,
    }
