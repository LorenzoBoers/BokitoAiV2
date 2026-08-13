"""Native Björn Lundén (BLA) integration.

Talks directly to the Björn Lundén public REST API — no Xano stack and no
separate MCP sidecar process. Tenants install the ``bjorn_lunden_mcp``
integration, which registers an McpServer row with the sentinel URL
``native://bjorn-lunden``; tool calls from agents are then routed here.

Auth model (see https://developer.bjornlunden.se):
- OAuth 2.0 client-credentials flow: POST to the token URL with HTTP Basic
  auth (client_id:client_secret) yields a short-lived Bearer token.
- Company-scoped calls additionally send a ``User-Key`` header holding the
  company GUID (obtained via ``list_companies``).
"""

from __future__ import annotations

import time
from typing import Any

import httpx

BL_NATIVE_URL = "native://bjorn-lunden"
BL_BASE_URL = "https://apigateway.blinfo.se/bla-api/v1/sp"
BL_TOKEN_URL = "https://apigateway.blinfo.se/auth/oauth/v2/oauth-token"

MISSING_CREDENTIALS_ERROR = (
    "Björn Lundén credentials are not configured. Open Integrations, edit the "
    "Björn Lundén connection, and add the client_id and client_secret issued "
    "by the Björn Lundén developer portal."
)

MISSING_COMPANY_KEY_ERROR = (
    "No Björn Lundén company selected. Call list_companies first and pass the "
    "company GUID as company_id, or store it as user_key on the connection."
)

# Tool catalog for the native connection. Names line up with the dev sandbox
# so agent prompts and workstreams behave the same in dev and production.
BL_NATIVE_TOOLS: list[dict[str, str]] = [
    {"name": "list_companies", "description": "List companies/clients connected to this Björn Lundén integration (returns company GUIDs to use as company_id)"},
    {"name": "get_company_details", "description": "Fetch company information for the selected company"},
    {"name": "search_customers", "description": "Search customers by name, number, or email"},
    {"name": "get_customer", "description": "Fetch one customer with contact and balance details"},
    {"name": "list_suppliers", "description": "List suppliers, optionally filtered by name"},
    {"name": "get_supplier", "description": "Fetch one supplier with contact details"},
    {"name": "list_invoices", "description": "List customer invoices; filter by from_date/to_date (YYYY-MM-DD) or page through the batch"},
    {"name": "get_invoice", "description": "Fetch a single customer invoice by invoice number"},
    {"name": "list_supplier_invoices", "description": "List supplier (purchase) invoices in batches"},
    {"name": "list_ledger_entries", "description": "List journal/general-ledger entries in batches"},
    {"name": "list_accounts", "description": "List ledger accounts from the chart of accounts"},
    {"name": "get_account_balance", "description": "Fetch a ledger account with its details and balance"},
]

# Module-level token cache: client_id -> (access_token, expires_at_epoch).
_token_cache: dict[str, tuple[str, float]] = {}

# Test seam: when set, HTTP clients are built with this transport.
_transport: httpx.AsyncBaseTransport | None = None


def _http_client(**kwargs: Any) -> httpx.AsyncClient:
    if _transport is not None:
        kwargs["transport"] = _transport
    kwargs.setdefault("timeout", 20.0)
    return httpx.AsyncClient(**kwargs)


def parse_bl_credentials(auth: dict[str, Any]) -> dict[str, str]:
    """Extract BL credentials from a connection's auth payload.

    Accepts explicit ``client_id`` / ``client_secret`` / ``user_key`` fields.
    As a convenience the single ``api_key`` field also works when formatted
    as ``client_id:client_secret`` or ``client_id:client_secret:user_key``.
    """
    client_id = str(auth.get("client_id") or "").strip()
    client_secret = str(auth.get("client_secret") or "").strip()
    user_key = str(auth.get("user_key") or "").strip()
    api_key = str(auth.get("api_key") or "").strip()
    if (not client_id or not client_secret) and api_key.count(":") in (1, 2):
        parts = api_key.split(":")
        client_id = client_id or parts[0].strip()
        client_secret = client_secret or parts[1].strip()
        if len(parts) == 3 and not user_key:
            user_key = parts[2].strip()
    return {"client_id": client_id, "client_secret": client_secret, "user_key": user_key}


def has_bl_credentials(auth: dict[str, Any]) -> bool:
    creds = parse_bl_credentials(auth)
    return bool(creds["client_id"] and creds["client_secret"])


