"""Knowledge: docs, memory, personas, skills and snippets, searchable with pgvector."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.agent.embeddings import embed_texts
from bokito.domain.base import utcnow
from bokito.domain.orient import Doc, DocChunk, DocKind
from bokito.errors import NotFound

CHUNK_CHARS = 1200


def slugify_path(title: str, kind: DocKind) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80] or "untitled"
    return f"{kind.value}s/{slug}.md"


def chunk_markdown(body: str) -> list[tuple[str, str]]:
    """Split on headings, then on size. Returns (heading, text) pairs."""
    chunks: list[tuple[str, str]] = []
    heading = ""
    buffer: list[str] = []

    def flush() -> None:
        text = "\n".join(buffer).strip()
        if not text:
            return
        while len(text) > CHUNK_CHARS:
            cut = text.rfind("\n", 0, CHUNK_CHARS)
            if cut < CHUNK_CHARS // 2:
                cut = CHUNK_CHARS
            chunks.append((heading, text[:cut].strip()))
            text = text[cut:].strip()
        if text:
            chunks.append((heading, text))

    for line in body.splitlines():
        if line.startswith("#"):
            flush()
            buffer = []
            heading = line.lstrip("#").strip()
        buffer.append(line)
    flush()
    return chunks


async def reindex(session: AsyncSession, doc: Doc) -> int:
    await session.execute(delete(DocChunk).where(DocChunk.doc_id == doc.id))
    pairs = chunk_markdown(doc.body)
    if doc.title:
        pairs = [(h, f"{doc.title}\n{t}" if i == 0 else t) for i, (h, t) in enumerate(pairs)]
    vectors = await embed_texts([t for _, t in pairs])
    for i, ((heading, text), vec) in enumerate(zip(pairs, vectors, strict=True)):
        session.add(
            DocChunk(
                tenant_id=doc.tenant_id,
                doc_id=doc.id,
                position=i,
                heading=heading[:300],
                text=text,
                embedding=vec,
                token_count=len(text) // 4,
            )
        )
    doc.indexed_at = utcnow()
    await session.flush()
    return len(pairs)


async def upsert(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    title: str,
    body: str,
    kind: DocKind = DocKind.doc,
    path: str | None = None,
    frontmatter: dict[str, Any] | None = None,
    published: bool | None = None,
    ai_maintained: bool = False,
    source: str = "",
    connection_id: uuid.UUID | None = None,
) -> Doc:
    path = path or slugify_path(title, kind)
    doc = await session.scalar(select(Doc).where(Doc.tenant_id == tenant_id, Doc.path == path))
    if doc is None:
        doc = Doc(tenant_id=tenant_id, path=path, kind=kind, title=title, body=body)
        session.add(doc)
    doc.title = title[:300]
    doc.body = body
    doc.kind = kind
    if frontmatter is not None:
        doc.frontmatter = frontmatter
    if published is not None:
        doc.published = published
    doc.ai_maintained = ai_maintained or doc.ai_maintained
    if source:
        doc.source = source
    if connection_id:
        doc.connection_id = connection_id
    await session.flush()
    await reindex(session, doc)
    return doc


async def get(session: AsyncSession, tenant_id: uuid.UUID, doc_id: uuid.UUID) -> Doc:
    doc = await session.get(Doc, doc_id)
    if not doc or doc.tenant_id != tenant_id:
        raise NotFound("doc not found", code="doc_not_found")
    return doc


async def get_by_path(session: AsyncSession, tenant_id: uuid.UUID, path: str) -> Doc | None:
    return await session.scalar(select(Doc).where(Doc.tenant_id == tenant_id, Doc.path == path))


async def list_docs(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    kind: DocKind | None = None,
    q: str | None = None,
) -> list[Doc]:
    stmt = select(Doc).where(Doc.tenant_id == tenant_id)
    if kind:
        stmt = stmt.where(Doc.kind == kind)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Doc.title.ilike(like), Doc.path.ilike(like)))
    stmt = stmt.order_by(Doc.kind, Doc.title)
    return list((await session.scalars(stmt)).all())


async def remove(session: AsyncSession, doc: Doc) -> None:
    await session.delete(doc)
    await session.flush()


@dataclass
class Hit:
    doc_id: uuid.UUID
    path: str
    title: str
    kind: str
    heading: str
    text: str
    score: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "doc_id": str(self.doc_id),
            "path": self.path,
            "title": self.title,
            "kind": self.kind,
            "heading": self.heading,
            "text": self.text,
            "score": round(self.score, 4),
        }


async def search(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    query: str,
    *,
    kinds: list[DocKind] | None = None,
    limit: int = 6,
    published_only: bool = False,
) -> list[Hit]:
    query = query.strip()
    if not query:
        return []
    [vec] = await embed_texts([query])
    distance = DocChunk.embedding.cosine_distance(vec)
    stmt = (
        select(DocChunk, Doc, distance.label("distance"))
        .join(Doc, Doc.id == DocChunk.doc_id)
        .where(DocChunk.tenant_id == tenant_id, DocChunk.embedding.is_not(None))
    )
    if kinds:
        stmt = stmt.where(Doc.kind.in_(kinds))
    if published_only:
        stmt = stmt.where(Doc.published.is_(True))
    stmt = stmt.order_by(distance).limit(limit * 3)
    rows = (await session.execute(stmt)).all()

    # Lexical boost keeps exact term hits on top when embeddings are weak (mock mode).
    terms = [t for t in re.findall(r"[a-z0-9]+", query.lower()) if len(t) > 2]
    hits: list[Hit] = []
    for chunk, doc, dist in rows:
        text_l = chunk.text.lower()
        lexical = sum(1 for t in terms if t in text_l) / (len(terms) or 1)
        score = (1.0 - float(dist)) * 0.7 + lexical * 0.3
        hits.append(
            Hit(doc.id, doc.path, doc.title, doc.kind.value, chunk.heading, chunk.text, score)
        )
    hits.sort(key=lambda h: h.score, reverse=True)
    return hits[:limit]
