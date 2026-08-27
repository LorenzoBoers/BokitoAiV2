"""Knowledge base API backed by WorkspaceDoc.

Collections and documents are stored as `WorkspaceDoc` rows (kinds
`kb_collection` / `kb_doc`); KB-specific metadata lives in `frontmatter_json`.
The dashboard addresses collections/documents by a stable numeric id derived
from the row UUID.
"""

import json
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.auth import user_numeric_id
from app.models.workspace import WorkspaceDoc

router = APIRouter(prefix="/kb", tags=["kb"])

COLLECTION_KIND = "kb_collection"
DOCUMENT_KIND = "kb_doc"


def _slug(value: str) -> str:
    cleaned = "".join(c if c.isalnum() else "-" for c in value.lower()).strip("-")
    return cleaned or "item"


def _frontmatter(doc: WorkspaceDoc) -> dict[str, Any]:
    try:
        data = json.loads(doc.frontmatter_json or "{}")
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


class CollectionBody(BaseModel):
    name: str
    description: str | None = None


class DocumentBody(BaseModel):
    filename: str
    file_url: str
    file_type: str = "other"
    file_size_bytes: int = 0


async def _list_by_kind(
    session: AsyncSession, tenant_id: UUID, kind: str
) -> list[WorkspaceDoc]:
    result = await session.execute(
        select(WorkspaceDoc)
        .where(WorkspaceDoc.tenant_id == tenant_id, WorkspaceDoc.kind == kind)
        .order_by(WorkspaceDoc.created_at)
    )
    return list(result.scalars().all())


async def _get_by_numeric(
    session: AsyncSession, tenant_id: UUID, kind: str, numeric_id: int
) -> WorkspaceDoc | None:
    docs = await _list_by_kind(session, tenant_id, kind)
    for doc in docs:
        if user_numeric_id(doc.id) == numeric_id:
            return doc
    return None


async def _numeric_index(
    session: AsyncSession, tenant_id: UUID, kind: str
) -> dict[int, WorkspaceDoc]:
    docs = await _list_by_kind(session, tenant_id, kind)
    return {user_numeric_id(doc.id): doc for doc in docs}


def _serialize_document(doc: WorkspaceDoc) -> dict[str, Any]:
    meta = _frontmatter(doc)
    return {
        "id": user_numeric_id(doc.id),
        "collection_id": int(meta.get("collection_id") or 0),
        "filename": doc.title,
        "file_url": str(meta.get("file_url") or ""),
        "file_type": str(meta.get("file_type") or "other"),
        "file_size_bytes": int(meta.get("file_size_bytes") or 0),
        "index_status": str(meta.get("index_status") or "pending"),
        "index_error": str(meta.get("index_error") or "") or None,
    }


