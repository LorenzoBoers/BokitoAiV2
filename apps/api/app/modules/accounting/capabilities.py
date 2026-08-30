"""Capability matrix: what each accounting vendor can actually serve.

Sources (checked against the public API references):

- KING Accountancy — Cloudswitch SOAP (read-only V1): DEB/CRED/GRB tables,
  GetAdmInfo, last-booking dates. No invoice objects, no bank mutations,
  no tax-rate reads through the current toolset.
- Björn Lundén — BLA REST: customers, suppliers, sales/purchase invoices,
  journal entries, chart of accounts. No bank mutations through the SP API.
- Moneybird — REST v2: contacts, sales invoices, purchase documents,
  financial mutations (bank, read + link), tax rates.
- Exact Online — docs-only row (no adapter in this slice): full CRUD on
  invoices/GL/receivables, but invoice-bank matching is not exposed via REST.
- Snelstart — docs-only row: relations, sales/purchase, GL, VAT, bank
  statements; requires the certification track before an adapter ships.
"""

from __future__ import annotations

from typing import Any

# Capability keys use dotted read/write scopes so misses can be reported
# precisely, e.g. {"code": "unsupported", "capability": "bank_mutations.read"}.
CAPABILITIES: dict[str, dict[str, bool]] = {
    "king": {
        "companies.read": True,
        "parties.customers.read": True,
        "parties.suppliers.read": True,
        "documents.sales.read": False,
        "documents.purchase.read": False,
        "accounts.read": True,
        "ledger.read": True,  # limited: last-booking dates/periods only
        "outstanding.read": False,
        "bank_mutations.read": False,
        "tax_rates.read": False,
        # Writes: Cloudswitch Create/UpdateStamTabelRecord (DEB/CRED) and
        # CreateJournaalpost. Behind the platform+tenant write switch.
        "parties.write": True,
        "journal.write": True,
        "documents.sales.write": False,
        "payments.write": False,
    },
    "bjorn_lunden": {
        "companies.read": True,
        "parties.customers.read": True,
        "parties.suppliers.read": True,
        "documents.sales.read": True,
        "documents.purchase.read": True,
        "accounts.read": True,
        "ledger.read": True,
        "outstanding.read": True,  # derived from open invoice state
        "bank_mutations.read": False,
        "tax_rates.read": False,
        # BLA REST supports vouchers/invoices; adapter write slice not built yet.
        "parties.write": False,
        "journal.write": False,
        "documents.sales.write": False,
        "payments.write": False,
    },
    "moneybird": {
        "companies.read": True,
        "parties.customers.read": True,
        "parties.suppliers.read": True,
        "documents.sales.read": True,
        "documents.purchase.read": True,
        "accounts.read": True,
        "ledger.read": False,  # no raw journal read in v2
        "outstanding.read": True,
        "bank_mutations.read": True,
        "tax_rates.read": True,
        # Moneybird: contacts + sales invoices + payments via REST; no free
        # journal entries. Adapter write slice not built yet.
        "parties.write": False,
        "journal.write": False,
        "documents.sales.write": False,
        "payments.write": False,
    },
    # Docs-only rows: schema-ready, no adapter yet.
    "exact_online": {
        "docs_only": True,
        "companies.read": True,
        "parties.customers.read": True,
        "parties.suppliers.read": True,
        "documents.sales.read": True,
        "documents.purchase.read": True,
        "accounts.read": True,
        "ledger.read": True,
        "outstanding.read": True,
        "bank_mutations.read": True,  # BankEntries exist; invoice matching does not
        "tax_rates.read": True,
        "parties.write": False,
        "journal.write": False,
        "documents.sales.write": False,
        "payments.write": False,
    },
    "snelstart": {
        "docs_only": True,
        "companies.read": True,
        "parties.customers.read": True,
        "parties.suppliers.read": True,
        "documents.sales.read": True,
        "documents.purchase.read": True,
        "accounts.read": True,
        "ledger.read": True,
        "outstanding.read": True,
        "bank_mutations.read": True,
        "tax_rates.read": True,
        "parties.write": False,
        "journal.write": False,
        "documents.sales.write": False,
        "payments.write": False,
    },
}

# Verb -> capability required to serve it.
VERB_CAPABILITY: dict[str, str] = {
    "list_companies": "companies.read",
    "get_company": "companies.read",
    "search_parties": "parties.customers.read",
    "get_party": "parties.customers.read",
    "list_documents": "documents.sales.read",
    "get_document": "documents.sales.read",
    "list_accounts": "accounts.read",
    "get_account": "accounts.read",
    "list_ledger": "ledger.read",
    "list_outstanding": "outstanding.read",
    "list_bank_mutations": "bank_mutations.read",
    # summarize degrades gracefully per capability; only companies required.
    "summarize": "companies.read",
    # Apply verbs execute an approved write through the adapter. They are
    # additionally guarded by the platform + tenant write switches.
    "apply_party": "parties.write",
    "apply_booking": "journal.write",
    "apply_document": "documents.sales.write",
    "apply_payment": "payments.write",
}


def vendor_supports(vendor: str, capability: str) -> bool:
    row = CAPABILITIES.get(vendor) or {}
    return bool(row.get(capability))


def capability_for_verb(verb: str) -> str | None:
    return VERB_CAPABILITY.get(verb)


def matrix_rows() -> list[dict[str, Any]]:
    """Flat rows for docs / UI: vendor, capability, supported."""
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
