"""Bokito virtual models: platform-branded models routed to real backing models.

A Bokito model is a normal ``ModelCatalog`` row with ``provider="bokito"`` and
no ``model_id`` of its own. At resolution time (`model_resolution.py`) the call
is routed to a real backing model; the tenant-facing slug, display name, and
usage rows keep the Bokito identity. Customers are billed at the Bokito row's
list price while provider cost follows the backing model; platform-key usage
then applies the invisible resale markup.

Operator-facing tiers (never expose backing providers in product copy):

- Maki — lighter everyday work
- Bokito AI — standard default
- Kong — heavier complex work

Backing family is selected with ``BOKITO_BACKING_FAMILY`` (``mistral`` default,
``claude`` to switch). Both families keep a full map of three tiers so flipping
the env is enough — no catalog/slug changes for operators.

``select_backing_slug`` accepts a ``task_hint`` so a future router can pick a
backing model per task weight without touching call sites.
"""

from __future__ import annotations

BOKITO_PROVIDER = "bokito"

FAMILY_MISTRAL = "mistral"
FAMILY_CLAUDE = "claude"
VALID_FAMILIES = frozenset({FAMILY_MISTRAL, FAMILY_CLAUDE})

# Two complete rows of three backings. Active family comes from settings.
_FAMILY_BACKING: dict[str, dict[str, str]] = {
    FAMILY_MISTRAL: {
        "bokito-maki": "ministral-3b-2512",
        "bokito-ai-3-1": "mistral-medium-latest",
        "bokito-kong": "mistral-large-latest",
    },
    FAMILY_CLAUDE: {
        "bokito-maki": "claude-haiku-4-5",
        "bokito-ai-3-1": "claude-sonnet-5-5",
        "bokito-kong": "claude-opus-5-5",
    },
}

_FAMILY_FALLBACKS: dict[str, dict[str, tuple[str, ...]]] = {
    FAMILY_MISTRAL: {
        "bokito-maki": ("mistral-small-latest", "claude-haiku-4-5", "claude-sonnet-5-5"),
        "bokito-ai-3-1": ("mistral-small-latest", "mistral-large-latest", "claude-sonnet-5-5"),
        "bokito-kong": ("mistral-medium-latest", "claude-opus-5-5", "claude-sonnet-5-5"),
    },
    FAMILY_CLAUDE: {
        "bokito-maki": ("claude-sonnet-5-5", "ministral-3b-2512", "mistral-small-latest"),
        "bokito-ai-3-1": ("claude-sonnet-4-6", "mistral-medium-latest", "claude-opus-5-5"),
        "bokito-kong": ("claude-opus-4-8", "claude-sonnet-5-5", "mistral-large-latest"),
    },
}

_FAMILY_DEFAULTS: dict[str, str] = {
    FAMILY_MISTRAL: "mistral-medium-latest",
    FAMILY_CLAUDE: "claude-sonnet-5-5",
}

# Legacy global list kept for callers that still import the name.
FALLBACK_BACKINGS: tuple[str, ...] = ("mistral-medium-latest", "claude-sonnet-4-6")

# Operator tier hints for Models UI / selectable_chat (not provider names).
TIER_HINTS: dict[str, str] = {
    "bokito-maki": "lighter",
    "bokito-ai-3-1": "standard",
    "bokito-kong": "heavier",
}

MANAGED_CHAT_SLUGS: tuple[str, ...] = ("bokito-maki", "bokito-ai-3-1", "bokito-kong")

DISPLAY_NAMES: dict[str, str] = {
    "bokito-maki": "Maki",
    "bokito-ai-3-1": "Bokito AI",
    "bokito-kong": "Kong",
}


def active_family() -> str:
    """Return the configured backing family (``mistral`` or ``claude``)."""
    try:
        from app.config import get_settings

        raw = get_settings().bokito_backing_family or FAMILY_MISTRAL
    except Exception:
        raw = FAMILY_MISTRAL
    family = str(raw).strip().lower()
    return family if family in VALID_FAMILIES else FAMILY_MISTRAL


def is_bokito_provider(provider: str | None) -> bool:
    return (provider or "").strip().lower() == BOKITO_PROVIDER


def tier_hint(slug: str) -> str:
    return TIER_HINTS.get((slug or "").strip().lower(), "standard")


def display_name_for_slug(slug: str) -> str:
    key = (slug or "").strip().lower()
    return DISPLAY_NAMES.get(key, key or "Bokito AI")


def select_backing_slug(slug: str, *, task_hint: str | None = None) -> str:
    """Return the catalog slug of the real model backing a Bokito model.

    ``task_hint`` is reserved for future task-weight routing; it is accepted
    but unused today so callers can start passing it without a signature change.
    """
    del task_hint
    family = active_family()
    key = (slug or "").strip().lower()
    return _FAMILY_BACKING[family].get(key, _FAMILY_DEFAULTS[family])


def backing_candidates(slug: str) -> list[str]:
    """Primary backing first, then that slug's fallbacks (deduplicated)."""
    family = active_family()
    key = (slug or "").strip().lower()
    primary = select_backing_slug(key)
    out = [primary]
    for candidate in _FAMILY_FALLBACKS[family].get(key, FALLBACK_BACKINGS):
        if candidate not in out:
            out.append(candidate)
    return out


def bill_prices_for_slug(slug: str) -> tuple[int, int] | None:
    """Return (input, output) cents/Mtok for the active family's primary backing.

    Used by catalog refresh so virtual row list prices track the live backing.
    """
    family = active_family()
    key = (slug or "").strip().lower()
    backing = _FAMILY_BACKING[family].get(key)
    if not backing:
        return None
    from app.services.model_catalog import DEFAULT_MODELS

    for spec in DEFAULT_MODELS:
        if spec[0] == backing:
            return int(spec[6]), int(spec[7])
    return None
