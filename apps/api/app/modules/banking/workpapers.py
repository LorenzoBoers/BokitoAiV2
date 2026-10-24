"""Treasury checks. They do not read the bank and they do not send money.

AIS consent is at most 180 days since 25 July 2023 (PSD2 RTS on strong
customer authentication; it was 90 days before that). Euro-area banks must
let customers send instant euro transfers from 9 October 2025, at no higher
price than a standard transfer, and must offer verification of payee
(Instant Payments Regulation, DNB and the Betaalvereniging).
"""

from __future__ import annotations

import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

_SOURCES = (
    {
        "title": "DNB — Instant Payments Regulation",
        "url": "https://www.dnb.nl/nieuws-voor-de-sector/toezicht-2025/instant-payments-regulation-nieuwe-verplichtingen/",
    },
    {
        "title": "Betaalvereniging — Instant Payments Verordening",
        "url": "https://www.betaalvereniging.nl/kennisbank/europese-regelgeving/instant-payments-verordening/",
    },
)


def _q(amount: Decimal) -> str:
    return str(amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def iban_check(args: dict[str, Any]) -> dict[str, Any]:
    """ISO 13616 check digits. Does not look up the bank."""
    raw = str(args.get("iban") or "")
    compact = re.sub(r"[\s-]+", "", raw).upper()
    if not compact:
        raise ValueError("Pass iban.")
    structure = bool(re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}", compact))
    rearranged = compact[4:] + compact[:4]
    digits = []
    for char in rearranged:
        if char.isdigit():
            digits.append(char)
        elif char.isalpha():
            digits.append(str(ord(char) - 55))
        else:
            structure = False
            break
    valid = False
    if structure and digits:
        valid = int("".join(digits)) % 97 == 1
    country = compact[:2] if len(compact) >= 2 else ""
    note = "The check digits match." if valid else "The check digits do not match. Do not propose a payment to this IBAN."
    if country == "NL" and len(compact) != 18:
        note = "A Dutch IBAN has 18 characters. " + note
        valid = False
    return {
        "ok": True,
        "iban": compact,
        "country": country,
        "valid": valid,
        "bank_name": None,
        "note": note + " The bank name is not looked up.",
        "sources": list(_SOURCES),
    }


def consent(args: dict[str, Any]) -> dict[str, Any]:
    """How long an account-information consent lasts. This module does not renew it."""
    del args
    return {
        "ok": True,
        "account_information_max_days": 180,
        "since": "2023-07-25",
        "previously_max_days": 90,
        "each_payment_needs_confirmation": True,
        "sends_payments": False,
        "note": (
            "Reading accounts through PSD2 needs the account holder's consent, "
            "for at most 180 days, and then it must be confirmed again. "
            "Each outgoing payment needs its own confirmation. "
            "The connected provider here reads balances and transactions. "
            "propose_payment records a decision. It does not send a SEPA or instant transfer."
        ),
        "sources": list(_SOURCES),
    }


def liquidity(args: dict[str, Any]) -> dict[str, Any]:
    """Sum balances the caller already read. No foreign-exchange conversion."""
    rows = args.get("balances") or []
    if not isinstance(rows, list):
        raise ValueError("balances must be a list.")
    totals: dict[str, Decimal] = {}
    used = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        amount = row.get("amount")
        if amount is None or amount == "":
            continue
        try:
            value = Decimal(str(amount))
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"Not a number: {amount}") from exc
        currency = str(row.get("currency") or "").strip().upper() or "UNKNOWN"
        totals[currency] = totals.get(currency, Decimal("0")) + value
        used += 1
    return {
        "ok": True,
        "accounts_summed": used,
        "totals": {code: _q(amount) for code, amount in totals.items()},
        "converted": False,
        "note": (
            "Totals are per currency. Nothing was converted. "
            "Take the balances from get_balance. "
            "Matching a line to an invoice is Boekito. "
            "The year-end bank tie-out is Accounto."
            if used
            else "No balances were passed, so no cash position is calculated. Read get_balance first."
        ),
        "questions": [
            "Which tax, payroll, and supplier payments leave before the next inflow?",
            "Is any account a savings account that cannot pay today's bills?",
        ],
        "sources": list(_SOURCES),
    }


def payment_guard(args: dict[str, Any]) -> dict[str, Any]:
    """Checklist before a payment proposal. Does not send the payment."""
    checked = iban_check({"iban": args.get("iban")}) if args.get("iban") else None
    missing = [
        name
        for name, present in (
            ("iban", args.get("iban")),
            ("amount", args.get("amount")),
            ("currency", args.get("currency")),
            ("payee_name", args.get("payee_name")),
            ("reference", args.get("reference")),
        )
        if present in (None, "")
    ]
    ready = not missing and bool(checked and checked["valid"])
    return {
        "ok": True,
        "ready_to_propose": ready,
        "missing": missing,
        "iban": checked,
        "verification_of_payee": (
            "Since 9 October 2025 a euro-area bank must check the payee name against the IBAN "
            "before a standard or instant euro transfer. Confirm that match in the bank. This tool cannot."
        ),
        "sends_payments": False,
        "note": "A ready checklist still goes out only as propose_payment, and only after a person approves. Booking the payment in the accounts is Boekito.",
        "sources": list(_SOURCES),
    }


WORKPAPERS = {
    "iban_check": iban_check,
    "consent": consent,
    "liquidity": liquidity,
    "payment_guard": payment_guard,
}
