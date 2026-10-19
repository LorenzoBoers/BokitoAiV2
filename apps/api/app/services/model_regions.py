"""Hosting region of LLM providers: where prompts and completions are processed.

Bokito is EU-hosted by default. The managed Bokito AI model runs on an EU
provider (Mistral, Paris); US providers (Anthropic, OpenAI) are available as
BYOK connections or, per workspace, as an explicit opt-in for platform-key
usage. The region is derived from the provider type (and, for OpenAI-compatible
endpoints, from the base URL host) so it needs no extra storage on catalog or
connection rows. Usage rows store the region at write time because the backing
model behind a virtual slug can change over time.
"""

from __future__ import annotations

from urllib.parse import urlparse

REGION_EU = "eu"
REGION_US = "us"
REGION_UNKNOWN = "unknown"

# Host suffixes of OpenAI-compatible endpoints known to process data in the EU.
_EU_HOST_SUFFIXES = (
    "mistral.ai",
    "scaleway.com",
    "scaleway.ai",
    "scw.cloud",
    "ovh.net",
    "ovhcloud.com",
    "ionos.com",
    "ionos.de",
    "aleph-alpha.com",
    "nebius.com",
)

REGION_LABELS: dict[str, dict[str, str]] = {
    REGION_EU: {"en": "EU", "nl": "EU"},
    REGION_US: {"en": "US", "nl": "VS"},
    REGION_UNKNOWN: {"en": "Unknown", "nl": "Onbekend"},
}


def infer_provider(model_id: str | None) -> str | None:
    """Guess the provider from a raw API model id (used off-catalog)."""
    from app.services.provider_spec import infer_provider_type

    return infer_provider_type(model_id)


def provider_region(provider_type: str | None, base_url: str | None = "") -> str:
    """Return ``eu`` | ``us`` | ``unknown`` for a provider type and optional base URL."""
    from app.services.provider_spec import get_provider_spec

    provider = (provider_type or "").strip().lower()
    spec = get_provider_spec(provider)
    if spec is not None and spec.region:
        return spec.region
    host = (urlparse((base_url or "").strip()).hostname or "").lower()
    if host and any(host == s or host.endswith("." + s) for s in _EU_HOST_SUFFIXES):
        return REGION_EU
    if host and (host.endswith("openai.com") or host.endswith("anthropic.com")):
        return REGION_US
    return REGION_UNKNOWN


def is_eu(region: str | None) -> bool:
    return (region or "").strip().lower() == REGION_EU


def region_label(region: str | None, lang: str = "en") -> str:
    labels = REGION_LABELS.get((region or "").strip().lower(), REGION_LABELS[REGION_UNKNOWN])
    return labels.get(lang, labels["en"])
