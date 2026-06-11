"""Text embedding provider (OpenAI live, deterministic mock for tests)."""

from app.config import get_settings

settings = get_settings()


async def embed_text(text: str) -> list[float]:
    if settings.llm_mode == "mock" or not settings.openai_api_key:
        # Deterministic pseudo-embedding for tests
        base = [0.0] * settings.embedding_dimensions
        for i, ch in enumerate(text[:512]):
            base[i % settings.embedding_dimensions] += ord(ch) / 10000.0
        return base
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    response = await client.embeddings.create(model=settings.embedding_model, input=text[:8000])
    return response.data[0].embedding
