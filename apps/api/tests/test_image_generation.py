"""Bokito image layer: own resolve path, DALL-E 2 backbone, mock without a key."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.services.image_generation import (
    BOKITO_IMAGE_PROVIDER,
    BOKITO_IMAGE_SLUG,
    generate_image,
    resolve_image_call,
)
from app.services.image_providers import (
    ImageGenerationResult,
    MistralImageProvider,
    MockImageProvider,
    OpenAIImageProvider,
    collect_mistral_image_refs,
    get_image_provider,
)
from app.services.provider_spec import IMAGE_PROVIDER_SPECS, get_provider_spec


@pytest.fixture
def tenant_id():
    return uuid4()


def _patch_key(monkeypatch, key: str, source: str):
    async def _resolve(session, tenant_id, provider):
        del session, tenant_id
        if provider == "openai":
            return key, source
        return "", "mock"

    monkeypatch.setattr(
        "app.services.image_generation._resolve_platform_key", _resolve
    )


@pytest.mark.asyncio
async def test_virtual_layer_backs_onto_dalle2_and_mocks_without_a_key(monkeypatch, tenant_id):
    _patch_key(monkeypatch, "", "mock")

    resolved = await resolve_image_call(None, tenant_id)
    assert resolved.slug == BOKITO_IMAGE_SLUG
    assert resolved.provider == BOKITO_IMAGE_PROVIDER
    assert resolved.kind == "image"
    assert resolved.provider_type == "openai"
    assert resolved.model_id == "dall-e-2"
    assert resolved.key_source == "mock"
    assert resolved.billable is False
    assert resolved.region == "us"

    generated = await generate_image(None, tenant_id, "a red square")
    assert generated.mock is True
    assert generated.result.images_count == 1
    assert generated.usage.call_type == "image"
    assert generated.usage.unit == "image"
    assert generated.usage.images == 1
    assert generated.usage.provider == "bokito"
    assert generated.usage.model_id == "dall-e-2"
    assert generated.usage.customer_cost_micros == 0
    assert generated.usage.priced is False
    assert generated.usage.provider_list_price_cents == 2
    assert generated.usage.billable is False


@pytest.mark.asyncio
async def test_tenant_key_beats_platform_and_calls_openai_adapter(monkeypatch, tenant_id):
    _patch_key(monkeypatch, "sk-tenant", "tenant")
    seen: dict[str, str] = {}

    class _Fake:
        def __init__(self, api_key: str, base_url: str | None = None) -> None:
            seen["api_key"] = api_key
            seen["base_url"] = base_url or ""

        async def generate(self, prompt, *, model_id, size="1024x1024", n=1):
            seen["prompt"] = prompt
            seen["model_id"] = model_id
            seen["size"] = size
            seen["n"] = str(n)
            return ImageGenerationResult(
                images=[],
                model_id=model_id,
                images_count=n,
                tokens_in=4,
                tokens_out=0,
            )

    monkeypatch.setattr("app.services.image_providers.OpenAIImageProvider", _Fake)

    resolved = await resolve_image_call(None, tenant_id, model_slug="dall-e-2")
    assert resolved.provider == "openai"
    assert resolved.slug == "dall-e-2"
    assert resolved.key_source == "tenant"
    assert resolved.billable is False

    generated = await generate_image(
        None, tenant_id, "a blue circle", model_slug="bokito-image", size="512x512", n=2
    )
    assert seen == {
        "api_key": "sk-tenant",
        "base_url": "",
        "prompt": "a blue circle",
        "model_id": "dall-e-2",
        "size": "512x512",
        "n": "2",
    }
    assert generated.mock is False
    assert generated.usage.unit == "token"
    assert generated.usage.tokens_in == 4
    assert generated.usage.images == 2
    assert generated.usage.provider == "bokito"
    assert generated.usage.priced is False
    assert generated.usage.customer_cost_micros == 0


@pytest.mark.asyncio
async def test_platform_key_is_marked_billable_but_not_priced(monkeypatch, tenant_id):
    _patch_key(monkeypatch, "sk-platform", "platform")

    class _Fake:
        def __init__(self, api_key: str, base_url: str | None = None) -> None:
            del api_key, base_url

        async def generate(self, prompt, *, model_id, size="1024x1024", n=1):
            del prompt, size
            return ImageGenerationResult(images=[], model_id=model_id, images_count=n)

    monkeypatch.setattr("app.services.image_providers.OpenAIImageProvider", _Fake)

    resolved = await resolve_image_call(None, tenant_id)
    assert resolved.key_source == "platform"
    assert resolved.billable is True
    generated = await generate_image(None, tenant_id, "a flag")
    assert generated.usage.billable is True
    assert generated.usage.priced is False
    assert generated.usage.customer_cost_micros == 0
    assert generated.usage.unit == "image"


@pytest.mark.asyncio
async def test_unknown_slug_falls_back_to_bokito_image(monkeypatch, tenant_id):
    _patch_key(monkeypatch, "", "mock")
    resolved = await resolve_image_call(None, tenant_id, model_slug="not-a-model")
    assert resolved.slug == BOKITO_IMAGE_SLUG
    assert resolved.provider == BOKITO_IMAGE_PROVIDER
    assert resolved.model_id == "dall-e-2"
    assert resolved.kind == "image"


def test_image_factory_mock_and_openai_split():
    assert isinstance(get_image_provider("openai", ""), MockImageProvider)
    assert isinstance(get_image_provider("mistral", ""), MockImageProvider)
    assert isinstance(get_image_provider("anthropic", "sk"), MockImageProvider)
    live = get_image_provider("openai", "sk-oa", "https://api.openai.com/v1")
    assert isinstance(live, OpenAIImageProvider)
    assert live.api_key == "sk-oa"
    assert live.base_url == "https://api.openai.com/v1"
    mistral = get_image_provider("mistral", "sk-mi")
    assert isinstance(mistral, MistralImageProvider)
    assert [spec.type for spec in IMAGE_PROVIDER_SPECS] == ["mistral", "openai"]
    assert get_provider_spec("openai").image_adapter is not None
    assert get_provider_spec("mistral").image_adapter is not None


def test_mistral_payload_refs_become_the_same_image_shape():
    refs = collect_mistral_image_refs(
        {
            "choices": [
                {
                    "messages": [
                        {
                            "content": [
                                {"type": "text", "text": "Done"},
                                {
                                    "type": "tool_file",
                                    "file_id": "file-1",
                                    "file_type": "png",
                                },
                            ]
                        }
                    ]
                }
            ]
        }
    )
    assert refs == [{"file_id": "file-1", "url": None}]
    urls = collect_mistral_image_refs(
        {"choices": [{"message": {"content": "See https://files.mistral.ai/generated/abc.png now"}}]}
    )
    assert urls == [{"file_id": None, "url": "https://files.mistral.ai/generated/abc.png"}]


def test_mistral_chat_tool_returns_a_blob_url_inside_json_content():
    blob = (
        "https://mistralaiblackforestprod.blob.core.windows.net/images/blackforest/abc/image.jpg"
        "?se=2026-10-18T14%3A17%3A13Z&sp=r"
    )
    refs = collect_mistral_image_refs(
        {
            "object": "chat.multi_completion",
            "choices": [
                {
                    "messages": [
                        {
                            "role": "tool",
                            "content": '{"url": "' + blob + '"}',
                        },
                        {
                            "role": "assistant",
                            "content": f"Here is the image: ![Red Circle]({blob})",
                        },
                    ]
                }
            ],
        }
    )
    assert refs == [{"file_id": None, "url": blob}]


@pytest.mark.asyncio
async def test_mistral_adapter_downloads_png_into_bokito_image(monkeypatch):
    seen: dict[str, object] = {}

    class _Response:
        def __init__(self, *, status_code=200, payload=None, content=b""):
            self.status_code = status_code
            self._payload = payload or {}
            self.content = content

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, json):
            seen["url"] = url
            seen["json"] = json
            return _Response(
                payload={
                    "usage": {"prompt_tokens": 4, "completion_tokens": 1},
                    "choices": [
                        {
                            "message": {
                                "content": [
                                    {"type": "tool_file", "file_id": "file-9", "file_type": "png"}
                                ]
                            }
                        }
                    ],
                }
            )

        async def get(self, url, headers=None):
            seen["download"] = url
            return _Response(content=b"\x89PNG")

    monkeypatch.setattr("httpx.AsyncClient", lambda **kwargs: _Client())
    provider = MistralImageProvider("sk-mi")
    result = await provider.generate("a red circle", model_id="mistral-small-latest")
    assert "/chat/completions" in str(seen["url"])
    assert seen["json"]["tools"] == [{"type": "image_generation"}]
    assert seen["json"]["model"] == "mistral-small-latest"
    assert seen["download"] == "https://api.mistral.ai/v1/files/file-9/content"
    assert result.mock is False
    assert result.images_count == 1
    assert result.images[0].b64
    assert result.tokens_in == 4


@pytest.mark.asyncio
async def test_virtual_layer_uses_mistral_when_openai_has_no_key(monkeypatch, tenant_id):
    async def _resolve(session, tenant_id, provider):
        del session, tenant_id
        if provider == "mistral":
            return "sk-mi", "platform"
        return "", "mock"

    monkeypatch.setattr("app.services.image_generation._resolve_platform_key", _resolve)

    class _Fake:
        def __init__(self, api_key: str, base_url: str | None = None) -> None:
            del api_key, base_url

        async def generate(self, prompt, *, model_id, size="1024x1024", n=1):
            del prompt, size, n
            return ImageGenerationResult(images=[], model_id=model_id, images_count=1)

    monkeypatch.setattr(
        "app.services.image_providers.MistralImageProvider", _Fake
    )
    resolved = await resolve_image_call(None, tenant_id)
    assert resolved.provider == BOKITO_IMAGE_PROVIDER
    assert resolved.provider_type == "mistral"
    assert resolved.model_id == "mistral-small-latest"
    assert resolved.key_source == "platform"
    generated = await generate_image(None, tenant_id, "a red circle")
    assert generated.mock is False
    assert generated.usage.model_id == "mistral-small-latest"


@pytest.mark.asyncio
async def test_opening_a_tenant_seeds_image_nodes_on_the_custom_path(session_override):
    from app.models.auth import Tenant
    from app.models.provider import TenantModel
    from app.services.bokito_model_nodes import ensure_default_model_nodes
    from app.services.provider_connections import create_connection
    from app.services.tenant_model_catalog import create_model, list_models, tenant_has_models
    from sqlalchemy import select

    tenant = Tenant(slug="img-nodes", name="Img")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)
    await ensure_default_model_nodes(session_override, tenant.id)
    await ensure_default_model_nodes(session_override, tenant.id)

    rows = await list_models(session_override, tenant.id, kind="image")
    assert {row.slug for row in rows} == {"bokito-image", "dall-e-2", "mistral-image"}
    assert {row.origin for row in rows} == {"platform"}
    assert await tenant_has_models(session_override, tenant.id) is False

    openai = await create_connection(
        session_override, tenant.id, provider_type="openai", label="Own OpenAI", api_key="sk-own-openai"
    )
    anthropic = await create_connection(
        session_override,
        tenant.id,
        provider_type="anthropic",
        label="Own Anthropic",
        api_key="sk-own-anthropic",
    )
    await create_model(
        session_override,
        tenant.id,
        connection_id=openai.id,
        model_id="dall-e-3",
        slug="my-dalle",
        kind="image",
        display_name="My DALL-E",
    )
    await create_model(
        session_override,
        tenant.id,
        connection_id=anthropic.id,
        model_id="claude-sonnet-4-6",
        slug="my-claude",
        kind="chat",
        display_name="My Claude",
    )
    assert await tenant_has_models(session_override, tenant.id) is True
    stored = (
        await session_override.execute(
            select(TenantModel).where(TenantModel.tenant_id == tenant.id)
        )
    ).scalars().all()
    assert {row.slug for row in stored if row.origin == "tenant"} == {"my-dalle", "my-claude"}


@pytest.mark.asyncio
async def test_generate_rejects_empty_prompt(tenant_id):
    with pytest.raises(ValueError):
        await generate_image(None, tenant_id, "  ")
