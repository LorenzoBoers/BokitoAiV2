"""Normalized mock responses so the accounting flow demos before credentials exist.

Mirrors the legacy MCP accounting mocks but returns the canonical module
schema. Only used outside production, when a connection has no credentials.
"""

from __future__ import annotations

from typing import Any

from app.modules.accounting.schema import ok_result

MOCK_COMPANIES = [
    {"id": "adm-demo-1", "name": "Andersson Bygg AB", "external_id": "1001"},
    {"id": "adm-demo-2", "name": "Bakker BV", "external_id": "1002"},
]


def mock_verb(vendor: str, connection_id: str, verb: str, args: dict[str, Any]) -> dict[str, Any]:
    if verb == "list_companies":
        return ok_result(
            companies=[
                {**c, "vendor": vendor, "connection_id": connection_id} for c in MOCK_COMPANIES
            ],
            mock=True,
        )
    if verb == "get_company":
        company_id = str(args.get("company_id") or "adm-demo-1")
        match = next((c for c in MOCK_COMPANIES if c["id"] == company_id), MOCK_COMPANIES[0])
        return ok_result(
            company={**match, "vendor": vendor, "connection_id": connection_id}, mock=True
        )
    if verb == "search_parties":
        query = str(args.get("query") or "")
        return ok_result(
            parties=[
                {
                    "id": "cust-1001",
                    "role": "customer",
                    "name": query.title() or "Andersson Bygg AB",
                    "email": "ekonomi@anderssonbygg.se",
                    "number": "1001",
                    "open_balance": 12450.0,
                    "currency": "SEK",
                }
            ],
            mock=True,
        )
    if verb == "get_party":
        return ok_result(
            party={
                "id": str(args.get("party_id") or "cust-1001"),
                "role": "customer",
                "name": "Andersson Bygg AB",
                "email": "ekonomi@anderssonbygg.se",
                "phone": "+46 8 123 456",
                "number": "1001",
                "open_balance": 12450.0,
                "currency": "SEK",
            },
            mock=True,
        )
    if verb == "list_documents":
        return ok_result(
            documents=[
                {
                    "id": "inv-2024-081",
                    "kind": "sales_invoice",
                    "status": "open",
                    "number": "2024-081",
                    "party_name": "Andersson Bygg AB",
                    "total": 12450.0,
                    "currency": "SEK",
                    "due_date": "2026-08-15",
                },
                {
                    "id": "inv-2024-069",
                    "kind": "sales_invoice",
                    "status": "paid",
                    "number": "2024-069",
                    "party_name": "Andersson Bygg AB",
                    "total": 8300.0,
                    "currency": "SEK",
                    "due_date": "2026-06-30",
                },
            ],
            mock=True,
        )
    if verb == "get_document":
        return ok_result(
            document={
                "id": str(args.get("document_id") or "inv-2024-081"),
                "kind": "sales_invoice",
                "status": "open",
                "number": "2024-081",
                "total": 12450.0,
                "currency": "SEK",
                "due_date": "2026-08-15",
                "lines": [
                    {"description": "Consulting services July", "amount": 9960.0},
                    {"description": "VAT 25%", "amount": 2490.0},
                ],
            },
            mock=True,
        )
    if verb == "list_accounts":
        return ok_result(
            accounts=[
                {"id": "1510", "number": "1510", "name": "Accounts receivable"},
                {"id": "1930", "number": "1930", "name": "Bank", "balance": 145200.0},
            ],
            mock=True,
        )
    if verb == "get_account":
        return ok_result(
            account={
                "id": str(args.get("account_id") or "1930"),
                "number": str(args.get("account_id") or "1930"),
                "name": "Bank",
                "balance": 145200.0,
                "currency": "SEK",
            },
            mock=True,
        )
    if verb == "list_ledger":
        return ok_result(
            ledger=[
                {"account": "1930", "description": "Bank", "debit": 8300.0, "credit": 0.0},
                {
                    "account": "1510",
                    "description": "Accounts receivable",
                    "debit": 0.0,
                    "credit": 8300.0,
                },
            ],
            mock=True,
        )
    if verb == "list_outstanding":
        return ok_result(
            outstanding=[
                {
                    "document_id": "inv-2024-081",
                    "kind": "sales_invoice",
                    "party_name": "Andersson Bygg AB",
                    "amount": 12450.0,
                    "currency": "SEK",
                    "due_date": "2026-08-15",
                    "overdue": False,
                }
            ],
            mock=True,
        )
    if verb == "list_bank_mutations":
        return ok_result(
            bank_mutations=[
                {
                    "id": "fm-1",
                    "date": "2026-08-20",
                    "amount": 8300.0,
                    "currency": "EUR",
                    "counterparty": "Andersson Bygg AB",
                    "description": "Invoice 2024-069",
                    "state": "unprocessed",
                }
            ],
            mock=True,
        )
    if verb.startswith("apply_"):
        return ok_result(
            applied=True,
            vendor_id="mock-write-1",
            note=f"Mock write for {verb}; no real accounting package was touched.",
            mock=True,
        )
    return ok_result(note=f"Mock response for {verb}", mock=True)