@router.get("/collections")
async def list_collections(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from sqlalchemy import func

    from app.models.workspace import DocChunk

    collections = await _list_by_kind(session, auth.tenant.id, COLLECTION_KIND)
    documents = await _list_by_kind(session, auth.tenant.id, DOCUMENT_KIND)
    chunks_by_doc: dict[UUID, int] = {}
    if documents:
        chunk_rows = await session.execute(
            select(DocChunk.doc_id, func.count(DocChunk.id))
            .where(DocChunk.doc_id.in_([doc.id for doc in documents]))
            .group_by(DocChunk.doc_id)
        )
        chunks_by_doc = {row[0]: int(row[1]) for row in chunk_rows.all()}
    counts: dict[int, int] = {}
    chunk_counts: dict[int, int] = {}
    for doc in documents:
        cid = int(_frontmatter(doc).get("collection_id") or 0)
        counts[cid] = counts.get(cid, 0) + 1
        chunk_counts[cid] = chunk_counts.get(cid, 0) + chunks_by_doc.get(doc.id, 0)
    items = []
    for col in collections:
        numeric = user_numeric_id(col.id)
        items.append(
            {
                "id": numeric,
                "name": col.title,
                "description": col.content or None,
                "document_count": counts.get(numeric, 0),
                "total_chunks": chunk_counts.get(numeric, 0),
            }
        )
    return {"items": items}


@router.post("/collections")
async def create_collection(
    body: CollectionBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    doc = WorkspaceDoc(
        tenant_id=auth.tenant.id,
        path=f"kb/collections/{_slug(name)}",
        kind=COLLECTION_KIND,
        title=name,
        content=(body.description or "").strip(),
        frontmatter_json="{}",
        created_by_type="user",
    )
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    return {
        "id": user_numeric_id(doc.id),
        "name": doc.title,
        "description": doc.content or None,
        "document_count": 0,
        "total_chunks": 0,
    }


@router.delete("/collections/{collection_id}")
async def delete_collection(
    collection_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    collection = await _get_by_numeric(session, auth.tenant.id, COLLECTION_KIND, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    from sqlalchemy import delete as sa_delete

    from app.models.workspace import DocChunk

    documents = await _list_by_kind(session, auth.tenant.id, DOCUMENT_KIND)
    for doc in documents:
        if int(_frontmatter(doc).get("collection_id") or 0) != collection_id:
            continue
        await session.execute(sa_delete(DocChunk).where(DocChunk.doc_id == doc.id))
        await session.delete(doc)
    await session.delete(collection)
    await session.commit()
    return {"ok": True}


@router.get("/collections/{collection_id}/documents")
async def list_documents(
    collection_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    collections = await _numeric_index(session, auth.tenant.id, COLLECTION_KIND)
    if collection_id not in collections:
        raise HTTPException(status_code=404, detail="Collection not found")
    documents = await _list_by_kind(session, auth.tenant.id, DOCUMENT_KIND)
    items = [
        _serialize_document(doc)
        for doc in documents
        if int(_frontmatter(doc).get("collection_id") or 0) == collection_id
    ]
    return {"items": items}


@router.post("/collections/{collection_id}/documents")
async def create_document(
    collection_id: int,
    body: DocumentBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    collection = await _get_by_numeric(session, auth.tenant.id, COLLECTION_KIND, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    filename = body.filename.strip()
    if not filename:
        raise HTTPException(status_code=400, detail="filename required")

    # Real ingestion: fetch the uploaded file, extract text, and chunk it into
    # the workspace vector pipeline so search_index actually finds it. The
    # index_status reflects what happened instead of a hardcoded "indexed".
    from app.services.doc_ingest import extract_text
    from app.services.storage import fetch_attachment_bytes

    content = ""
    index_status = "pending"
    index_error = ""
    data = await fetch_attachment_bytes(body.file_url) if body.file_url else None
    if data is None:
        index_status = "failed"
        index_error = "Could not fetch the uploaded file."
    else:
        try:
            content = extract_text(filename, data)
            index_status = "indexed"
        except HTTPException as exc:
            index_status = "unsupported" if exc.status_code == 415 else "failed"
            index_error = str(exc.detail)

    doc = WorkspaceDoc(
        tenant_id=auth.tenant.id,
        path=f"kb/docs/{_slug(filename)}-{collection_id}",
        kind=DOCUMENT_KIND,
        title=filename,
        content=content,
        frontmatter_json=json.dumps(
            {
                "collection_id": collection_id,
                "file_url": body.file_url,
                "file_type": body.file_type,
                "file_size_bytes": body.file_size_bytes,
                "index_status": index_status,
                **({"index_error": index_error} if index_error else {}),
            }
        ),
        created_by_type="user",
    )
    session.add(doc)
    await session.flush()
    if content:
        from app.services.workspace import reindex_doc

        await reindex_doc(session, doc)
    await session.commit()
    await session.refresh(doc)
    return _serialize_document(doc)


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    doc = await _get_by_numeric(session, auth.tenant.id, DOCUMENT_KIND, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    from sqlalchemy import delete as sa_delete

    from app.models.workspace import DocChunk

    await session.execute(sa_delete(DocChunk).where(DocChunk.doc_id == doc.id))
    await session.delete(doc)
    await session.commit()
    return {"ok": True}


@router.get("/search")
async def search(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    query: str = Query(default=""),
    limit: int = Query(default=5),
):
    needle = query.strip().lower()
    documents = await _list_by_kind(session, auth.tenant.id, DOCUMENT_KIND)
    matches = []
    for doc in documents:
        haystack = f"{doc.title}\n{doc.content}".lower()
        if not needle or needle in haystack:
            meta = _frontmatter(doc)
            matches.append(
                {
                    "id": user_numeric_id(doc.id),
                    "filename": doc.title,
                    "file_url": str(meta.get("file_url") or ""),
                }
            )
        if len(matches) >= max(1, limit):
            break
    return {"items": matches}
