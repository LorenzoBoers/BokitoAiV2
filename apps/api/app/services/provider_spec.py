"""Single registry of LLM provider metadata.

Chat, embedding and image generation share this description: type, region,
env key, whether Bokito stores a platform secret, default base URL,
capabilities and adapter factories. ``platform_secrets``, ``tenant_secrets``
and ``model_regions`` read those facts from here instead of keeping their own
lists.

``IMAGE_PROVIDER_SPECS`` is every spec whose capabilities include ``image``.
Adding a provider there is adding a ``ProviderSpec`` with that capability,
an ``image_adapter`` and (when Bokito should store the key) ``platform_secret``.
The chat adapter stays on ``adapter`` and is never used for images.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from app.services.provider_presets import MISTRAL_BASE_URL

Capability = Literal["chat", "embedding", "image", "vision"]

ChatAdapter = Callable[[str, str | None], Any]
ImageAdapter = Callable[[str, str | None], Any]
Probe = Callable[[str, str], Awaitable[dict[str, Any]]]

_OPENAI_DEFAULT_BASE = "https://api.openai.com/v1"


@dataclass(frozen=True)
class ProviderSpec:
    """Identity of one provider type. Runtime clients are built by ``adapter``."""

    type: str
    # ``eu`` | ``us`` | "" (region comes from the base URL host).
    region: str
    # Settings attribute holding the env API key. Empty when there is no env slot.
    env_key: str
    platform_secret: bool
    default_base_url: str
    capabilities: frozenset[str]
    # Prefixes of raw API model ids, longest-match is not required: first spec wins.
    id_prefixes: tuple[str, ...] = ()
    # Chat client factory. None when the spec has no chat capability.
    # Vision uses this same client: the provider accepts image input on chat.
    adapter: ChatAdapter | None = None
    # Image client factory. None when the spec has no image capability.
    image_adapter: ImageAdapter | None = None
    # Embedding client factory. None when the spec has no embedding capability.
    embedding_adapter: ChatAdapter | None = None
    probe: Probe | None = None


def _mistral_chat_adapter(api_key: str, base_url: str | None) -> Any:
    from app.services.agent.llm import OpenAILLMProvider

    # Mistral exposes an OpenAI-compatible Chat Completions API (EU-hosted).
    provider = OpenAILLMProvider(api_key=api_key, base_url=base_url or MISTRAL_BASE_URL)
    provider.provider_type = "mistral"
    return provider


def _anthropic_chat_adapter(api_key: str, base_url: str | None) -> Any:
    from app.services.agent.llm import AnthropicLLMProvider

    return AnthropicLLMProvider(api_key=api_key, base_url=base_url)


def _openai_chat_adapter(api_key: str, base_url: str | None) -> Any:
    from app.services.agent.llm import OpenAILLMProvider

    return OpenAILLMProvider(api_key=api_key, base_url=base_url)


def _openai_image_adapter(api_key: str, base_url: str | None) -> Any:
    from app.services.image_providers import OpenAIImageProvider

    return OpenAIImageProvider(api_key=api_key, base_url=base_url)


def _mistral_image_adapter(api_key: str, base_url: str | None) -> Any:
    from app.services.image_providers import MistralImageProvider

    return MistralImageProvider(api_key=api_key, base_url=base_url)


class OpenAICompatibleEmbeddingAdapter:
    """Embeddings client for any OpenAI-compatible ``/embeddings`` route."""

    def __init__(self, api_key: str, base_url: str | None = None) -> None:
        self.api_key = api_key
        self.base_url = (base_url or "").strip() or None


def _openai_embedding_adapter(api_key: str, base_url: str | None) -> Any:
    return OpenAICompatibleEmbeddingAdapter(api_key=api_key, base_url=base_url)


def _mistral_embedding_adapter(api_key: str, base_url: str | None) -> Any:
    return OpenAICompatibleEmbeddingAdapter(
        api_key=api_key, base_url=base_url or MISTRAL_BASE_URL
    )


async def _probe_anthropic(api_key: str, base_url: str) -> dict[str, Any]:
    del base_url
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://api.anthropic.com/v1/models",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                },
            )
            if response.status_code == 401:
                return {"ok": False, "message": "Invalid API key"}
            response.raise_for_status()
            return {"ok": True, "message": "Connection successful"}
    except httpx.HTTPError as exc:
        return {"ok": False, "message": f"Connection failed: {exc}"}


async def _probe_bearer_models(
    api_key: str, base_url: str, *, fallback_base: str
) -> dict[str, Any]:
    base = (base_url or "").strip().rstrip("/") or fallback_base
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{base}/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if response.status_code == 401:
                return {"ok": False, "message": "Invalid API key"}
            response.raise_for_status()
            return {"ok": True, "message": "Connection successful"}
    except httpx.HTTPError as exc:
        return {"ok": False, "message": f"Connection failed: {exc}"}


async def _probe_mistral(api_key: str, base_url: str) -> dict[str, Any]:
    return await _probe_bearer_models(api_key, base_url, fallback_base=MISTRAL_BASE_URL)


async def _probe_openai(api_key: str, base_url: str) -> dict[str, Any]:
    return await _probe_bearer_models(api_key, base_url, fallback_base=_OPENAI_DEFAULT_BASE)


def _spec(**kwargs: Any) -> ProviderSpec:
    caps = kwargs.pop("capabilities")
    return ProviderSpec(capabilities=frozenset(caps), **kwargs)


# Insertion order is the infer_provider scan order and the staff-key list order.
_SPECS: tuple[ProviderSpec, ...] = (
    _spec(
        type="mistral",
        region="eu",
        env_key="mistral_api_key",
        platform_secret=True,
        default_base_url=MISTRAL_BASE_URL,
        capabilities=("chat", "embedding", "image", "vision"),
        id_prefixes=("mistral", "ministral", "codestral", "magistral", "open-mistral"),
        adapter=_mistral_chat_adapter,
        image_adapter=_mistral_image_adapter,
        embedding_adapter=_mistral_embedding_adapter,
        probe=_probe_mistral,
    ),
    _spec(
        type="anthropic",
        region="us",
        env_key="anthropic_api_key",
        platform_secret=True,
        default_base_url="",
        capabilities=("chat", "vision"),
        id_prefixes=("claude",),
        adapter=_anthropic_chat_adapter,
        probe=_probe_anthropic,
    ),
    _spec(
        type="openai",
        region="us",
        env_key="openai_api_key",
        platform_secret=True,
        default_base_url="",
        capabilities=("chat", "embedding", "image", "vision"),
        id_prefixes=("gpt-", "o1", "o3", "text-embedding", "dall-e"),
        adapter=_openai_chat_adapter,
        image_adapter=_openai_image_adapter,
        embedding_adapter=_openai_embedding_adapter,
        probe=_probe_openai,
    ),
    _spec(
        type="openai_compatible",
        region="",
        env_key="openai_api_key",
        platform_secret=False,
        default_base_url="",
        capabilities=("chat", "embedding"),
        id_prefixes=(),
        adapter=_openai_chat_adapter,
        embedding_adapter=_openai_embedding_adapter,
        probe=_probe_openai,
    ),
)

PROVIDER_SPECS: dict[str, ProviderSpec] = {spec.type: spec for spec in _SPECS}

# Specs a workspace can attach an image key to. Derived so a new image
# provider is registered once, on ProviderSpec, and shows up here.
IMAGE_PROVIDER_SPECS: tuple[ProviderSpec, ...] = tuple(
    spec for spec in _SPECS if "image" in spec.capabilities
)


def provider_specs() -> tuple[ProviderSpec, ...]:
    return _SPECS


def get_capability_adapter(
    provider_type: str,
    capability: str,
    api_key: str,
    base_url: str | None = None,
) -> Any:
    """One door per capability. Unknown providers and empty keys return a mock.

    Vision is not a second HTTP API: it is the chat adapter, which already
    accepts image input. Embedding and image each have their own factory.
    """
    spec = get_provider_spec(provider_type)
    factory = None
    if spec is not None and capability in spec.capabilities and api_key:
        if capability == "image":
            factory = spec.image_adapter
        elif capability == "embedding":
            factory = spec.embedding_adapter
        elif capability in ("chat", "vision"):
            factory = spec.adapter
    if factory is not None:
        return factory(api_key, base_url)
    if capability == "image":
        from app.services.image_providers import MockImageProvider

        return MockImageProvider()
    if capability in ("chat", "vision"):
        from app.services.agent.llm import MockLLMProvider

        return MockLLMProvider()
    return None


def get_provider_spec(provider_type: str | None) -> ProviderSpec | None:
    if not provider_type:
        return None
    return PROVIDER_SPECS.get(provider_type.strip().lower())


def platform_provider_types() -> tuple[str, ...]:
    """Providers that may have a Bokito-owned key in ``platform_secrets``."""
    return tuple(spec.type for spec in _SPECS if spec.platform_secret)


def llm_provider_types() -> tuple[str, ...]:
    """Chat/embedding providers with a platform key slot (legacy BYOK list)."""
    return tuple(
        spec.type
        for spec in _SPECS
        if spec.platform_secret and spec.capabilities & {"chat", "embedding"}
    )


def fixed_regions() -> dict[str, str]:
    """Provider type -> ``eu`` | ``us`` for types that do not depend on base URL."""
    return {spec.type: spec.region for spec in _SPECS if spec.region}


def infer_provider_type(model_id: str | None) -> str | None:
    """Guess the provider from a raw API model id (used off-catalog)."""
    value = (model_id or "").strip().lower()
    if not value:
        return None
    for spec in _SPECS:
        if spec.id_prefixes and value.startswith(spec.id_prefixes):
            return spec.type
    return None


def env_api_key(provider_type: str, *, live: bool, settings: Any) -> str:
    """Env key for ``provider_type``. Empty unless live mode and the spec names one."""
    if not live:
        return ""
    spec = get_provider_spec(provider_type)
    if spec is None or not spec.env_key:
        return ""
    return getattr(settings, spec.env_key, "") or ""
