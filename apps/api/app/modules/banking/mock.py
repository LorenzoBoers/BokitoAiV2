"""Normalized banking mocks: the read flow demos before PSD2 credentials exist.

Only used outside production, when a connection has no credentials.
"""

from __future__ import annotations

from typing import Any

from app.modules.accounting.schema import ok_result

MOCK_ACCOUNTS = [
    {
        "id": "acc-demo-1",
        "name": "Zakelijke rekening",
        "iban": "NL91ABNA0417164300",
        "currency": "EUR",
        "balance": 18432.55,
    },
    {
        "id": "acc-demo-2",
        "name": "Spaarrekening",
        "iban": "NL69INGB0123456789",
        "currency": "EUR",
        "balance": 50210.00,
    },
]

MOCK_TRANSACTIONS = [
    {
        "id": "tx-1001",
        "account_id": "acc-demo-1",
        "amount": -1250.0,
        "currency": "EUR",
        "booked_at": "2026-08-27",
        "counterparty": "Belastingdienst",
        "description": "BTW Q2",
    },
    {
        "id": "tx-1002",
        "account_id": "acc-demo-1",
        "amount": 4200.0,
        "currency": "EUR",
        "booked_at": "2026-08-26",
        "counterparty": "Andersson Bygg AB",
        "description": "Factuur 2026-118",
    },
    {
        "id": "tx-1003",
        "account_id": "acc-demo-1",
        "amount": -89.0,
        "currency": "EUR",
        "booked_at": "2026-08-25",
        "counterparty": "KPN",
        "description": "Telefonie augustus",
    },
]


def mock_verb(connection_id: str, verb: str, args: dict[str, Any]) -> dict[str, Any]:
    if verb == "list_accounts":
        return ok_result(
            accounts=[{**a, "connection_id": connection_id} for a in MOCK_ACCOUNTS],
            mock=True,
        )
    if verb == "get_balance":
        account_id = str(args.get("account_id") or "acc-demo-1")
        match = next((a for a in MOCK_ACCOUNTS if a["id"] == account_id), MOCK_ACCOUNTS[0])
        return ok_result(
            balance={
                "account_id": match["id"],
                "amount": match["balance"],
                "currency": match["currency"],
            },
            mock=True,
        )
    if verb == "list_transactions":
        account_id = str(args.get("account_id") or "").strip()
        rows = [
            t for t in MOCK_TRANSACTIONS if not account_id or t["account_id"] == account_id
        ]
        return ok_result(transactions=rows, mock=True)
    return ok_result(note=f"Mock banking verb {verb}", mock=True)
