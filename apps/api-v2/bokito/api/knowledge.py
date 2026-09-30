"""Knowledge: docs and search."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Query

from bokito.api.schemas import DocOut, DocSummaryOut, ToolOutcomeOut
from bokito.deps import DbSession, Operator
from bokito.domain.orient import DocKind
from bokito.services import knowledge as kb
from bokito.tools import execute_tool
from bokito.tools.builtin.knowledge import WriteDocArgs

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.get("/docs", response_model=list[DocSummaryOut], summary="Documents")
async def list_docs(
    session: DbSession, principal: Operator, kind: DocKind | None = None, q: str | None = None
) -> list[DocSummaryOut]:
    return [
        DocSummaryOut.model_validate(d)
        for d in await kb.list_docs(session, principal.tenant_id, kind=kind, q=q)
    ]


@router.post("/docs", response_model=ToolOutcomeOut, summary="Create or update (tool: write_doc)")
async def write_doc(body: WriteDocArgs, session: DbSession, principal: Operator) -> ToolOutcomeOut:
    outcome = await execute_tool(session, principal, "write_doc", body.model_dump(mode="json"))
    await session.commit()
    return ToolOutcomeOut(**outcome.to_dict())


@router.get("/docs/{doc_id}", response_model=DocOut, summary="Document")
async def get_doc(doc_id: uuid.UUID, session: DbSession, principal: Operator) -> DocOut:
    return DocOut.model_validate(await kb.get(session, principal.tenant_id, doc_id))


@router.delete("/docs/{doc_id}", status_code=204, summary="Delete a document")
async def delete_doc(doc_id: uuid.UUID, session: DbSession, principal: Operator) -> None:
    doc = await kb.get(session, principal.tenant_id, doc_id)
    await kb.remove(session, doc)
    await session.commit()


@router.get("/search", summary="Search knowledge", response_model=list[dict])
async def search(
    session: DbSession,
    principal: Operator,
    q: str = Query(min_length=1),
    kind: list[DocKind] | None = Query(default=None),
    limit: int = Query(default=6, ge=1, le=20),
) -> list[dict[str, Any]]:
    hits = await kb.search(session, principal.tenant_id, q, kinds=kind, limit=limit)
    return [h.to_dict() for h in hits]
