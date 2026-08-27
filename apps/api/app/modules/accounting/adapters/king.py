"""KING Accountancy adapter: Cloudswitch SOAP reads behind the module verbs."""

from __future__ import annotations

from typing import Any

from app.modules.accounting.schema import Account, Company, LedgerLine, Party, ok_result
from app.services.king_finance import call_king_tool, public_companies

VENDOR = "king"


def _f(value: Any) -> float | None:
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _party_from_row(row: dict[str, Any], role: str) -> dict[str, Any]:
    address = ", ".join(
        part for part in (row.get("STRAAT"), row.get("POSTCD"), row.get("PLAATS")) if part
    )
    return Party(
        id=str(row.get("NR") or ""),
        role="supplier" if role == "supplier" else "customer",
        name=str(row.get("NAAM") or ""),
        email=str(row.get("EMAIL") or ""),
        phone=str(row.get("TELEFOON") or ""),
        address=address,
        number=str(row.get("NR") or ""),
    ).model_dump()


async def call(
    auth: dict[str, Any], connection_id: str, verb: str, args: dict[str, Any]
) -> dict[str, Any]:
    company_id = str(args.get("company_id") or "").strip()

    if verb == "list_companies":
        companies = [
            Company(
                id=row["id"],
                name=row["name"],
                vendor=VENDOR,
                connection_id=connection_id,
                external_id=row.get("adm_nr", ""),
            ).model_dump()
            for row in public_companies(auth)
        ]
        return ok_result(companies=companies)

    if verb == "get_company":
        outcome = await call_king_tool(auth, "get_company_details", {"company_id": company_id})
        if outcome.get("error"):
            return {"ok": False, "code": "vendor_error", "message": outcome["error"]}
        details = outcome.get("result") or {}
        return ok_result(
            company=Company(
                id=str(details.get("company_id") or company_id),
                name=str(details.get("name") or ""),
                vendor=VENDOR,
                connection_id=connection_id,
            ).model_dump(),
            details=details,
        )

    if verb == "search_parties":
        role = str(args.get("role") or "customer")
        tool = "list_suppliers" if role == "supplier" else "search_customers"
        outcome = await call_king_tool(
            auth, tool, {"company_id": company_id, "query": args.get("query") or ""}
        )
        if outcome.get("error"):
            return {"ok": False, "code": "vendor_error", "message": outcome["error"]}
        rows = outcome.get("result") or []
        return ok_result(parties=[_party_from_row(r, role) for r in rows if isinstance(r, dict)])

    if verb == "get_party":
        outcome = await call_king_tool(
            auth,
            "get_customer",
            {"company_id": company_id, "customer_id": args.get("party_id") or args.get("id")},
        )
        if outcome.get("error"):
            return {"ok": False, "code": "vendor_error", "message": outcome["error"]}
        row = outcome.get("result") or {}
        return ok_result(party=_party_from_row(row, "customer"))

    if verb in ("list_accounts", "get_account"):
        tool = "get_account_balance" if verb == "get_account" else "list_accounts"
        outcome = await call_king_tool(
            auth,
            tool,
            {"company_id": company_id, "account": args.get("account_id") or args.get("account")},
        )
        if outcome.get("error"):
            return {"ok": False, "code": "vendor_error", "message": outcome["error"]}
        if verb == "get_account":
            row = outcome.get("result") or {}
            return ok_result(
                account=Account(
                    id=str(row.get("NR") or ""),
                    number=str(row.get("NR") or ""),
                    name=str(row.get("OMSCHR") or ""),
                ).model_dump()
            )
        rows = outcome.get("result") or []
        return ok_result(
            accounts=[
                Account(
                    id=str(r.get("NR") or ""),
                    number=str(r.get("NR") or ""),
                    name=str(r.get("OMSCHR") or ""),
                ).model_dump()
                for r in rows
                if isinstance(r, dict)
            ]
        )

    if verb == "list_ledger":
        # KING V1 exposes last-booking dates/periods, not full journal reads.
        outcome = await call_king_tool(auth, "list_recent_bookings", {"company_id": company_id})
        if outcome.get("error"):
            return {"ok": False, "code": "vendor_error", "message": outcome["error"]}
        result = outcome.get("result") or {}
        lines = [
            LedgerLine(
                description="Last booking",
                date=str(row.get("DATUM") or row.get("date") or ""),
                period=str(row.get("PERIODE") or row.get("period") or ""),
            ).model_dump()
            for row in (result.get("last_booking_dates") or [])
            if isinstance(row, dict)
        ]
        return ok_result(
            ledger=lines,
            note="KING exposes last-booking dates only; full journal reads are not available.",
            raw=result,
        )

    return {
        "ok": False,
        "code": "unsupported",
        "capability": verb,
        "message": f"KING Accountancy does not support {verb}.",
    }
