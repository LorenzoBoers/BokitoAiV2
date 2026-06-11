"""Workspace markdown docs API: memory, persona, skills, docs, daily logs."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import workspace as svc

router = APIRouter(prefix="/workspace", tags=["workspace"])


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
