"""Moneybird adapter: REST v2 reads behind the module verbs."""

from __future__ import annotations

from typing import Any

from app.modules.accounting.schema import (
    Account,
    BankMutation,
    Company,
    Document,
    DocumentLine,
    Outstanding,
    Party,
    TaxRate,
    ok_result,
)
from app.services import moneybird

VENDOR = "moneybird"


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


def _contact_name(row: dict[str, Any]) -> str:
    company = _s(row, "company_name")
    if company:
        return company
    return " ".join(p for p in (_s(row, "firstname"), _s(row, "lastname")) if p)


def _party(row: dict[str, Any], role: str = "customer") -> dict[str, Any]:
    address = ", ".join(
        p for p in (_s(row, "address1"), _s(row, "zipcode"), _s(row, "city")) if p
    )
    return Party(
        id=_s(row, "id"),
        role="supplier" if role == "supplier" else "customer",
        name=_contact_name(row),
        email=_s(row, "email", "send_invoices_to_email"),
        phone=_s(row, "phone"),
        address=address,
        number=_s(row, "customer_id"),
    ).model_dump()


def _invoice_status(row: dict[str, Any]) -> str:
    state = _s(row, "state").lower()
    if state in ("draft", "open", "paid", "late", "pending_payment", "scheduled", "reminded"):
        if state == "late":
            return "overdue"
        if state in ("pending_payment", "scheduled", "reminded"):
            return "open"
        return state
    return "unknown"


def _sales_document(row: dict[str, Any]) -> dict[str, Any]:
    contact = row.get("contact") if isinstance(row.get("contact"), dict) else {}
    return Document(
        id=_s(row, "id"),
        kind="sales_invoice",
        status=_invoice_status(row),  # type: ignore[arg-type]
        number=_s(row, "invoice_id", "reference"),
        party_id=_s(row, "contact_id"),
        party_name=_contact_name(contact) if contact else "",
        total=_f(row.get("total_price_incl_tax")),
        currency=_s(row, "currency"),
        date=_s(row, "invoice_date"),
        due_date=_s(row, "due_date"),
        lines=[
            DocumentLine(
                description=_s(l, "description"),
                amount=_f(l.get("total_price_excl_tax_with_discount") or l.get("price")),
            )
            for l in (row.get("details") or [])
            if isinstance(l, dict)
        ],
    ).model_dump()


def _purchase_document(row: dict[str, Any]) -> dict[str, Any]:
    contact = row.get("contact") if isinstance(row.get("contact"), dict) else {}
    return Document(
        id=_s(row, "id"),
        kind="purchase_bill",
        status="paid" if row.get("paid") else "open",
        number=_s(row, "reference"),
        party_id=_s(row, "contact_id"),
        party_name=_contact_name(contact) if contact else "",
        total=_f(row.get("total_price_incl_tax")),
        currency=_s(row, "currency"),
        date=_s(row, "date"),
        due_date=_s(row, "due_date"),
    ).model_dump()


