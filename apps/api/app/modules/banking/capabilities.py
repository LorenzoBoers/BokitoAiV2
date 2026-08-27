"""Planned banking capabilities. No vendor adapter yet."""

from __future__ import annotations

from typing import Any

CAPABILITIES: dict[str, dict[str, bool]] = {
    "gocardless_bank": {
        "docs_only": True,
        "accounts.read": True,
        "balances.read": True,
        "transactions.read": True,
        "payments.write": False,
    },
    "tink": {
        "docs_only": True,
        "accounts.read": True,
        "balances.read": True,
        "transactions.read": True,
        "payments.write": False,
    },
    "yapily": {
        "docs_only": True,
        "accounts.read": True,
        "balances.read": True,
        "transactions.read": True,
        "payments.write": False,
    },
    "knab": {
        "docs_only": True,
        "accounts.read": True,
        "balances.read": True,
        "transactions.read": True,
        "payments.write": False,
    },
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
