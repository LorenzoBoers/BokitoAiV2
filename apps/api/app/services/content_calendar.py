"""Content calendar: queue items of kind ``post`` in a folder, mirrored to a Sheet.

A calendar entry is a folder queue item with fields date, channel, caption
and image (``AgentTask.metadata_json["fields"]``). When the folder has a
linked resource of type ``sheet`` (``external_ref`` is the spreadsheet id,
``config.tab`` the tab), every change rewrites the calendar range of that
Sheet through the documents module. Under the Manual autonomy setting the
mirror waits; ``mirror_calendar`` can then be run on request.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestration import AgentTask

logger = logging.getLogger(__name__)

CALENDAR_KIND = "post"
CALENDAR_FIELDS = ("date", "channel", "caption", "image")
HEADER = ["Date", "Channel", "Title", "Caption", "Image", "Status"]
MAX_ROWS = 500


def normalize_calendar_fields(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key in CALENDAR_FIELDS:
        value = raw.get(key)
        if value is None:
            continue
        out[key] = str(value).strip()[:2000]
    return out


def item_fields(item: AgentTask) -> dict[str, str]:
    try:
        meta = json.loads(item.metadata_json or "{}")
    except json.JSONDecodeError:
        return {}
    fields = meta.get("fields") if isinstance(meta, dict) else None
    return fields if isinstance(fields, dict) else {}


def set_item_fields(item: AgentTask, fields: dict[str, str], *, replace: bool = False) -> None:
    try:
        meta = json.loads(item.metadata_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    current = {} if replace else dict(meta.get("fields") or {})
    current.update(fields)
    meta["fields"] = current
    item.metadata_json = json.dumps(meta)


async def calendar_rows(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> list[list[str]]:
    items = (
        await session.execute(
            select(AgentTask).where(
                AgentTask.tenant_id == tenant_id,
                AgentTask.project_id == project_id,
                AgentTask.kind == CALENDAR_KIND,
                AgentTask.deleted_at.is_(None),
                AgentTask.status != "rejected",
            )
        )
    ).scalars().all()
    rows = []
    for item in items:
        f = item_fields(item)
        rows.append([f.get("date", ""), f.get("channel", ""), item.title, f.get("caption", ""), f.get("image", ""), item.status])
    rows.sort(key=lambda r: (r[0] or "9999", r[2]))
    return [HEADER, *rows[:MAX_ROWS]]


async def _sheet_resource(session: AsyncSession, tenant_id: UUID, project_id: UUID):
    from app.models.project_work import ProjectResource

    return (
        await session.execute(
            select(ProjectResource).where(
                ProjectResource.tenant_id == tenant_id,
                ProjectResource.project_id == project_id,
                ProjectResource.resource_type == "sheet",
                ProjectResource.deleted_at.is_(None),
            ).order_by(ProjectResource.created_at)
        )
    ).scalars().first()


async def mirror_calendar(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, *, on_request: bool = False
) -> dict[str, Any]:
    from app.models.auth import Tenant
    from app.modules.documents.router import call_verb
    from app.tools.policy import resolve_posture

    resource = await _sheet_resource(session, tenant_id, project_id)
    if resource is None or not (resource.external_ref or "").strip():
        return {"status": "no_sheet"}
    tenant = await session.get(Tenant, tenant_id)
    if not on_request and tenant is not None and resolve_posture(tenant) == "manual":
        return {"status": "waiting", "reason": "Autonomy is Manual; mirror on request."}
    try:
        config = json.loads(resource.config_json or "{}")
    except json.JSONDecodeError:
        config = {}
    tab = str((config or {}).get("tab") or "Kalender")
    rows = await calendar_rows(session, tenant_id, project_id)
    result = await call_verb(
        session,
        tenant_id,
        "sheets_update",
        {"spreadsheet_id": resource.external_ref.strip(), "range": f"{tab}!A1:F{len(rows)}", "values": rows},
    )
    status = "mirrored" if result.get("ok") else "error"
    return {"status": status, "rows": len(rows) - 1, "result": result}


async def mirror_after_change(session: AsyncSession, item: AgentTask) -> None:
    """Best effort: a failing Sheet never blocks the calendar change itself."""
    if item.kind != CALENDAR_KIND or item.project_id is None:
        return
    try:
        out = await mirror_calendar(session, item.tenant_id, item.project_id)
        if out.get("status") == "error":
            logger.info("calendar mirror failed for %s: %s", item.project_id, out.get("result"))
    except Exception:  # noqa: BLE001
        logger.exception("calendar mirror failed for %s", item.project_id)
