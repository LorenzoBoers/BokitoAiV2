"""Smoke-test Brave Search using the process/env settings."""
from __future__ import annotations

import asyncio
import os

from app.config import get_settings
from app.services.web_search import brave_search


async def main() -> None:
    get_settings.cache_clear()
    settings = get_settings()
    key = (settings.brave_search_api_key or os.environ.get("BRAVE_SEARCH_API_KEY") or "").strip()
    print("settings_len", len(key))
    out = await brave_search("straaljager", count=3, kind="images")
    print("error", out.get("error"))
    results = out.get("results") or []
    print("results", len(results))
    if results:
        print("first_title", (results[0].get("title") or "")[:80])


if __name__ == "__main__":
    asyncio.run(main())