async def _get_access_token(client_id: str, client_secret: str, token_url: str) -> str:
    cached = _token_cache.get(client_id)
    if cached and cached[1] > time.time() + 30:
        return cached[0]
    async with _http_client() as client:
        response = await client.post(
            token_url,
            auth=(client_id, client_secret),
            data={"grant_type": "client_credentials"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response.raise_for_status()
        body = response.json()
    token = str(body.get("access_token") or "")
    if not token:
        raise RuntimeError("Björn Lundén token endpoint returned no access_token")
    expires_in = float(body.get("expires_in") or 3600)
    _token_cache[client_id] = (token, time.time() + expires_in)
    return token


async def validate_credentials(auth: dict[str, Any]) -> dict[str, Any]:
    """Health-check the stored credentials without touching company data."""
    if not has_bl_credentials(auth):
        return {"ok": True, "note": "credentials_pending"}
    creds = parse_bl_credentials(auth)
    token_url = str(auth.get("token_url") or BL_TOKEN_URL)
    try:
        await _get_access_token(creds["client_id"], creds["client_secret"], token_url)
    except Exception as exc:
        return {"ok": False, "error": f"Björn Lundén authentication failed: {exc}"}
    return {"ok": True}


def _endpoint_for_tool(tool_name: str, args: dict[str, Any]) -> tuple[str, bool] | None:
    """Map a tool call to (path, company_scoped). Returns None if unknown."""
    def _s(key: str, default: str = "") -> str:
        return str(args.get(key) or default).strip()

    if tool_name == "list_companies":
        return "/common/client", False
    if tool_name == "get_company_details":
        return "/details", True
    if tool_name in ("search_customers", "list_customers"):
        return "/customer", True
    if tool_name == "get_customer":
        cid = _s("customer_id") or _s("id")
        return f"/customer/{cid}", True
    if tool_name == "list_suppliers":
        return "/supplier", True
    if tool_name == "get_supplier":
        sid = _s("supplier_id") or _s("id")
        return f"/supplier/{sid}", True
    if tool_name == "list_invoices":
        from_date, to_date = _s("from_date"), _s("to_date")
        if from_date and to_date:
            return f"/customerinvoice/date/{from_date}/{to_date}", True
        return "/customerinvoice/batch", True
    if tool_name == "get_invoice":
        number = _s("invoice_number") or _s("invoice_id") or _s("id")
        return f"/customerinvoice/{number}", True
    if tool_name == "list_supplier_invoices":
        return "/supplierinvoice/batch", True
    if tool_name == "list_ledger_entries":
        return "/journal/entry/batch", True
    if tool_name == "list_accounts":
        return "/account", True
    if tool_name == "get_account_balance":
        account = _s("account") or _s("account_id") or _s("id")
        return f"/account/{account}", True
    return None


def _filter_customers(rows: Any, query: str) -> Any:
    """BLA /customer has no server-side search; filter the list locally."""
    if not query or not isinstance(rows, list):
        return rows
    needle = query.lower()
    matched = [
        row
        for row in rows
        if isinstance(row, dict)
        and any(
            needle in str(row.get(field, "")).lower()
            for field in ("name", "email", "id", "customerNumber", "number", "orgNo")
        )
    ]
    return matched


async def call_bl_tool(
    auth: dict[str, Any], tool_name: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    """Execute one Björn Lundén tool call against the live BLA API.

    Returns ``{"result": ...}`` on success or ``{"error": ...}`` on failure.
    """
    if not has_bl_credentials(auth):
        return {"error": MISSING_CREDENTIALS_ERROR}

    mapped = _endpoint_for_tool(tool_name, arguments)
    if mapped is None:
        return {"error": f"Unknown Björn Lundén tool: {tool_name}"}
    path, company_scoped = mapped

    creds = parse_bl_credentials(auth)
    base_url = str(auth.get("base_url") or BL_BASE_URL).rstrip("/")
    token_url = str(auth.get("token_url") or BL_TOKEN_URL)

    company_key = str(arguments.get("company_id") or "").strip() or creds["user_key"]
    if company_scoped and not company_key:
        return {"error": MISSING_COMPANY_KEY_ERROR}

    try:
        token = await _get_access_token(creds["client_id"], creds["client_secret"], token_url)
    except Exception as exc:
        return {"error": f"Björn Lundén authentication failed: {exc}"}

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if company_scoped:
        headers["User-Key"] = company_key

    params: dict[str, Any] = {}
    page = arguments.get("page")
    if page is not None and str(page).strip():
        params["page"] = str(page).strip()

    try:
        async with _http_client() as client:
            response = await client.get(f"{base_url}{path}", headers=headers, params=params)
            response.raise_for_status()
            data = response.json() if response.content else None
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:300] if exc.response is not None else str(exc)
        return {"error": f"Björn Lundén API error ({exc.response.status_code}): {detail}"}
    except Exception as exc:
        return {"error": f"Björn Lundén API request failed: {exc}"}

    if tool_name in ("search_customers", "list_customers"):
        query = str(arguments.get("query") or arguments.get("name") or "").strip()
        data = _filter_customers(data, query)

    return {"result": data}
