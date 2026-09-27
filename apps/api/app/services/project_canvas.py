"""Project canvas service: get-or-create, validate, patch, hydrate live widgets."""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.project_canvas import (
    CANVAS_SCHEMA_VERSION,
    LIVE_WIDGET_TYPES,
    WIDGET_TYPES,
    ProjectCanvas,
)

logger = logging.getLogger(__name__)

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
_WIDGET_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")

DEFAULT_LAYOUT: dict[str, Any] = {
    "columns": 12,
    "row_height": 56,
    "gap": 12,
}


def default_widgets(project_name: str) -> list[dict[str, Any]]:
    """Starter board: narrative + live project pulse."""
    return [
        {
            "id": "intro",
            "type": "markdown",
            "title": project_name,
            "x": 0,
            "y": 0,
            "w": 8,
            "h": 3,
            "config": {
                "markdown": (
                    f"# {project_name}\n\n"
                    "This canvas is the living overview for the project. "
                    "Agents keep widgets current; you rearrange, pin metrics, "
                    "and ask for new boards from chat.\n\n"
                    "- Use **Queue** for implementation work\n"
                    "- Use **Documentation** for lasting truth\n"
                    "- Ask an agent to update this canvas when priorities shift"
                ),
            },
        },
        {
            "id": "health",
            "type": "status",
            "title": "Health",
            "x": 8,
            "y": 0,
            "w": 4,
            "h": 3,
            "config": {
                "level": "ok",
                "label": "On track",
                "detail": "Agents maintain this status as work moves.",
            },
        },
        {
            "id": "queue-summary",
            "type": "queue_summary",
            "title": "Queue",
            "x": 0,
            "y": 3,
            "w": 4,
            "h": 3,
            "config": {},
        },
        {
            "id": "budget",
            "type": "budget",
            "title": "Budget",
            "x": 4,
            "y": 3,
            "w": 4,
            "h": 3,
            "config": {},
        },
        {
            "id": "resources",
            "type": "resources",
            "title": "Resources",
            "x": 8,
            "y": 3,
            "w": 4,
            "h": 3,
            "config": {},
        },
        {
            "id": "queue-list",
            "type": "queue_list",
            "title": "Open queue",
            "x": 0,
            "y": 6,
            "w": 12,
            "h": 4,
            "config": {"limit": 8},
        },
    ]


