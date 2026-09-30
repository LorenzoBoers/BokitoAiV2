"""Small Moneybird API v2 client (https://developer.moneybird.com).

Endpoints used:
- GET   /contacts?query=                          find a contact
- GET   /sales_invoices?filter=contact_id:..      list invoices
- GET   /sales_invoices/{id}                      one invoice
- PATCH /sales_invoices/{id}/send_invoice         send (or resend) by email

Mock mode (no network) returns a stable fixture so agents, tests and demos work
without a Moneybird administration.
"""

from __future__ import annotations

from typing import Any

import httpx

from bokito.config import get_settings
from bokito.errors import AppError

BASE = "https://moneybird.com/api/v2"


class MoneybirdError(AppError):
    status_code = 502
    code = "moneybird_error"


def _live() -> bool:
    return get_settings().llm_mode == "live"


def contact_view(c: dict[str, Any]) -> dict[str, Any]:
    name = (c.get("company_name") or "").strip() or " ".join(
        p for p in (c.get("firstname"), c.get("lastname")) if p
    )
    return {
        "id": str(c.get("id") or ""),
        "name": name,
        "email": c.get("email") or "",
        "customer_id": c.get("customer_id") or "",
        "phone": c.get("phone") or "",
    }


def invoice_view(i: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(i.get("id") or ""),
        "number": i.get("invoice_id") or i.get("draft_id") or "",
        "state": i.get("state") or "",
        "contact_id": str(i.get("contact_id") or ""),
        "invoice_date": i.get("invoice_date"),
        "due_date": i.get("due_date"),
        "total_incl_tax": i.get("total_price_incl_tax"),
        "total_unpaid": i.get("total_unpaid"),
        "currency": i.get("currency") or "EUR",
        "url": i.get("url") or "",
        "reference": i.get("reference") or "",
    }


MOCK_CONTACTS = [
    {
        "id": "mb_c_1001",
        "company_name": "Example BV",
        "firstname": "",
        "lastname": "",
        "email": "billing@example.com",
        "customer_id": "C-1001",
    }
]
MOCK_INVOICES = [
    {
        "id": "mb_i_2001",
        "invoice_id": "2026-0042",
        "state": "open",
        "contact_id": "mb_c_1001",
        "invoice_date": "2026-09-01",
        "due_date": "2026-09-15",
        "total_price_incl_tax": "1210.00",
        "total_unpaid": "1210.00",
        "currency": "EUR",
        "url": "https://moneybird.com/invoices/mock/2026-0042",
        "reference": "Project Alpha",
    },
    {
        "id": "mb_i_2002",
        "invoice_id": "2026-0031",
        "state": "paid",
        "contact_id": "mb_c_1001",
        "invoice_date": "2026-07-01",
        "due_date": "2026-07-15",
        "total_price_incl_tax": "605.00",
        "total_unpaid": "0.00",
        "currency": "EUR",
        "url": "https://moneybird.com/invoices/mock/2026-0031",
        "reference": "Onboarding",
    },
]


class MoneybirdClient:
    def __init__(self, credentials: dict[str, Any]):
        self.token = str(credentials.get("access_token") or "")
        self.administration_id = str(credentials.get("administration_id") or "")
        if not self.token or not self.administration_id:
            raise MoneybirdError(
                "Moneybird access_token and administration_id are required",
                code="moneybird_credentials",
            )

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=f"{BASE}/{self.administration_id}",
            headers={"Authorization": f"Bearer {self.token}", "User-Agent": "bokito-v2"},
            timeout=httpx.Timeout(30.0, connect=10.0),
        )

    @staticmethod
    async def _json(resp: httpx.Response) -> Any:
        if resp.status_code >= 400:
            raise MoneybirdError(
                f"Moneybird {resp.status_code}: {resp.text[:300]}", code="moneybird_upstream"
            )
        return resp.json() if resp.content else {}

    async def verify(self) -> tuple[bool, str]:
        if not _live():
            return True, "mock"
        try:
            async with self._client() as c:
                await self._json(await c.get("/contacts", params={"per_page": 1}))
        except (httpx.HTTPError, MoneybirdError) as exc:
            return False, str(exc)[:300]
        return True, ""

    async def find_contacts(self, query: str) -> list[dict[str, Any]]:
        if not _live():
            q = query.lower().strip()
            return [
                contact_view(c)
                for c in MOCK_CONTACTS
                if not q
                or q in (c["email"] or "").lower()
                or q in (c["company_name"] or "").lower()
                or q in (c["customer_id"] or "").lower()
            ]
        try:
            async with self._client() as c:
                data = await self._json(await c.get("/contacts", params={"query": query}))
        except httpx.HTTPError as exc:
            raise MoneybirdError(
                f"Moneybird unreachable: {exc}", code="moneybird_upstream"
            ) from exc
        return [contact_view(x) for x in (data or [])]

    async def list_invoices(
        self, *, contact_id: str = "", state: str = "", limit: int = 20
    ) -> list[dict[str, Any]]:
        if not _live():
            rows = [
                i
                for i in MOCK_INVOICES
                if (not contact_id or i["contact_id"] == contact_id)
                and (not state or i["state"] in state.split("|"))
            ]
            return [invoice_view(i) for i in rows[:limit]]
        filters = []
        if contact_id:
            filters.append(f"contact_id:{contact_id}")
        if state:
            filters.append(f"state:{state}")
        params: dict[str, Any] = {"per_page": min(limit, 100)}
        if filters:
            params["filter"] = ",".join(filters)
        try:
            async with self._client() as c:
                data = await self._json(await c.get("/sales_invoices", params=params))
        except httpx.HTTPError as exc:
            raise MoneybirdError(
                f"Moneybird unreachable: {exc}", code="moneybird_upstream"
            ) from exc
        return [invoice_view(i) for i in (data or [])]

    async def get_invoice(self, invoice_id: str) -> dict[str, Any]:
        if not _live():
            for i in MOCK_INVOICES:
                if i["id"] == invoice_id or i["invoice_id"] == invoice_id:
                    return invoice_view(i)
            raise MoneybirdError(f"invoice {invoice_id} not found", code="moneybird_not_found")
        try:
            async with self._client() as c:
                data = await self._json(await c.get(f"/sales_invoices/{invoice_id}"))
        except httpx.HTTPError as exc:
            raise MoneybirdError(
                f"Moneybird unreachable: {exc}", code="moneybird_upstream"
            ) from exc
        return invoice_view(data)

    async def send_invoice(
        self, invoice_id: str, *, email_address: str = "", message: str = ""
    ) -> dict[str, Any]:
        if not _live():
            inv = await self.get_invoice(invoice_id)
            return {**inv, "sent": True, "delivery_method": "Email", "mock": True}
        body: dict[str, Any] = {"sales_invoice_sending": {"delivery_method": "Email"}}
        if email_address:
            body["sales_invoice_sending"]["email_address"] = email_address
        if message:
            body["sales_invoice_sending"]["email_message"] = message
        try:
            async with self._client() as c:
                data = await self._json(
                    await c.patch(f"/sales_invoices/{invoice_id}/send_invoice", json=body)
                )
        except httpx.HTTPError as exc:
            raise MoneybirdError(
                f"Moneybird unreachable: {exc}", code="moneybird_upstream"
            ) from exc
        return {
            **invoice_view(data or {"id": invoice_id}),
            "sent": True,
            "delivery_method": "Email",
        }
