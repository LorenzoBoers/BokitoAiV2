"""KING Accountancy adapter: Cloudswitch SOAP reads + writes behind the module verbs.

Writes (apply_party, apply_booking) map the canonical module payloads to
Cloudswitch datasets. They are only dispatched here after human approval and
behind the platform + tenant write switches (checked in the module router).
"""

from __future__ import annotations

from typing import Any

from app.modules.accounting.schema import (
    Account,
    Company,
    JournalEntry,
    LedgerLine,
    Party,
    PartyUpsert,
    ok_result,
)
from app.services.king_finance import call_king_tool, public_companies

VENDOR = "king"


def _party_fields(payload: PartyUpsert) -> dict[str, str]:
    """Canonical party -> KING DEB/CRED field names."""
    return {
        "NAAM": payload.name,
        "EMAIL": payload.email,
        "TEL": payload.phone,
        "STRAAT": payload.street,
        "POSTCD": payload.postal_code,
        "PLAATS": payload.city,
        "LAND": payload.country,
    }


def _king_date(value: str) -> str:
    """YYYY-MM-DD -> DD-MM-YYYY (Cloudswitch date format)."""
    parts = value.strip().split("-")
    if len(parts) == 3 and len(parts[0]) == 4:
        return f"{parts[2]}-{parts[1]}-{parts[0]}"
    return value.strip()


def _booking_rows(entry: JournalEntry) -> list[dict[str, Any]] | str:
    """Canonical journal entry -> KING BOE datarows.

    Cloudswitch books row-per-counter-account: REK is the single-sided
    account, each row carries TEGREK + BEDRBOEK (positive = debit REK).
    Supported shapes: one debit line vs N credit lines, or one credit line
    vs N debit lines. Returns an error string for other shapes.
    """
    debits = [line for line in entry.lines if (line.debit or 0) > 0]
    credits = [line for line in entry.lines if (line.credit or 0) > 0]
    if not debits or not credits:
        return "A journal entry needs at least one debit and one credit line."
    total_debit = sum(line.debit or 0 for line in debits)
    total_credit = sum(line.credit or 0 for line in credits)
    if abs(total_debit - total_credit) > 0.005:
        return (
            f"Journal entry does not balance: debit {total_debit:.2f} "
            f"vs credit {total_credit:.2f}."
        )
    if len(debits) > 1 and len(credits) > 1:
        return (
            "KING bookings need one single-sided line: use one debit line with "
            "multiple credit lines, or one credit line with multiple debit lines."
        )

    single, others, sign = (
        (debits[0], credits, 1) if len(debits) == 1 else (credits[0], debits, -1)
    )
    if not entry.journal.strip():
        return "KING bookings require a journal (dagboek) code."
    date = entry.date.strip()
    year = date[:4] if len(date) >= 4 and date[:4].isdigit() else ""
    month = date[5:7].lstrip("0") if len(date) >= 7 else ""
    if not year or not month:
        return "KING bookings require date as YYYY-MM-DD (year and period derive from it)."

    rows: list[dict[str, Any]] = []
    for line in others:
        amount = (line.credit if sign == 1 else line.debit) or 0
        rows.append(
            {
                "JR": year,
                "PN": month,
                "DAGB": entry.journal.strip(),
                "REK": single.account,
                "TEGREK": line.account,
                "BEDRBOEK": f"{sign * amount:.2f}",
                "BTW": line.tax_code,
                "DAT": _king_date(entry.date),
                "OMSCHR": line.description or entry.description,
                "BOEKSTUK": entry.reference,
            }
        )
    return rows


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

    if verb == "apply_party":
        try:
            payload = PartyUpsert(**{k: v for k, v in args.items() if k in PartyUpsert.model_fields})
        except Exception as exc:
            return {"ok": False, "code": "invalid_payload", "message": str(exc)}
        fields = _party_fields(payload)
        if payload.party_id.strip():
            outcome = await call_king_tool(
                auth,
                "update_party",
                {
                    "company_id": company_id,
                    "role": payload.role,
                    "party_id": payload.party_id,
                    "fields": fields,
                },
            )
        else:
            outcome = await call_king_tool(
                auth,
                "create_party",
                {"company_id": company_id, "role": payload.role, "fields": fields},
            )
        if outcome.get("error"):
            return {"ok": False, "code": "vendor_error", "message": outcome["error"]}
        return ok_result(**(outcome.get("result") or {}))

    if verb == "apply_booking":
        try:
            entry = JournalEntry(**{k: v for k, v in args.items() if k in JournalEntry.model_fields})
        except Exception as exc:
            return {"ok": False, "code": "invalid_payload", "message": str(exc)}
        rows = _booking_rows(entry)
        if isinstance(rows, str):
            return {"ok": False, "code": "invalid_payload", "message": rows}
        outcome = await call_king_tool(
            auth, "create_journal_entry", {"company_id": company_id, "rows": rows}
        )
        if outcome.get("error"):
            return {"ok": False, "code": "vendor_error", "message": outcome["error"]}
        return ok_result(**(outcome.get("result") or {}))

    return {
        "ok": False,
        "code": "unsupported",
        "capability": verb,
        "message": f"KING Accountancy does not support {verb}.",
    }