def _parse_json(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


def _clamp_int(value: Any, default: int, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def normalize_layout(raw: Any) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    return {
        "columns": _clamp_int(src.get("columns"), 12, 4, 24),
        "row_height": _clamp_int(src.get("row_height"), 56, 32, 120),
        "gap": _clamp_int(src.get("gap"), 12, 0, 32),
    }


def normalize_widget(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    widget_id = str(raw.get("id") or "").strip()
    widget_type = str(raw.get("type") or "").strip().lower()
    if not widget_id or not _WIDGET_ID_RE.match(widget_id):
        return None
    if widget_type not in WIDGET_TYPES:
        return None
    config = raw.get("config") if isinstance(raw.get("config"), dict) else {}
    title = str(raw.get("title") or "").strip()
    # Strip oversized markdown / table payloads (keep agent-friendly but bounded).
    if widget_type == "markdown":
        md = str(config.get("markdown") or "")[:20_000]
        config = {**config, "markdown": md}
    elif widget_type == "iframe":
        url = str(config.get("url") or "").strip()[:2_000]
        if url and not (url.startswith("https://") or url.startswith("http://")):
            url = ""
        config = {**config, "url": url}
    elif widget_type == "table":
        rows = config.get("rows") if isinstance(config.get("rows"), list) else []
        config = {
            **config,
            "columns": (config.get("columns") if isinstance(config.get("columns"), list) else [])[:24],
            "rows": rows[:200],
        }
    elif widget_type == "chart":
        series = config.get("series") if isinstance(config.get("series"), list) else []
        config = {
            **config,
            "kind": str(config.get("kind") or "bar")[:16],
            "series": series[:48],
        }
    elif widget_type == "links":
        items = config.get("items") if isinstance(config.get("items"), list) else []
        config = {**config, "items": items[:40]}
    elif widget_type == "metric":
        config = {
            **config,
            "value": str(config.get("value") or "")[:120],
            "label": str(config.get("label") or title or "")[:120],
            "hint": str(config.get("hint") or "")[:240],
            "trend": str(config.get("trend") or "")[:16],
        }
    elif widget_type == "status":
        level = str(config.get("level") or "ok").lower()
        if level not in {"ok", "watch", "blocked", "unknown"}:
            level = "unknown"
        config = {
            **config,
            "level": level,
            "label": str(config.get("label") or "")[:120],
            "detail": str(config.get("detail") or "")[:500],
        }

    return {
        "id": widget_id,
        "type": widget_type,
        "title": title[:160] if title else None,
        "x": _clamp_int(raw.get("x"), 0, 0, 23),
        "y": _clamp_int(raw.get("y"), 0, 0, 500),
        "w": _clamp_int(raw.get("w"), 4, 1, 24),
        "h": _clamp_int(raw.get("h"), 2, 1, 24),
        "config": config,
    }


def normalize_widgets(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for item in raw[:80]:
        widget = normalize_widget(item)
        if widget is None or widget["id"] in seen:
            continue
        seen.add(widget["id"])
        out.append(widget)
    return out


def serialize_canvas(
    canvas: ProjectCanvas,
    *,
    hydrate: dict[str, Any] | None = None,
) -> dict[str, Any]:
    widgets = _parse_json(canvas.widgets_json, [])
    if not isinstance(widgets, list):
        widgets = []
    if hydrate:
        widgets = [_attach_live(w, hydrate) if isinstance(w, dict) else w for w in widgets]
    return {
        "id": str(canvas.id),
        "project_id": str(canvas.project_id),
        "slug": canvas.slug,
        "title": canvas.title,
        "schema_version": canvas.schema_version,
        "revision": canvas.revision,
        "layout": normalize_layout(_parse_json(canvas.layout_json, DEFAULT_LAYOUT)),
        "widgets": widgets,
        "updated_by_type": canvas.updated_by_type,
        "updated_by_id": canvas.updated_by_id or None,
        "notes": canvas.notes,
        "created_at": canvas.created_at.isoformat() + "Z" if canvas.created_at else None,
        "updated_at": canvas.updated_at.isoformat() + "Z" if canvas.updated_at else None,
        "widget_types": sorted(WIDGET_TYPES),
        "live_widget_types": sorted(LIVE_WIDGET_TYPES),
    }


def _attach_live(widget: dict[str, Any], hydrate: dict[str, Any]) -> dict[str, Any]:
    wtype = str(widget.get("type") or "")
    if wtype not in LIVE_WIDGET_TYPES:
        return widget
    data = hydrate.get(wtype)
    if data is None:
        return widget
    return {**widget, "data": data}


async def _require_project(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> Project:
    result = await session.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def get_or_create_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    slug: str = "main",
) -> ProjectCanvas:
    project = await _require_project(session, tenant_id, project_id)
    slug_key = (slug or "main").strip().lower()
    if not _SLUG_RE.match(slug_key):
        raise HTTPException(status_code=400, detail="Invalid canvas slug")

    result = await session.execute(
        select(ProjectCanvas).where(
            ProjectCanvas.tenant_id == tenant_id,
            ProjectCanvas.project_id == project_id,
            ProjectCanvas.slug == slug_key,
        )
    )
    canvas = result.scalar_one_or_none()
    if canvas is not None:
        return canvas

    widgets = default_widgets(project.name)
    canvas = ProjectCanvas(
        tenant_id=tenant_id,
        project_id=project_id,
        slug=slug_key,
        title="Canvas",
        schema_version=CANVAS_SCHEMA_VERSION,
        revision=1,
        layout_json=json.dumps(DEFAULT_LAYOUT),
        widgets_json=json.dumps(widgets),
        updated_by_type="system",
        updated_by_id="",
        notes="Seeded default canvas",
    )
    session.add(canvas)
    await session.commit()
    await session.refresh(canvas)
    return canvas


async def list_canvases(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> list[dict[str, Any]]:
    await _require_project(session, tenant_id, project_id)
    # Ensure the primary board exists so the UI always has something to open.
    await get_or_create_canvas(session, tenant_id, project_id, slug="main")
    result = await session.execute(
        select(ProjectCanvas)
        .where(
            ProjectCanvas.tenant_id == tenant_id,
            ProjectCanvas.project_id == project_id,
        )
        .order_by(ProjectCanvas.slug)
    )
    return [
        {
            "id": str(c.id),
            "slug": c.slug,
            "title": c.title,
            "revision": c.revision,
            "updated_at": c.updated_at.isoformat() + "Z" if c.updated_at else None,
            "widget_count": len(_parse_json(c.widgets_json, []) or []),
        }
        for c in result.scalars().all()
    ]


async def _hydrate_live(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, widgets: list[dict[str, Any]]
) -> dict[str, Any]:
    needed = {str(w.get("type")) for w in widgets if isinstance(w, dict)} & LIVE_WIDGET_TYPES
    out: dict[str, Any] = {}
    if not needed:
        return out

    if "queue_summary" in needed or "queue_list" in needed:
        from app.models.orchestration import AgentTask
        from app.services.project_work import QUEUE_ITEM_KINDS, serialize_queue_item

        rows = (
            await session.execute(
                select(AgentTask)
                .where(
                    AgentTask.tenant_id == tenant_id,
                    AgentTask.project_id == project_id,
                    AgentTask.kind.in_(QUEUE_ITEM_KINDS),
                )
                .order_by(AgentTask.updated_at.desc())
            )
        ).scalars().all()
        by_status: dict[str, int] = {}
        for row in rows:
            by_status[row.status] = by_status.get(row.status, 0) + 1
        open_statuses = {
            "proposed",
            "queued",
            "analyzing",
            "planned",
            "running",
            "verifying",
        }
        if "queue_summary" in needed:
            out["queue_summary"] = {
                "total": len(rows),
                "open": sum(by_status.get(s, 0) for s in open_statuses),
                "by_status": by_status,
            }
        if "queue_list" in needed:
            open_items = [r for r in rows if r.status in open_statuses][:12]
            out["queue_list"] = {
                "items": [serialize_queue_item(item) for item in open_items],
            }

    if "resources" in needed:
        from app.services import project_work as work

        resources = await work.list_resources(session, tenant_id, project_id)
        out["resources"] = {"items": resources}

    if "budget" in needed:
        from app.services import projects as projects_svc

        try:
            budget = await projects_svc.usage_budget(session, tenant_id, project_id)
            out["budget"] = budget
        except Exception:
            logger.exception("canvas budget hydrate failed for %s", project_id)
            out["budget"] = None

    return out


async def get_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    slug: str = "main",
    hydrate: bool = True,
) -> dict[str, Any]:
    canvas = await get_or_create_canvas(session, tenant_id, project_id, slug=slug)
    widgets = normalize_widgets(_parse_json(canvas.widgets_json, []))
    live = await _hydrate_live(session, tenant_id, project_id, widgets) if hydrate else None
    return serialize_canvas(canvas, hydrate=live)


async def put_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    slug: str = "main",
    title: str | None = None,
    layout: Any = None,
    widgets: Any = None,
    notes: str | None = None,
    expected_revision: int | None = None,
    updated_by_type: str = "user",
    updated_by_id: str = "",
    reset_to_default: bool = False,
) -> dict[str, Any]:
    project = await _require_project(session, tenant_id, project_id)
    canvas = await get_or_create_canvas(session, tenant_id, project_id, slug=slug)

    if expected_revision is not None and expected_revision != canvas.revision:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Canvas was updated elsewhere; reload and try again.",
                "revision": canvas.revision,
            },
        )

    if reset_to_default:
        canvas.layout_json = json.dumps(DEFAULT_LAYOUT)
        canvas.widgets_json = json.dumps(default_widgets(project.name))
        canvas.title = "Canvas"
        canvas.notes = "Reset to default canvas"
    else:
        if title is not None:
            canvas.title = (title.strip() or canvas.title)[:160]
        if layout is not None:
            canvas.layout_json = json.dumps(normalize_layout(layout))
        if widgets is not None:
            canvas.widgets_json = json.dumps(normalize_widgets(widgets))
        if notes is not None:
            canvas.notes = (notes.strip() or None)
            if canvas.notes and len(canvas.notes) > 2000:
                canvas.notes = canvas.notes[:2000]

    canvas.schema_version = CANVAS_SCHEMA_VERSION
    canvas.revision = int(canvas.revision or 0) + 1
    canvas.updated_by_type = (updated_by_type or "user")[:32]
    canvas.updated_by_id = (updated_by_id or "")[:64]
    canvas.updated_at = datetime.utcnow()
    session.add(canvas)
    await session.commit()
    await session.refresh(canvas)
    return await get_canvas(session, tenant_id, project_id, slug=canvas.slug, hydrate=True)


async def patch_widgets(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    slug: str = "main",
    upsert: list[dict[str, Any]] | None = None,
    remove_ids: list[str] | None = None,
    expected_revision: int | None = None,
    notes: str | None = None,
    updated_by_type: str = "agent",
    updated_by_id: str = "",
) -> dict[str, Any]:
    """Merge widget upserts/removes without rewriting the whole board."""
    canvas = await get_or_create_canvas(session, tenant_id, project_id, slug=slug)
    if expected_revision is not None and expected_revision != canvas.revision:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Canvas was updated elsewhere; reload and try again.",
                "revision": canvas.revision,
            },
        )

    current = {w["id"]: w for w in normalize_widgets(_parse_json(canvas.widgets_json, []))}
    for rid in remove_ids or []:
        current.pop(str(rid).strip(), None)
    for raw in upsert or []:
        widget = normalize_widget(raw)
        if widget is None:
            continue
        prev = current.get(widget["id"])
        if prev:
            # Preserve placement when the agent omits geometry.
            for key in ("x", "y", "w", "h", "title"):
                if raw.get(key) is None and prev.get(key) is not None:
                    widget[key] = prev[key]
            if not raw.get("config") and prev.get("config"):
                widget["config"] = prev["config"]
        current[widget["id"]] = widget

    ordered = sorted(current.values(), key=lambda w: (w.get("y", 0), w.get("x", 0), w["id"]))
    return await put_canvas(
        session,
        tenant_id,
        project_id,
        slug=slug,
        widgets=ordered,
        notes=notes,
        expected_revision=None,  # already checked
        updated_by_type=updated_by_type,
        updated_by_id=updated_by_id,
    )


