"""Bokito virtual models: platform-branded models routed to real backing models.

A Bokito model is a normal ``ModelCatalog`` row with ``provider="bokito"`` and
no ``model_id`` of its own. At resolution time (`model_resolution.py`) the call
is routed to a real backing model; the tenant-facing slug, display name, and
usage rows keep the Bokito identity. Customers are billed at the Bokito row's
list price while provider cost follows the backing model, so cheaper backing
models translate directly into margin.

Bokito is EU-hosted by default: the primary backing model is Mistral (Paris).
When the platform has no Mistral key yet, resolution walks ``FALLBACK_BACKINGS``
so existing installs keep answering; the Models page shows which region the
managed model actually runs in, so the fallback is never silent.

Today the routing is a static map. ``select_backing_slug`` accepts a
``task_hint`` so a future router can pick a backing model per task weight
(light triage on a small model, heavy reasoning on a large one) without
touching call sites.
"""

from __future__ import annotations

BOKITO_PROVIDER = "bokito"

# Virtual slug -> backing catalog slug. The backing row must be a real
# provider model (mistral/anthropic/openai) present in the platform catalog.
_BACKING: dict[str, str] = {
    "bokito-ai-3-1": "mistral-medium-latest",
}

_DEFAULT_BACKING = "mistral-medium-latest"

# Tried in order when the primary backing has no usable platform key. US
# providers only ever run the managed model as a visible fallback.
FALLBACK_BACKINGS: tuple[str, ...] = ("claude-sonnet-4-6",)


def is_bokito_provider(provider: str | None) -> bool:
    return (provider or "").strip().lower() == BOKITO_PROVIDER


def select_backing_slug(slug: str, *, task_hint: str | None = None) -> str:
    """Return the catalog slug of the real model backing a Bokito model.

    ``task_hint`` is reserved for future task-weight routing; it is accepted
    but unused today so callers can start passing it without a signature change.
    """
    del task_hint
    return _BACKING.get((slug or "").strip().lower(), _DEFAULT_BACKING)


def backing_candidates(slug: str) -> list[str]:
    """Primary backing first, then the fallbacks (deduplicated, order kept)."""
    primary = select_backing_slug(slug)
    out = [primary]
    for candidate in FALLBACK_BACKINGS:
        if candidate not in out:
            out.append(candidate)
    return out
