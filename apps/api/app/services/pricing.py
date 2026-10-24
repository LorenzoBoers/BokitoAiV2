"""Price books: resolve customer resale price and attribute cost quotes.

Resolution order for a quote:
1. tenant override
2. tenant's bound price book rules
3. default price book rules
4. legacy fallback from ResolvedModelCall (catalog + Bokito list + markup)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.pricing import (
    PriceBook,
    PriceBookRule,
    TenantPriceBinding,
    TenantPriceOverride,
)
from app.services import bokito_models
from app.services import model_catalog as catalog_svc

logger = logging.getLogger(__name__)

DEFAULT_BOOK_SLUG = "bokito-standard"

# Rough OpenAI list estimates when we only have units (micro-USD per unit).
_DEFAULT_UNIT_PROVIDER_MICROS = {
    "image": 20_000,  # $0.02
    "audio_second": 100,  # $0.0001
    "realtime_minute": 150_000,  # $0.15 rough
    "tts_char": 15,  # $0.000015
}


@dataclass(frozen=True)
class PriceRuleView:
    match_kind: str
    match_value: str
    pricing_mode: str
    list_input_cents_per_mtok: int | None
    list_output_cents_per_mtok: int | None
    markup_multiplier: float | None
    unit_list_micros: int | None
    provider_unit_micros: int | None
    priority: int
    version: int
    source: str  # override | book | legacy


@dataclass(frozen=True)
class CostQuote:
    provider_cost_micros: int
    customer_cost_micros: int
    price_book_id: UUID | None
    price_rule_version: int
    pricing_mode: str


def _active(row: Any, now: datetime) -> bool:
    start = getattr(row, "effective_from", None)
    end = getattr(row, "effective_to", None)
    if start is not None and start > now:
        return False
    if end is not None and end <= now:
        return False
    return True


def _rule_view(row: Any, source: str) -> PriceRuleView:
    return PriceRuleView(
        match_kind=str(row.match_kind or ""),
        match_value=str(row.match_value or "").strip().lower(),
        pricing_mode=str(row.pricing_mode or "markup_on_provider"),
        list_input_cents_per_mtok=row.list_input_cents_per_mtok,
        list_output_cents_per_mtok=row.list_output_cents_per_mtok,
        markup_multiplier=row.markup_multiplier,
        unit_list_micros=row.unit_list_micros,
        provider_unit_micros=row.provider_unit_micros,
        priority=int(row.priority or 100),
        version=int(getattr(row, "version", 1) or 1),
        source=source,
    )


def _matches(
    rule: PriceRuleView,
    *,
    slug: str,
    provider: str,
    unit_kind: str,
) -> bool:
    kind = rule.match_kind
    value = rule.match_value
    if kind == "managed_tier":
        return slug == value and bokito_models.is_bokito_slug(slug)
    if kind == "catalog_slug":
        return slug == value
    if kind == "provider":
        return provider == value
    if kind == "unit_kind":
        return unit_kind == value
    return False


async def ensure_default_book(session: AsyncSession) -> PriceBook:
    """Idempotent seed of the platform standard book from current env/catalog."""
    existing = (
        await session.execute(
            select(PriceBook).where(PriceBook.slug == DEFAULT_BOOK_SLUG).limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    markup = await catalog_svc.get_markup_multiplier(session)
    book = PriceBook(
        slug=DEFAULT_BOOK_SLUG,
        name="Bokito standard",
        is_default=True,
        currency="usd",
    )
    session.add(book)
    await session.flush()

    rules: list[PriceBookRule] = []
    for slug in bokito_models.MANAGED_CHAT_SLUGS:
        prices = bokito_models.bill_prices_for_slug(slug)
        if prices is None:
            continue
        rules.append(
            PriceBookRule(
                price_book_id=book.id,
                match_kind="managed_tier",
                match_value=slug,
                pricing_mode="fixed_list",
                list_input_cents_per_mtok=prices[0],
                list_output_cents_per_mtok=prices[1],
                markup_multiplier=1.0,
                priority=10,
            )
        )
    # Platform non-Bokito catalog: markup on provider list.
    rules.append(
        PriceBookRule(
            price_book_id=book.id,
            match_kind="provider",
            match_value="*",
            pricing_mode="markup_on_provider",
            markup_multiplier=float(markup),
            priority=900,
        )
    )
    # Unit meters (voice / image) — customer = provider estimate × markup until tuned.
    for unit_kind, prov in _DEFAULT_UNIT_PROVIDER_MICROS.items():
        rules.append(
            PriceBookRule(
                price_book_id=book.id,
                match_kind="unit_kind",
                match_value=unit_kind,
                pricing_mode="fixed_list",
                unit_list_micros=int(round(prov * float(markup))),
                provider_unit_micros=prov,
                priority=50,
            )
        )
    session.add_all(rules)
    await session.flush()
    logger.info("seeded price book %s with %s rules", book.slug, len(rules))
    return book


async def resolve_book(
    session: AsyncSession, tenant_id: UUID | None
) -> PriceBook:
    await ensure_default_book(session)
    if tenant_id is not None:
        bound = (
            await session.execute(
                select(PriceBook)
                .join(TenantPriceBinding, TenantPriceBinding.price_book_id == PriceBook.id)
                .where(TenantPriceBinding.tenant_id == tenant_id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if bound is not None:
            return bound
    default = (
        await session.execute(
            select(PriceBook).where(PriceBook.is_default.is_(True)).limit(1)
        )
    ).scalar_one_or_none()
    if default is not None:
        return default
    return await ensure_default_book(session)


async def _candidate_rules(
    session: AsyncSession, tenant_id: UUID | None, book: PriceBook
) -> list[PriceRuleView]:
    now = utcnow()
    out: list[PriceRuleView] = []
    if tenant_id is not None:
        overrides = (
            await session.execute(
                select(TenantPriceOverride).where(TenantPriceOverride.tenant_id == tenant_id)
            )
        ).scalars().all()
        for row in overrides:
            if _active(row, now):
                out.append(_rule_view(row, "override"))
    book_rules = (
        await session.execute(
            select(PriceBookRule).where(PriceBookRule.price_book_id == book.id)
        )
    ).scalars().all()
    for row in book_rules:
        if _active(row, now):
            out.append(_rule_view(row, "book"))
    out.sort(key=lambda r: (0 if r.source == "override" else 1, r.priority, r.match_kind))
    return out


def _pick_rule(
    rules: list[PriceRuleView],
    *,
    slug: str,
    provider: str,
    unit_kind: str,
) -> PriceRuleView | None:
    slug_l = (slug or "").strip().lower()
    provider_l = (provider or "").strip().lower()
    unit_l = (unit_kind or "token").strip().lower()
    for rule in rules:
        if rule.match_kind == "provider" and rule.match_value == "*":
            # Wildcard provider only for token meters on non-managed catalog.
            if unit_l == "token" and not bokito_models.is_bokito_slug(slug_l):
                return rule
            continue
        if _matches(rule, slug=slug_l, provider=provider_l, unit_kind=unit_l):
            return rule
    return None


def _token_micros(tokens_in: int, tokens_out: int, in_cents: int, out_cents: int) -> int:
    return round(tokens_in * in_cents / 100 + tokens_out * out_cents / 100)


async def quote(
    session: AsyncSession,
    tenant_id: UUID | None,
    *,
    slug: str,
    provider: str,
    billable: bool,
    tokens_in: int = 0,
    tokens_out: int = 0,
    units: int = 0,
    unit_kind: str = "token",
    provider_input_cents: int = 0,
    provider_output_cents: int = 0,
    legacy_bill_input_cents: int | None = None,
    legacy_bill_output_cents: int | None = None,
    legacy_markup: float = catalog_svc.DEFAULT_MARKUP,
) -> CostQuote:
    """Compute provider + customer micros using the tenant's price book."""
    book = await resolve_book(session, tenant_id)
    rules = await _candidate_rules(session, tenant_id, book)
    rule = _pick_rule(rules, slug=slug, provider=provider, unit_kind=unit_kind)

    provider_micros = 0
    customer_micros = 0
    mode = "legacy"
    version = 0

    if unit_kind and unit_kind != "token" and (units or 0) > 0:
        prov_unit = (
            rule.provider_unit_micros
            if rule and rule.provider_unit_micros is not None
            else _DEFAULT_UNIT_PROVIDER_MICROS.get(unit_kind, 0)
        )
        cust_unit = (
            rule.unit_list_micros
            if rule and rule.unit_list_micros is not None
            else int(round(prov_unit * float(legacy_markup)))
        )
        provider_micros = int(units) * int(prov_unit)
        customer_micros = int(units) * int(cust_unit) if billable else 0
        mode = rule.pricing_mode if rule else "unit_default"
        version = rule.version if rule else 0
    else:
        provider_micros = _token_micros(
            tokens_in, tokens_out, provider_input_cents, provider_output_cents
        )
        if rule is None:
            bill_in = (
                legacy_bill_input_cents
                if legacy_bill_input_cents is not None
                else provider_input_cents
            )
            bill_out = (
                legacy_bill_output_cents
                if legacy_bill_output_cents is not None
                else provider_output_cents
            )
            bill_micros = _token_micros(tokens_in, tokens_out, bill_in, bill_out)
            customer_micros = round(bill_micros * legacy_markup) if billable else 0
            mode = "legacy"
        elif rule.pricing_mode == "fixed_list":
            bill_in = (
                rule.list_input_cents_per_mtok
                if rule.list_input_cents_per_mtok is not None
                else provider_input_cents
            )
            bill_out = (
                rule.list_output_cents_per_mtok
                if rule.list_output_cents_per_mtok is not None
                else provider_output_cents
            )
            bill_micros = _token_micros(tokens_in, tokens_out, bill_in, bill_out)
            customer_micros = bill_micros if billable else 0
            mode = "fixed_list"
            version = rule.version
        elif rule.pricing_mode == "passthrough":
            customer_micros = provider_micros if billable else 0
            mode = "passthrough"
            version = rule.version
        else:  # markup_on_provider
            mult = float(rule.markup_multiplier or legacy_markup or 1.0)
            customer_micros = round(provider_micros * mult) if billable else 0
            mode = "markup_on_provider"
            version = rule.version

    return CostQuote(
        provider_cost_micros=int(provider_micros),
        customer_cost_micros=int(customer_micros),
        price_book_id=book.id,
        price_rule_version=version,
        pricing_mode=mode,
    )


