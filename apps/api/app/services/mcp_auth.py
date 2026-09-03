"""Shared MCP HTTP auth header helpers (tenant-scoped servers)."""

from __future__ import annotations

from typing import Any


def mcp_auth_headers(auth: dict[str, Any]) -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    bearer = auth.get("bearer_token") or auth.get("access_token")
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    elif auth.get("api_key"):
        headers["Authorization"] = f"Bearer {auth['api_key']}"
        headers["X-API-Key"] = str(auth["api_key"])
    # Custom header passthrough (e.g. vendor-specific auth schemes).
    extra = auth.get("headers")
    if isinstance(extra, dict):
        for key, value in extra.items():
            if isinstance(key, str) and key.strip() and value is not None:
                headers[key.strip()] = str(value)
    return headers
