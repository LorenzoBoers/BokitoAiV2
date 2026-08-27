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
