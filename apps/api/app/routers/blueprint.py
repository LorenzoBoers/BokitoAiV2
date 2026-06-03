import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.blueprint import (
    BlueprintBlock,
    BlueprintChangeRequest,
    BlueprintDoc,
    BlueprintPage,
)
from app.services.agent.rag import upsert_index_chunk

router = APIRouter(prefix="/blueprint", tags=["blueprint"])


class PageCreate(BaseModel):
    title: str
    slug: str
    kind: str = "page"
    parent_id: UUID | None = None


class BlockCreate(BaseModel):
    block_type: str = "paragraph"
    content: dict
    sort_order: int = 0


class ChangeRequestCreate(BaseModel):
    title: str
    body: str = ""
    page_id: UUID | None = None
    priority: int = 2


async def _get_or_create_doc(session: AsyncSession, tenant_id: UUID) -> BlueprintDoc:
    result = await session.execute(select(BlueprintDoc).where(BlueprintDoc.tenant_id == tenant_id))
    doc = result.scalar_one_or_none()
    if doc:
        return doc
    doc = BlueprintDoc(tenant_id=tenant_id, title="Blueprint")
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    return doc


@router.get("")
async def get_blueprint(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    doc = await _get_or_create_doc(session, auth.tenant.id)
    pages_result = await session.execute(
        select(BlueprintPage).where(BlueprintPage.doc_id == doc.id).order_by(BlueprintPage.sort_order)
    )
    pages = []
    for page in pages_result.scalars().all():
        blocks_result = await session.execute(
            select(BlueprintBlock)
            .where(BlueprintBlock.page_id == page.id)
            .order_by(BlueprintBlock.sort_order)
        )
        pages.append(
            {
                "id": str(page.id),
                "title": page.title,
                "slug": page.slug,
                "kind": page.kind,
                "blocks": [
                    {
                        "id": str(b.id),
                        "block_type": b.block_type,
                        "content": json.loads(b.content_json or "{}"),
                        "sort_order": b.sort_order,
                    }
                    for b in blocks_result.scalars().all()
                ],
            }
        )
    return {"doc_id": str(doc.id), "title": doc.title, "pages": pages}


@router.post("/pages")
async def create_page(
    body: PageCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    doc = await _get_or_create_doc(session, auth.tenant.id)
    page = BlueprintPage(
        doc_id=doc.id,
        tenant_id=auth.tenant.id,
        parent_id=body.parent_id,
        title=body.title,
        slug=body.slug,
        kind=body.kind,
    )
    session.add(page)
    await session.commit()
    await session.refresh(page)
    return {"id": str(page.id), "slug": page.slug}


@router.post("/pages/{page_id}/blocks")
async def create_block(
    page_id: UUID,
    body: BlockCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    page_result = await session.execute(
        select(BlueprintPage).where(BlueprintPage.id == page_id, BlueprintPage.tenant_id == auth.tenant.id)
    )
    page = page_result.scalar_one_or_none()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    block = BlueprintBlock(
        page_id=page_id,
        tenant_id=auth.tenant.id,
        block_type=body.block_type,
        content_json=json.dumps(body.content),
        sort_order=body.sort_order,
    )
    session.add(block)
    await session.commit()
    await session.refresh(block)
    text = body.content.get("text") or body.content.get("markdown") or json.dumps(body.content)
    await upsert_index_chunk(session, auth.tenant.id, "blueprint_block", str(block.id), page.title, text)
    return {"id": str(block.id)}


@router.post("/change-requests")
async def create_change_request(
    body: ChangeRequestCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    cr = BlueprintChangeRequest(
        tenant_id=auth.tenant.id,
        page_id=body.page_id,
        title=body.title,
        body=body.body,
        priority=body.priority,
    )
    session.add(cr)
    await session.commit()
    await session.refresh(cr)
    # Trigger background agent run via arq (enqueued from worker)
    from app.workers.tasks import enqueue_change_request_run

    await enqueue_change_request_run(str(auth.tenant.id), str(cr.id))
    return {"id": str(cr.id), "status": cr.status}
