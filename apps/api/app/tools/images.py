"""Default image tool. Every agent gets it unless the tenant turns it off.

The slug follows ``resolve_image_model_slug``: an explicit agent value, then
the workspace image model, then ``bokito-image``.
"""

from __future__ import annotations

import logging
import base64
from typing import Any

from app.tools.registry import ToolContext, ToolSpec, register_tool



logger = logging.getLogger(__name__)

def _image_bytes(image) -> tuple[bytes, str, str] | None:
    raw = getattr(image, "b64", None) or ""
    if not raw:
        return None
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    try:
        payload = base64.b64decode(raw)
    except Exception:
        logger.debug('image base64 decode failed', exc_info=True)
        return None
    if payload.startswith(b"\x89PNG"):
        return payload, "image/png", "png"
    if payload.startswith(b"\xff\xd8"):
        return payload, "image/jpeg", "jpg"
    if payload.startswith(b"RIFF") and b"WEBP" in payload[:16]:
        return payload, "image/webp", "webp"
    return payload, "image/png", "png"


async def _generate_image(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.image_generation import generate_image, resolve_image_model_slug
    from app.services.storage import get_storage_backend

    prompt = str(tool_input.get("prompt") or "").strip()
    if not prompt:
        return {"ok": False, "error": "Prompt is required"}
    agent_slug = ""
    if ctx.agent is not None:
        agent_slug = str(getattr(ctx.agent, "image_model", "") or "")
    slug = await resolve_image_model_slug(
        ctx.session, ctx.tenant_id, agent_slug=agent_slug
    )
    if not slug:
        return {"ok": False, "error": "Image generation is turned off for this workspace"}
    try:
        generated = await generate_image(ctx.session, ctx.tenant_id, prompt, model_slug=slug)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    if generated.mock:
        return {
            "ok": False,
            "error": "No image provider key is configured",
            "model": generated.resolved.slug,
            "provider_type": generated.resolved.provider_type,
            "model_id": generated.resolved.model_id,
        }
    backend = get_storage_backend()
    urls: list[str] = []
    for index, image in enumerate(generated.result.images):
        decoded = _image_bytes(image)
        if decoded:
            payload, mime, ext = decoded
            stored = await backend.store(
                data=payload,
                filename=f"generated-{index + 1}.{ext}",
                mime=mime,
                tenant_id=str(ctx.tenant_id),
            )
            urls.append(stored.url)
        elif image.url:
            urls.append(image.url)
    if not urls:
        return {
            "ok": False,
            "error": "The image provider returned no file",
            "model": generated.resolved.slug,
        }
    return {
        "ok": True,
        "model": generated.resolved.slug,
        "provider_type": generated.resolved.provider_type,
        "model_id": generated.resolved.model_id,
        "images": urls,
        "items": [
            {"type": "image", "url": url, "title": prompt[:80]}
            for url in urls
        ],
    }


register_tool(
    ToolSpec(
        name="generate_image",
        description=(
            "Generate an image from a text prompt. The chat shows it in a frame "
            "as soon as you call this, so do not paste the image URL or a markdown "
            "image in your reply. One short sentence is enough. Use this whenever "
            "the operator asks you to create, draw, or generate a picture. Do not "
            "say you cannot generate images, and do not use web_search as a "
            "substitute. The workspace image model is used; when none is set, "
            "that is Bokito Image (DALL-E 2, then Mistral)."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "What the image should show",
                },
            },
            "required": ["prompt"],
        },
        handler=_generate_image,
        mutating=False,
        gated=False,
        audience="both",
        display_name="Generate image",
    )
)
