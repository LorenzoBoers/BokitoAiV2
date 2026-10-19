"""ProviderSpec registry keeps chat and embedding resolution identical."""

from __future__ import annotations

import pytest

from app.services.agent.llm import (
    AnthropicLLMProvider,
    MockLLMProvider,
    OpenAILLMProvider,
    get_chat_provider,
)
from app.services.model_regions import infer_provider, provider_region
from app.services.model_resolution import _env_key
from app.services.platform_secrets import PLATFORM_PROVIDERS
from app.services.provider_presets import MISTRAL_BASE_URL
from app.services.provider_spec import (
    IMAGE_PROVIDER_SPECS,
    get_provider_spec,
    llm_provider_types,
    platform_provider_types,
)
from app.services.tenant_secrets import LLM_PROVIDERS


def test_platform_and_llm_lists_come_from_specs():
    assert PLATFORM_PROVIDERS == ("mistral", "anthropic", "openai")
    assert LLM_PROVIDERS == ("mistral", "anthropic", "openai")
    assert platform_provider_types() == PLATFORM_PROVIDERS
    assert llm_provider_types() == LLM_PROVIDERS
    assert "openai_compatible" not in PLATFORM_PROVIDERS


def test_fixed_regions_match_previous_map():
    assert provider_region("mistral") == "eu"
    assert provider_region("anthropic") == "us"
    assert provider_region("openai") == "us"
    assert provider_region("openai_compatible", "https://api.mistral.ai/v1") == "eu"
    assert provider_region("openai_compatible", "https://api.scaleway.ai/v1") == "eu"
    assert provider_region("openai_compatible", "https://example.com/v1") == "unknown"
    assert provider_region("openai_compatible", "https://api.openai.com/v1") == "us"


def test_infer_provider_reads_spec_prefixes():
    assert infer_provider("mistral-small-latest") == "mistral"
    assert infer_provider("ministral-3b-2512") == "mistral"
    assert infer_provider("codestral-latest") == "mistral"
    assert infer_provider("magistral-medium") == "mistral"
    assert infer_provider("open-mistral-nemo") == "mistral"
    assert infer_provider("claude-haiku-4-5") == "anthropic"
    assert infer_provider("gpt-4o") == "openai"
    assert infer_provider("o1-preview") == "openai"
    assert infer_provider("o3-mini") == "openai"
    assert infer_provider("text-embedding-3-small") == "openai"
    assert infer_provider("dall-e-2") == "openai"
    assert infer_provider("something-else") is None
    assert infer_provider("") is None
    assert infer_provider(None) is None


def test_chat_capabilities_and_image_on_openai_and_mistral():
    assert get_provider_spec("mistral").capabilities == frozenset(
        {"chat", "embedding", "image", "vision"}
    )
    assert get_provider_spec("openai").capabilities == frozenset(
        {"chat", "embedding", "image", "vision"}
    )
    assert get_provider_spec("openai_compatible").capabilities == frozenset({"chat", "embedding"})
    assert get_provider_spec("anthropic").capabilities == frozenset({"chat", "vision"})
    assert IMAGE_PROVIDER_SPECS == (
        get_provider_spec("mistral"),
        get_provider_spec("openai"),
    )
    assert get_provider_spec("openai").image_adapter is not None
    assert get_provider_spec("mistral").image_adapter is not None
    assert "image" not in get_provider_spec("anthropic").capabilities
    assert "image" not in get_provider_spec("openai_compatible").capabilities


def test_get_chat_provider_uses_spec_adapters():
    assert isinstance(get_chat_provider("anthropic", ""), MockLLMProvider)
    assert isinstance(get_chat_provider("unknown", "sk-x"), MockLLMProvider)
    assert isinstance(get_chat_provider("anthropic", "sk-ant"), AnthropicLLMProvider)

    mistral = get_chat_provider("mistral", "sk-mi")
    assert isinstance(mistral, OpenAILLMProvider)
    assert mistral.provider_type == "mistral"
    assert mistral.base_url == MISTRAL_BASE_URL

    custom = get_chat_provider("mistral", "sk-mi", "https://example.test/v1")
    assert custom.base_url == "https://example.test/v1"
    assert custom.provider_type == "mistral"

    openai = get_chat_provider("openai", "sk-oa")
    assert isinstance(openai, OpenAILLMProvider)
    assert openai.provider_type == "openai"
    assert openai.base_url is None

    compatible = get_chat_provider("openai_compatible", "sk-oa", "https://groq.example/v1")
    assert isinstance(compatible, OpenAILLMProvider)
    assert compatible.provider_type == "openai"
    assert compatible.base_url == "https://groq.example/v1"


def test_env_key_follows_spec(monkeypatch):
    from app.services import model_resolution

    monkeypatch.setattr(model_resolution.settings, "llm_mode", "mock")
    monkeypatch.setattr(model_resolution.settings, "openai_api_key", "sk-oa")
    monkeypatch.setattr(model_resolution.settings, "mistral_api_key", "sk-mi")
    assert _env_key("openai") == ""
    assert _env_key("openai_compatible") == ""

    monkeypatch.setattr(model_resolution.settings, "llm_mode", "live")
    assert _env_key("openai") == "sk-oa"
    assert _env_key("openai_compatible") == "sk-oa"
    assert _env_key("mistral") == "sk-mi"
    assert _env_key("not-a-provider") == ""


@pytest.mark.asyncio
async def test_embed_mock_path_unchanged():
    from app.services.embeddings import embed_text_with_usage

    vector, tokens = await embed_text_with_usage("hello", api_key="", live=False)
    assert tokens == 0
    assert len(vector) > 0
    again, _ = await embed_text_with_usage("hello", api_key="", live=False)
    assert again == vector
