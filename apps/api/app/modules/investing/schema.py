"""Canonical investing objects. No adapters in this slice."""

from __future__ import annotations

from pydantic import BaseModel


class Position(BaseModel):
    id: str
    symbol: str
    quantity: float | None = None
    currency: str = ""


class Quote(BaseModel):
    symbol: str
    price: float | None = None
    currency: str = ""
    as_of: str = ""


class WatchlistItem(BaseModel):
    symbol: str
    name: str = ""
