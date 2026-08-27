"""Björn Lundén adapter: BLA REST reads behind the module verbs."""

from __future__ import annotations

from typing import Any

from app.modules.accounting.schema import (
    Account,
    Company,
    Document,
    DocumentLine,
    LedgerLine,
    Outstanding,
    Party,
    ok_result,
)
from app.services.bjorn_lunden import call_bl_tool

VENDOR = "bjorn_lunden"


def _f(value: Any) -> float | None:
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _s(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


async def _vendor(auth: dict[str, Any], tool: str, args: dict[str, Any]) -> tuple[Any, str]:
    outcome = await call_bl_tool(auth, tool, args)
    if outcome.get("error"):
        return None, str(outcome["error"])
    return outcome.get("result"), ""


def _party(row: dict[str, Any], role: str) -> dict[str, Any]:
    return Party(
        id=_s(row, "id", "customerNumber", "supplierNumber", "number"),
        role="supplier" if role == "supplier" else "customer",
        name=_s(row, "name"),
        email=_s(row, "email"),
        phone=_s(row, "phone", "telephone"),
        number=_s(row, "customerNumber", "supplierNumber", "number"),
        currency=_s(row, "currency"),
    ).model_dump()


def _invoice_status(row: dict[str, Any]) -> str:
    state = _s(row, "state", "status").lower()
    if state in ("draft", "open", "paid", "void"):
        return state
    remaining = _f(row.get("remainingAmount"))
    if remaining is not None:
        return "paid" if remaining == 0 else "open"
    return "unknown"


def _document(row: dict[str, Any], kind: str) -> dict[str, Any]:
    return Document(
        id=_s(row, "id", "invoiceNumber", "number"),
        kind="purchase_bill" if kind == "purchase" else "sales_invoice",
        status=_invoice_status(row),  # type: ignore[arg-type]
        number=_s(row, "invoiceNumber", "number"),
        party_id=_s(row, "customerId", "customerNumber", "supplierId", "supplierNumber"),
        party_name=_s(row, "customerName", "supplierName", "name"),
        total=_f(row.get("totalAmount") or row.get("amount") or row.get("total")),
        currency=_s(row, "currency"),
        date=_s(row, "invoiceDate", "date"),
        due_date=_s(row, "dueDate"),
        lines=[
            DocumentLine(description=_s(line, "text", "description"), amount=_f(line.get("amount")))
            for line in (row.get("rows") or row.get("lines") or [])
            if isinstance(line, dict)
        ],
    ).model_dump()


async def call(
    auth: dict[str, Any], connection_id: str, verb: str, args: dict[str, Any]
) -> dict[str, Any]:
    company_id = str(args.get("company_id") or "").strip()
    base_args: dict[str, Any] = {"company_id": company_id} if company_id else {}

    if verb == "list_companies":
        result, error = await _vendor(auth, "list_companies", {})
        if error:
            return {"ok": False, "code": "vendor_error", "message": error}
        rows = result if isinstance(result, list) else []
        return ok_result(
            companies=[
                Company(
                    id=_s(r, "publicKey", "id", "key"),
                    name=_s(r, "name"),
                    vendor=VENDOR,
                    connection_id=connection_id,
                    external_id=_s(r, "orgNo", "organisationNumber"),
                ).model_dump()
                for r in rows
                if isinstance(r, dict)
            ]
        )

    if verb == "get_company":
        result, error = await _vendor(auth, "get_company_details", base_args)
        if error:
            return {"ok": False, "code": "vendor_error", "message": error}
        row = result if isinstance(result, dict) else {}
        return ok_result(
            company=Company(
                id=company_id or _s(row, "publicKey", "id"),
                name=_s(row, "name"),
                vendor=VENDOR,
                connection_id=connection_id,
                external_id=_s(row, "orgNo", "organisationNumber"),
            ).model_dump(),
            details=row,
        )

    if verb == "search_parties":
        role = str(args.get("role") or "customer")
        tool = "list_suppliers" if role == "supplier" else "search_customers"
        result, error = await _vendor(
            auth, tool, {**base_args, "query": args.get("query") or ""}
        )
        if error:
            return {"ok": False, "code": "vendor_error", "message": error}
        rows = result if isinstance(result, list) else []
        return ok_result(parties=[_party(r, role) for r in rows if isinstance(r, dict)])

    if verb == "get_party":
        role = str(args.get("role") or "customer")
        tool = "get_supplier" if role == "supplier" else "get_customer"
        key = "supplier_id" if role == "supplier" else "customer_id"
        result, error = await _vendor(
            auth, tool, {**base_args, key: args.get("party_id") or args.get("id")}
        )
        if error:
            return {"ok": False, "code": "vendor_error", "message": error}
        row = result if isinstance(result, dict) else {}
        return ok_result(party=_party(row, role))

    if verb == "list_documents":
        kind = str(args.get("kind") or "sales_invoice")
        if kind == "purchase_bill":
            result, error = await _vendor(auth, "list_supplier_invoices", base_args)
            doc_kind = "purchase"
        else:
            vendor_args = dict(base_args)
            if args.get("from_date") and args.get("to_date"):
                vendor_args["from_date"] = args["from_date"]
                vendor_args["to_date"] = args["to_date"]
            result, error = await _vendor(auth, "list_invoices", vendor_args)
            doc_kind = "sales"
        if error:
            return {"ok": False, "code": "vendor_error", "message": error}
        rows = result if isinstance(result, list) else []
        return ok_result(documents=[_document(r, doc_kind) for r in rows if isinstance(r, dict)])

    if verb == "get_document":
        result, error = await _vendor(
            auth,
            "get_invoice",
            {**base_args, "invoice_number": args.get("document_id") or args.get("id")},
        )
        if error:
            return {"ok": False, "code": "vendor_error", "message": error}
        row = result if isinstance(result, dict) else {}
        return ok_result(document=_document(row, "sales"))

    if verb in ("list_accounts", "get_account"):
        if verb == "get_account":
            result, error = await _vendor(
                auth,
                "get_account_balance",
                {**base_args, "account": args.get("account_id") or args.get("account")},
            )
            if error:
                return {"ok": False, "code": "vendor_error", "message": error}
            row = result if isinstance(result, dict) else {}
            return ok_result(
                account=Account(
                    id=_s(row, "id", "number", "account"),
                    number=_s(row, "number", "account", "id"),
                    name=_s(row, "name", "description"),
                    balance=_f(row.get("balance")),
                    currency=_s(row, "currency"),
                ).model_dump()
            )
        result, error = await _vendor(auth, "list_accounts", base_args)
        if error:
            return {"ok": False, "code": "vendor_error", "message": error}
        rows = result if isinstance(result, list) else []
        return ok_result(
            accounts=[
                Account(
                    id=_s(r, "id", "number", "account"),
                    number=_s(r, "number", "account", "id"),
                    name=_s(r, "name", "description"),
                    balance=_f(r.get("balance")),
                ).model_dump()
                for r in rows
                if isinstance(r, dict)
            ]
        )

    if verb == "list_ledger":
        result, error = await _vendor(auth, "list_ledger_entries", base_args)
        if error:
            return {"ok": False, "code": "vendor_error", "message": error}
        rows = result if isinstance(result, list) else []
        lines: list[dict[str, Any]] = []
        for entry in rows:
            if not isinstance(entry, dict):
                continue
            for line in entry.get("ledgerRows") or entry.get("rows") or [entry]:
                if not isinstance(line, dict):
                    continue
                lines.append(
                    LedgerLine(
                        id=_s(line, "id"),
                        account=_s(line, "account", "accountNumber"),
                        description=_s(line, "text", "description"),
                        debit=_f(line.get("debit")),
                        credit=_f(line.get("credit")),
                        date=_s(entry, "date", "registrationDate"),
                    ).model_dump()
                )
        return ok_result(ledger=lines)

    if verb == "list_outstanding":
        result, error = await _vendor(auth, "list_invoices", base_args)
        if error:
            return {"ok": False, "code": "vendor_error", "message": error}
        rows = result if isinstance(result, list) else []
        outstanding = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            doc = _document(row, "sales")
            if doc["status"] not in ("open", "overdue"):
                continue
            outstanding.append(
                Outstanding(
                    document_id=doc["id"],
                    kind="sales_invoice",
                    party_name=doc["party_name"],
                    amount=_f(row.get("remainingAmount")) or doc["total"],
                    currency=doc["currency"],
                    due_date=doc["due_date"],
                ).model_dump()
            )
        return ok_result(outstanding=outstanding)

    return {
        "ok": False,
        "code": "unsupported",
        "capability": verb,
        "message": f"Björn Lundén does not support {verb}.",
    }
