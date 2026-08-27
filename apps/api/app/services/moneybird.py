"""Native Moneybird integration (REST v2).

Talks directly to the Moneybird API (https://developer.moneybird.com).
Auth: OAuth 2.0 authorization-code flow (tokens stored on the
IntegrationConnection) or a personal API token stored as ``api_token``.
Company-scoped calls target ``/api/v2/{administration_id}/...``.

Reads only in this module. Writes (create invoice, send, book payment)
never happen here — they go through ``propose_*`` decisions in the
accounting module router.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

MB_NATIVE_URL = "native://moneybird"
MB_BASE_URL = "https://moneybird.com/api/v2"

MISSING_CREDENTIALS_ERROR = (
    "Moneybird is not connected. Open Integrations and connect Moneybird via "
    "OAuth, or store a personal api_token on the connection."
)
MISSING_ADMINISTRATION_ERROR = (
    "No Moneybird administration selected. Call list_companies first and pass "
    "company_id (the administration id)."
)

# Test seam: when set, HTTP clients are built with this transport.
_transport: httpx.AsyncBaseTransport | None = None


def _http_client(**kwargs: Any) -> httpx.AsyncClient:
    if _transport is not None:
        kwargs["transport"] = _transport
    kwargs.setdefault("timeout", 20.0)
    return httpx.AsyncClient(**kwargs)


def resolve_token(credentials: dict[str, Any]) -> str:
    """Access token from OAuth credentials or a personal API token."""
    for key in ("access_token", "api_token", "api_key"):
        value = str(credentials.get(key) or "").strip()
        if value:
            return value
    return ""


def has_moneybird_credentials(credentials: dict[str, Any]) -> bool:
    return bool(resolve_token(credentials))


def parse_credentials(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def _get(
    token: str, path: str, params: dict[str, Any] | None = None, *, base_url: str = MB_BASE_URL
) -> Any:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with _http_client() as client:
        response = await client.get(f"{base_url}{path}", headers=headers, params=params or {})
        response.raise_for_status()
        return response.json() if response.content else None


async def validate_credentials(credentials: dict[str, Any]) -> dict[str, Any]:
    """Health-check the stored token by listing administrations."""
    token = resolve_token(credentials)
    if not token:
        return {"ok": True, "note": "credentials_pending"}
    try:
        await _get(token, "/administrations.json")
    except Exception as exc:
        return {"ok": False, "error": f"Moneybird authentication failed: {exc}"}
    return {"ok": True}


async def list_administrations(credentials: dict[str, Any]) -> list[dict[str, Any]]:
    token = resolve_token(credentials)
    if not token:
        raise RuntimeError(MISSING_CREDENTIALS_ERROR)
    data = await _get(token, "/administrations.json")
    rows = data if isinstance(data, list) else []
    return [
        {
            "id": str(row.get("id") or ""),
            "name": str(row.get("name") or ""),
            "currency": str(row.get("currency") or ""),
            "country": str(row.get("country") or ""),
        }
        for row in rows
        if isinstance(row, dict)
    ]


async def list_contacts(
    credentials: dict[str, Any], administration_id: str, *, query: str = "", page: int = 1
) -> list[dict[str, Any]]:
    token = resolve_token(credentials)
    params: dict[str, Any] = {"page": page, "per_page": 50}
    if query:
        params["query"] = query
    data = await _get(token, f"/{administration_id}/contacts.json", params)
    return data if isinstance(data, list) else []


async def get_contact(
    credentials: dict[str, Any], administration_id: str, contact_id: str
) -> dict[str, Any]:
    token = resolve_token(credentials)
    data = await _get(token, f"/{administration_id}/contacts/{contact_id}.json")
    return data if isinstance(data, dict) else {}


async def list_sales_invoices(
    credentials: dict[str, Any],
    administration_id: str,
    *,
    state: str = "",
    page: int = 1,
) -> list[dict[str, Any]]:
    token = resolve_token(credentials)
    params: dict[str, Any] = {"page": page, "per_page": 50}
    if state:
        params["filter"] = f"state:{state}"
    data = await _get(token, f"/{administration_id}/sales_invoices.json", params)
    return data if isinstance(data, list) else []


async def get_sales_invoice(
    credentials: dict[str, Any], administration_id: str, invoice_id: str
) -> dict[str, Any]:
    token = resolve_token(credentials)
    data = await _get(token, f"/{administration_id}/sales_invoices/{invoice_id}.json")
    return data if isinstance(data, dict) else {}


async def list_purchase_documents(
    credentials: dict[str, Any], administration_id: str, *, page: int = 1
) -> list[dict[str, Any]]:
    token = resolve_token(credentials)
    params = {"page": page, "per_page": 50}
    data = await _get(
        token, f"/{administration_id}/documents/purchase_invoices.json", params
    )
    return data if isinstance(data, list) else []


async def list_financial_mutations(
    credentials: dict[str, Any], administration_id: str, *, page: int = 1
) -> list[dict[str, Any]]:
    token = resolve_token(credentials)
    params = {"page": page, "per_page": 50}
    data = await _get(token, f"/{administration_id}/financial_mutations.json", params)
    return data if isinstance(data, list) else []


async def list_ledger_accounts(
    credentials: dict[str, Any], administration_id: str
) -> list[dict[str, Any]]:
    token = resolve_token(credentials)
    data = await _get(token, f"/{administration_id}/ledger_accounts.json")
    return data if isinstance(data, list) else []


async def list_tax_rates(
    credentials: dict[str, Any], administration_id: str
) -> list[dict[str, Any]]:
    token = resolve_token(credentials)
    data = await _get(token, f"/{administration_id}/tax_rates.json")
    return data if isinstance(data, list) else []
