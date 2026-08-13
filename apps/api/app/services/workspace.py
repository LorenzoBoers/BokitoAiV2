"""Workspace markdown docs: CRUD, frontmatter, chunking, hybrid search.

The workspace is the agents' file-style memory: persona, long-term memory,
skills (SKILL.md pattern: compact list injected, body read on demand),
plain docs, daily logs, and heartbeat checklists. Every write re-chunks the
doc into DocChunk rows used by hybrid (vector + keyword) retrieval.
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workspace import DOC_KINDS, DocChunk, WorkspaceDoc

CHUNK_TARGET_CHARS = 1500


# ── frontmatter ──────────────────────────────────────────────────


def parse_frontmatter(raw: str) -> tuple[dict[str, str], str]:
    """Extract simple `key: value` frontmatter between leading --- markers."""
    if not raw.startswith("---"):
        return {}, raw
    end = raw.find("\n---", 3)
    if end == -1:
        return {}, raw
    header = raw[3:end].strip()
    body = raw[end + 4 :].lstrip("\n")
    meta: dict[str, str] = {}
    for line in header.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip().strip("\"'")
    return meta, body


def render_frontmatter(meta: dict[str, Any]) -> str:
    if not meta:
        return ""
    lines = [f"{k}: {v}" for k, v in meta.items() if v not in (None, "")]
    return "---\n" + "\n".join(lines) + "\n---\n" if lines else ""


# ── chunking ─────────────────────────────────────────────────────


def chunk_markdown(content: str) -> list[tuple[str, str]]:
    """Split markdown into (heading, text) chunks around section boundaries."""
    sections: list[tuple[str, list[str]]] = []
    current_heading = ""
    current_lines: list[str] = []
    for line in content.splitlines():
        if re.match(r"^#{1,3}\s", line):
            if current_lines:
                sections.append((current_heading, current_lines))
            current_heading = line.lstrip("# ").strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_lines:
        sections.append((current_heading, current_lines))

    chunks: list[tuple[str, str]] = []
    for heading, lines in sections:
        text = "\n".join(lines).strip()
        if not text:
            continue
        while len(text) > CHUNK_TARGET_CHARS:
            cut = text.rfind("\n", 0, CHUNK_TARGET_CHARS)
            if cut <= 0:
                cut = CHUNK_TARGET_CHARS
            chunks.append((heading, text[:cut].strip()))
            text = text[cut:].strip()
        if text:
            chunks.append((heading, text))
    return chunks


# ── search (hybrid: vector + keyword) ────────────────────────────


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


_WORD_RE = re.compile(r"[a-z0-9]{2,}")


def _tokens(text: str) -> set[str]:
    return set(_WORD_RE.findall(text.lower()))


def _keyword_score(query_tokens: set[str], text: str) -> float:
    if not query_tokens:
        return 0.0
    doc_tokens = _tokens(text)
    if not doc_tokens:
        return 0.0
    return len(query_tokens & doc_tokens) / len(query_tokens)


async def hybrid_search(
    session: AsyncSession,
    tenant_id: UUID,
    query: str,
    top_k: int = 8,
    *,
    source_types: list[str] | None = None,
) -> list[dict[str, Any]]:
    from app.services.embeddings import embed_text_with_usage
    from app.services.model_resolution import record_usage, resolve_model_call

    resolved = await resolve_model_call(session, tenant_id, kind="embedding")
    query_embedding, emb_tokens = await embed_text_with_usage(
        query,
        api_key=resolved.api_key,
        live=resolved.live,
        model_id=resolved.model_id,
        base_url=resolved.base_url or None,
    )
    if emb_tokens:
        await record_usage(
            session, tenant_id, resolved, tokens_in=emb_tokens, tokens_out=0,
            scope="embedding", call_type="embedding",
        )
    query_tokens = _tokens(query)
    stmt = select(DocChunk).where(DocChunk.tenant_id == tenant_id)
    if source_types:
        stmt = stmt.where(DocChunk.source_type.in_(source_types))
    result = await session.execute(stmt)
    scored = []
    for chunk in result.scalars().all():
        try:
            emb = json.loads(chunk.embedding_json or "[]")
        except json.JSONDecodeError:
            emb = []
        vector = _cosine(query_embedding, emb)
        keyword = _keyword_score(query_tokens, f"{chunk.title}\n{chunk.content}")
        score = 0.6 * vector + 0.4 * keyword
        if score > 0:
            scored.append((score, chunk))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [
        {
            "source_type": chunk.source_type,
            "source_id": chunk.source_id,
            "doc_id": str(chunk.doc_id) if chunk.doc_id else None,
            "title": chunk.title,
            "content": chunk.content,
            "score": round(score, 4),
        }
        for score, chunk in scored[:top_k]
    ]


async def upsert_source_chunk(
    session: AsyncSession,
    tenant_id: UUID,
    source_type: str,
    source_id: str,
    title: str,
    content: str,
    metadata: dict[str, Any] | None = None,
) -> DocChunk:
    """Index a non-doc source (email, repo file) as a single chunk."""
    from app.services.embeddings import embed_text_with_usage
    from app.services.model_resolution import record_usage, resolve_model_call

    resolved = await resolve_model_call(session, tenant_id, kind="embedding")
    embedding, emb_tokens = await embed_text_with_usage(
        content,
        api_key=resolved.api_key,
        live=resolved.live,
        model_id=resolved.model_id,
        base_url=resolved.base_url or None,
    )
    if emb_tokens:
        await record_usage(
            session, tenant_id, resolved, tokens_in=emb_tokens, tokens_out=0,
            scope="embedding", call_type="embedding",
        )
    result = await session.execute(
        select(DocChunk).where(
            DocChunk.tenant_id == tenant_id,
            DocChunk.source_type == source_type,
            DocChunk.source_id == source_id,
        )
    )
    chunk = result.scalar_one_or_none()
    if chunk:
        chunk.title = title
        chunk.content = content
        chunk.embedding_json = json.dumps(embedding)
        chunk.metadata_json = json.dumps(metadata or {})
    else:
        chunk = DocChunk(
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


# ── doc CRUD ─────────────────────────────────────────────────────


def serialize_doc(doc: WorkspaceDoc, *, include_content: bool = True) -> dict[str, Any]:
    try:
        frontmatter = json.loads(doc.frontmatter_json or "{}")
    except json.JSONDecodeError:
        frontmatter = {}
    data = {
        "id": str(doc.id),
        "path": doc.path,
        "kind": doc.kind,
        "title": doc.title,
        "frontmatter": frontmatter,
        "is_pinned": doc.is_pinned,
        "sort_order": doc.sort_order,
        "created_by_type": doc.created_by_type,
        "created_at": doc.created_at.isoformat(),
        "updated_at": doc.updated_at.isoformat(),
    }
    if include_content:
        data["content"] = doc.content
    return data


def _normalize_path(path: str) -> str:
    cleaned = path.strip().strip("/").replace("\\", "/")
    if not cleaned:
        raise HTTPException(status_code=400, detail="Doc path required")
    if ".." in cleaned:
        raise HTTPException(status_code=400, detail="Invalid doc path")
    if not cleaned.endswith(".md"):
        cleaned = f"{cleaned}.md"
    return cleaned


def _title_from(path: str, meta: dict[str, str], body: str) -> str:
    if meta.get("name"):
        return meta["name"]
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    stem = path.rsplit("/", 1)[-1]
    return stem[:-3].replace("-", " ").replace("_", " ").title() if stem.endswith(".md") else stem


async def get_doc(session: AsyncSession, tenant_id: UUID, doc_id: UUID) -> WorkspaceDoc | None:
    result = await session.execute(
        select(WorkspaceDoc).where(WorkspaceDoc.id == doc_id, WorkspaceDoc.tenant_id == tenant_id)
    )
    return result.scalar_one_or_none()


async def get_doc_by_path(session: AsyncSession, tenant_id: UUID, path: str) -> WorkspaceDoc | None:
    result = await session.execute(
        select(WorkspaceDoc).where(
            WorkspaceDoc.tenant_id == tenant_id, WorkspaceDoc.path == _normalize_path(path)
        )
    )
    return result.scalar_one_or_none()


async def list_docs(
    session: AsyncSession, tenant_id: UUID, *, kind: str | None = None
) -> list[WorkspaceDoc]:
    stmt = select(WorkspaceDoc).where(WorkspaceDoc.tenant_id == tenant_id)
    if kind:
        stmt = stmt.where(WorkspaceDoc.kind == kind)
    stmt = stmt.order_by(WorkspaceDoc.sort_order, WorkspaceDoc.path)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def reindex_doc(session: AsyncSession, doc: WorkspaceDoc) -> int:
    from app.services.embeddings import embed_text_with_usage
    from app.services.model_resolution import record_usage, resolve_model_call

    resolved = await resolve_model_call(session, doc.tenant_id, kind="embedding")
    await session.execute(delete(DocChunk).where(DocChunk.doc_id == doc.id))
    count = 0
    for heading, text in chunk_markdown(doc.content):
        embedding, emb_tokens = await embed_text_with_usage(
            f"{doc.title}\n{heading}\n{text}",
            api_key=resolved.api_key,
            live=resolved.live,
            model_id=resolved.model_id,
            base_url=resolved.base_url or None,
        )
        if emb_tokens:
            await record_usage(
                session, doc.tenant_id, resolved, tokens_in=emb_tokens, tokens_out=0,
                scope="embedding", call_type="embedding",
            )
        session.add(
            DocChunk(
                tenant_id=doc.tenant_id,
                doc_id=doc.id,
                source_type="workspace_doc",
                source_id=doc.path,
                title=f"{doc.title}{f' / {heading}' if heading else ''}",
                content=text,
                embedding_json=json.dumps(embedding),
                metadata_json=json.dumps({"kind": doc.kind, "path": doc.path}),
            )
        )
        count += 1
    await session.flush()
    return count


async def upsert_doc(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    path: str,
    content: str,
    kind: str | None = None,
    title: str | None = None,
    created_by_type: str = "user",
    created_by_id: str = "",
    commit: bool = True,
) -> WorkspaceDoc:
    norm = _normalize_path(path)
    meta, body = parse_frontmatter(content)
    if kind and kind not in DOC_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid doc kind: {kind}")

    doc = await get_doc_by_path(session, tenant_id, norm)
    if doc:
        doc.content = body
        doc.frontmatter_json = json.dumps(meta)
        if kind:
            doc.kind = kind
        doc.title = title or _title_from(norm, meta, body)
        doc.updated_at = datetime.utcnow()
    else:
        inferred_kind = kind or _infer_kind(norm)
        # Keep created_at == updated_at on first write so "explicitly saved
        # after bootstrap" checks (e.g. onboarding) compare cleanly.
        now = datetime.utcnow()
        doc = WorkspaceDoc(
            tenant_id=tenant_id,
            path=norm,
            kind=inferred_kind,
            title=title or _title_from(norm, meta, body),
            content=body,
            frontmatter_json=json.dumps(meta),
            created_by_type=created_by_type,
            created_by_id=created_by_id,
            created_at=now,
            updated_at=now,
        )
        session.add(doc)
    await session.flush()
    await reindex_doc(session, doc)
    if commit:
        await session.commit()
        await session.refresh(doc)
    return doc


def _infer_kind(path: str) -> str:
    head = path.split("/", 1)[0]
    if head in ("skills", "skill"):
        return "skill"
    if head in ("memory", "memories") or path == "memory.md":
        return "memory"
    if path == "persona.md" or head == "persona":
        return "persona"
    if head in ("logs", "log", "daily"):
        return "daily_log"
    if head == "heartbeat" or path == "heartbeat.md":
        return "heartbeat"
    return "doc"


async def delete_doc(session: AsyncSession, tenant_id: UUID, doc_id: UUID) -> None:
    doc = await get_doc(session, tenant_id, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Doc not found")
    await session.execute(delete(DocChunk).where(DocChunk.doc_id == doc.id))
    await session.delete(doc)
    await session.commit()


# ── agent context assembly ───────────────────────────────────────


async def skills_overview(session: AsyncSession, tenant_id: UUID) -> str:
    """Compact skills list: name + description only; bodies read on demand."""
    docs = await list_docs(session, tenant_id, kind="skill")
    if not docs:
        return ""
    lines = []
    for doc in docs:
        try:
            meta = json.loads(doc.frontmatter_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        description = meta.get("description", "")
        lines.append(f"- {doc.path}: {meta.get('name', doc.title)}{f' — {description}' if description else ''}")
    return "\n".join(lines)


async def build_workspace_context(session: AsyncSession, tenant_id: UUID) -> str:
    """Company + persona + memory + skills + live tenant snapshot for the system prompt."""
    parts: list[str] = []
    company = await get_doc_by_path(session, tenant_id, "company.md")
    if company and company.content.strip():
        parts.append(f"## Company\n{company.content[:2000]}")
    persona = await list_docs(session, tenant_id, kind="persona")
    if persona and persona[0].content.strip():
        parts.append(f"## Persona\n{persona[0].content[:2000]}")
    memory = await list_docs(session, tenant_id, kind="memory")
    if memory and memory[0].content.strip():
        parts.append(f"## Long-term memory\n{memory[0].content[:2500]}")
    skills = await skills_overview(session, tenant_id)
    if skills:
        parts.append(
            "## Skills (read the full doc with the read_doc tool before using one)\n" + skills
        )
    try:
        from app.services.tenant_introspection import build_tenant_snapshot_prompt

        snapshot = await build_tenant_snapshot_prompt(session, tenant_id)
        if snapshot.strip():
            parts.append(snapshot)
    except Exception:
        # Never break chat if snapshot queries fail.
        pass
    return "\n\n".join(parts)
