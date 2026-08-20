"""Workspace markdown docs API: memory, persona, skills, docs, daily logs."""

import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.middleware.rate_limit import rate_limit
from app.services import workspace as svc

router = APIRouter(prefix="/workspace", tags=["workspace"])

MAX_INGEST_BYTES = 10 * 1024 * 1024


class DocCreateBody(BaseModel):
    path: str
    content: str = ""
    kind: str | None = None
    title: str | None = None


class DocUpdateBody(BaseModel):
    content: str | None = None
    kind: str | None = None
    title: str | None = None
    is_pinned: bool | None = None


class SearchBody(BaseModel):
    query: str
    top_k: int = 8
    source_types: list[str] | None = None


@router.get("/docs")
async def list_workspace_docs(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    kind: str | None = Query(None),
):
    docs = await svc.list_docs(session, auth.tenant.id, kind=kind)
    return {"docs": [svc.serialize_doc(d, include_content=False) for d in docs]}


@router.post("/docs")
async def create_workspace_doc(
    body: DocCreateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    doc = await svc.upsert_doc(
        session,
        auth.tenant.id,
        path=body.path,
        content=body.content,
        kind=body.kind,
        title=body.title,
        created_by_type="user",
        created_by_id=str(auth.user.id),
    )
    return svc.serialize_doc(doc)


def _upload_doc_path(filename: str) -> str:
    """Stable doc path per source filename: re-uploading updates the doc."""
    stem = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    stem = stem.rsplit(".", 1)[0] if "." in stem else stem
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-") or "document"
    return f"docs/uploads/{slug[:80]}.md"


@router.post("/docs/upload", dependencies=[Depends(rate_limit("doc-ingest", limit=20))])
async def upload_workspace_doc(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    file: UploadFile = File(...),
):
    """Ingest a document (PDF, Word, text, markdown) into the knowledge base.

    Extracts plain text, stores the original file for reference, and writes a
    WorkspaceDoc so the standard chunk + embed pipeline makes it retrievable
    in agent drafts. Re-uploading the same filename updates the existing doc.
    """
    from app.services.doc_ingest import extract_text
    from app.services.storage import get_storage_backend, guess_mime

    data = await file.read()
    if len(data) > MAX_INGEST_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    filename = file.filename or "document"
    text = extract_text(filename, data)

    stored = await get_storage_backend().store(
        data=data,
        filename=filename,
        mime=guess_mime(filename, file.content_type),
        tenant_id=str(auth.tenant.id),
    )
    source_url = stored.to_attachment().get("url", "")

    title = filename.rsplit(".", 1)[0].replace("-", " ").replace("_", " ").strip() or filename
    content = svc.render_frontmatter(
        {"source_file": filename, "source_url": source_url}
    ) + text
    doc = await svc.upsert_doc(
        session,
        auth.tenant.id,
        path=_upload_doc_path(filename),
        content=content,
        kind="doc",
        title=title,
        created_by_type="user",
        created_by_id=str(auth.user.id),
    )
    return svc.serialize_doc(doc, include_content=False)


@router.get("/docs/{doc_id}")
async def get_workspace_doc(
    doc_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    doc = await svc.get_doc(session, auth.tenant.id, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Doc not found")
    return svc.serialize_doc(doc)


@router.patch("/docs/{doc_id}")
async def update_workspace_doc(
    doc_id: UUID,
    body: DocUpdateBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    doc = await svc.get_doc(session, auth.tenant.id, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Doc not found")
    if body.is_pinned is not None:
        doc.is_pinned = body.is_pinned
    if body.content is not None or body.kind or body.title:
        doc = await svc.upsert_doc(
            session,
            auth.tenant.id,
            path=doc.path,
            content=body.content if body.content is not None else doc.content,
            kind=body.kind,
            title=body.title,
            created_by_type="user",
            created_by_id=str(auth.user.id),
        )
    else:
        await session.commit()
        await session.refresh(doc)
    return svc.serialize_doc(doc)


class DocPublishBody(BaseModel):
    published: bool


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:80] or "article"


@router.post("/docs/{doc_id}/publish")
async def publish_workspace_doc(
    doc_id: UUID,
    body: DocPublishBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Publish or unpublish a markdown doc on the tenant's public help center.

    Publishing is frontmatter-driven (`published` + stable `slug`), so the
    same WorkspaceDoc keeps feeding agent RAG. Only plain docs can go public;
    persona, memory, skills, and logs stay internal.
    """
    import json
    from datetime import datetime

    from app.routers.help_center import article_slug, is_published
    from app.services.audit import record_audit

    doc = await svc.get_doc(session, auth.tenant.id, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Doc not found")
    if doc.kind != "doc":
        raise HTTPException(status_code=400, detail="Only docs can be published")

    try:
        meta = json.loads(doc.frontmatter_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}

    if body.published:
        slug = str(meta.get("slug") or "").strip() or _slugify(doc.title or doc.path)
        # Keep slugs unique among the tenant's published articles.
        taken = set()
        for other in await svc.list_docs(session, auth.tenant.id, kind="doc"):
            if other.id == doc.id:
                continue
            try:
                other_meta = json.loads(other.frontmatter_json or "{}")
            except json.JSONDecodeError:
                other_meta = {}
            if isinstance(other_meta, dict) and is_published(other_meta):
                taken.add(article_slug(other, other_meta))
        base = slug
        suffix = 2
        while slug in taken:
            slug = f"{base}-{suffix}"
            suffix += 1
        meta["published"] = "true"
        meta["slug"] = slug
    else:
        meta.pop("published", None)

    doc.frontmatter_json = json.dumps(meta)
    doc.updated_at = datetime.utcnow()
    session.add(doc)
    await record_audit(
        session,
        tenant_id=auth.tenant.id,
        actor_type="user",
        actor_id=str(auth.user.id),
        action="doc.publish" if body.published else "doc.unpublish",
        resource_type="workspace_doc",
        resource_id=str(doc.id),
        summary=f"{'Published' if body.published else 'Unpublished'} '{doc.title}' on help center",
        commit=False,
    )
    await session.commit()
    await session.refresh(doc)
    return svc.serialize_doc(doc, include_content=False)


@router.delete("/docs/{doc_id}")
async def delete_workspace_doc(
    doc_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await svc.delete_doc(session, auth.tenant.id, doc_id)
    return {"ok": True}


@router.post("/search")
async def search_workspace(
    body: SearchBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    results = await svc.hybrid_search(
        session,
        auth.tenant.id,
        body.query,
        top_k=body.top_k,
        source_types=body.source_types,
    )
    return {"results": results}
