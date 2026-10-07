"""Bokito virtual models: platform-branded models routed to real backing models.

A Bokito model is a normal ``ModelCatalog`` row with ``provider="bokito"`` and
no ``model_id`` of its own. At resolution time (`model_resolution.py`) the call
is routed to a real backing model; the tenant-facing slug, display name, and
usage rows keep the Bokito identity. Customers are billed at fixed list prices
from env (``BOKITO_*_COST_PER_MTOK_CENTS``); provider cost follows the backing
model. Managed tiers do not apply ``TOKEN_MARKUP_MULTIPLIER``.

Operator-facing tiers (never expose backing providers in product copy):

- Maki — lighter everyday work
- Bokito — standard default
- Kong — heavier complex work

Backing routes
--------------
Each tier maps to an ordered chain of ``ModelCatalog`` slugs. The provider of
a step is the catalog row's provider, so a new provider is a catalog row plus
a platform key (or a tenant BYOK key) — no code change. Resolution walks the
chain and takes the first step with a usable key (tenant key first, then
platform key, skipping keys parked by ``provider_health``).

Chains come from, highest first:

1. ``platform_settings["bokito_backings"]`` — staff-editable at runtime via
   ``PUT /api/staff/bokito-backings`` (cached per process for a few seconds).
2. ``BOKITO_BACKINGS`` env, JSON ``{"bokito-ai-3-1": ["mistral-medium-latest", ...]}``.
3. ``DEFAULT_BACKINGS`` below (EU, Mistral only).

Each source may override only some tiers; the rest fall through.

``select_backing_slug`` accepts a ``task_hint`` so a future router can pick a
backing model per task weight without touching call sites.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

BOKITO_PROVIDER = "bokito"
BACKINGS_SETTING_KEY = "bokito_backings"

DEFAULT_BACKINGS: dict[str, tuple[str, ...]] = {
    "bokito-maki": ("ministral-3b-2512", "mistral-small-latest"),
    "bokito-ai-3-1": ("mistral-medium-latest", "mistral-large-4", "mistral-small-latest"),
    "bokito-kong": ("mistral-large-4", "mistral-large-latest", "mistral-medium-latest"),
}
DEFAULT_TIER = "bokito-ai-3-1"

_CACHE_TTL_S = 15.0
# Staff overrides from the DB; ``None`` until first load in this process.
_db_routes: dict[str, tuple[str, ...]] | None = None
_db_loaded_at = 0.0

# Operator tier hints for Models UI / selectable_chat (not provider names).
TIER_HINTS: dict[str, str] = {
    "bokito-maki": "lighter",
    "bokito-ai-3-1": "standard",
    "bokito-kong": "heavier",
}

MANAGED_CHAT_SLUGS: tuple[str, ...] = ("bokito-maki", "bokito-ai-3-1", "bokito-kong")

DISPLAY_NAMES: dict[str, str] = {
    "bokito-maki": "Maki",
    "bokito-ai-3-1": "Bokito",
    "bokito-kong": "Kong",
}


def parse_routes(raw: Any) -> dict[str, tuple[str, ...]]:
    """Normalize ``{tier: [slug, ...]}`` (dict or JSON text); drops unknown tiers."""
    if isinstance(raw, str):
        if not raw.strip():
            return {}
        raw = json.loads(raw)
    if not isinstance(raw, dict):
        raise ValueError("Backing routes must be an object of tier -> list of model slugs")
    out: dict[str, tuple[str, ...]] = {}
    for tier, chain in raw.items():
        key = str(tier).strip().lower()
        if key not in MANAGED_CHAT_SLUGS:
            raise ValueError(f"Unknown Bokito tier: {tier}")
        if isinstance(chain, str):
            chain = [chain]
        if not isinstance(chain, (list, tuple)):
            raise ValueError(f"Chain for {tier} must be a list of model slugs")
        steps: list[str] = []
        for step in chain:
            slug = str(step).strip()
            if slug and slug not in steps:
                steps.append(slug)
        if not steps:
            raise ValueError(f"Chain for {tier} is empty")
        out[key] = tuple(steps)
    return out


def _env_routes() -> dict[str, tuple[str, ...]]:
    try:
        from app.config import get_settings

        return parse_routes(get_settings().bokito_backings or "")
    except Exception as exc:  # noqa: BLE001 — a bad env must not break chat
        logger.warning("Ignoring invalid BOKITO_BACKINGS: %s", exc)
        return {}


def effective_routes() -> dict[str, tuple[str, ...]]:
    """Defaults, overlaid by env, overlaid by the staff DB setting."""
    routes = dict(DEFAULT_BACKINGS)
    routes.update(_env_routes())
    if _db_routes:
        routes.update(_db_routes)
    return routes


def set_cached_db_routes(routes: dict[str, tuple[str, ...]] | None) -> None:
    global _db_routes, _db_loaded_at
    _db_routes = routes or {}
    _db_loaded_at = time.monotonic()


def reset_route_cache() -> None:
    global _db_routes, _db_loaded_at
    _db_routes = None
    _db_loaded_at = 0.0


async def refresh_routes(session: Any, *, force: bool = False) -> dict[str, tuple[str, ...]]:
    """Load staff overrides from ``platform_settings`` (cached for a few seconds)."""
    if not force and _db_routes is not None and time.monotonic() - _db_loaded_at < _CACHE_TTL_S:
        return effective_routes()
    from sqlalchemy import select

    from app.models.model_catalog import PlatformSetting

    result = await session.execute(
        select(PlatformSetting.value).where(PlatformSetting.key == BACKINGS_SETTING_KEY)
    )
    raw = result.scalar_one_or_none()
    try:
        set_cached_db_routes(parse_routes(raw or ""))
    except (ValueError, json.JSONDecodeError) as exc:
        logger.warning("Ignoring invalid %s setting: %s", BACKINGS_SETTING_KEY, exc)
        set_cached_db_routes({})
    return effective_routes()


def route_sources() -> dict[str, str]:
    """Where each tier's chain comes from: ``setting`` | ``env`` | ``default``."""
    env = _env_routes()
    out: dict[str, str] = {}
    for tier in MANAGED_CHAT_SLUGS:
        if _db_routes and tier in _db_routes:
            out[tier] = "setting"
        elif tier in env:
            out[tier] = "env"
        else:
            out[tier] = "default"
    return out


