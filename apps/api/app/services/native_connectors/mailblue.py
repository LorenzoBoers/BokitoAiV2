"""Mailblue (ActiveCampaign API v3): lists, contacts and campaigns, read only.

Auth: the account URL (``https://{account}.api-us1.com`` or the Mailblue
account host) and the API key, sent as ``Api-Token``.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.services.native_connectors._http import client, error_text, read_tool

NATIVE_URL = "native://mailblue"
MAX_LIMIT = 100

TOOLS: list[dict[str, Any]] = [
    read_tool("list_lists", "Mailing lists with subscriber counts", {"limit": {"type": "integer"}}),
    read_tool(
        "search_contacts",
        "Contacts by email or name",
        {"search": {"type": "string"}, "limit": {"type": "integer"}},
    ),
    read_tool(
        "list_campaigns",
        "Recent campaigns with send date, opens and clicks",
        {"limit": {"type": "integer"}},
    ),
]


def _base(auth: dict[str, Any]) -> str:
    url = str(auth.get("account_url") or "").strip().rstrip("/")
    if url and not url.startswith("http"):
        url = f"https://{url}"
    return url


def has_credentials(auth: dict[str, Any]) -> bool:
    return bool(_base(auth) and str(auth.get("api_key") or "").strip())


async def _get(auth: dict[str, Any], path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    async with client(base_url=f"{_base(auth)}/api/3", headers={"Api-Token": str(auth.get("api_key") or "")}) as http:
        try:
            response = await http.get(path, params=params or {})
        except httpx.HTTPError as exc:
            return {"error": f"Mailblue is unreachable: {exc}"}
    if response.status_code >= 400:
        return {"error": error_text(response)}
    return {"data": response.json()}


async def validate(auth: dict[str, Any]) -> dict[str, Any]:
    if not has_credentials(auth):
        return {"ok": False, "error": "Fill in the Mailblue account URL and API key."}
    result = await _get(auth, "/users/me")
    if "error" in result:
        return {"ok": False, "error": result["error"]}
    return {"ok": True}


def _limit(arguments: dict[str, Any]) -> int:
    try:
        return max(1, min(MAX_LIMIT, int(arguments.get("limit") or 20)))
    except (TypeError, ValueError):
        return 20


async def call(auth: dict[str, Any], tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if not has_credentials(auth):
        return {"error": "Mailblue needs to be connected again under Connections."}
    limit = _limit(arguments)
    if tool == "list_lists":
        result = await _get(auth, "/lists", {"limit": limit})
        if "error" in result:
            return result
        rows = result["data"].get("lists") or []
        return {"result": [{"id": r.get("id"), "name": r.get("name"), "subscribers": r.get("subscriber_count")} for r in rows]}
    if tool == "search_contacts":
        result = await _get(auth, "/contacts", {"search": str(arguments.get("search") or ""), "limit": limit})
        if "error" in result:
            return result
        rows = result["data"].get("contacts") or []
        return {
            "result": [
                {"id": r.get("id"), "email": r.get("email"), "name": f"{r.get('firstName') or ''} {r.get('lastName') or ''}".strip()}
                for r in rows
            ]
        }
    if tool == "list_campaigns":
        result = await _get(auth, "/campaigns", {"limit": limit, "orders[sdate]": "DESC"})
        if "error" in result:
            return result
        rows = result["data"].get("campaigns") or []
        return {
            "result": [
                {
                    "id": r.get("id"),
                    "name": r.get("name"),
                    "sent_at": r.get("sdate"),
                    "sends": r.get("send_amt"),
                    "opens": r.get("uniqueopens"),
                    "clicks": r.get("uniquelinkclicks"),
                }
                for r in rows
            ]
        }
    return {"error": f"Unknown Mailblue tool {tool}"}
