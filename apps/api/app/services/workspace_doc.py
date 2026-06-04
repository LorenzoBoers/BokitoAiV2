"""Workspace blueprint/doc service for the dashboard Notion-style editor.

Maps BlueprintDoc/Page/Block models to the workforce workspace-doc API contract
used by apps/dashboard/src/lib/workspace-doc-api.ts.
"""

import json
import uuid
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.blueprint import (
    BlockRevision,
    BlueprintBlock,
    BlueprintChangeRequest,
    BlueprintDoc,
    BlueprintPage,
)
from app.services.agent.rag import upsert_index_chunk

DOC_PAGE_KINDS = {
    "overview",
    "vision",
    "features",
    "brand",
    "tech",
    "marketing",
    "operations",
    "roadmap",
    "log",
    "notes",
    "custom",
    "page",
    "prd",
    "sop",
}


def _iso(value: datetime | None) -> str:
    return (value or datetime.utcnow()).isoformat()


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _block_text(content: dict[str, Any]) -> str:
    text_runs = content.get("text")
    if isinstance(text_runs, list):
        parts = []
        for run in text_runs:
            if isinstance(run, dict) and isinstance(run.get("text"), str):
                parts.append(run["text"])
        joined = "".join(parts).strip()
        if joined:
            return joined
    for key in ("markdown", "plain"):
        val = content.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


async def get_or_create_doc(session: AsyncSession, tenant_id: UUID) -> BlueprintDoc:
    result = await session.execute(select(BlueprintDoc).where(BlueprintDoc.tenant_id == tenant_id))
    doc = result.scalar_one_or_none()
    if doc:
        return doc
    doc = BlueprintDoc(tenant_id=tenant_id, title="Blueprint")
    session.add(doc)
    await session.flush()
    await session.commit()
    await session.refresh(doc)
    return doc


def serialize_doc_root(doc: BlueprintDoc) -> dict[str, Any]:
    return {
        "id": str(doc.id),
        "tenant_id": str(doc.tenant_id),
        "project_id": "",
        "title": doc.title,
        "created_at": _iso(doc.created_at),
        "updated_at": _iso(getattr(doc, "updated_at", None) or doc.created_at),
    }


def serialize_page(page: BlueprintPage, doc_id: UUID) -> dict[str, Any]:
    kind = page.kind if page.kind in DOC_PAGE_KINDS else "custom"
    return {
        "id": str(page.id),
        "tenant_id": str(page.tenant_id),
        "workspace_doc_id": str(doc_id),
        "parent_page_id": str(page.parent_id) if page.parent_id else None,
        "title": page.title,
        "slug": page.slug,
        "icon": page.icon,
        "kind": kind,
        "is_pinned": page.is_pinned,
        "is_locked": page.is_locked,
        "position": page.sort_order,
        "content_version": page.content_version,
        "rendered_markdown": None,
        "rendered_plaintext": None,
        "content_hash": None,
        "last_indexed_at": None,
        "archived_at": None,
        "created_at": _iso(page.created_at),
        "updated_at": _iso(getattr(page, "updated_at", None) or page.created_at),
    }


def serialize_block(block: BlueprintBlock, tenant_id: UUID) -> dict[str, Any]:
    content = _parse_json(block.content_json)
    return {
        "id": str(block.id),
        "tenant_id": str(tenant_id),
        "project_id": "",
        "page_id": str(block.page_id),
        "parent_block_id": content.get("parent_block_id"),
        "type": block.block_type,
        "text": content.get("text") if isinstance(content.get("text"), list) else [],
        "props": content.get("props") if isinstance(content.get("props"), dict) else {},
        "position": block.sort_order,
        "created_by_type": content.get("created_by_type", "user"),
        "created_by_id": content.get("created_by_id"),
        "last_edited_by_type": content.get("last_edited_by_type", "user"),
        "last_edited_by_id": content.get("last_edited_by_id"),
        "created_at": _iso(block.created_at),
        "updated_at": _iso(block.updated_at),
    }


