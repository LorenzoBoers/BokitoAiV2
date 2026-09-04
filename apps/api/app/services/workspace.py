"""Workspace markdown docs: pages + sections, frontmatter, chunking, hybrid search.

The workspace is the agents' file-style memory: persona, long-term memory,
skills (SKILL.md pattern: compact list injected, body read on demand),
plain docs, daily logs, and heartbeat checklists.

Knowledge is stored as pages (`WorkspaceDoc`) of small sections (`DocSection`):
one topic per section, its own maturity status and its own embedding chunk.
`WorkspaceDoc.content` is a derived render cache so whole-doc readers keep
working; every write path syncs sections and re-embeds only what changed.
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

from app.models.workspace import (
    DOC_KINDS,
    DOC_SECTION_STATUSES,
    DocChunk,
    DocSection,
    WorkspaceDoc,
)

CHUNK_TARGET_CHARS = 1500
# Knowledge skill: one topic per section, roughly 150-400 words. Agents get a
# hard ceiling (they must split); humans only get the guideline in the UI.
SECTION_MAX_WORDS = 450
SECTION_SPLIT_HINT = (
    "Section too long: keep one topic per section (roughly 150-400 words). "
    "Split the content into multiple `##` sections and write them separately."
)


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


# ── sections (atomic knowledge units) ────────────────────────────

_SECTION_HEADING_RE = re.compile(r"^##\s+(.+?)\s*$")
_WORDS_RE = re.compile(r"\S+")


def anchor_from(heading: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")
    return slug[:120] or "section"


def word_count(text: str) -> int:
    return len(_WORDS_RE.findall(text or ""))


def split_markdown_sections(content: str) -> list[tuple[str, str]]:
    """Split markdown into (heading, body) on `##` boundaries.

    Text before the first `##` (page title, intro) becomes a section with an
    empty heading. Bodies keep deeper headings (###...) intact.
    """
    sections: list[tuple[str, list[str]]] = []
    heading = ""
    lines: list[str] = []
    for line in (content or "").splitlines():
        match = _SECTION_HEADING_RE.match(line)
        if match:
            if lines or heading:
                sections.append((heading, lines))
            heading = match.group(1).strip()
            lines = []
        else:
            lines.append(line)
    if lines or heading:
        sections.append((heading, lines))
    out: list[tuple[str, str]] = []
    for head, body_lines in sections:
        body = "\n".join(body_lines).strip()
        if not head and not body:
            continue
        out.append((head, body))
    return out


def render_doc_content(sections: list[DocSection]) -> str:
    """Derived whole-page markdown from ordered sections."""
    parts: list[str] = []
    for section in sorted(sections, key=lambda s: s.position):
        body = (section.content or "").strip()
        if section.heading:
            parts.append(f"## {section.heading}" + (f"\n\n{body}" if body else ""))
        elif body:
            parts.append(body)
    return "\n\n".join(parts)


def serialize_section(section: DocSection) -> dict[str, Any]:
    return {
        "id": str(section.id),
        "doc_id": str(section.doc_id),
        "anchor": section.anchor,
        "heading": section.heading,
        "position": section.position,
        "content": section.content,
        "status": section.status,
        "status_changed_at": section.status_changed_at.isoformat()
        if section.status_changed_at
        else None,
        "status_changed_by_type": section.status_changed_by_type,
        "summary": section.summary,
        "edited_by_type": section.edited_by_type,
        "updated_at": section.updated_at.isoformat() if section.updated_at else None,
    }


async def list_sections(
    session: AsyncSession, tenant_id: UUID, doc_id: UUID
) -> list[DocSection]:
    result = await session.execute(
        select(DocSection)
        .where(DocSection.tenant_id == tenant_id, DocSection.doc_id == doc_id)
        .order_by(DocSection.position)
    )
    return list(result.scalars().all())


async def get_section(
    session: AsyncSession, tenant_id: UUID, section_id: UUID
) -> DocSection | None:
    result = await session.execute(
        select(DocSection).where(
            DocSection.id == section_id, DocSection.tenant_id == tenant_id
        )
    )
    return result.scalar_one_or_none()


async def _delete_section_rows(session: AsyncSession, section_ids: list[UUID]) -> None:
    """Remove sections plus their chunks and section-level task links."""
    if not section_ids:
        return
    from app.models.project_work import TaskDocLink

    await session.execute(delete(DocChunk).where(DocChunk.section_id.in_(section_ids)))
    await session.execute(
        delete(TaskDocLink).where(TaskDocLink.section_id.in_(section_ids))
    )
    await session.execute(delete(DocSection).where(DocSection.id.in_(section_ids)))


async def sync_sections_from_content(
    session: AsyncSession,
    doc: WorkspaceDoc,
    *,
    actor_type: str = "user",
    actor_id: str = "",
) -> list[DocSection]:
    """Align section rows with the doc's markdown (whole-page write path).

    Anchors are heading slugs, so a section keeps its id, status and links
    across saves as long as the heading survives. Sections whose heading
    disappeared are deleted together with their chunks and section links.
    """
    existing = (
        await session.execute(select(DocSection).where(DocSection.doc_id == doc.id))
    ).scalars().all()
    by_anchor = {section.anchor: section for section in existing}
    now = datetime.utcnow()

    seen: set[str] = set()
    out: list[DocSection] = []
    for position, (heading, body) in enumerate(split_markdown_sections(doc.content)):
        anchor = anchor_from(heading) if heading else "_intro"
        if anchor in seen:
            continue  # duplicate headings collapse into the first section
        seen.add(anchor)
        section = by_anchor.get(anchor)
        if section:
            changed = (
                section.heading != heading
                or section.position != position
                or section.content != body
            )
            section.heading = heading
            section.position = position
            section.content = body
            if changed:
                section.edited_by_type = actor_type
                section.edited_by_id = actor_id
                section.updated_at = now
            session.add(section)
        else:
            section = DocSection(
                tenant_id=doc.tenant_id,
                doc_id=doc.id,
                anchor=anchor,
                heading=heading,
                position=position,
                content=body,
                status="draft",
                edited_by_type=actor_type,
                edited_by_id=actor_id,
                created_at=now,
                updated_at=now,
            )
            session.add(section)
        out.append(section)

    vanished = [section.id for section in existing if section.anchor not in seen]
    await _delete_section_rows(session, vanished)
    await session.flush()
    return out


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
            "section_id": str(chunk.section_id) if getattr(chunk, "section_id", None) else None,
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
        "project_id": str(doc.project_id) if doc.project_id else None,
        "agent_id": str(doc.agent_id) if getattr(doc, "agent_id", None) else None,
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
    session: AsyncSession,
    tenant_id: UUID,
    *,
    kind: str | None = None,
    project_id: UUID | None = None,
    agent_id: UUID | None = None,
    scope: str | None = None,
    limit: int | None = None,
) -> list[WorkspaceDoc]:
    """List knowledge docs with optional scope filters.

    Defaults to organization knowledge (`project_id` and `agent_id` null).
    Pass `project_id` / `agent_id` to list that scope. Pass `scope="all"` to
    skip the org-only default (still filtered by any explicit ids).
    """
    stmt = select(WorkspaceDoc).where(WorkspaceDoc.tenant_id == tenant_id)
    if project_id is not None:
        stmt = stmt.where(WorkspaceDoc.project_id == project_id)
    elif agent_id is not None:
        stmt = stmt.where(WorkspaceDoc.agent_id == agent_id)
        stmt = stmt.where(WorkspaceDoc.project_id.is_(None))
    elif scope != "all":
        # Organization hub default: not project-scoped and not agent-personal.
        stmt = stmt.where(WorkspaceDoc.project_id.is_(None))
        stmt = stmt.where(WorkspaceDoc.agent_id.is_(None))
    if kind:
        stmt = stmt.where(WorkspaceDoc.kind == kind)
    stmt = stmt.order_by(WorkspaceDoc.sort_order, WorkspaceDoc.path)
    if limit is not None:
        stmt = stmt.limit(max(1, min(int(limit), 100)))
    result = await session.execute(stmt)
    return list(result.scalars().all())


def _section_chunk_metadata(doc: WorkspaceDoc, section: DocSection) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "kind": doc.kind,
        "path": doc.path,
        "section_status": section.status,
    }
    if section.heading:
        metadata["heading"] = section.heading
    if doc.project_id:
        metadata["project_id"] = str(doc.project_id)
    if getattr(doc, "agent_id", None):
        metadata["agent_id"] = str(doc.agent_id)
    return metadata


async def reindex_section(
    session: AsyncSession, doc: WorkspaceDoc, section: DocSection, *, resolved=None
) -> int:
    """(Re)embed one section: delete its chunks and write fresh ones."""
    from app.services.embeddings import embed_text_with_usage
    from app.services.model_resolution import record_usage, resolve_model_call

    if resolved is None:
        resolved = await resolve_model_call(session, doc.tenant_id, kind="embedding")
    await session.execute(delete(DocChunk).where(DocChunk.section_id == section.id))
    text = (section.content or "").strip()
    if not text and not section.heading:
        return 0
    parts: list[str] = []
    while len(text) > CHUNK_TARGET_CHARS:
        cut = text.rfind("\n", 0, CHUNK_TARGET_CHARS)
        if cut <= 0:
            cut = CHUNK_TARGET_CHARS
        parts.append(text[:cut].strip())
        text = text[cut:].strip()
    if text or section.heading:
        parts.append(text)
    count = 0
    metadata = _section_chunk_metadata(doc, section)
    for part in parts:
        embedding, emb_tokens = await embed_text_with_usage(
            f"{doc.title}\n{section.heading}\n{part}",
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
                section_id=section.id,
                source_type="workspace_doc",
                source_id=doc.path,
                title=f"{doc.title}{f' / {section.heading}' if section.heading else ''}",
                content=part,
                embedding_json=json.dumps(embedding),
                metadata_json=json.dumps(metadata),
            )
        )
        count += 1
    await session.flush()
    return count


async def reindex_doc(session: AsyncSession, doc: WorkspaceDoc) -> int:
    """Full re-embed: one or more chunks per section."""
    from app.services.model_resolution import resolve_model_call

    resolved = await resolve_model_call(session, doc.tenant_id, kind="embedding")
    await session.execute(delete(DocChunk).where(DocChunk.doc_id == doc.id))
    sections = await list_sections(session, doc.tenant_id, doc.id)
    if not sections and (doc.content or "").strip():
        # Callers that write doc.content directly (e.g. KB file ingestion)
        # get their section rows derived here, keeping sections the only
        # indexed unit.
        sections = await sync_sections_from_content(
            session, doc, actor_type=doc.created_by_type or "user"
        )
    count = 0
    for section in sections:
        count += await reindex_section(session, doc, section, resolved=resolved)
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
    project_id: UUID | None = None,
    agent_id: UUID | None = None,
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
        # The editor round-trips the body only (serialize_doc strips
        # frontmatter into its own field), so a save without a frontmatter
        # block must not wipe existing metadata (source_file, published, ...).
        if meta:
            doc.frontmatter_json = json.dumps(meta)
        if kind:
            doc.kind = kind
        doc.title = title or _title_from(norm, meta, body)
        if project_id is not None:
            doc.project_id = project_id
        if agent_id is not None:
            doc.agent_id = agent_id
        doc.updated_at = datetime.utcnow()
    else:
        inferred_kind = kind or ("project_doc" if project_id else _infer_kind(norm))
        # Keep created_at == updated_at on first write so "explicitly saved
        # after bootstrap" checks (e.g. onboarding) compare cleanly.
        now = datetime.utcnow()
        doc = WorkspaceDoc(
            tenant_id=tenant_id,
            project_id=project_id,
            agent_id=agent_id,
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
    # Sections are the source of truth; the blob write path syncs them and the
    # content column stays as the derived render cache.
    await sync_sections_from_content(
        session, doc, actor_type=created_by_type, actor_id=created_by_id
    )
    await reindex_doc(session, doc)
    if commit:
        await session.commit()
        await session.refresh(doc)
    return doc


def enforce_section_limit(content: str) -> None:
    """Hard ceiling for agent-written sections; raises with a split hint."""
    if word_count(content) > SECTION_MAX_WORDS:
        raise HTTPException(status_code=422, detail=SECTION_SPLIT_HINT)


async def upsert_section(
    session: AsyncSession,
    tenant_id: UUID,
    doc: WorkspaceDoc,
    *,
    heading: str,
    content: str,
    mode: str = "replace",
    summary: str | None = None,
    position: int | None = None,
    actor_type: str = "user",
    actor_id: str = "",
    enforce_limit: bool = False,
    commit: bool = True,
) -> DocSection:
    """Create or update one section on a page and re-embed only that section."""
    anchor = anchor_from(heading) if heading else "_intro"
    existing = (
        await session.execute(
            select(DocSection).where(
                DocSection.doc_id == doc.id, DocSection.anchor == anchor
            )
        )
    ).scalar_one_or_none()
    now = datetime.utcnow()
    if existing and mode == "append" and existing.content.strip():
        content = f"{existing.content.rstrip()}\n\n{content}"
    if enforce_limit:
        enforce_section_limit(content)
    if existing:
        existing.heading = heading
        existing.content = content
        if summary is not None:
            existing.summary = summary
        if position is not None:
            existing.position = position
        existing.edited_by_type = actor_type
        existing.edited_by_id = actor_id
        existing.updated_at = now
        # An edited section is no longer verified knowledge.
        if existing.status == "final":
            existing.status = "review"
            existing.status_changed_at = now
            existing.status_changed_by_type = actor_type
            existing.status_changed_by_id = actor_id
        section = existing
    else:
        if position is None:
            rows = await list_sections(session, tenant_id, doc.id)
            position = (rows[-1].position + 1) if rows else 0
        section = DocSection(
            tenant_id=tenant_id,
            doc_id=doc.id,
            anchor=anchor,
            heading=heading,
            position=position,
            content=content,
            status="draft",
            summary=summary or "",
            edited_by_type=actor_type,
            edited_by_id=actor_id,
            created_at=now,
            updated_at=now,
        )
    session.add(section)
    await session.flush()
    # Refresh the derived page render and the section's own chunks.
    sections = await list_sections(session, tenant_id, doc.id)
    doc.content = render_doc_content(sections)
    doc.updated_at = now
    session.add(doc)
    await reindex_section(session, doc, section)
    if commit:
        await session.commit()
        await session.refresh(section)
    return section


async def update_section(
    session: AsyncSession,
    tenant_id: UUID,
    section_id: UUID,
    *,
    heading: str | None = None,
    content: str | None = None,
    summary: str | None = None,
    position: int | None = None,
    status: str | None = None,
    actor_type: str = "user",
    actor_id: str = "",
    commit: bool = True,
) -> DocSection:
    """Patch one section by id; the anchor stays stable across heading edits."""
    section = await get_section(session, tenant_id, section_id)
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    doc = await get_doc(session, tenant_id, section.doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Doc not found")
    now = datetime.utcnow()
    content_changed = False
    if heading is not None and heading != section.heading:
        section.heading = heading.strip()
        content_changed = True
    if content is not None and content != section.content:
        section.content = content
        content_changed = True
    if summary is not None:
        section.summary = summary
    if position is not None:
        section.position = position
    if content_changed:
        section.edited_by_type = actor_type
        section.edited_by_id = actor_id
        # Edited knowledge is no longer verified.
        if section.status == "final" and status is None:
            section.status = "review"
            section.status_changed_at = now
            section.status_changed_by_type = actor_type
            section.status_changed_by_id = actor_id
    if status is not None:
        if status not in DOC_SECTION_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid section status: {status}")
        if status != section.status:
            section.status = status
            section.status_changed_at = now
            section.status_changed_by_type = actor_type
            section.status_changed_by_id = actor_id
    section.updated_at = now
    session.add(section)
    await session.flush()
    sections = await list_sections(session, tenant_id, doc.id)
    doc.content = render_doc_content(sections)
    doc.updated_at = now
    session.add(doc)
    if content_changed:
        await reindex_section(session, doc, section)
    else:
        # Status/summary only: patch chunk metadata without re-embedding.
        chunks = (
            await session.execute(
                select(DocChunk).where(DocChunk.section_id == section.id)
            )
        ).scalars().all()
        metadata = _section_chunk_metadata(doc, section)
        for chunk in chunks:
            chunk.metadata_json = json.dumps(metadata)
            session.add(chunk)
    if commit:
        await session.commit()
        await session.refresh(section)
    return section


async def delete_section(
    session: AsyncSession, tenant_id: UUID, section_id: UUID, *, commit: bool = True
) -> None:
    section = await get_section(session, tenant_id, section_id)
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    doc = await get_doc(session, tenant_id, section.doc_id)
    await _delete_section_rows(session, [section.id])
    if doc is not None:
        sections = await list_sections(session, tenant_id, doc.id)
        doc.content = render_doc_content(sections)
        doc.updated_at = datetime.utcnow()
        session.add(doc)
    if commit:
        await session.commit()


async def set_section_status(
    session: AsyncSession,
    tenant_id: UUID,
    section_id: UUID,
    status: str,
    *,
    actor_type: str = "user",
    actor_id: str = "",
    summary: str | None = None,
    commit: bool = True,
) -> DocSection:
    """Maturity transition (draft -> review -> final) with audit + chunk metadata sync."""
    if status not in DOC_SECTION_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid section status: {status}")
    section = await get_section(session, tenant_id, section_id)
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    previous = section.status
    now = datetime.utcnow()
    section.status = status
    section.status_changed_at = now
    section.status_changed_by_type = actor_type
    section.status_changed_by_id = actor_id
    if summary is not None:
        section.summary = summary
    section.updated_at = now
    session.add(section)

    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action="doc_section:status",
        actor_type=actor_type,
        actor_id=actor_id,
        resource_type="doc_section",
        resource_id=str(section.id),
        summary=f"Section '{section.heading or section.anchor}' {previous} -> {status}",
        before={"status": previous},
        after={"status": status},
        commit=False,
    )
    # Patch chunk metadata in place; a status change needs no re-embedding.
    doc = await get_doc(session, tenant_id, section.doc_id)
    if doc is not None:
        chunks = (
            await session.execute(
                select(DocChunk).where(DocChunk.section_id == section.id)
            )
        ).scalars().all()
        metadata = _section_chunk_metadata(doc, section)
        for chunk in chunks:
            chunk.metadata_json = json.dumps(metadata)
            session.add(chunk)
    if commit:
        await session.commit()
        await session.refresh(section)
    return section


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
    sections = await list_sections(session, tenant_id, doc.id)
    await _delete_section_rows(session, [s.id for s in sections])
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


async def build_workspace_context(
    session: AsyncSession, tenant_id: UUID, *, agent_id: UUID | None = None
) -> str:
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
        from app.modules.catalog import active_module_skill_prompt

        module_skills = await active_module_skill_prompt(session, tenant_id)
        if module_skills:
            parts.append(module_skills)
    except Exception:
        # Module skills must never break prompt assembly.
        pass
    try:
        from app.services.tenant_introspection import build_tenant_snapshot_prompt

        snapshot = await build_tenant_snapshot_prompt(session, tenant_id, agent_id=agent_id)
        if snapshot.strip():
            parts.append(snapshot)
    except Exception:
        # Never break chat if snapshot queries fail.
        pass
    return "\n\n".join(parts)
