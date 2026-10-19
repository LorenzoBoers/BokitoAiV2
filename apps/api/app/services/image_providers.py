"""Image adapters. Each one implements ``generate``; the factory is on ProviderSpec.

OpenAI uses the Images API. Mistral has no Images endpoint: the adapter calls
Chat Completions with the built-in ``image_generation`` tool and turns the
PNG (``file_id`` or ``files.mistral.ai`` URL) into the same ``GeneratedImage``.
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass
from typing import Any


@dataclass
class GeneratedImage:
    b64: str | None = None
    url: str | None = None


@dataclass
class ImageGenerationResult:
    images: list[GeneratedImage]
    model_id: str
    images_count: int
    tokens_in: int = 0
    tokens_out: int = 0
    mock: bool = False


class MockImageProvider:
    """Used when the spec has no image adapter or the call has no API key."""

    async def generate(
        self,
        prompt: str,
        *,
        model_id: str,
        size: str = "1024x1024",
        n: int = 1,
    ) -> ImageGenerationResult:
        del prompt, size
        count = max(n, 1)
        return ImageGenerationResult(
            images=[GeneratedImage() for _ in range(count)],
            model_id=model_id,
            images_count=count,
            mock=True,
        )


class OpenAIImageProvider:
    """OpenAI Images API. DALL-E 2 and DALL-E 3 share this client; ``model_id`` selects."""

    def __init__(self, api_key: str, base_url: str | None = None) -> None:
        self.api_key = api_key
        self.base_url = (base_url or "").strip() or None

    async def generate(
        self,
        prompt: str,
        *,
        model_id: str,
        size: str = "1024x1024",
        n: int = 1,
    ) -> ImageGenerationResult:
        from openai import AsyncOpenAI

        kwargs: dict[str, Any] = {"api_key": self.api_key}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        client = AsyncOpenAI(**kwargs)
        create_kwargs: dict[str, Any] = {
            "model": model_id,
            "prompt": prompt,
            "size": size,
            "n": n,
        }
        if model_id.startswith("dall-e"):
            create_kwargs["response_format"] = "b64_json"
        response = await client.images.generate(**create_kwargs)
        images: list[GeneratedImage] = []
        for item in response.data or []:
            images.append(
                GeneratedImage(
                    b64=getattr(item, "b64_json", None),
                    url=getattr(item, "url", None),
                )
            )
        usage = getattr(response, "usage", None)
        tokens_in = int(getattr(usage, "input_tokens", 0) or 0) if usage else 0
        tokens_out = int(getattr(usage, "output_tokens", 0) or 0) if usage else 0
        return ImageGenerationResult(
            images=images,
            model_id=model_id,
            images_count=len(images) or n,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
        )


_MISTRAL_FILE_URL = re.compile(r"https://files\.mistral\.ai/[^\s)\]\"']+")
_MARKDOWN_IMAGE_URL = re.compile(r"!\[[^\]]*\]\((https://[^)\s]+)\)")


def collect_mistral_image_refs(payload: Any) -> list[dict[str, str | None]]:
    """Pull image refs out of a Mistral chat payload.

    Conversations return ``file_id`` or ``files.mistral.ai``. Chat completions
    with the image tool return ``choices[].messages``: a tool message whose
    ``content`` is JSON ``{"url": "https://...blob.../image.jpg?..."}``, and an
    assistant message with the same URL in markdown.
    """
    found: list[dict[str, str | None]] = []
    seen: set[tuple[str, str]] = set()

    def add(file_id: str | None, url: str | None) -> None:
        file_id = (file_id or "").strip() or None
        url = (url or "").strip() or None
        if url and not url.startswith("https://"):
            url = None
        if not file_id and not url:
            return
        key = (file_id or "", url or "")
        if key in seen:
            return
        seen.add(key)
        found.append({"file_id": file_id, "url": url})

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            file_id = node.get("file_id")
            url = node.get("url")
            image_url = node.get("image_url")
            if isinstance(image_url, dict):
                url = url or image_url.get("url")
            elif isinstance(image_url, str):
                url = url or image_url
            if isinstance(file_id, str) or isinstance(url, str):
                add(file_id if isinstance(file_id, str) else None, url if isinstance(url, str) else None)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, str):
            stripped = node.strip()
            if stripped.startswith("{") or stripped.startswith("["):
                try:
                    import json

                    walk(json.loads(stripped))
                except json.JSONDecodeError:
                    pass
            for match in _MISTRAL_FILE_URL.findall(node):
                add(None, match)
            for match in _MARKDOWN_IMAGE_URL.findall(node):
                add(None, match)

    walk(payload)
    return found


class MistralImageProvider:
    """Mistral ``image_generation`` tool on ``POST /v1/chat/completions``.

    ``model_id`` is the chat model that may call the tool (for example
    ``mistral-small-latest``), not a diffusion model id. Size is ignored:
    the tool does not take an OpenAI ``size`` parameter.
    """

    def __init__(self, api_key: str, base_url: str | None = None) -> None:
        from app.services.provider_presets import MISTRAL_BASE_URL

        self.api_key = api_key
        self.base_url = (base_url or "").strip().rstrip("/") or MISTRAL_BASE_URL

    async def generate(
        self,
        prompt: str,
        *,
        model_id: str,
        size: str = "1024x1024",
        n: int = 1,
    ) -> ImageGenerationResult:
        import httpx

        del size
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": model_id,
                    "messages": [{"role": "user", "content": prompt}],
                    "tools": [{"type": "image_generation"}],
                },
            )
            response.raise_for_status()
            payload = response.json()
            refs = collect_mistral_image_refs(payload)[: max(n, 1)]
            images: list[GeneratedImage] = []
            for ref in refs:
                images.append(await self._materialize(client, ref))
        usage = payload.get("usage") if isinstance(payload, dict) else None
        tokens_in = int((usage or {}).get("prompt_tokens") or 0) if isinstance(usage, dict) else 0
        tokens_out = int((usage or {}).get("completion_tokens") or 0) if isinstance(usage, dict) else 0
        return ImageGenerationResult(
            images=images,
            model_id=model_id,
            images_count=len(images),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
        )

    async def _materialize(self, client: Any, ref: dict[str, str | None]) -> GeneratedImage:
        url = ref.get("url")
        file_id = ref.get("file_id")
        raw: bytes | None = None
        if file_id:
            downloaded = await client.get(
                f"{self.base_url}/files/{file_id}/content",
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            if downloaded.status_code == 200:
                raw = downloaded.content
        elif url:
            downloaded = await client.get(url)
            if downloaded.status_code == 200 and downloaded.content:
                raw = downloaded.content
        b64 = base64.b64encode(raw).decode("ascii") if raw else None
        return GeneratedImage(b64=b64, url=url)


def get_image_provider(provider_type: str, api_key: str, base_url: str | None = None):
    """Return the image adapter for this provider, or mock when it cannot serve images."""
    from app.services.provider_spec import get_capability_adapter

    return get_capability_adapter(provider_type, "image", api_key, base_url)