async def call(
    credentials: dict[str, Any], connection_id: str, verb: str, args: dict[str, Any]
) -> dict[str, Any]:
    company_id = str(args.get("company_id") or "").strip()

    try:
        if verb == "list_companies":
            rows = await moneybird.list_administrations(credentials)
            return ok_result(
                companies=[
                    Company(
                        id=row["id"],
                        name=row["name"],
                        vendor=VENDOR,
                        connection_id=connection_id,
                    ).model_dump()
                    for row in rows
                ]
            )

        if not company_id:
            return {
                "ok": False,
                "code": "missing_company",
                "message": moneybird.MISSING_ADMINISTRATION_ERROR,
            }

        if verb == "get_company":
            rows = await moneybird.list_administrations(credentials)
            match = next((r for r in rows if r["id"] == company_id), None)
            if not match:
                return {"ok": False, "code": "not_found", "message": f"Administration {company_id} not found"}
            return ok_result(
                company=Company(
                    id=match["id"],
                    name=match["name"],
                    vendor=VENDOR,
                    connection_id=connection_id,
                ).model_dump(),
                details=match,
            )

        if verb == "search_parties":
            rows = await moneybird.list_contacts(
                credentials, company_id, query=str(args.get("query") or "")
            )
            role = str(args.get("role") or "customer")
            return ok_result(parties=[_party(r, role) for r in rows if isinstance(r, dict)])

        if verb == "get_party":
            row = await moneybird.get_contact(
                credentials, company_id, str(args.get("party_id") or args.get("id") or "")
            )
            return ok_result(party=_party(row))

        if verb == "list_documents":
            kind = str(args.get("kind") or "sales_invoice")
            if kind == "purchase_bill":
                rows = await moneybird.list_purchase_documents(credentials, company_id)
                return ok_result(
                    documents=[_purchase_document(r) for r in rows if isinstance(r, dict)]
                )
            rows = await moneybird.list_sales_invoices(
                credentials, company_id, state=str(args.get("status") or "")
            )
            return ok_result(documents=[_sales_document(r) for r in rows if isinstance(r, dict)])

        if verb == "get_document":
            row = await moneybird.get_sales_invoice(
                credentials, company_id, str(args.get("document_id") or args.get("id") or "")
            )
            return ok_result(document=_sales_document(row))

        if verb == "list_accounts":
            rows = await moneybird.list_ledger_accounts(credentials, company_id)
            return ok_result(
                accounts=[
                    Account(
                        id=_s(r, "id"),
                        number=_s(r, "account_id"),
                        name=_s(r, "name"),
                    ).model_dump()
                    for r in rows
                    if isinstance(r, dict)
                ]
            )

        if verb == "list_outstanding":
            open_rows = await moneybird.list_sales_invoices(credentials, company_id, state="open")
            late_rows = await moneybird.list_sales_invoices(credentials, company_id, state="late")
            outstanding = []
            for row, overdue in [(r, False) for r in open_rows] + [(r, True) for r in late_rows]:
                if not isinstance(row, dict):
                    continue
                doc = _sales_document(row)
                outstanding.append(
                    Outstanding(
                        document_id=doc["id"],
                        kind="sales_invoice",
                        party_name=doc["party_name"],
                        amount=_f(row.get("total_unpaid")) or doc["total"],
                        currency=doc["currency"],
                        due_date=doc["due_date"],
                        overdue=overdue,
                    ).model_dump()
                )
            return ok_result(outstanding=outstanding)

        if verb == "list_bank_mutations":
            rows = await moneybird.list_financial_mutations(credentials, company_id)
            return ok_result(
                bank_mutations=[
                    BankMutation(
                        id=_s(r, "id"),
                        date=_s(r, "date"),
                        amount=_f(r.get("amount")),
                        currency=_s(r, "currency"),
                        counterparty=_s(r, "contra_account_name", "message"),
                        description=_s(r, "message"),
                        state=_s(r, "state"),
                    ).model_dump()
                    for r in rows
                    if isinstance(r, dict)
                ]
            )

        if verb == "list_tax_rates":
            rows = await moneybird.list_tax_rates(credentials, company_id)
            return ok_result(
                tax_rates=[
                    TaxRate(
                        id=_s(r, "id"),
                        name=_s(r, "name"),
                        percentage=_f(r.get("percentage")),
                    ).model_dump()
                    for r in rows
                    if isinstance(r, dict)
                ]
            )
    except RuntimeError as exc:
        return {"ok": False, "code": "credentials", "message": str(exc)}
    except Exception as exc:
        return {"ok": False, "code": "vendor_error", "message": f"Moneybird API error: {exc}"}

    return {
        "ok": False,
        "code": "unsupported",
        "capability": verb,
        "message": f"Moneybird does not support {verb}.",
    }