async def apply_canvas_document(
    session: AsyncSession,
    tenant_id: UUID,
    after: dict[str, Any],
) -> dict[str, Any]:
    """Govern apply path for resource_type=project_canvas."""
    project_raw = str(after.get("project_id") or "").strip()
    if not project_raw:
        raise HTTPException(status_code=400, detail="project_id required")
    try:
        project_id = UUID(project_raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid project_id") from exc

    slug = str(after.get("slug") or "main").strip().lower() or "main"
    mode = str(after.get("mode") or "replace").strip().lower()
    agent_id = str(after.get("agent_id") or after.get("updated_by_id") or "")

    if mode == "patch":
        result = await patch_widgets(
            session,
            tenant_id,
            project_id,
            slug=slug,
            upsert=after.get("upsert") if isinstance(after.get("upsert"), list) else None,
            remove_ids=after.get("remove_ids") if isinstance(after.get("remove_ids"), list) else None,
            notes=str(after.get("notes") or "") or None,
            updated_by_type="agent",
            updated_by_id=agent_id,
        )
    else:
        result = await put_canvas(
            session,
            tenant_id,
            project_id,
            slug=slug,
            title=str(after["title"]) if after.get("title") is not None else None,
            layout=after.get("layout"),
            widgets=after.get("widgets"),
            notes=str(after.get("notes") or "") or None,
            reset_to_default=bool(after.get("reset_to_default")),
            updated_by_type="agent",
            updated_by_id=agent_id,
        )
    return {"status": "applied", "canvas": result}


def new_widget_id(prefix: str = "w") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"
