"""GoCardless Bank Account Data adapter (read-only PSD2 reads).

Credentials on the IntegrationConnection: ``secret_id`` + ``secret_key``
(https://bankaccountdata.gocardless.com) and ``account_ids`` collected during
requisition setup. Only read verbs exist; payments are never executed here.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.modules.accounting.schema import module_error, ok_result
from app.modules.banking.schema import BankAccount, BankTransaction

BASE_URL = "https://bankaccountdata.gocardless.com/api/v2"


def has_gocardless_credentials(creds: dict[str, Any]) -> bool:
    return bool(
        str(creds.get("secret_id") or "").strip()
        and str(creds.get("secret_key") or "").strip()
    )


async def _token(client: httpx.AsyncClient, creds: dict[str, Any]) -> str:
    resp = await client.post(
        f"{BASE_URL}/token/new/",
        json={
            "secret_id": str(creds.get("secret_id") or ""),
            "secret_key": str(creds.get("secret_key") or ""),
        },
    )
    resp.raise_for_status()
    return str(resp.json().get("access") or "")


def _account_ids(creds: dict[str, Any]) -> list[str]:
    raw = creds.get("account_ids")
    if isinstance(raw, list):
        return [str(a) for a in raw if str(a).strip()]
    return [a.strip() for a in str(raw or "").split(",") if a.strip()]


async def call(
    creds: dict[str, Any], connection_id: str, verb: str, args: dict[str, Any]
) -> dict[str, Any]:
    ids = _account_ids(creds)
    if not ids:
        return module_error(
            "no_accounts",
            "No bank accounts are linked on this connection yet. Finish the "
            "requisition flow at the bank and store the account ids.",
        )
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            token = await _token(client, creds)
            headers = {"Authorization": f"Bearer {token}"}

            if verb == "list_accounts":
                accounts: list[dict[str, Any]] = []
                for account_id in ids[:10]:
                    detail = await client.get(
                        f"{BASE_URL}/accounts/{account_id}/details/", headers=headers
                    )
                    detail.raise_for_status()
                    row = (detail.json() or {}).get("account") or {}
                    accounts.append(
                        {
                            **BankAccount(
                                id=account_id,
                                name=str(row.get("name") or row.get("ownerName") or ""),
                                iban=str(row.get("iban") or ""),
                                currency=str(row.get("currency") or ""),
                            ).model_dump(),
                            "connection_id": connection_id,
                        }
                    )
                return ok_result(accounts=accounts)

            account_id = str(args.get("account_id") or "").strip() or ids[0]
            if verb == "get_balance":
                resp = await client.get(
                    f"{BASE_URL}/accounts/{account_id}/balances/", headers=headers
                )
                resp.raise_for_status()
                balances = (resp.json() or {}).get("balances") or []
                first = balances[0] if balances else {}
                amount = (first.get("balanceAmount") or {}) if isinstance(first, dict) else {}
                return ok_result(
                    balance={
                        "account_id": account_id,
                        "amount": float(amount.get("amount") or 0.0),
                        "currency": str(amount.get("currency") or ""),
                    }
                )

            if verb == "list_transactions":
                resp = await client.get(
                    f"{BASE_URL}/accounts/{account_id}/transactions/", headers=headers
                )
                resp.raise_for_status()
                booked = ((resp.json() or {}).get("transactions") or {}).get("booked") or []
                rows = [
                    BankTransaction(
                        id=str(t.get("transactionId") or t.get("internalTransactionId") or ""),
                        account_id=account_id,
                        amount=float((t.get("transactionAmount") or {}).get("amount") or 0.0),
                        currency=str((t.get("transactionAmount") or {}).get("currency") or ""),
                        booked_at=str(t.get("bookingDate") or ""),
                        counterparty=str(
                            t.get("creditorName") or t.get("debtorName") or ""
                        ),
                        description=" ".join(
                            str(t.get("remittanceInformationUnstructured") or "").split()
                        ),
                    ).model_dump()
                    for t in booked[:50]
                    if isinstance(t, dict)
                ]
                return ok_result(transactions=rows)
    except httpx.HTTPStatusError as exc:
        return module_error(
            "vendor_error",
            f"GoCardless returned {exc.response.status_code} for {verb}.",
        )
    except httpx.HTTPError as exc:
        return module_error("vendor_error", f"GoCardless request failed: {exc}")

    return module_error("unsupported", f"Banking verb {verb} is not supported.")
