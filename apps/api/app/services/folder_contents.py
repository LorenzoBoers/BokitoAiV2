"""One list of what a folder contains.

Membership of conversations, attachments and canvases is the same subtree
rule as Communication (``list_predicates``). Subfolders are the folder's own
children. The response is display fields only: no message body and no canvas
source.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError, status_error
from app.models.project_canvas import CANVAS_KINDS, KIND_IMAGE, ProjectCanvas
from app.models.signal import Signal, SignalMessage, SignalTag, SignalTagLink
from app.services.counts import conversation_scope
from app.services.signal_tags import signals_with_tag_ids
from app.services.trash import alive

CONTENT_TYPES = ("all", "folder", "conversation", "image", "file")
_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".heic"}


def parse_contents_type(raw: str | None) -> tuple[str, str | None]:
    """``all|folder|conversation|image|file`` or ``canvas:<kind>``."""
    value = (raw or "all").strip().lower()
    if value.startswith("canvas:"):
        kind = value.split(":", 1)[1].strip()
        if kind not in CANVAS_KINDS:
            raise status_error(status_code=422, detail="Unknown contents type")
        return "canvas", kind
    if value not in CONTENT_TYPES:
        raise status_error(status_code=422, detail="Unknown contents type")
    return value, None


def is_image_attachment(name: str, content_type: str) -> bool:
    ct = (content_type or "").lower().split(";")[0].strip()
    if ct.startswith("image/"):
        return True
    filename = (name or "").rsplit("/", 1)[-1].lower()
    dot = filename.rfind(".")
    return dot >= 0 and filename[dot:] in _IMAGE_EXT


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _label(tag: SignalTag, *, count: int | None = None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(tag.id),
        "name": (tag.name or "").lstrip("#"),
        "color": tag.color or "",
        "icon": tag.icon or "",
    }
    if count is not None:
        row["count"] = count
    return row


def _needle(q: str) -> str:
    return q.strip().lower()


def _hit(needle: str, *parts: str) -> bool:
    if not needle:
        return True
    return any(needle in (part or "").lower() for part in parts)


def _image_thumb(kind: str, source: str) -> str | None:
    if kind != KIND_IMAGE or not source:
        return None
    try:
        data = json.loads(source)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    url = data.get("url") or data.get("src")
    return str(url) if url else None


async def list_folder_contents(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    user_id: UUID | None,
    visible_account_ids: set[UUID] | None,
    contents_type: str = "all",
    q: str = "",
    label_ids: list[UUID] | None = None,
    page: int = 1,
    per_page: int = 40,
) -> dict[str, Any]:
    """Paged contents of one folder: subfolders, conversations, images, files, canvases."""
    from app.services.communication_nav import list_predicates
    from app.services.projects import get_project_detail

    kind, canvas_filter = parse_contents_type(contents_type)
    detail = await get_project_detail(
        session,
        tenant_id,
        project_id,
        user_id=user_id,
        visible_account_ids=visible_account_ids,
    )
    predicates = await list_predicates(session, tenant_id, {"project_id": project_id})
    if predicates is None:
        raise NotFoundError("Folder not found")

    scope = conversation_scope(tenant_id, user_id, visible_account_ids)
    label_clauses = [
        Signal.id.in_(signals_with_tag_ids(tenant_id, [label_id])) for label_id in (label_ids or [])
    ]
    needle = _needle(q)

    signal_rows = (
        await session.execute(
            select(
                Signal.id,
                Signal.subject,
                Signal.contact_name,
                Signal.contact_email,
                Signal.contact_phone,
                Signal.channel,
                Signal.status,
                Signal.has_unread,
                Signal.last_message_at,
                Signal.ticket_tag_id,
            ).where(*scope, *predicates, *label_clauses)
        )
    ).all()
    by_id = {row.id: row for row in signal_rows}
    labels_by_signal, facets = await _labels_for(session, tenant_id, list(by_id))

    folders = _folder_items(detail.get("children") or [], needle)
    conversations = _conversation_items(signal_rows, labels_by_signal, project_id, needle)
    images, files = await _attachment_items(
        session, scope, predicates, label_clauses, by_id, labels_by_signal, needle
    )
    canvases = await _canvas_items(
        session, tenant_id, scope, predicates, label_clauses, labels_by_signal, project_id, needle
    )

    canvas_counts: dict[str, int] = {}
    for item in canvases:
        name = item.get("canvas_kind") or ""
        if name:
            canvas_counts[name] = canvas_counts.get(name, 0) + 1

    counts = {
        "all": len(folders) + len(conversations) + len(images) + len(files) + len(canvases),
        "folder": len(folders),
        "conversation": len(conversations),
        "image": len(images),
        "file": len(files),
        "canvas": canvas_counts,
    }

    if kind == "folder":
        chosen = folders
    elif kind == "conversation":
        chosen = conversations
    elif kind == "image":
        chosen = images
    elif kind == "file":
        chosen = files
    elif kind == "canvas":
        chosen = [row for row in canvases if row.get("canvas_kind") == canvas_filter]
    else:
        rest = [*conversations, *images, *files, *canvases]
        rest.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
        chosen = [*folders, *rest]

    page = max(1, page)
    per_page = min(max(per_page, 1), 100)
    start = (page - 1) * per_page
    window = chosen[start : start + per_page]
    next_page = page + 1 if start + per_page < len(chosen) else None

    return {
        "items": window,
        "counts": counts,
        "labels": facets,
        "next_page": next_page,
    }


def _folder_items(children: list[dict[str, Any]], needle: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for child in children:
        title = child.get("display_name") or child.get("name") or ""
        if not _hit(needle, title, child.get("name") or ""):
            continue
        folder_id = str(child["id"])
        rows.append(
            {
                "kind": "folder",
                "id": folder_id,
                "title": title,
                "subtitle": "",
                "updated_at": None,
                "href_target": f"/folders/{folder_id}",
                "thumb_url": None,
                "channel": None,
                "status": None,
                "unread": None,
                "labels": [],
                "canvas_kind": None,
                "signal_id": None,
                "open_count": int(child.get("open_count") or 0),
                "closed_count": int(child.get("closed_count") or 0),
                "child_count": int(child.get("child_count") or 0),
            }
        )
    rows.sort(key=lambda row: row["title"].lower())
    return rows


def _conversation_items(
    signal_rows: list[Any],
    labels_by_signal: dict[UUID, list[dict[str, Any]]],
    project_id: UUID,
    needle: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in signal_rows:
        who = row.contact_name or row.contact_email or row.contact_phone or ""
        title = row.subject or ""
        if not _hit(needle, title, who):
            continue
        queue = "closed" if row.status == "closed" else "open"
        rows.append(
            {
                "kind": "conversation",
                "id": str(row.id),
                "title": title,
                "subtitle": who,
                "updated_at": _iso(row.last_message_at),
                "href_target": f"/communication/folder/{project_id}/{queue}/t/{row.id}",
                "thumb_url": None,
                "channel": row.channel or None,
                "status": row.status or None,
                "unread": bool(row.has_unread),
                "labels": labels_by_signal.get(row.id, []),
                "canvas_kind": None,
                "signal_id": str(row.id),
                "open_count": None,
                "closed_count": None,
                "child_count": None,
            }
        )
    rows.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return rows


async def _attachment_items(
    session: AsyncSession,
    scope: list[Any],
    predicates: list[Any],
    label_clauses: list[Any],
    by_id: dict[Any, Any],
    labels_by_signal: dict[UUID, list[dict[str, Any]]],
    needle: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    messages = (
        await session.execute(
            select(
                SignalMessage.signal_id,
                SignalMessage.attachments_json,
                SignalMessage.created_at,
            )
            .join(Signal, Signal.id == SignalMessage.signal_id)
            .where(
                *scope,
                *predicates,
                *label_clauses,
                SignalMessage.attachments_json != "[]",
            )
            .order_by(SignalMessage.created_at.desc())
        )
    ).all()
    images: list[dict[str, Any]] = []
    files: list[dict[str, Any]] = []
    for signal_id, raw, created_at in messages:
        signal = by_id.get(signal_id)
        subject = (signal.subject if signal else "") or ""
        try:
            attachments = json.loads(raw or "[]")
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(attachments, list):
            continue
        for index, item in enumerate(attachments):
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("filename") or "file")
            if not _hit(needle, name, subject):
                continue
            url = item.get("url") or item.get("href")
            content_type = str(item.get("content_type") or item.get("type") or "")
            image = is_image_attachment(name, content_type)
            row = {
                "kind": "image" if image else "file",
                "id": f"{signal_id}:{index}:{name}",
                "title": name,
                "subtitle": subject,
                "updated_at": _iso(created_at),
                "href_target": str(url) if url else "",
                "thumb_url": str(url) if image and url else None,
                "channel": None,
                "status": None,
                "unread": None,
                "labels": labels_by_signal.get(signal_id, []),
                "canvas_kind": None,
                "signal_id": str(signal_id),
                "open_count": None,
                "closed_count": None,
                "child_count": None,
            }
            (images if image else files).append(row)
    return images, files


async def _canvas_items(
    session: AsyncSession,
    tenant_id: UUID,
    scope: list[Any],
    predicates: list[Any],
    label_clauses: list[Any],
    labels_by_signal: dict[UUID, list[dict[str, Any]]],
    project_id: UUID,
    needle: str,
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(ProjectCanvas)
            .join(Signal, Signal.id == ProjectCanvas.signal_id)
            .where(
                ProjectCanvas.tenant_id == tenant_id,
                alive(ProjectCanvas),
                *scope,
                *predicates,
                *label_clauses,
            )
            .order_by(ProjectCanvas.updated_at.desc())
        )
    ).scalars().all()
    items: list[dict[str, Any]] = []
    for canvas in rows:
        title = canvas.title or ""
        if not _hit(needle, title):
            continue
        kind = (canvas.kind or "dashboard").strip() or "dashboard"
        items.append(
            {
                "kind": "canvas",
                "id": str(canvas.id),
                "title": title,
                "subtitle": "",
                "updated_at": _iso(canvas.updated_at),
                "href_target": f"/folders/{project_id}?canvas={canvas.id}",
                "thumb_url": _image_thumb(kind, canvas.source or ""),
                "channel": None,
                "status": None,
                "unread": None,
                "labels": labels_by_signal.get(canvas.signal_id, []),
                "canvas_kind": kind,
                "signal_id": str(canvas.signal_id),
                "open_count": None,
                "closed_count": None,
                "child_count": None,
            }
        )
    return items


async def _labels_for(
    session: AsyncSession, tenant_id: UUID, signal_ids: list[UUID]
) -> tuple[dict[UUID, list[dict[str, Any]]], list[dict[str, Any]]]:
    """Labels on these conversations (link or ticket), plus a facet list with counts."""
    if not signal_ids:
        return {}, []
    linked = (
        await session.execute(
            select(SignalTagLink.signal_id, SignalTag)
            .join(SignalTag, SignalTag.id == SignalTagLink.tag_id)
            .where(SignalTagLink.signal_id.in_(signal_ids), SignalTag.tenant_id == tenant_id)
        )
    ).all()
    ticket_ids = (
        await session.execute(
            select(Signal.id, Signal.ticket_tag_id).where(
                Signal.id.in_(signal_ids), Signal.ticket_tag_id.is_not(None)
            )
        )
    ).all()
    extra_ids = {tag_id for _sid, tag_id in ticket_ids if tag_id}
    known = {tag.id: tag for _sid, tag in linked}
    missing = extra_ids - set(known)
    if missing:
        for tag in (
            await session.execute(
                select(SignalTag).where(SignalTag.tenant_id == tenant_id, SignalTag.id.in_(missing))
            )
        ).scalars().all():
            known[tag.id] = tag

    by_signal: dict[UUID, list[dict[str, Any]]] = {}
    counts: dict[UUID, int] = {}

    def add(signal_id: UUID, tag: SignalTag) -> None:
        bucket = by_signal.setdefault(signal_id, [])
        if any(row["id"] == str(tag.id) for row in bucket):
            return
        bucket.append(_label(tag))
        counts[tag.id] = counts.get(tag.id, 0) + 1

    for signal_id, tag in linked:
        add(signal_id, tag)
    for signal_id, tag_id in ticket_ids:
        tag = known.get(tag_id)
        if tag is not None:
            add(signal_id, tag)

    facets = sorted(
        (_label(known[tag_id], count=count) for tag_id, count in counts.items() if tag_id in known),
        key=lambda row: (-int(row["count"]), row["name"]),
    )
    return by_signal, facets
