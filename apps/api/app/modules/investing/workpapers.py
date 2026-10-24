"""Market workpapers. They do not quote a price and they do not recommend a trade.

The AFM treats advice as a personal recommendation of a specific financial
instrument to a specific client (Wft article 1:1, and the AFM note on when
comparison becomes advice). Execution only means the client decides.
Investo may draft the order the operator already chose. It may not say that
a named instrument is suitable for this workspace.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

_AFM_ADVICE = {
    "title": "AFM — wanneer is iets advies",
    "url": "https://www.afm.nl/nl-nl/sector/adviseurs-bemiddelaars-en-gevolmachtigde-agenten/vergunning-nodig/het-verschil-tussen-adviseren-en-bemiddelen",
}
_AFM_EXEC = {
    "title": "AFM — execution only",
    "url": "https://www.afm.nl/nl-nl/consumenten/themas/financieel-advies/execution-only-zonder-advies",
}


def _q(amount: Decimal) -> str:
    return str(amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def advice_boundary(args: dict[str, Any]) -> dict[str, Any]:
    kind = str(args.get("kind") or "information").strip().lower()
    asks_fit = bool(args.get("asks_whether_it_fits"))
    names_instrument = bool(str(args.get("instrument") or "").strip())
    personal = kind in {"recommendation", "advice", "advies"} or asks_fit
    if personal and names_instrument:
        return {
            "ok": True,
            "offered": False,
            "kind": "advice",
            "note": (
                "A recommendation of a specific instrument for this workspace is investment advice. "
                "Investo does not give it and does not hold itself out as licensed to give it. "
                "Explain public information, or draft the order the operator has already chosen."
            ),
            "sources": [_AFM_ADVICE, _AFM_EXEC],
        }
    if personal:
        return {
            "ok": True,
            "offered": False,
            "kind": "advice",
            "note": "Asked whether something fits this workspace. That is advice. Refuse it and ask the operator which order they already want drafted.",
            "sources": [_AFM_ADVICE, _AFM_EXEC],
        }
    return {
        "ok": True,
        "offered": True,
        "kind": "information" if kind != "order_draft" else "order_draft",
        "note": (
            "Public information and an order the operator already chose are in scope. "
            "Do not add that the instrument is suitable, cheap, or likely to rise. "
            "No broker is connected, so there is no live quote and no execution."
        ),
        "sources": [_AFM_ADVICE, _AFM_EXEC],
    }


def order_ticket(args: dict[str, Any]) -> dict[str, Any]:
    """Fields an order proposal needs. The operator must already have chosen the trade."""
    chosen = bool(args.get("operator_chose"))
    fields = {
        "instrument": str(args.get("instrument") or "").strip(),
        "side": str(args.get("side") or "").strip().lower(),
        "quantity": args.get("quantity"),
        "order_type": str(args.get("order_type") or "").strip().lower(),
    }
    missing = [name for name, value in fields.items() if value in (None, "")]
    if fields["side"] not in {"", "buy", "sell"}:
        missing.append("side")
    if fields["order_type"] not in {"", "market", "limit"}:
        missing.append("order_type")
    if fields["order_type"] == "limit" and args.get("limit_price") in (None, ""):
        missing.append("limit_price")
    if not chosen:
        missing.append("operator_chose")
    return {
        "ok": True,
        "ready_to_propose": not missing,
        "missing": missing,
        "executes": False,
        "note": (
            "propose_order only records the decision. Nothing is sent to a broker. "
            "No market-data connector is live, so do not fill a missing price yourself."
        ),
        "sources": [_AFM_EXEC],
    }


def concentration(args: dict[str, Any]) -> dict[str, Any]:
    """Share of each position in the total the caller supplied. No house limit."""
    rows = args.get("positions") or []
    if not isinstance(rows, list):
        raise ValueError("positions must be a list.")
    parsed: list[tuple[str, Decimal]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = row.get("value")
        if value in (None, ""):
            continue
        try:
            amount = Decimal(str(value))
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"Not a number: {value}") from exc
        if amount < 0:
            raise ValueError("Position values must be zero or positive.")
        parsed.append((str(row.get("instrument") or "position").strip() or "position", amount))
    total = sum((amount for _, amount in parsed), Decimal("0"))
    if total == 0:
        return {
            "ok": True,
            "positions": [],
            "note": "No position values were passed, so no weights are calculated. Do not invent them, and do not treat a weight as advice.",
            "sources": [_AFM_EXEC],
        }
    weights = [
        {"instrument": name, "value": _q(amount), "weight": _q(amount / total * Decimal("100"))}
        for name, amount in parsed
    ]
    return {
        "ok": True,
        "positions": weights,
        "total": _q(total),
        "house_limit": None,
        "note": "Weights only. There is no house limit, and a large weight is not a recommendation to sell.",
        "sources": [_AFM_EXEC],
    }


WORKPAPERS = {
    "advice_boundary": advice_boundary,
    "order_ticket": order_ticket,
    "concentration": concentration,
}
