import json
import math
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.blueprint import BlueprintBlock, BlueprintPage
from app.models.index import IndexChunk

settings = get_settings()


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


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


async def search_index(
    session: AsyncSession, tenant_id: UUID, query: str, top_k: int = 8
) -> list[dict[str, Any]]:
    query_embedding = await embed_text(query)
    result = await session.execute(select(IndexChunk).where(IndexChunk.tenant_id == tenant_id))
    chunks = result.scalars().all()
    scored = []
    for chunk in chunks:
        emb = json.loads(chunk.embedding_json or "[]")
        score = _cosine_similarity(query_embedding, emb)
        scored.append((score, chunk))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [
        {
            "source_type": chunk.source_type,
            "source_id": chunk.source_id,
            "title": chunk.title,
            "content": chunk.content,
            "score": score,
        }
        for score, chunk in scored[:top_k]
        if score > 0
    ]


async def upsert_index_chunk(
    session: AsyncSession,
    tenant_id: UUID,
    source_type: str,
    source_id: str,
    title: str,
    content: str,
    metadata: dict[str, Any] | None = None,
) -> IndexChunk:
    embedding = await embed_text(content)
    result = await session.execute(
        select(IndexChunk).where(
            IndexChunk.tenant_id == tenant_id,
            IndexChunk.source_type == source_type,
            IndexChunk.source_id == source_id,
        )
    )
    chunk = result.scalar_one_or_none()
    if chunk:
        chunk.title = title
        chunk.content = content
        chunk.embedding_json = json.dumps(embedding)
        chunk.metadata_json = json.dumps(metadata or {})
    else:
        chunk = IndexChunk(
            tenant_id=tenant_id,
            source_type=source_type,
            source_id=source_id,
            title=title,
            content=content,
            embedding_json=json.dumps(embedding),
            metadata_json=json.dumps(metadata or {}),
        )
        session.add(chunk)
    await session.commit()
    await session.refresh(chunk)
    return chunk


async def build_core_summary(session: AsyncSession, tenant_id: UUID) -> str:
    result = await session.execute(
        select(IndexChunk).where(
            IndexChunk.tenant_id == tenant_id,
            IndexChunk.source_type == "blueprint_summary",
        )
    )
    chunk = result.scalar_one_or_none()
    if chunk:
        return chunk.content
    full = await build_blueprint_context(session, tenant_id)
    return full[:1500]


async def build_blueprint_context(session: AsyncSession, tenant_id: UUID) -> str:
    pages_result = await session.execute(
        select(BlueprintPage).where(BlueprintPage.tenant_id == tenant_id).order_by(BlueprintPage.sort_order)
    )
    pages = pages_result.scalars().all()
    lines = ["# Tenant Blueprint"]
    for page in pages:
        lines.append(f"\n## {page.title} ({page.kind})")
        blocks_result = await session.execute(
            select(BlueprintBlock)
            .where(BlueprintBlock.page_id == page.id)
            .order_by(BlueprintBlock.sort_order)
        )
        for block in blocks_result.scalars().all():
            content = json.loads(block.content_json or "{}")
            text = content.get("text") or content.get("markdown") or str(content)
            lines.append(f"- [{block.block_type}] {text[:500]}")
    return "\n".join(lines)
