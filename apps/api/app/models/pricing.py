"""Price books: platform and per-tenant resale rules for AI usage."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.core.time import utcnow


class PriceBook(SQLModel, table=True):
    __tablename__ = "price_books"

    id: UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    slug: str = Field(max_length=64, index=True)
    name: str = Field(max_length=120)
    is_default: bool = Field(default=False, index=True)
    currency: str = Field(default="usd", max_length=8)
    created_at: datetime = Field(default_factory=utcnow)


class PriceBookRule(SQLModel, table=True):
    __tablename__ = "price_book_rules"

    id: UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    price_book_id: UUID = Field(foreign_key="price_books.id", index=True)
    # managed_tier | catalog_slug | provider | unit_kind
    match_kind: str = Field(default="catalog_slug", max_length=32)
    match_value: str = Field(default="", max_length=120)
    # fixed_list | markup_on_provider | passthrough
    pricing_mode: str = Field(default="markup_on_provider", max_length=32)
    list_input_cents_per_mtok: Optional[int] = None
    list_output_cents_per_mtok: Optional[int] = None
    markup_multiplier: Optional[float] = None
    unit_list_micros: Optional[int] = None
    provider_unit_micros: Optional[int] = None
    priority: int = Field(default=100)
    version: int = Field(default=1)
    effective_from: Optional[datetime] = None
    effective_to: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)


class TenantPriceBinding(SQLModel, table=True):
    __tablename__ = "tenant_price_bindings"

    id: UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: UUID = Field(foreign_key="tenants.id", index=True)
    price_book_id: UUID = Field(foreign_key="price_books.id")
    notes: str = Field(default="", max_length=255)
    created_at: datetime = Field(default_factory=utcnow)


class TenantPriceOverride(SQLModel, table=True):
    __tablename__ = "tenant_price_overrides"

    id: UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: UUID = Field(foreign_key="tenants.id", index=True)
    match_kind: str = Field(default="catalog_slug", max_length=32)
    match_value: str = Field(default="", max_length=120)
    pricing_mode: str = Field(default="fixed_list", max_length=32)
    list_input_cents_per_mtok: Optional[int] = None
    list_output_cents_per_mtok: Optional[int] = None
    markup_multiplier: Optional[float] = None
    unit_list_micros: Optional[int] = None
    provider_unit_micros: Optional[int] = None
    priority: int = Field(default=10)
    version: int = Field(default=1)
    effective_from: Optional[datetime] = None
    effective_to: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)