def serialize_change_request(cr: BlueprintChangeRequest) -> dict[str, Any]:
    status = cr.status
    if status == "done":
        status = "implemented"
    elif status not in ("pending", "in_progress", "implemented", "blocked", "rejected"):
        status = "pending"
    return {
        "id": str(cr.id),
        "tenant_id": str(cr.tenant_id),
        "project_id": "",
        "target_page_id": str(cr.page_id) if cr.page_id else None,
        "title": cr.title,
        "body": cr.body,
        "status": status,
        "priority": cr.priority,
        "submitted_by_type": "user",
        "submitted_by_id": None,
        "linked_revision_ids": [],
        "resolved_at": None,
        "created_at": _iso(cr.created_at),
        "updated_at": _iso(cr.created_at),
    }


async def get_tree(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    doc = await get_or_create_doc(session, tenant_id)
    pages_result = await session.execute(
        select(BlueprintPage)
        .where(BlueprintPage.doc_id == doc.id, BlueprintPage.tenant_id == tenant_id)
        .order_by(BlueprintPage.sort_order, BlueprintPage.created_at)
    )
    pages = [serialize_page(p, doc.id) for p in pages_result.scalars().all()]
    return {"workspace_doc": serialize_doc_root(doc), "pages": pages}


async def _get_page(session: AsyncSession, tenant_id: UUID, page_id: UUID) -> BlueprintPage | None:
    result = await session.execute(
        select(BlueprintPage).where(BlueprintPage.id == page_id, BlueprintPage.tenant_id == tenant_id)
    )
    return result.scalar_one_or_none()


async def list_page_blocks(
    session: AsyncSession, tenant_id: UUID, page_id: UUID
) -> dict[str, Any]:
    page = await _get_page(session, tenant_id, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    doc = await get_or_create_doc(session, tenant_id)
    blocks_result = await session.execute(
        select(BlueprintBlock)
        .where(BlueprintBlock.page_id == page_id, BlueprintBlock.tenant_id == tenant_id)
        .order_by(BlueprintBlock.sort_order, BlueprintBlock.created_at)
    )
    return {
        "page": serialize_page(page, doc.id),
        "blocks": [serialize_block(b, tenant_id) for b in blocks_result.scalars().all()],
    }


async def create_page(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    workspace_doc_id: str,
    title: str,
    slug: str,
    kind: str = "custom",
    icon: str | None = None,
    parent_page_id: str | None = None,
    position: int = 0,
) -> dict[str, Any]:
    doc = await get_or_create_doc(session, tenant_id)
    if str(doc.id) != workspace_doc_id:
        raise HTTPException(status_code=400, detail="Invalid workspace_doc_id")
    parent_uuid = UUID(parent_page_id) if parent_page_id else None
    page = BlueprintPage(
        doc_id=doc.id,
        tenant_id=tenant_id,
        parent_id=parent_uuid,
        title=title,
        slug=slug,
        kind=kind,
        icon=icon,
        sort_order=position,
    )
    session.add(page)
    doc.updated_at = datetime.utcnow()
    session.add(doc)
    await session.commit()
    await session.refresh(page)
    return serialize_page(page, doc.id)


async def patch_page(
    session: AsyncSession,
    tenant_id: UUID,
    page_id: UUID,
    patch: dict[str, Any],
) -> dict[str, Any]:
    page = await _get_page(session, tenant_id, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if page.is_locked and patch.get("lock_action") != "unlock":
        raise HTTPException(status_code=423, detail="Page is locked")

    if "title" in patch and patch["title"] is not None:
        page.title = str(patch["title"])
    if "kind" in patch and patch["kind"] is not None:
        page.kind = str(patch["kind"])
    if "icon" in patch:
        page.icon = patch["icon"]
    if "parent_page_id" in patch:
        raw = patch["parent_page_id"]
        page.parent_id = UUID(raw) if raw else None
    if "position" in patch and patch["position"] is not None:
        page.sort_order = int(patch["position"])
    if patch.get("is_pinned") is True:
        page.is_pinned = True
    elif patch.get("is_pinned") is False:
        page.is_pinned = False
    if patch.get("lock_action") == "lock":
        page.is_locked = True
    elif patch.get("lock_action") == "unlock":
        page.is_locked = False

    page.updated_at = datetime.utcnow()
    session.add(page)
    await session.commit()
    await session.refresh(page)
    doc = await get_or_create_doc(session, tenant_id)
    return serialize_page(page, doc.id)


async def delete_page(session: AsyncSession, tenant_id: UUID, page_id: UUID) -> None:
    page = await _get_page(session, tenant_id, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    blocks = await session.execute(
        select(BlueprintBlock).where(BlueprintBlock.page_id == page_id)
    )
    for block in blocks.scalars().all():
        revs = await session.execute(select(BlockRevision).where(BlockRevision.block_id == block.id))
        for rev in revs.scalars().all():
            await session.delete(rev)
        await session.delete(block)
    await session.delete(page)
    await session.commit()


async def _record_revision(
    session: AsyncSession,
    tenant_id: UUID,
    page_id: UUID,
    block_id: UUID,
    op: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    actor_label: str,
    change_note: str | None = None,
) -> BlockRevision:
    meta = {"op": op, "before": before, "after": after, "actor_label": actor_label, "page_id": str(page_id)}
    rev = BlockRevision(
        block_id=block_id,
        tenant_id=tenant_id,
        content_json=json.dumps(after or {}),
        change_note=change_note or json.dumps(meta),
    )
    session.add(rev)
    return rev


async def apply_block_ops(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    page_id: UUID,
    ops: list[dict[str, Any]],
    *,
    actor_label: str = "User",
    expected_version: int | None = None,
) -> dict[str, Any]:
    page = await _get_page(session, tenant_id, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    if page.is_locked:
        raise HTTPException(status_code=423, detail="Page is locked")
    if expected_version is not None and page.content_version != expected_version:
        raise HTTPException(status_code=409, detail="Content version conflict. Reload the page and retry.")

    applied: list[dict[str, Any]] = []
    user_ref = str(user_id)

    for raw_op in ops:
        op_name = raw_op.get("op")
        if op_name == "create":
            block_id = raw_op.get("id")
            try:
                block_uuid = UUID(str(block_id)) if block_id else uuid.uuid4()
            except ValueError:
                block_uuid = uuid.uuid4()
            content = {
                "text": raw_op.get("text") or [{"text": ""}],
                "props": raw_op.get("props") or {},
                "parent_block_id": raw_op.get("parent_block_id"),
                "created_by_type": "user",
                "created_by_id": user_ref,
                "last_edited_by_type": "user",
                "last_edited_by_id": user_ref,
            }
            block = BlueprintBlock(
                id=block_uuid,
                page_id=page_id,
                tenant_id=tenant_id,
                block_type=str(raw_op.get("type") or "paragraph"),
                content_json=json.dumps(content),
                sort_order=int(raw_op.get("position") or 0),
            )
            session.add(block)
            await session.flush()
            row = serialize_block(block, tenant_id)
            applied.append(row)
            await _record_revision(
                session, tenant_id, page_id, block.id, "create", None, row, actor_label, raw_op.get("change_note")
            )
            text = _block_text(content)
            if text:
                await upsert_index_chunk(session, tenant_id, "blueprint_block", str(block.id), page.title, text)

        elif op_name == "update":
            block_uuid = UUID(str(raw_op["id"]))
            result = await session.execute(
                select(BlueprintBlock).where(
                    BlueprintBlock.id == block_uuid,
                    BlueprintBlock.page_id == page_id,
                    BlueprintBlock.tenant_id == tenant_id,
                )
            )
            block = result.scalar_one_or_none()
            if not block:
                continue
            before = serialize_block(block, tenant_id)
            content = _parse_json(block.content_json)
            if raw_op.get("type") is not None:
                block.block_type = str(raw_op["type"])
            if raw_op.get("text") is not None:
                content["text"] = raw_op["text"]
            if raw_op.get("props") is not None:
                content["props"] = raw_op["props"]
            content["last_edited_by_type"] = "user"
            content["last_edited_by_id"] = user_ref
            block.content_json = json.dumps(content)
            block.updated_at = datetime.utcnow()
            session.add(block)
            await session.flush()
            after = serialize_block(block, tenant_id)
            applied.append(after)
            await _record_revision(
                session, tenant_id, page_id, block.id, "update", before, after, actor_label, raw_op.get("change_note")
            )
            text = _block_text(content)
            if text:
                await upsert_index_chunk(session, tenant_id, "blueprint_block", str(block.id), page.title, text)

        elif op_name == "move":
            block_uuid = UUID(str(raw_op["id"]))
            result = await session.execute(
                select(BlueprintBlock).where(
                    BlueprintBlock.id == block_uuid,
                    BlueprintBlock.page_id == page_id,
                    BlueprintBlock.tenant_id == tenant_id,
                )
            )
            block = result.scalar_one_or_none()
            if not block:
                continue
            before = serialize_block(block, tenant_id)
            content = _parse_json(block.content_json)
            if "parent_block_id" in raw_op:
                content["parent_block_id"] = raw_op.get("parent_block_id")
            block.content_json = json.dumps(content)
            block.sort_order = int(raw_op.get("position") or block.sort_order)
            block.updated_at = datetime.utcnow()
            session.add(block)
            await session.flush()
            after = serialize_block(block, tenant_id)
            applied.append(after)
            await _record_revision(
                session, tenant_id, page_id, block.id, "move", before, after, actor_label, raw_op.get("change_note")
            )

        elif op_name == "delete":
            block_uuid = UUID(str(raw_op["id"]))
            result = await session.execute(
                select(BlueprintBlock).where(
                    BlueprintBlock.id == block_uuid,
                    BlueprintBlock.page_id == page_id,
                    BlueprintBlock.tenant_id == tenant_id,
                )
            )
            block = result.scalar_one_or_none()
            if not block:
                continue
            before = serialize_block(block, tenant_id)
            await _record_revision(
                session, tenant_id, page_id, block.id, "delete", before, None, actor_label, raw_op.get("change_note")
            )
            await session.delete(block)

    page.content_version += 1
    page.updated_at = datetime.utcnow()
    session.add(page)
    await session.commit()
    return {"applied": applied, "page_id": str(page_id), "content_version": page.content_version}


async def list_revisions(
    session: AsyncSession,
    tenant_id: UUID,
    page_id: UUID,
    block_id: UUID | None = None,
) -> list[dict[str, Any]]:
    page = await _get_page(session, tenant_id, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    query = select(BlockRevision).where(BlockRevision.tenant_id == tenant_id)
    if block_id:
        query = query.where(BlockRevision.block_id == block_id)
    else:
        block_ids = await session.execute(
            select(BlueprintBlock.id).where(BlueprintBlock.page_id == page_id, BlueprintBlock.tenant_id == tenant_id)
        )
        ids = [row for row in block_ids.scalars().all()]
        if not ids:
            return []
        query = query.where(BlockRevision.block_id.in_(ids))
    result = await session.execute(query.order_by(BlockRevision.created_at.desc()))
    rows: list[dict[str, Any]] = []
    for rev in result.scalars().all():
        meta: dict[str, Any] = {}
        try:
            meta = json.loads(rev.change_note or "{}")
        except json.JSONDecodeError:
            meta = {"actor_label": rev.change_note or "User"}
        rows.append(
            {
                "id": str(rev.id),
                "tenant_id": str(tenant_id),
                "project_id": "",
                "page_id": str(page_id),
                "block_id": str(rev.block_id),
                "op": meta.get("op", "update"),
                "before": meta.get("before"),
                "after": meta.get("after") or _parse_json(rev.content_json),
                "actor_type": "user",
                "actor_id": None,
                "actor_label": meta.get("actor_label", "User"),
                "change_note": rev.change_note if meta.get("op") is None else None,
                "created_at": _iso(rev.created_at),
            }
        )
    return rows


async def list_change_requests(
    session: AsyncSession, tenant_id: UUID, status: str | None = None
) -> list[dict[str, Any]]:
    query = select(BlueprintChangeRequest).where(BlueprintChangeRequest.tenant_id == tenant_id)
    if status:
        mapped = "done" if status == "implemented" else status
        query = query.where(BlueprintChangeRequest.status == mapped)
    result = await session.execute(query.order_by(BlueprintChangeRequest.created_at.desc()))
    return [serialize_change_request(cr) for cr in result.scalars().all()]


async def create_change_request(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    body: str,
    title: str | None = None,
    target_page_id: str | None = None,
    priority: int = 2,
) -> dict[str, Any]:
    page_uuid = UUID(target_page_id) if target_page_id else None
    cr = BlueprintChangeRequest(
        tenant_id=tenant_id,
        page_id=page_uuid,
        title=title or "Change request",
        body=body,
        priority=priority,
    )
    session.add(cr)
    await session.commit()
    await session.refresh(cr)
    try:
        from app.workers.tasks import enqueue_change_request_run

        await enqueue_change_request_run(str(tenant_id), str(cr.id))
    except Exception:
        pass
    return serialize_change_request(cr)
