"""Static registry of known LLM provider types and preset models."""

from __future__ import annotations

from typing import Any, TypedDict

PROVIDER_TYPES = ("anthropic", "openai", "openai_compatible")


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
    models: list[PresetModel]


PROVIDER_PRESETS: dict[str, ProviderPreset] = {
    "anthropic": {
        "label": "Anthropic",
        "default_base_url": "",
        "requires_base_url": False,
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
            "models": preset["models"],
        }
    return out