def is_bokito_provider(provider: str | None) -> bool:
    return (provider or "").strip().lower() == BOKITO_PROVIDER


def tier_hint(slug: str) -> str:
    return TIER_HINTS.get((slug or "").strip().lower(), "standard")


def display_name_for_slug(slug: str) -> str:
    key = (slug or "").strip().lower()
    return DISPLAY_NAMES.get(key, key or "Bokito")


def select_backing_slug(slug: str, *, task_hint: str | None = None) -> str:
    """Return the catalog slug of the real model backing a Bokito model.

    ``task_hint`` is reserved for future task-weight routing; it is accepted
    but unused today so callers can start passing it without a signature change.
    """
    del task_hint
    return backing_candidates(slug)[0]


def backing_candidates(slug: str) -> list[str]:
    """The tier's backing chain: primary first, then fallbacks in order."""
    routes = effective_routes()
    key = (slug or "").strip().lower()
    chain = routes.get(key) or routes.get(DEFAULT_TIER) or DEFAULT_BACKINGS[DEFAULT_TIER]
    return list(chain)


# Env field pairs on Settings for each managed slug (input, output) cents/Mtok.
_LIST_PRICE_SETTINGS: dict[str, tuple[str, str]] = {
    "bokito-maki": (
        "bokito_maki_input_cost_per_mtok_cents",
        "bokito_maki_output_cost_per_mtok_cents",
    ),
    "bokito-ai-3-1": (
        "bokito_ai_input_cost_per_mtok_cents",
        "bokito_ai_output_cost_per_mtok_cents",
    ),
    "bokito-kong": (
        "bokito_kong_input_cost_per_mtok_cents",
        "bokito_kong_output_cost_per_mtok_cents",
    ),
}

# Fallback ladder when settings are unavailable (seed / tests without env).
_DEFAULT_LIST_PRICES: dict[str, tuple[int, int]] = {
    "bokito-maki": (10, 10),
    "bokito-ai-3-1": (50, 150),
    "bokito-kong": (150, 750),
}


def bill_prices_for_slug(slug: str) -> tuple[int, int] | None:
    """Return fixed (input, output) cents/Mtok list prices for a managed tier.

    Prices come from env (Settings), not from the silent backing model, so the
    operator ladder stays lighter < standard < heavier regardless of provider.
    """
    key = (slug or "").strip().lower()
    fields = _LIST_PRICE_SETTINGS.get(key)
    if not fields:
        return None
    try:
        from app.config import get_settings

        settings = get_settings()
        cin = int(getattr(settings, fields[0]))
        cout = int(getattr(settings, fields[1]))
        return max(0, cin), max(0, cout)
    except Exception:
        return _DEFAULT_LIST_PRICES.get(key)