async def bind_tenant_book(
    session: AsyncSession,
    tenant_id: UUID,
    price_book_id: UUID,
    *,
    notes: str = "",
) -> TenantPriceBinding:
    book = await session.get(PriceBook, price_book_id)
    if book is None:
        raise ValueError("price book not found")
    existing = (
        await session.execute(
            select(TenantPriceBinding).where(TenantPriceBinding.tenant_id == tenant_id).limit(1)
        )
    ).scalar_one_or_none()
    if existing is None:
        existing = TenantPriceBinding(tenant_id=tenant_id, price_book_id=price_book_id, notes=notes)
        session.add(existing)
    else:
        existing.price_book_id = price_book_id
        existing.notes = notes or existing.notes
    await session.flush()
    return existing


async def list_books(session: AsyncSession) -> list[dict[str, Any]]:
    await ensure_default_book(session)
    books = (await session.execute(select(PriceBook).order_by(PriceBook.slug))).scalars().all()
    out: list[dict[str, Any]] = []
    for book in books:
        rules = (
            await session.execute(
                select(PriceBookRule)
                .where(PriceBookRule.price_book_id == book.id)
                .order_by(PriceBookRule.priority, PriceBookRule.match_kind)
            )
        ).scalars().all()
        out.append(
            {
                "id": str(book.id),
                "slug": book.slug,
                "name": book.name,
                "is_default": book.is_default,
                "currency": book.currency,
                "rules": [
                    {
                        "id": str(r.id),
                        "match_kind": r.match_kind,
                        "match_value": r.match_value,
                        "pricing_mode": r.pricing_mode,
                        "list_input_cents_per_mtok": r.list_input_cents_per_mtok,
                        "list_output_cents_per_mtok": r.list_output_cents_per_mtok,
                        "markup_multiplier": r.markup_multiplier,
                        "unit_list_micros": r.unit_list_micros,
                        "provider_unit_micros": r.provider_unit_micros,
                        "priority": r.priority,
                        "version": r.version,
                    }
                    for r in rules
                ],
            }
        )
    return out


def is_bokito_slug(slug: str) -> bool:
    return bokito_models.is_bokito_slug(slug)
