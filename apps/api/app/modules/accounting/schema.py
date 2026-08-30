"""Canonical accounting objects and the module response envelope.

Objects are the intersection of what the connected packages really support
(see ``capabilities.py``). Canonical refs stay stable across vendors:
``connection_id`` + ``company_id`` + ``object`` + ``vendor_id`` and an
optional human ``display_id`` (invoice number, debtor number).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

DocumentKind = Literal["sales_invoice", "purchase_bill", "credit_note"]
DocumentStatus = Literal["draft", "open", "paid", "overdue", "void", "unknown"]
PartyRole = Literal["customer", "supplier"]


class Ref(BaseModel):
    """Stable cross-vendor reference for one accounting object."""

    connection_id: str
    company_id: str
    object: str
    vendor_id: str
    display_id: str = ""


class Company(BaseModel):
    id: str
    name: str
    vendor: str
    connection_id: str
    external_id: str = ""


class Party(BaseModel):
    id: str
    role: PartyRole
    name: str
    email: str = ""
    phone: str = ""
    address: str = ""
    number: str = ""
    open_balance: float | None = None
    currency: str = ""


class DocumentLine(BaseModel):
    description: str = ""
    amount: float | None = None


class Document(BaseModel):
    id: str
    kind: DocumentKind
    status: DocumentStatus = "unknown"
    number: str = ""
    party_id: str = ""
    party_name: str = ""
    total: float | None = None
    currency: str = ""
    date: str = ""
    due_date: str = ""
    lines: list[DocumentLine] = Field(default_factory=list)


class Account(BaseModel):
    id: str
    number: str = ""
    name: str = ""
    balance: float | None = None
    currency: str = ""


class LedgerLine(BaseModel):
    id: str = ""
    account: str = ""
    description: str = ""
    debit: float | None = None
    credit: float | None = None
    date: str = ""
    period: str = ""


class Outstanding(BaseModel):
    document_id: str
    kind: DocumentKind
    party_name: str = ""
    amount: float | None = None
    currency: str = ""
    due_date: str = ""
    overdue: bool = False


class BankMutation(BaseModel):
    id: str
    date: str = ""
    amount: float | None = None
    currency: str = ""
    counterparty: str = ""
    description: str = ""
    state: str = ""


class TaxRate(BaseModel):
    id: str
    name: str = ""
    percentage: float | None = None


class PartyUpsert(BaseModel):
    """Vendor-neutral customer/supplier create-or-update payload.

    ``party_id`` empty means create; set means update that party.
    """

    role: PartyRole = "customer"
    party_id: str = ""
    name: str
    email: str = ""
    phone: str = ""
    street: str = ""
    postal_code: str = ""
    city: str = ""
    country: str = ""


class JournalLine(BaseModel):
    account: str
    description: str = ""
    debit: float | None = None
    credit: float | None = None
    tax_code: str = ""


class JournalEntry(BaseModel):
    """Vendor-neutral journal booking (KING CreateJournaalpost, Exact
    GeneralJournalEntries, BLA vouchers). Lines must balance."""

    journal: str = ""  # dagboek / journal code; vendor default when empty
    date: str = ""  # YYYY-MM-DD; vendor default when empty
    description: str = ""
    reference: str = ""
    lines: list[JournalLine] = Field(default_factory=list)


class SalesInvoiceDraft(BaseModel):
    """Vendor-neutral sales invoice draft (Moneybird sales_invoices,
    Exact SalesEntries, SnelStart verkoopboekingen)."""

    party_id: str
    reference: str = ""
    date: str = ""
    due_date: str = ""
    currency: str = ""
    lines: list[DocumentLine] = Field(default_factory=list)


class PaymentRegistration(BaseModel):
    """Vendor-neutral payment registration against one document."""

    document_id: str
    amount: float
    date: str = ""
    account: str = ""


# Apply verb -> canonical payload model used to validate before dispatch.
WRITE_PAYLOADS: dict[str, type[BaseModel]] = {
    "apply_party": PartyUpsert,
    "apply_booking": JournalEntry,
    "apply_document": SalesInvoiceDraft,
    "apply_payment": PaymentRegistration,
}


class ModuleError(BaseModel):
    """Structured failure envelope; ``unsupported`` carries a capability key."""

    ok: Literal[False] = False
    code: str
    message: str = ""
    capability: str = ""
    hint: str = ""


def unsupported(capability: str, vendor: str, hint: str = "") -> dict[str, Any]:
    return ModuleError(
        code="unsupported",
        capability=capability,
        message=f"The connected package ({vendor}) does not support {capability}.",
        hint=hint or "Use summarize or list_documents instead, or connect a package that supports this.",
    ).model_dump()


def module_error(code: str, message: str) -> dict[str, Any]:
    return ModuleError(code=code, message=message).model_dump()


def ok_result(**payload: Any) -> dict[str, Any]:
    return {"ok": True, **payload}
