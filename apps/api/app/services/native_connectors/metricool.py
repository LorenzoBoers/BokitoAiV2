"""Metricool: brands, statistics per network and period, and posts, read only.

Auth: the API token (``X-Mc-Auth``) and the user id; the API needs the
Advanced plan. Without it the agent reads a CSV export in the client folder.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.services.native_connectors._http import client, error_text, read_tool

NATIVE_URL = "native://metricool"
BASE_URL = "https://app.metricool.com/api"

_PERIOD = {
    "brand_id": {"type": "string", "description": "Metricool blogId of the brand"},
    "from": {"type": "string", "description": "Start date YYYY-MM-DD"},
    "to": {"type": "string", "description": "End date YYYY-MM-DD"},
}

TOOLS: list[dict[str, Any]] = [
    read_tool("list_brands", "Brands (blogs) on this Metricool account"),
    read_tool(
        "get_network_stats",
        "Posts and their engagement for one network in a period",
        {**_PERIOD, "network": {"type": "string", "description": "instagram, facebook, tiktok, linkedin"}},
    ),
    read_tool("list_scheduled_posts", "Planned and published posts in a period", _PERIOD),
]


def has_credentials(auth: dict[str, Any]) -> bool:
    return bool(str(auth.get("token") or "").strip() and str(auth.get("user_id") or "").strip())


async def _get(auth: dict[str, Any], path: str, params: dict[str, Any]) -> dict[str, Any]:
    query = {"userId": str(auth.get("user_id") or ""), "integrationSource": "bokito", **params}
    async with client(base_url=BASE_URL, headers={"X-Mc-Auth": str(auth.get("token") or "")}) as http:
        try:
            response = await http.get(path, params=query)
        except httpx.HTTPError as exc:
            return {"error": f"Metricool is unreachable: {exc}"}
    if response.status_code >= 400:
        return {"error": error_text(response)}
    try:
        return {"data": response.json()}
    except ValueError:
        return {"data": response.text[:4000]}


async def validate(auth: dict[str, Any]) -> dict[str, Any]:
    if not has_credentials(auth):
        return {"ok": False, "error": "Fill in the Metricool API token and user id."}
    result = await _get(auth, "/admin/simpleProfiles", {})
    if "error" in result:
        return {"ok": False, "error": result["error"]}
    return {"ok": True}


def _brand(auth: dict[str, Any], arguments: dict[str, Any]) -> str:
    return str(arguments.get("brand_id") or auth.get("blog_id") or "").strip()


async def call(auth: dict[str, Any], tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if not has_credentials(auth):
        return {"error": "Metricool needs to be connected again under Connections."}
    if tool == "list_brands":
        result = await _get(auth, "/admin/simpleProfiles", {})
        if "error" in result:
            return result
        rows = result["data"] if isinstance(result["data"], list) else []
        return {"result": [{"brand_id": r.get("id"), "name": r.get("label") or r.get("title")} for r in rows if isinstance(r, dict)]}
    brand = _brand(auth, arguments)
    if not brand:
        return {"error": "brand_id is required; call list_brands first."}
    period = {"blogId": brand, "from": str(arguments.get("from") or ""), "to": str(arguments.get("to") or "")}
    if tool == "get_network_stats":
        network = str(arguments.get("network") or "instagram").strip().lower()
        result = await _get(auth, f"/v2/analytics/posts/{network}", period)
        return result if "error" in result else {"result": result["data"]}
    if tool == "list_scheduled_posts":
        result = await _get(auth, "/v2/scheduler/posts", {"blogId": brand, "start": period["from"], "end": period["to"]})
        return result if "error" in result else {"result": result["data"]}
    return {"error": f"Unknown Metricool tool {tool}"}
