"""Year-file workpapers for Accounto.

Figures are arguments. This module does not read a ledger and does not invent
amounts. Thresholds and rates are the published Dutch rules, with the source
named on every result. A registered accountant signs outside Bokito.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

# BW 2:395a / 2:396 / 2:397, raised for financial years starting on or after
# 1 January 2024. Public table: KvK, "In welke bedrijfsklasse valt je bedrijf?"
# (updated 14 January 2026). A class needs two of three ceilings on two
# consecutive balance-sheet dates. Assets and turnover are "niet meer dan";
# employees are "minder dan".
_MICRO = (Decimal("450000"), Decimal("900000"), Decimal("10"))
_SMALL = (Decimal("7500000"), Decimal("15000000"), Decimal("50"))
_MEDIUM = (Decimal("25000000"), Decimal("50000000"), Decimal("250"))

# Belastingdienst, "Tarieven voor de vennootschapsbelasting": 19% up to and
# including €200,000 and 25.8% above, for 2023 through 2026.
_VPB_YEARS = frozenset({2023, 2024, 2025, 2026})
_VPB_THRESHOLD = Decimal("200000")
_VPB_LOW = Decimal("0.19")
_VPB_HIGH = Decimal("0.258")

_SOURCES = {
    "size": {
        "title": "KvK — bedrijfsklasse",
        "url": "https://www.kvk.nl/deponeren/in-welke-bedrijfsklasse-valt-je-bedrijf/",
    },
    "bw2": {
        "title": "wetten.nl — BW2 Titel 9",
        "url": "https://wetten.overheid.nl/BWBR0003045/",
    },
    "nba": {
        "title": "NBA — welk accountantsproduct",
        "url": "https://www.nba.nl/over-nba/zoek-een-accountant/welk-accountantsproduct-heb-ik-nodig/",
    },
    "std4410": {
        "title": "NBA — Standaard 4410 samenstellingsopdrachten",
        "url": "https://www.nba.nl/wet--en-regelgeving/hra/1619/10430/10543/",
    },
    "rj": {
        "title": "RJ — Richtlijnen voor de jaarverslaggeving",
        "url": "https://www.rjnet.nl/",
    },
    "sbr": {
        "title": "KvK — deponeren met SBR",
        "url": "https://www.kvk.nl/deponeren/deponeren-met-sbr/",
    },
    "vpb": {
        "title": "Belastingdienst — tarieven vennootschapsbelasting",
        "url": "https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/winst/vennootschapsbelasting/tarieven_vennootschapsbelasting",
    },
    "ib": {
        "title": "Belastingdienst — inkomstenbelasting",
        "url": "https://www.belastingdienst.nl/wps/wcm/connect/nl/inkomstenbelasting/inkomstenbelasting",
    },
}

_DEPOSIT = frozenset({"bv", "nv", "cooperatie"})
_NO_DEPOSIT = frozenset({"eenmanszaak", "vof", "cv", "maatschap"})
_VPB_FORMS = frozenset({"bv", "nv", "cooperatie"})
_IB_FORMS = frozenset({"eenmanszaak", "vof", "cv", "maatschap"})

_FORM_ALIASES = {
    "bv": "bv",
    "besloten vennootschap": "bv",
    "nv": "nv",
    "naamloze vennootschap": "nv",
    "cooperatie": "cooperatie",
    "coöperatie": "cooperatie",
    "cooperative": "cooperatie",
    "eenmanszaak": "eenmanszaak",
    "ez": "eenmanszaak",
    "vof": "vof",
    "vennootschap onder firma": "vof",
    "cv": "cv",
    "commanditaire vennootschap": "cv",
    "maatschap": "maatschap",
    "stichting": "stichting",
    "vereniging": "vereniging",
}


def _sources(*keys: str) -> list[dict[str, str]]:
    return [_SOURCES[key] for key in keys]


def _money(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Not a number: {value}") from exc


def _q(amount: Decimal) -> str:
    return str(amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def normalize_legal_form(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    return _FORM_ALIASES.get(raw, raw)


def _criteria_met(
    assets: Decimal | None,
    turnover: Decimal | None,
    employees: Decimal | None,
    ceilings: tuple[Decimal, Decimal, Decimal],
) -> int:
    asset_max, turnover_max, employee_max = ceilings
    met = 0
    if assets is not None and assets <= asset_max:
        met += 1
    if turnover is not None and turnover <= turnover_max:
        met += 1
    if employees is not None and employees < employee_max:
        met += 1
    return met


def _class_for_year(
    assets: Decimal | None,
    turnover: Decimal | None,
    employees: Decimal | None,
) -> str | None:
    known = sum(item is not None for item in (assets, turnover, employees))
    if known < 2:
        return None
    if _criteria_met(assets, turnover, employees, _MICRO) >= 2:
        return "micro"
    if _criteria_met(assets, turnover, employees, _SMALL) >= 2:
        return "small"
    if _criteria_met(assets, turnover, employees, _MEDIUM) >= 2:
        return "medium"
    return "large"


def size_class(args: dict[str, Any]) -> dict[str, Any]:
    """Indicate the BW2 size class. Does not read the ledger."""
    assets = _money(args.get("total_assets"))
    turnover = _money(args.get("net_turnover"))
    employees = _money(args.get("employees"))
    prior_assets = _money(args.get("prior_total_assets"))
    prior_turnover = _money(args.get("prior_net_turnover"))
    prior_employees = _money(args.get("prior_employees"))
    legal_form = normalize_legal_form(args.get("legal_form"))
    current = _class_for_year(assets, turnover, employees)
    prior_known = any(item is not None for item in (prior_assets, prior_turnover, prior_employees))
    prior = _class_for_year(prior_assets, prior_turnover, prior_employees) if prior_known else None

    if current is None:
        in_force = None
        confirmed = False
        note = (
            "Need at least two of total assets, net turnover, and average employees. "
            "Take the figures from Accounting or the operator. Do not estimate them."
        )
    elif prior is None:
        in_force = None
        confirmed = False
        note = (
            f"This year indicates {current}. The legal class needs the same "
            "indication on two consecutive balance-sheet dates."
        )
    elif prior == current:
        in_force = current
        confirmed = True
        note = f"Both years indicate {current}, so that class is in force."
    else:
        in_force = prior
        confirmed = False
        note = (
            f"The prior year indicates {prior} and this year indicates {current}. "
            f"The class stays {prior} until two consecutive years meet the new ceilings."
        )

    deposit = _deposit_duty(legal_form, in_force or current)
    audit = _audit_duty(in_force or current)
    return {
        "ok": True,
        "legal_form": legal_form or None,
        "indicated": current,
        "prior_indicated": prior,
        "size_class": in_force,
        "confirmed": confirmed,
        "deposit": deposit,
        "statutory_audit": audit,
        "ceilings": {
            "micro": {"assets_max": "450000", "turnover_max": "900000", "employees_below": "10"},
            "small": {"assets_max": "7500000", "turnover_max": "15000000", "employees_below": "50"},
            "medium": {"assets_max": "25000000", "turnover_max": "50000000", "employees_below": "250"},
            "large": "Above the medium ceilings on at least two criteria.",
            "rule": "At least two of the three criteria, on two consecutive balance-sheet dates.",
            "from_financial_year": "2024-01-01",
        },
        "note": note,
        "sources": _sources("size", "bw2"),
    }


def _deposit_duty(legal_form: str, size: str | None) -> dict[str, Any]:
    if legal_form in _NO_DEPOSIT:
        return {
            "required": False,
            "note": (
                "A sole proprietorship, vof, cv, or maatschap does not deposit annual "
                "accounts, unless every partner is itself a legal entity that must deposit. "
                "Confirm that exception on kvk.nl."
            ),
        }
    if legal_form in _DEPOSIT:
        return {
            "required": True,
            "note": (
                "A bv, nv, or coöperatie deposits at the Kamer van Koophandel. "
                "Micro, small, medium, and (from book year 2025) large entities file digitally via SBR. "
                f"Size used for the exemptions: {size or 'not confirmed yet'}."
            ),
        }
    if legal_form in {"stichting", "vereniging"}:
        return {
            "required": None,
            "note": "A commercial stichting or vereniging often must deposit. Confirm the duty on kvk.nl.",
        }
    return {
        "required": None,
        "note": "Pass legal_form (bv, nv, eenmanszaak, vof, stichting, …) before stating a filing duty.",
    }


def _audit_duty(size: str | None) -> dict[str, Any]:
    if size in {"micro", "small"}:
        return {
            "required": False,
            "note": "Micro and small entities have no statutory audit, unless they report under IFRS-EU in a way that removes the exemption.",
        }
    if size in {"medium", "large"}:
        return {
            "required": True,
            "note": (
                "Medium and large entities generally need a statutory audit (BW 2:393), "
                "unless a 403 group exemption applies. Accounto does not perform that audit."
            ),
        }
    return {
        "required": None,
        "note": "The audit duty follows the size class. It is unknown until the class is confirmed.",
    }


def _parse_date(value: Any, field: str) -> date:
    raw = str(value or "").strip()
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError(f"{field} must be YYYY-MM-DD.") from exc


def _add_months(day: date, months: int) -> date:
    index = day.month - 1 + months
    year = day.year + index // 12
    month = index % 12 + 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


def filing_calendar(args: dict[str, Any]) -> dict[str, Any]:
    """Deadlines from the year-end. Extensions (shareholders, becon) are named, not calculated."""
    year_end = _parse_date(args.get("year_end"), "year_end")
    legal_form = normalize_legal_form(args.get("legal_form"))
    size = str(args.get("size_class") or "").strip().lower() or None
    calendar_year = year_end.month == 12 and year_end.day == 31
    prepare_by = _add_months(year_end, 5)
    extension_max = _add_months(year_end, 10)
    deposit_ultimate = _add_months(year_end, 12)
    accounts_apply = legal_form not in _NO_DEPOSIT
    annual: dict[str, Any] = {
        "applies": accounts_apply if legal_form else None,
        "prepare_by": prepare_by.isoformat() if accounts_apply else None,
        "shareholder_extension_max": extension_max.isoformat() if accounts_apply else None,
        "deposit_within_days_after_adoption": 8 if accounts_apply else None,
        "deposit_ultimate": deposit_ultimate.isoformat() if accounts_apply else None,
        "note": (
            "The board of a bv or nv prepares the annual accounts within 5 months. "
            "The general meeting may extend that by at most 5 months for special circumstances. "
            "Deposit within 8 days after adoption, and in any case within 12 months after year-end. "
            "Accounto does not file at the Kamer van Koophandel."
            if accounts_apply
            else "This legal form does not prepare BW2 Title 9 annual accounts for deposit."
        ),
    }
    corporate: dict[str, Any] | None = None
    income: dict[str, Any] | None = None
    if not legal_form or legal_form in _VPB_FORMS or legal_form in {"stichting", "vereniging"}:
        if calendar_year:
            file_by = date(year_end.year + 1, 6, 1).isoformat()
            tax_note = "A calendar-year corporate-tax return is due before 1 June of the next year."
        else:
            file_by = _add_months(year_end, 5).isoformat()
            tax_note = "A broken financial year files corporate tax within 5 months after year-end."
        corporate = {
            "applies": legal_form in _VPB_FORMS if legal_form else None,
            "file_by": file_by,
            "note": (
                f"{tax_note} A becon extension can move this date; confirm it on belastingdienst.nl. "
                "Accounto does not file the return."
            ),
        }
    if legal_form in _IB_FORMS:
        income = {
            "applies": True,
            "file_by": date(year_end.year + 1, 5, 1).isoformat() if calendar_year else None,
            "note": (
                "Profit of a sole proprietorship, vof, cv, or maatschap is taxed in box 1 of the income tax. "
                "A calendar year is generally due before 1 May. Accounto does not compute ondernemersaftrek "
                "or the assessment, and does not file the return."
            ),
        }
    return {
        "ok": True,
        "legal_form": legal_form or None,
        "year_end": year_end.isoformat(),
        "size_class": size,
        "annual_accounts": annual,
        "corporate_tax": corporate,
        "income_tax": income,
        "left_to_accounting": (
            "VAT returns and the operational close stay with Accounting (Boekito). "
            "Accounto only ties the filed VAT position back to the ledger in the year file."
        ),
        "sources": _sources("bw2", "sbr", "vpb", "ib", "size"),
    }


def tax_bridge(args: dict[str, Any]) -> dict[str, Any]:
    """Commercial profit to an indicative fiscal result. Missing profit stays blank."""
    legal_form = normalize_legal_form(args.get("legal_form"))
    year_raw = args.get("year")
    year = int(year_raw) if year_raw not in (None, "") else None
    commercial = _money(args.get("commercial_profit"))
    lines: list[dict[str, str]] = []
    skipped = 0
    raw_adjustments = args.get("adjustments") or []
    if not isinstance(raw_adjustments, list):
        raw_adjustments = []
        skipped += 1
    for item in raw_adjustments:
        if not isinstance(item, dict):
            skipped += 1
            continue
        amount = _money(item.get("amount"))
        if amount is None:
            skipped += 1
            continue
        kind = str(item.get("kind") or "unspecified").strip().lower()
        if kind not in {"permanent", "temporary", "unspecified"}:
            kind = "unspecified"
        lines.append(
            {
                "label": str(item.get("label") or "Adjustment").strip() or "Adjustment",
                "kind": kind,
                "amount": _q(amount),
            }
        )
    fiscal: str | None = None
    if commercial is not None:
        total = commercial + sum((Decimal(line["amount"]) for line in lines), Decimal("0"))
        fiscal = _q(total)

    tax: dict[str, Any] | None = None
    if not legal_form:
        regime = "unknown"
        note = "Pass legal_form so the bridge uses corporate tax or income tax. No tax is calculated."
    elif legal_form in _IB_FORMS:
        regime = "income_tax"
        note = (
            "This form is not subject to corporate tax. List the commercial-to-fiscal "
            "differences here, and leave the assessment to the income-tax return. "
            "Do not apply the corporate-tax rates."
        )
    elif legal_form not in _VPB_FORMS and legal_form not in {"stichting", "vereniging"}:
        regime = "unknown"
        note = "This legal form is not a corporate-tax or income-tax case the bridge can rate. No tax is calculated."
    else:
        regime = "corporate_tax"
        if year not in _VPB_YEARS:
            note = (
                "Corporate-tax rates of 19% up to €200,000 and 25.8% above are published "
                "for 2023 through 2026. This year is outside that range, so no tax is calculated. "
                "Search the Accountant sources before quoting a rate."
            )
        elif fiscal is None:
            note = (
                "No commercial profit was passed, so no tax is calculated. "
                "Take the profit from Accounting. Do not estimate it."
            )
        else:
            profit = Decimal(fiscal)
            if profit <= 0:
                low = Decimal("0")
                high = Decimal("0")
                due = Decimal("0")
                rate_note = "A loss gives no corporate tax in this indication. Loss relief is not applied."
            else:
                low_base = min(profit, _VPB_THRESHOLD)
                high_base = max(profit - _VPB_THRESHOLD, Decimal("0"))
                low = low_base * _VPB_LOW
                high = high_base * _VPB_HIGH
                due = low + high
                rate_note = "Indication only: 19% up to €200,000 and 25.8% above. Not an assessment."
            tax = {
                "low_band": _q(low),
                "high_band": _q(high),
                "indicative_tax": _q(due),
                "note": (
                    f"{rate_note} Participation exemption, innovation box, and fiscal unity "
                    "are included only when the operator listed them as adjustments."
                ),
            }
            note = tax["note"]
    return {
        "ok": True,
        "legal_form": legal_form or None,
        "year": year,
        "regime": regime,
        "commercial_profit": None if commercial is None else _q(commercial),
        "adjustments": lines,
        "adjustments_skipped": skipped,
        "fiscal_profit": fiscal,
        "corporate_tax": tax,
        "note": note,
        "sources": _sources("vpb", "ib"),
    }


def engagement(args: dict[str, Any]) -> dict[str, Any]:
    """What this assignment is, and what Accounto will not sign."""
    kind = str(args.get("kind") or "compile").strip().lower().replace("-", "_")
    legal_form = normalize_legal_form(args.get("legal_form"))
    refused = {
        "review": "A review engagement (beoordelingsopdracht) is an assurance engagement. Accounto does not perform it and does not draft a review conclusion.",
        "audit": "A statutory audit (controleopdracht) is an assurance engagement. Accounto does not perform it and does not draft an audit opinion.",
        "controle": "A statutory audit (controleopdracht) is an assurance engagement. Accounto does not perform it and does not draft an audit opinion.",
        "beoordeling": "A review engagement is an assurance engagement. Accounto does not perform it.",
    }
    if kind in refused:
        return {
            "ok": True,
            "kind": kind,
            "offered": False,
            "signs": False,
            "files": False,
            "note": refused[kind],
            "hand_to": "A registered accountant outside Bokito, when the entity needs assurance.",
            "sources": _sources("nba", "std4410"),
        }
    offered = {
        "compile": (
            "A compilation (samenstellen, NBA Standaard 4410) helps management prepare historical "
            "financial information. It gives no assurance that the information is free of material "
            "misstatement. Management stays responsible for the policies, the estimates, and the annual accounts. "
            "Accounto prepares the questions, the tie-out list, and the pack. A registered accountant signs the compilation report outside Bokito."
        ),
        "tax_return": (
            "A tax-position assignment lists the commercial-to-fiscal bridge and the filing date. "
            "It is not the return itself. Filing stays in the Belastingdienst portal, by a person."
        ),
        "advice": (
            "An advice assignment records findings and questions for management. "
            "It does not produce annual accounts and it does not sign anything."
        ),
    }
    if kind not in offered:
        kind = "compile"
    return {
        "ok": True,
        "kind": kind,
        "legal_form": legal_form or None,
        "offered": True,
        "signs": False,
        "files": False,
        "assurance": "none",
        "management_responsible": True,
        "bookings_stay_with": "Accounting (Boekito)",
        "payments_stay_with": "Banking (Finito)",
        "note": offered[kind],
        "sources": _sources("nba", "std4410"),
    }


def tie_outs(args: dict[str, Any]) -> dict[str, Any]:
    period = str(args.get("period") or "").strip() or None
    items = [
        {
            "id": "debtors",
            "question": "Does the debtors subledger agree to the control account?",
            "figures_from": "Accounting list_outstanding (customers) and list_ledger on the control account.",
        },
        {
            "id": "creditors",
            "question": "Does the creditors subledger agree to the control account?",
            "figures_from": "Accounting list_outstanding (suppliers) and list_ledger on the control account.",
        },
        {
            "id": "vat",
            "question": "Do the filed VAT returns for the year agree to the VAT accounts?",
            "figures_from": "The returns the operator has, tied to Accounting list_ledger. Boekito collects the figures; Accounto checks the tie-out.",
        },
        {
            "id": "bank",
            "question": "Do the bank statements agree to the general-ledger bank accounts?",
            "figures_from": "Banking list_transactions or the statement, and Accounting list_ledger. Matching a line is Boekito or Finito, not a tie-out.",
        },
        {
            "id": "payroll",
            "question": "Do the payroll journals agree to the wage accounts?",
            "figures_from": "The payroll summary the operator supplies. There is no payroll package in this module.",
        },
        {
            "id": "fixed_assets",
            "question": "Does the fixed-asset register, including depreciation, agree to the ledger?",
            "figures_from": "The register the operator supplies, and Accounting list_ledger.",
        },
        {
            "id": "equity",
            "question": "Does opening equity agree to last year's closing equity, after appropriation?",
            "figures_from": "Last year's signed annual accounts and this year's ledger.",
        },
        {
            "id": "related_parties",
            "question": "Are balances and transactions with related parties identified and tied out?",
            "figures_from": "Management. Do not assume there are none.",
        },
    ]
    return {
        "ok": True,
        "period": period,
        "items": items,
        "note": "Each item stays open until the operator or Accounting supplies both sides. Do not mark an item agreed without those figures.",
        "sources": _sources("std4410"),
    }


def estimates(args: dict[str, Any]) -> dict[str, Any]:
    period = str(args.get("period") or "").strip() or None
    items = [
        {"id": "policies", "question": "Which measurement policies apply, and did any change this year?"},
        {"id": "depreciation", "question": "Are useful lives and residual values still reasonable against the asset register?"},
        {"id": "doubtful_debts", "question": "Which open receivables need a provision? Aging comes from Accounting's open items; the judgment is recorded here."},
        {"id": "provisions", "question": "Which provisions (warranty, claims, jubilee, onerous contracts) does management support?"},
        {"id": "accruals", "question": "Which invoices and costs belong in this period but are not booked yet, and which amounts are prepaid?"},
        {"id": "inventory", "question": "Is there inventory, and is the cutoff and valuation supported?"},
        {"id": "going_concern", "question": "Does management expect to continue for at least twelve months? What evidence is there?"},
        {"id": "subsequent", "question": "Did anything after the year-end change the figures or the notes?"},
    ]
    return {
        "ok": True,
        "period": period,
        "items": items,
        "note": "Management owns these judgments. Accounto asks and records the answer. It does not book the accrual or the provision; that booking is a proposal for Boekito.",
        "sources": _sources("std4410", "rj", "bw2"),
    }


def statements_outline(args: dict[str, Any]) -> dict[str, Any]:
    size = str(args.get("size_class") or "").strip().lower()
    framework = str(args.get("framework") or "bw2").strip().lower()
    if framework not in {"bw2", "fiscal"}:
        framework = "bw2"
    outlines = {
        "micro": "Balance sheet and profit and loss with the micro exemptions. Notes are short. Publication is a limited extract. No statutory audit.",
        "small": "Balance sheet, profit and loss, and notes, with the small-entity exemptions. Publication is narrower than the prepared statements. No statutory audit.",
        "medium": "Fuller statements and a management report. A statutory audit is generally required. Accounto does not perform it.",
        "large": "Full Title 9 statements, a management report, and a cash-flow statement. A statutory audit is required. Large entities file digitally via SBR from book year 2025.",
    }
    if size not in outlines:
        body = "Pass a confirmed size class (micro, small, medium, large) before describing the statements."
        size = ""
    else:
        body = outlines[size]
    fiscal_note = (
        "Micro and small entities may often prepare on fiscal policies. Medium and large entities generally use commercial Title 9 and the RJ. "
        "IFRS-EU is a separate choice and can remove the exemptions."
        if framework == "fiscal"
        else "Commercial Title 9, with the RJ used to interpret it. Fiscal policies are a choice mainly for micro and small entities."
    )
    return {
        "ok": True,
        "size_class": size or None,
        "framework": framework,
        "outline": body,
        "framework_note": fiscal_note,
        "signs": False,
        "note": "This is the shape of the pack, not the statements. Do not invent line items or totals.",
        "sources": _sources("bw2", "rj", "sbr", "size"),
    }


def plausibility(args: dict[str, Any]) -> dict[str, Any]:
    period = str(args.get("period") or "").strip() or None
    items = [
        {"id": "revenue_vat", "question": "Does revenue move with the VAT returns for the same period?"},
        {"id": "margin", "question": "Is the gross margin plausible against last year, and is a change explained?"},
        {"id": "costs_assets", "question": "Do costs and the related assets still fit together (for example depreciation and the asset register)?"},
        {"id": "cutoff", "question": "Are sales and purchases around the year-end in the right period?"},
        {"id": "manual", "question": "Which manual journals are large or unusual, and what supports them?"},
        {"id": "non_recurring", "question": "Which amounts will not recur, and are they presented that way?"},
    ]
    return {
        "ok": True,
        "period": period,
        "items": items,
        "note": "These are questions, not findings. A finding needs a figure from Accounting or a document from the operator.",
        "sources": _sources("std4410"),
    }


def dossier_items() -> list[str]:
    return [
        "Trial balance for this year and last year",
        "Bank statements and the reconciliation to the ledger",
        "VAT returns for the year and the tie-out to the VAT accounts",
        "Open debtors and creditors, with aging for the doubtful-debt judgment",
        "Fixed-asset register and the depreciation policy",
        "Payroll summaries tied to the wage accounts",
        "Loan, lease, subsidy, and other contracts that affect this year",
        "Shareholder minutes on the result appropriation",
        "Related-party balances and transactions",
        "Events after the year-end",
    ]
