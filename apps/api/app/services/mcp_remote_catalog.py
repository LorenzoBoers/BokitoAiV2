"""Load the remote MCP marketplace catalog from the shared JSON file.

Adding a preset: append a host (if new) and a provider in
``app/data/mcp_remote_catalog.json``. Backend hosts/providers and the
dashboard marketplace are generated from that file.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "mcp_remote_catalog.json"


@lru_cache(maxsize=1)
def load_mcp_remote_catalog() -> dict[str, Any]:
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("mcp_remote_catalog.json must be an object")
    return data


def catalog_hosts() -> list[dict[str, Any]]:
    rows = load_mcp_remote_catalog().get("hosts") or []
    return [row for row in rows if isinstance(row, dict) and row.get("slug")]


def catalog_providers() -> list[dict[str, Any]]:
    rows = load_mcp_remote_catalog().get("providers") or []
    return [row for row in rows if isinstance(row, dict) and row.get("slug")]
