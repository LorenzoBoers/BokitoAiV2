"""Agents without an image setting still get generate_image on bokito-image."""

from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.image_generation import (
    BOKITO_IMAGE_SLUG,
    ImageGeneration,
    ResolvedImageCall,
    resolve_image_model_slug,
)
from app.services.image_providers import GeneratedImage, ImageGenerationResult
from app.tools.registry import (
    ToolContext,
    filter_tools_for_agent,
    get_tool_definitions,
    get_tool_spec,
    with_default_image_tool,
)


def _generated(slug: str = BOKITO_IMAGE_SLUG) -> ImageGeneration:
    from app.services.image_generation import image_usage_event

    resolved = ResolvedImageCall(
        slug=slug,
        provider="bokito" if slug == BOKITO_IMAGE_SLUG else "openai",
        provider_type="openai",
        model_id="dall-e-2",
        kind="image",
        api_key="sk-test",
        key_source="platform",
    )
    result = ImageGenerationResult(
        images=[GeneratedImage(b64="aGVsbG8=")],
        model_id="dall-e-2",
        images_count=1,
    )
    return ImageGeneration(
        resolved=resolved,
        result=result,
        usage=image_usage_event(resolved, result),
    )


@pytest.mark.asyncio
async def test_unset_image_config_resolves_to_bokito_image():
    assert await resolve_image_model_slug(None, uuid4()) == BOKITO_IMAGE_SLUG


@pytest.mark.asyncio
async def test_agent_without_image_config_has_bokito_generate_image(monkeypatch):
    agent = SimpleNamespace(tools_json=json.dumps(["read_doc"]))
    narrowed = filter_tools_for_agent(get_tool_definitions(), agent)
    assert "generate_image" not in {tool["name"] for tool in narrowed}

    tools = with_default_image_tool(narrowed)
    assert "generate_image" in {tool["name"] for tool in tools}
    assert "generate_image" not in {
        tool["name"] for tool in with_default_image_tool(narrowed, enabled=False)
    }

    seen: dict[str, str] = {}

    async def _fake_generate(session, tenant_id, prompt, *, model_slug=None, size="1024x1024", n=1):
        del session, tenant_id, size, n
        seen["prompt"] = prompt
        seen["slug"] = model_slug or ""
        return _generated(model_slug or BOKITO_IMAGE_SLUG)

    class _Backend:
        async def store(self, *, data, filename, mime, tenant_id):
            del data, filename, mime, tenant_id
            return SimpleNamespace(url="https://files.example/generated-1.png")

    async def _resolve_items(session, tenant_id, items):
        del session, tenant_id
        return items

    monkeypatch.setattr("app.services.image_generation.generate_image", _fake_generate)
    monkeypatch.setattr("app.services.storage.get_storage_backend", lambda: _Backend())
    monkeypatch.setattr("app.services.proposal_items.resolve_items", _resolve_items)

    spec = get_tool_spec("generate_image")
    assert spec is not None
    outcome = await spec.handler(
        ToolContext(session=None, tenant_id=uuid4(), user_id=None, agent=agent),
        {"prompt": "a red circle on a white background"},
    )
    assert seen["slug"] == BOKITO_IMAGE_SLUG
    assert seen["prompt"] == "a red circle on a white background"
    assert outcome["ok"] is True
    assert outcome["model"] == BOKITO_IMAGE_SLUG
    assert outcome["model_id"] == "dall-e-2"
    assert outcome["provider_type"] == "openai"
    assert outcome["images"] == ["https://files.example/generated-1.png"]


def test_slim_activity_keeps_the_generated_image_url():
    from app.services.agent.turn_persist import slim_activity_item

    running = slim_activity_item(
        {
            "id": "img-1",
            "kind": "work",
            "tool": "generate_image",
            "status": "running",
            "input": {"prompt": "a fish"},
            "result": None,
        }
    )
    assert "input" not in running
    assert "image_urls" not in running
    assert running["label_key"] == "activity.generatingImage"

    done = slim_activity_item(
        {
            "id": "img-1",
            "kind": "work",
            "tool": "generate_image",
            "status": "ok",
            "result": {"ok": True, "images": ["https://files.example/generated-1.jpg"], "items": []},
        }
    )
    assert done["image_urls"] == ["https://files.example/generated-1.jpg"]
    assert done["label_key"] == "activity.generatedImage"
    assert "result" not in done


def test_reply_drops_an_image_the_frame_already_shows():
    from app.services.agent.turn_persist import strip_generated_image_echo

    url = "https://files.example/generated-1.jpg"
    text = f"Hier is je haai.\n\n![Haai met hoed]({url})\n\n{url}"
    assert strip_generated_image_echo(text, [url]) == "Hier is je haai."
    other = "Hier is je haai.\n\n![Haai](https://cdn.example/other-shark.jpg)"
    assert strip_generated_image_echo(other, [url]) == "Hier is je haai."
