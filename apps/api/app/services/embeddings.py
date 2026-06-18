"""Text embedding provider (OpenAI live, deterministic mock for tests)."""

from typing import Any

from app.config import get_settings

settings = get_settings()


def _mock_embedding(text: str) -> list[float]:
    # Deterministic pseudo-embedding for tests / mock mode.
    base = [0.0] * settings.embedding_dimensions
    for i, ch in enumerate(text[:512]):
        base[i % settings.embedding_dimensions] += ord(ch) / 10000.0
    return base


async def embed_text_with_usage(
    text: str,
    *,
    api_key: str | None = None,
    live: bool = False,
    model_id: str | None = None,
    base_url: str | None = None,
) -> tuple[list[float], int]:
    """Embed text, returning ``(vector, tokens_in)``.

    ``tokens_in`` is 0 in mock mode. Callers with a tenant context resolve the
    key + model via ``resolve_model_call`` and pass ``api_key``, ``live``, and
    ``model_id``.
    """
    effective_key = api_key if api_key is not None else settings.openai_api_key
    effective_live = live if api_key is not None else settings.llm_mode == "live"

    if not effective_live or not effective_key:
        return _mock_embedding(text), 0

    from openai import AsyncOpenAI

    kwargs: dict[str, Any] = {"api_key": effective_key}
    if base_url:
        kwargs["base_url"] = base_url
    client = AsyncOpenAI(**kwargs)
    response = await client.embeddings.create(
        model=model_id or settings.embedding_model, input=text[:8000]
    )
    tokens_in = getattr(response.usage, "prompt_tokens", 0) if response.usage else 0
    return response.data[0].embedding, tokens_in


async def embed_text(
    text: str,
    *,
    api_key: str | None = None,
    live: bool = False,
    model_id: str | None = None,
    base_url: str | None = None,
) -> list[float]:
    """Embed text and return only the vector (see ``embed_text_with_usage``)."""
    vector, _ = await embed_text_with_usage(
        text, api_key=api_key, live=live, model_id=model_id, base_url=base_url
    )
    return vector
