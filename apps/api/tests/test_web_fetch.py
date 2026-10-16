"""fetch_url / Crawl4AI page fetch + SSRF guards."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.web_fetch import assert_public_http_url, fetch_url_markdown
from app.tools.registry import get_tool_spec


def test_fetch_url_is_registered():
    spec = get_tool_spec("fetch_url")
    assert spec is not None
    assert spec.category == "workspace"
    assert spec.mutating is False
    assert spec.gated is False
    assert spec.audience == "both"


def test_ssrf_blocks_private_and_local():
    assert assert_public_http_url("") == "url_required"
    assert assert_public_http_url("ftp://example.com") == "url_scheme_blocked"
    assert assert_public_http_url("http://localhost/x") == "url_host_blocked"
    assert assert_public_http_url("http://127.0.0.1/") == "url_private_blocked"
    assert assert_public_http_url("http://10.0.0.1/") == "url_private_blocked"
    assert assert_public_http_url("http://192.168.1.1/") == "url_private_blocked"
    assert assert_public_http_url("http://169.254.169.254/") == "url_host_blocked"
    assert assert_public_http_url("http://user:pass@example.com/") == "url_credentials_blocked"
    assert assert_public_http_url("https://example.com/path") is None


@pytest.mark.asyncio
async def test_fetch_url_not_configured():
    with patch("app.services.web_fetch.get_settings") as settings:
        settings.return_value = MagicMock(crawl4ai_url="", crawl4ai_api_token="")
        out = await fetch_url_markdown("https://example.com")
    assert out["error"] == "fetch_url_not_configured"


@pytest.mark.asyncio
async def test_fetch_url_happy_path_markdown():
    payload = {
        "markdown": "# Hello\n\nWorld",
        "title": "Example Domain",
    }
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = payload
    response.text = ""

    mock_client = AsyncMock()
    mock_client.__aenter__.return_value = mock_client
    mock_client.post.return_value = response

    with (
        patch("app.services.web_fetch.get_settings") as settings,
        patch("app.services.web_fetch.httpx.AsyncClient", return_value=mock_client),
        patch("app.services.web_fetch.assert_public_http_url", return_value=None),
    ):
        settings.return_value = MagicMock(
            crawl4ai_url="http://crawl4ai:11235",
            crawl4ai_api_token="tok",
        )
        out = await fetch_url_markdown("https://example.com")

    assert out["url"] == "https://example.com"
    assert out["host"] == "example.com"
    assert "Hello" in out["markdown"]
    assert out["truncated"] is False
    mock_client.post.assert_awaited()
