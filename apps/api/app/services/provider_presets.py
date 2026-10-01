"""Static registry of known LLM provider types and preset models."""

from __future__ import annotations

from typing import Any, TypedDict

PROVIDER_TYPES = ("mistral", "anthropic", "openai", "openai_compatible")

# Mistral serves an OpenAI-compatible Chat Completions and Embeddings API.
MISTRAL_BASE_URL = "https://api.mistral.ai/v1"


class PresetModel(TypedDict):
    slug: str
    model_id: str
    display_name: str
    kind: str
    context_window: int
    input_cost_per_mtok_cents: int
    output_cost_per_mtok_cents: int
    supports_tools: bool
    supports_vision: bool
    sort_order: int


class ProviderPreset(TypedDict):
    label: str
    default_base_url: str
    requires_base_url: bool
    # Hosting region of the provider: eu | us | "" (depends on the base URL).
    region: str
    models: list[PresetModel]


PROVIDER_PRESETS: dict[str, ProviderPreset] = {
    "mistral": {
        "label": "Mistral",
        "default_base_url": MISTRAL_BASE_URL,
        "requires_base_url": False,
        "region": "eu",
        "models": [
            {
                "slug": "mistral-medium-latest",
                "model_id": "mistral-medium-latest",
                "display_name": "Mistral Medium 3.5",
                "kind": "chat",
                "context_window": 128000,
                "input_cost_per_mtok_cents": 150,
                "output_cost_per_mtok_cents": 750,
                "supports_tools": True,
                "supports_vision": True,
                "sort_order": 1,
            },
            {
                "slug": "mistral-large-latest",
                "model_id": "mistral-large-latest",
                "display_name": "Mistral Large 3",
                "kind": "chat",
                "context_window": 128000,
                "input_cost_per_mtok_cents": 50,
                "output_cost_per_mtok_cents": 150,
                "supports_tools": True,
                "supports_vision": True,
                "sort_order": 2,
            },
            {
                "slug": "mistral-small-latest",
                "model_id": "mistral-small-latest",
                "display_name": "Mistral Small 4",
                "kind": "chat",
                "context_window": 128000,
                "input_cost_per_mtok_cents": 15,
                "output_cost_per_mtok_cents": 60,
                "supports_tools": True,
                "supports_vision": True,
                "sort_order": 3,
            },
            {
                "slug": "mistral-embed",
                "model_id": "mistral-embed",
                "display_name": "Mistral Embed",
                "kind": "embedding",
                "context_window": 8192,
                "input_cost_per_mtok_cents": 10,
                "output_cost_per_mtok_cents": 0,
                "supports_tools": False,
                "supports_vision": False,
                "sort_order": 4,
            },
        ],
    },
    "anthropic": {
        "label": "Anthropic",
        "default_base_url": "",
        "requires_base_url": False,
        "region": "us",
        "models": [
            {
                "slug": "claude-sonnet-4-6",
                "model_id": "claude-sonnet-4-6",
                "display_name": "Claude Sonnet 4.6",
                "kind": "chat",
                "context_window": 200000,
                "input_cost_per_mtok_cents": 300,
                "output_cost_per_mtok_cents": 1500,
                "supports_tools": True,
                "supports_vision": True,
                "sort_order": 10,
            },
            {
                "slug": "claude-haiku-4-5",
                "model_id": "claude-haiku-4-5-20251001",
                "display_name": "Claude Haiku 4.5",
                "kind": "chat",
                "context_window": 200000,
                "input_cost_per_mtok_cents": 100,
                "output_cost_per_mtok_cents": 500,
                "supports_tools": True,
                "supports_vision": True,
                "sort_order": 20,
            },
            {
                "slug": "claude-opus-4-8",
                "model_id": "claude-opus-4-8",
                "display_name": "Claude Opus 4.8",
                "kind": "chat",
                "context_window": 200000,
                "input_cost_per_mtok_cents": 1500,
                "output_cost_per_mtok_cents": 7500,
                "supports_tools": True,
                "supports_vision": True,
                "sort_order": 30,
            },
        ],
    },
    "openai": {
        "label": "OpenAI",
        "default_base_url": "",
        "requires_base_url": False,
        "region": "us",
        "models": [
            {
                "slug": "gpt-4o",
                "model_id": "gpt-4o",
                "display_name": "GPT-4o",
                "kind": "chat",
                "context_window": 128000,
                "input_cost_per_mtok_cents": 250,
                "output_cost_per_mtok_cents": 1000,
                "supports_tools": True,
                "supports_vision": True,
                "sort_order": 40,
            },
            {
                "slug": "gpt-4o-mini",
                "model_id": "gpt-4o-mini",
                "display_name": "GPT-4o mini",
                "kind": "chat",
                "context_window": 128000,
                "input_cost_per_mtok_cents": 15,
                "output_cost_per_mtok_cents": 60,
                "supports_tools": True,
                "supports_vision": True,
                "sort_order": 50,
            },
            {
                "slug": "text-embedding-3-small",
                "model_id": "text-embedding-3-small",
                "display_name": "Embedding 3 Small",
                "kind": "embedding",
                "context_window": 8191,
                "input_cost_per_mtok_cents": 2,
                "output_cost_per_mtok_cents": 0,
                "supports_tools": False,
                "supports_vision": False,
                "sort_order": 60,
            },
            {
                "slug": "text-embedding-3-large",
                "model_id": "text-embedding-3-large",
                "display_name": "Embedding 3 Large",
                "kind": "embedding",
                "context_window": 8191,
                "input_cost_per_mtok_cents": 13,
                "output_cost_per_mtok_cents": 0,
                "supports_tools": False,
                "supports_vision": False,
                "sort_order": 70,
            },
        ],
    },
    "openai_compatible": {
        "label": "OpenAI-compatible",
        "default_base_url": "",
        "requires_base_url": True,
        "region": "",
        "models": [],
    },
}


def is_valid_provider_type(provider_type: str) -> bool:
    return provider_type in PROVIDER_TYPES


def get_preset(provider_type: str) -> ProviderPreset | None:
    return PROVIDER_PRESETS.get(provider_type)


def serialize_presets() -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, preset in PROVIDER_PRESETS.items():
        out[key] = {
            "label": preset["label"],
            "default_base_url": preset["default_base_url"],
            "requires_base_url": preset["requires_base_url"],
            "region": preset["region"],
            "models": preset["models"],
        }
    return out
