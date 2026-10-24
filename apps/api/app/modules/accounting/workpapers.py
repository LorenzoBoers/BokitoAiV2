"""Bookkeeping checks that do not read a package and do not close the year.

VAT rates are article 9 of the Wet op de omzetbelasting 1968 (text in force
from 1 January 2026): 21%, 9% for table I, 0% for table II. This module does
not decide which table a product belongs to. Invoice fields follow article
35a; a simplified invoice is article 34d, at most €100 including VAT.
Payment terms follow article 6:119a BW and the Ondernemersplein summary.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

_SOURCES = {
    "vat": {
        "title": "Belastingdienst — btw-tarieven",
        "url": "https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/btw_berekenen_aan_uw_klanten/btw_berekenen/btw_tarief/btw_tarief",
    },
    "statute": {
        "title": "Wet op de omzetbelasting 1968",
        "url": "https://wetten.overheid.nl/BWBR0002629/2026-01-01/0",
    },
    "simple": {
        "title": "Belastingdienst — vereenvoudigde factuur",
        "url": "https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/administratie_bijhouden/facturen_maken/factuureisen/aangepaste_regels_facturen/vereenvoudigde_factuur",
    },
    "terms": {
        "title": "Ondernemersplein — betalingstermijn",
        "url": "https://ondernemersplein.overheid.nl/wetten-en-regels/betalingstermijn-incassokosten-en-wettelijke-rente/",
    },
}

_FULL = (
    ("issue_date", "Date the invoice was issued."),
    ("number", "A unique number in a consecutive series."),
    ("seller_vat_id", "VAT identification number of the supplier."),
    ("seller_name_address", "Full name and address of the supplier."),
    ("buyer_name_address", "Full name and address of the customer."),
    ("description", "Nature of the goods or services."),
    ("quantity", "Quantity of the goods, or the extent of the services."),
    ("net_amount", "Consideration per rate, VAT excluded."),
    ("vat_rate", "VAT rate applied."),
    ("vat_amount", "VAT amount due, unless a special scheme excludes it."),
)
_SIMPLE = (
    ("issue_date", "Date the invoice was issued."),
    ("seller_name_address", "Name and address of the supplier."),
    ("description", "Nature of the goods or services."),
    ("vat_amount", "VAT amount, or enough information to calculate it."),
)


def _money(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Not a number: {value}") from exc


def _q(amount: Decimal) -> str:
    return str(amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _rate_key(value: Any) -> str:
    raw = str(value or "").strip().lower().replace("%", "").replace(",", ".")
    if raw in {"exempt", "vrijgesteld", "vrijstelling"}:
        return "exempt"
    if raw in {"0", "0.0", "zero", "nihil"}:
        return "0"
    if raw in {"9", "9.0"}:
        return "9"
    if raw in {"21", "21.0"}:
        return "21"
    return ""


def vat_rates(args: dict[str, Any]) -> dict[str, Any]:
    """Return the statutory rates. Compute VAT only when the rate and net are given."""
    key = _rate_key(args.get("rate"))
    net = _money(args.get("net_amount"))
    computed: dict[str, Any] | None = None
    if not key:
        note = (
            "The general rate is 21%. Table I is 9%. Table II is 0%. "
            "Some supplies are exempt, and then input VAT is not deductible. "
            "This tool does not choose the table. Look that up before you pass a rate."
        )
    elif key == "exempt":
        note = "An exempt supply has no VAT on the invoice. Input VAT on the related costs is not deductible."
        if net is not None:
            computed = {"net_amount": _q(net), "vat_amount": "0.00", "gross_amount": _q(net), "rate": "exempt"}
    elif net is None:
        note = "Pass net_amount to compute the VAT. The rate alone is not an amount."
    else:
        factor = {"21": Decimal("0.21"), "9": Decimal("0.09"), "0": Decimal("0")}[key]
        vat = net * factor
        extra = (
            "A 0% supply charges no VAT, and input VAT may still be deductible. Confirm the conditions."
            if key == "0"
            else "Computed from the rate you passed. This is not a filing."
        )
        computed = {
            "net_amount": _q(net),
            "vat_amount": _q(vat),
            "gross_amount": _q(net + vat),
            "rate": key,
        }
        note = extra
    return {
        "ok": True,
        "rates": {"general": "21", "reduced": "9", "zero": "0", "exempt": "no VAT, input VAT not deductible"},
        "computed": computed,
        "note": note,
        "left_to_accountant": "The annual VAT tie-out and the corporate-tax bridge stay with Accounto.",
        "sources": [_SOURCES["vat"], _SOURCES["statute"]],
    }


def invoice_check(args: dict[str, Any]) -> dict[str, Any]:
    """Which statutory invoice fields are still missing. Does not create the invoice."""
    amount = _money(args.get("amount_incl"))
    blocked = any(bool(args.get(flag)) for flag in ("intra_community", "distance_sales", "reverse_charge_abroad"))
    simplified = amount is not None and amount <= Decimal("100") and not blocked
    present = {str(item).strip() for item in (args.get("present") or []) if str(item).strip()}
    fields = _SIMPLE if simplified else _FULL
    rows = [
        {"id": key, "label": label, "present": key in present}
        for key, label in fields
    ]
    missing = [row["id"] for row in rows if not row["present"]]
    if simplified:
        regime = "simplified"
        note = "A simplified invoice is allowed up to €100 including VAT, and for a document that only corrects an earlier invoice. It is not allowed for an intra-Community supply, a distance sale, or a reverse charge abroad."
    elif blocked:
        regime = "full"
        note = "This supply cannot use a simplified invoice. The full article 35a mentions apply. A KvK number is usual on a Dutch invoice but is not one of those mentions."
    else:
        regime = "full"
        note = "Full invoice mentions from article 35a. Pass amount_incl to test the €100 simplified-invoice ceiling. A KvK number is usual on a Dutch invoice but is not one of those mentions."
    return {
        "ok": True,
        "regime": regime,
        "fields": rows,
        "missing": missing,
        "complete": not missing,
        "note": note,
        "booking_stays_here": "Creating the invoice in the package is propose_document, after approval.",
        "sources": [_SOURCES["statute"], _SOURCES["simple"]],
    }


def payment_terms(args: dict[str, Any]) -> dict[str, Any]:
    """Statutory payment term. Does not calculate interest."""
    party = str(args.get("party") or "business").strip().lower()
    agreed = args.get("agreed_days")
    agreed_days = int(agreed) if agreed not in (None, "") else None
    if party in {"consumer", "consument", "b2c"}:
        return {
            "ok": True,
            "party": "consumer",
            "default_days": None,
            "maximum_days": None,
            "agreed_days": agreed_days,
            "agreed_allowed": None,
            "compensation_eur": None,
            "note": "There is no statutory payment term for a consumer. The term in the contract must be reasonable. Commercial statutory interest and the €40 compensation are for business and government debts, not this case.",
            "sources": [_SOURCES["terms"]],
        }
    if party in {"government", "overheid"}:
        maximum = 30
        note = "A public authority pays within 30 days of receiving the invoice. Extension to 60 days is exceptional."
    elif party in {"large_to_sme", "groot_aan_mkb"}:
        maximum = 30
        note = "A large company that buys from an SME or a self-employed person must agree at most 30 days. A longer term is void. Whether the buyer is large is a size-class question for Accounto."
    else:
        party = "business"
        maximum = 60
        note = "Between businesses the term is 30 days when none was agreed, and a contract may set at most 60 days. Longer than 60 days only stands when it is not unfair to either side."
    allowed = None if agreed_days is None else agreed_days <= maximum
    return {
        "ok": True,
        "party": party,
        "default_days": 30,
        "maximum_days": maximum,
        "agreed_days": agreed_days,
        "agreed_allowed": allowed,
        "compensation_eur": "40",
        "note": (
            f"{note} A commercial late payment can also carry a minimum compensation of €40 "
            "and commercial statutory interest. The interest percentage is published separately "
            "and is not calculated here."
        ),
        "sources": [_SOURCES["terms"]],
    }


WORKPAPERS = {
    "vat_rates": vat_rates,
    "invoice_check": invoice_check,
    "payment_terms": payment_terms,
}
