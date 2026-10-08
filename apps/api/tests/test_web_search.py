"""Brave web_search tool and image showcase refs."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.proposal_items import normalize_item_type, resolve_items
from app.services.web_search import brave_search
from app.tools.registry import get_tool_spec


def test_web_search_is_registered():
    spec = get_tool_spec("web_search")
    assert spec is not None
    assert spec.category == "workspace"
    assert spec.mutating is False
    assert spec.gated is False


def test_image_is_a_showcase_type():
    assert normalize_item_type("image") == "image"
    assert normalize_item_type("img") == "image"
    assert normalize_item_type("photo") == "image"


@pytest.mark.asyncio
async def test_resolve_image_from_url(session_override):
    from uuid import uuid4

    items = await resolve_items(
        session_override,
        uuid4(),  # tenant unused for remote image URLs
        [
            {
                "type": "image",
                "url": "https://cdn.example.com/a.png",
                "title": "Example",
            },
            {"type": "image", "id": "not-a-url"},
        ],
    )
    assert items[0]["type"] == "image"
    assert items[0]["image_url"] == "https://cdn.example.com/a.png"
    assert items[0]["title"] == "Example"
    assert items[0].get("missing") is not True
    assert items[1]["missing"] is True


@pytest.mark.asyncio
async def test_brave_search_not_configured():
    with patch("app.services.web_search.get_settings") as settings:
        settings.return_value = MagicMock(brave_search_api_key="")
        out = await brave_search("bokito")
    assert out["error"] == "web_search_not_configured"


@pytest.mark.asyncio
async def test_brave_search_parses_web_results():
    payload = {
        "web": {
            "results": [
                {
                    "title": "Bokito",
                    "url": "https://bokito.ai/",
                    "description": "Chat-first ops",
                    "thumbnail": {"src": "https://bokito.ai/og.png"},
                }
            ]
        }
    }
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = payload

    mock_client = AsyncMock()
    mock_client.__aenter__.return_value = mock_client
    mock_client.get.return_value = response

    with (
        patch("app.services.web_search.get_settings") as settings,
        patch("app.services.web_search.httpx.AsyncClient", return_value=mock_client),
    ):
        settings.return_value = MagicMock(brave_search_api_key="test-key")
        out = await brave_search("bokito", count=3)

    assert out["kind"] == "web"
    assert out["count"] == 1
    assert out["results"][0]["url"] == "https://bokito.ai/"
    assert out["results"][0]["host"] == "bokito.ai"
    assert out["results"][0]["favicon_url"]


def test_web_search_on_suggest_and_assistant_allowlists():
    from app.services.personal_assistant import TOOL_ALLOWLIST
    from app.workers.tasks import SUGGEST_MODE_TOOLS

    assert "web_search" in SUGGEST_MODE_TOOLS
    assert "web_search" in TOOL_ALLOWLIST
