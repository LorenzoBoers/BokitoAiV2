"""Planned investing capabilities. No vendor adapter yet."""

from __future__ import annotations

from typing import Any

CAPABILITIES: dict[str, dict[str, bool]] = {
    "twelve_data": {"docs_only": True, "quotes.read": True, "positions.read": False},
    "alpaca": {"docs_only": True, "quotes.read": True, "positions.read": True, "orders.write": False},
    "bitvavo": {"docs_only": True, "quotes.read": True, "positions.read": True, "orders.write": False},
    "tradingview_alerts": {"docs_only": True, "alerts.read": True},
}


def matrix_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for vendor, caps in CAPABILITIES.items():
        docs_only = bool(caps.get("docs_only"))
        for capability, supported in caps.items():
            if capability == "docs_only":
                continue
            rows.append(
                {
                    "vendor": vendor,
                    "capability": capability,
                    "supported": bool(supported),
                    "docs_only": docs_only,
                }
            )
    return rows
