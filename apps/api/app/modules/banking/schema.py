"""Canonical banking objects. No adapters in this slice."""

from __future__ import annotations

from pydantic import BaseModel


class BankAccount(BaseModel):
    id: str
    name: str = ""
    iban: str = ""
    currency: str = ""
    balance: float | None = None


class BankTransaction(BaseModel):
    id: str
    account_id: str = ""
    amount: float | None = None
    currency: str = ""
    booked_at: str = ""
    counterparty: str = ""
    description: str = ""
