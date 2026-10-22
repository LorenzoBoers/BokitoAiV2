from __future__ import annotations

from typing import Any

import httpx

transport: httpx.AsyncBaseTransport | None = None


def client(**kwargs: Any) -> httpx.AsyncClient:
    if transport is not None:
        kwargs["transport"] = transport
    kwargs.setdefault("timeout", 20.0)
    return httpx.AsyncClient(**kwargs)


def read_tool(name: str, description: str, properties: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "input_schema": {"type": "object", "properties": properties or {}},
        "annotations": {"readOnlyHint": True, "destructiveHint": False},
    }


def error_text(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        body = response.text
    detail = body.get("message") or body.get("error") or body if isinstance(body, dict) else body
    return f"HTTP {response.status_code}: {str(detail)[:200]}"
