"""Embeddings: EU-default managed model (Mistral) or a deterministic mock.

The mock hashes tokens into a fixed-size vector so tests can exercise pgvector
without network access.
"""

from __future__ import annotations

import hashlib
import math
import re

import httpx

from bokito.config import get_settings
from bokito.domain.orient import EMBEDDING_DIMENSIONS

_TOKEN = re.compile(r"[a-z0-9]+")


def _mock_embed(text: str) -> list[float]:
    vec = [0.0] * EMBEDDING_DIMENSIONS
    for token in _TOKEN.findall(text.lower()):
        h = int(hashlib.blake2b(token.encode(), digest_size=8).hexdigest(), 16)
        vec[h % EMBEDDING_DIMENSIONS] += 1.0
        vec[(h >> 16) % EMBEDDING_DIMENSIONS] += 0.5
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


async def embed_texts(texts: list[str]) -> list[list[float]]:
    settings = get_settings()
    if not texts:
        return []
    if settings.llm_mode == "mock" or not settings.mistral_api_key:
        return [_mock_embed(t) for t in texts]
    provider, _, model = settings.embedding_model.partition(":")
    if provider != "mistral":
        return [_mock_embed(t) for t in texts]
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://api.mistral.ai/v1/embeddings",
            headers={"Authorization": f"Bearer {settings.mistral_api_key}"},
            json={"model": model or "mistral-embed", "input": texts},
        )
        r.raise_for_status()
        data = r.json()["data"]
    data.sort(key=lambda d: d["index"])
    return [d["embedding"] for d in data]
