"""Archive rules. They do not open Drive and they do not decide the year file.

The Belastingdienst requires invoices to be kept for 7 years, and invoices
about immovable property for 10 years, in the form in which they were sent
or received. The AVG says personal data is not kept longer than necessary;
the tax duty is a reason for those years, not a reason to keep it forever.
"""

from __future__ import annotations

from typing import Any

_KEEP = {
    "title": "Belastingdienst — facturen bewaren",
    "url": "https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/administratie_bijhouden/facturen_maken/uw_facturen_bewaren",
}
_PRIVACY = {
    "title": "Ondernemersplein — facturen, bewaarplicht en privacy",
    "url": "https://ondernemersplein.overheid.nl/wetten-en-regels/facturen-maken-en-versturen/",
}

_OWNERS = {
    "invoice": "Accounting books it. Documents keeps the file for the retention period.",
    "receipt": "Accounting books it. Documents keeps the file for the retention period.",
    "bank_statement": "Banking reads the lines. Accounting matches them. Accounto ties the year-end balance. Documents keeps the file.",
    "contract": "Documents keeps the file. The specialist who must act on it asks for the clause. Do not book from a contract alone.",
    "annual_accounts": "Accounto owns the year file. Documents only stores the signed copy.",
    "payroll": "Accounting uses the totals on the wage accounts. There is no payroll module. Documents keeps the file.",
    "other": "Keep it only when someone can say why. Do not drop it into the year file by default.",
}


def retention(args: dict[str, Any]) -> dict[str, Any]:
    kind = str(args.get("kind") or "invoice").strip().lower()
    immovable = bool(args.get("immovable_property"))
    years = 10 if immovable or kind in {"property", "immovable"} else 7
    return {
        "ok": True,
        "kind": kind,
        "years": years,
        "form": "Keep the invoice in the form in which it was sent or received. A scan replaces the paper only when it is a complete and authentic copy.",
        "privacy": (
            "Invoices contain personal data. The tax retention period is a reason to keep them. "
            "After those years, keeping the personal data needs a separate reason. Do not promise a shorter period."
        ),
        "note": f"Keep this record for {years} years. Accounto asks which documents the year file still needs. This tool only says how long the file stays.",
        "sources": [_KEEP, _PRIVACY],
    }


def classify(args: dict[str, Any]) -> dict[str, Any]:
    kind = str(args.get("kind") or "other").strip().lower()
    if kind not in _OWNERS:
        kind = "other"
    return {
        "ok": True,
        "kind": kind,
        "owner": _OWNERS[kind],
        "note": "Classifying a file does not file the ticket and does not book it.",
        "sources": [_KEEP],
    }


def cite(args: dict[str, Any]) -> dict[str, Any]:
    title = str(args.get("title") or "").strip()
    file_id = str(args.get("file_id") or "").strip()
    quote = str(args.get("quote") or "").strip()
    missing = [name for name, value in (("title", title), ("file_id", file_id)) if not value]
    return {
        "ok": True,
        "citation": {
            "title": title or None,
            "file_id": file_id or None,
            "quote": quote or None,
        },
        "usable": not missing and bool(quote),
        "missing": missing + ([] if quote else ["quote"]),
        "note": "Cite the file you already read. Do not invent a sentence that was not in it. Reading the file is get_content.",
        "sources": [_KEEP],
    }


WORKPAPERS = {
    "retention": retention,
    "classify": classify,
    "cite": cite,
}
