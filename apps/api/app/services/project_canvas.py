"""Canvas nodes as snapshot documents with Agenda-backed refresh."""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.project import Project
from app.models.project_canvas import (
    CANVAS_SCHEMA_VERSION,
    CANVAS_OWNERS,
    OWNER_PROJECT,
    OWNER_TENANT,
    ProjectCanvas,
)
from app.models.trigger import Trigger
from app.services.project_canvas_compile import (
    EMPTY_SOURCE,
    EMPTY_TREE,
    CanvasCompileError,
    compile_canvas,
    is_empty_tree,
)

logger = logging.getLogger(__name__)

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
MIN_REFRESH_MINUTES = 5
REFRESH_CADENCES = ("manual", "hourly", "daily", "weekly", "monthly")
DEFAULT_REFRESH_CADENCE = "daily"


def _parse_json(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


def _empty_document() -> tuple[str, dict[str, Any]]:
    return EMPTY_SOURCE, dict(EMPTY_TREE)


def slugify_title(title: str) -> str:
    raw = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")[:62]
    return raw or "canvas"


def refresh_instructions(
    *,
    owner_kind: str,
    owner_id: UUID,
    slug: str,
    canvas_id: UUID,
    title: str = "",
    brief: str = "",
) -> str:
    if owner_kind == OWNER_TENANT:
        lookup = (
            "This canvas hangs on Overview for the workspace. Use list_threads, "
            "list_projects, list_triggers and get_platform_watch as needed."
        )
    else:
        lookup = (
            f"This canvas belongs to project {owner_id}. Use list_queue_items, "
            "list_project_docs and list_project_resources, then embed those numbers."
        )
    brief_line = f"What it must show: {brief.strip()}\n" if (brief or "").strip() else ""
    return (
        f"Write or refresh snapshot canvas '{title or slug}' "
        f"(canvas_id={canvas_id}, owner_kind={owner_kind}, slug={slug}).\n"
        f"{brief_line}"
        f"{lookup}\n"
        "Call get_project_canvas, then update_project_canvas with a full bokito/canvas "
        "document. Import only from bokito/canvas. Embed figures you just fetched. "
        "Do not promise live tiles. Omit empty cards."
    )


def cadence_schedule(cadence: str) -> tuple[str, int, str] | None:
    key = (cadence or "").strip().lower()
    if key == "hourly":
        return ("interval", 60, "")
    if key == "daily":
        return ("cron", 0, "0 7 * * *")
    if key == "weekly":
        return ("cron", 0, "0 7 * * 1")
    if key == "monthly":
        return ("cron", 0, "0 7 1 * *")
    return None


def cadence_from_trigger(trigger: Trigger | None) -> str:
    if not trigger or not trigger.enabled:
        return "manual"
    if trigger.kind == "interval":
        minutes = int(trigger.interval_minutes or 0)
        if minutes <= 90:
            return "hourly"
        if minutes <= 2_000:
            return "daily"
        if minutes <= 15_000:
            return "weekly"
        return "monthly"
    parts = (trigger.cron_expr or "").split()
    if len(parts) == 5:
        if parts[2] not in {"*", "?"}:
            return "monthly"
        if parts[4] not in {"*", "?"}:
            return "weekly"
        if parts[1] == "*":
            return "hourly"
        return "daily"
    return "daily"


def resolve_refresh_cadence(
    *,
    refresh_cadence: str | None = None,
    refresh_minutes: int | None = None,
    default: str | None = None,
) -> str:
    raw = (refresh_cadence or "").strip().lower()
    if raw in REFRESH_CADENCES:
        return raw
    if refresh_minutes is None:
        return default or "manual"
    if int(refresh_minutes) < MIN_REFRESH_MINUTES:
        return "manual"
    if int(refresh_minutes) <= 90:
        return "hourly"
    if int(refresh_minutes) <= 2_000:
        return "daily"
    if int(refresh_minutes) <= 15_000:
        return "weekly"
    return "monthly"


async def _require_project(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> Project:
    result = await session.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def resolve_owner(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    owner_kind: str | None = None,
    owner_id: UUID | None = None,
    project_id: UUID | None = None,
) -> tuple[str, UUID]:
    kind = (owner_kind or "").strip().lower()
    if project_id and not kind:
        kind = OWNER_PROJECT
        owner_id = project_id
    if kind not in CANVAS_OWNERS:
        raise HTTPException(status_code=400, detail="owner_kind must be project or tenant")
    if owner_id is None:
        raise HTTPException(status_code=400, detail="owner_id is required")
    if kind == OWNER_PROJECT:
        await _require_project(session, tenant_id, owner_id)
    elif owner_id != tenant_id:
        raise HTTPException(status_code=400, detail="Tenant canvas owner_id must be this workspace")
    return kind, owner_id


async def resolve_managing_agent(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    owner_kind: str,
    owner_id: UUID,
    agent_id: UUID | None = None,
) -> UUID | None:
    if agent_id:
        row = (
            await session.execute(
                select(Agent).where(
                    Agent.id == agent_id,
                    Agent.tenant_id == tenant_id,
                    Agent.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=400, detail="Managing agent not found")
        return row.id
    if owner_kind == OWNER_PROJECT:
        project = await _require_project(session, tenant_id, owner_id)
        if project.po_agent_id:
            return project.po_agent_id
    from app.services.lead_agent import get_lead_agent

    lead = await get_lead_agent(session, tenant_id)
    return lead.id if lead else None


def serialize_canvas(canvas: ProjectCanvas, *, trigger: Trigger | None = None) -> dict[str, Any]:
    tree = _parse_json(canvas.tree_json, EMPTY_TREE)
    if not isinstance(tree, dict) or not tree.get("type"):
        tree = dict(EMPTY_TREE)
    source = canvas.source or EMPTY_SOURCE
    refresh_minutes = 0
    next_run_at = None
    cadence = cadence_from_trigger(trigger)
    if trigger and trigger.enabled:
        if trigger.kind == "interval":
            refresh_minutes = int(trigger.interval_minutes or 0)
        elif cadence == "hourly":
            refresh_minutes = 60
        elif cadence == "daily":
            refresh_minutes = 1_440
        elif cadence == "weekly":
            refresh_minutes = 10_080
        elif cadence == "monthly":
            refresh_minutes = 43_200
        next_run_at = trigger.next_run_at.isoformat() + "Z" if trigger.next_run_at else None
    return {
        "id": str(canvas.id),
        "project_id": str(canvas.project_id) if canvas.project_id else None,
        "owner_kind": canvas.owner_kind,
        "owner_id": str(canvas.owner_id),
        "slug": canvas.slug,
        "title": canvas.title,
        "schema_version": canvas.schema_version,
        "revision": canvas.revision,
        "source": source,
        "tree": tree,
        "empty": is_empty_tree(tree),
        "managing_agent_id": str(canvas.managing_agent_id) if canvas.managing_agent_id else None,
        "refresh_trigger_id": str(canvas.refresh_trigger_id) if canvas.refresh_trigger_id else None,
        "refresh_minutes": refresh_minutes,
        "refresh_cadence": cadence,
        "next_run_at": next_run_at,
        "updated_by_type": canvas.updated_by_type,
        "updated_by_id": canvas.updated_by_id or None,
        "notes": canvas.notes,
        "created_at": canvas.created_at.isoformat() + "Z" if canvas.created_at else None,
        "updated_at": canvas.updated_at.isoformat() + "Z" if canvas.updated_at else None,
    }


async def _load_trigger(session: AsyncSession, tenant_id: UUID, trigger_id: UUID | None) -> Trigger | None:
    if not trigger_id:
        return None
    return (
        await session.execute(
            select(Trigger).where(Trigger.id == trigger_id, Trigger.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()


async def _serialize(session: AsyncSession, tenant_id: UUID, canvas: ProjectCanvas) -> dict[str, Any]:
    trigger = await _load_trigger(session, tenant_id, canvas.refresh_trigger_id)
    return serialize_canvas(canvas, trigger=trigger)


def _legacy_markdown_intro(widgets_json: str | None) -> str | None:
    widgets = _parse_json(widgets_json, [])
    if not isinstance(widgets, list):
        return None
    for widget in widgets:
        if not isinstance(widget, dict):
            continue
        wtype = str(widget.get("type") or "").lower()
        cfg = widget.get("config") if isinstance(widget.get("config"), dict) else {}
        if wtype not in {"markdown", "intro", "text", "note"}:
            continue
        for key in ("content", "markdown", "text", "body"):
            raw = cfg.get(key) or widget.get(key)
            if isinstance(raw, str) and raw.strip():
                return raw.strip()[:8000]
    return None


def _document_from_legacy(canvas: ProjectCanvas) -> tuple[str, dict[str, Any]] | None:
    tree = _parse_json(canvas.tree_json, None)
    if isinstance(tree, dict) and tree.get("type") and not is_empty_tree(tree):
        return None
    if (canvas.source or "").strip() and "bokito/canvas" in (canvas.source or ""):
        return None
    intro = _legacy_markdown_intro(canvas.widgets_json)
    if not intro:
        return _empty_document() if not (canvas.source or "").strip() else None
    tree = {
        "type": "Stack",
        "props": {},
        "children": [{"type": "Text", "props": {"text": intro}, "children": []}],
    }
    source, tree = compile_canvas(tree=tree)
    return source, tree


async def _hydrate_owner_fields(canvas: ProjectCanvas, tenant_id: UUID) -> bool:
    changed = False
    if not canvas.owner_kind:
        canvas.owner_kind = OWNER_PROJECT if canvas.project_id else OWNER_TENANT
        changed = True
    if canvas.owner_id is None:
        if canvas.project_id:
            canvas.owner_id = canvas.project_id
            canvas.owner_kind = OWNER_PROJECT
            changed = True
        else:
            canvas.owner_id = tenant_id
            canvas.owner_kind = OWNER_TENANT
            changed = True
    return changed


async def get_canvas_row(
    session: AsyncSession,
    tenant_id: UUID,
    canvas_id: UUID,
    *,
    include_deleted: bool = False,
) -> ProjectCanvas:
    from app.services.trash import alive

    query = select(ProjectCanvas).where(
        ProjectCanvas.id == canvas_id, ProjectCanvas.tenant_id == tenant_id
    )
    if not include_deleted:
        query = query.where(alive(ProjectCanvas))
    canvas = (
        await session.execute(query)
    ).scalar_one_or_none()
    if canvas is None:
        raise HTTPException(status_code=404, detail="Canvas not found")
    return canvas


async def find_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    owner_kind: str,
    owner_id: UUID,
    slug: str,
) -> ProjectCanvas | None:
    slug_key = (slug or "main").strip().lower()
    from app.services.trash import alive

    return (
        await session.execute(
            select(ProjectCanvas).where(
                ProjectCanvas.tenant_id == tenant_id,
                ProjectCanvas.owner_kind == owner_kind,
                ProjectCanvas.owner_id == owner_id,
                ProjectCanvas.slug == slug_key,
                alive(ProjectCanvas),
            )
        )
    ).scalar_one_or_none()


async def list_canvases(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    owner_kind: str,
    owner_id: UUID,
) -> list[dict[str, Any]]:
    kind, oid = await resolve_owner(
        session, tenant_id, owner_kind=owner_kind, owner_id=owner_id
    )
    from app.services.trash import alive

    result = await session.execute(
        select(ProjectCanvas)
        .where(
            ProjectCanvas.tenant_id == tenant_id,
            ProjectCanvas.owner_kind == kind,
            ProjectCanvas.owner_id == oid,
            alive(ProjectCanvas),
        )
        .order_by(ProjectCanvas.created_at)
    )
    items = []
    dirty = False
    for canvas in result.scalars().all():
        if await _hydrate_owner_fields(canvas, tenant_id):
            dirty = True
        legacy = _document_from_legacy(canvas)
        if legacy is not None and (
            not (canvas.source or "").strip()
            or canvas.schema_version < CANVAS_SCHEMA_VERSION
            or not (_parse_json(canvas.tree_json, {}) or {}).get("type")
        ):
            source, tree = legacy
            canvas.source = source
            canvas.tree_json = json.dumps(tree)
            canvas.schema_version = CANVAS_SCHEMA_VERSION
            dirty = True
        if dirty:
            session.add(canvas)
        items.append(await _serialize(session, tenant_id, canvas))
    if dirty:
        await session.commit()
    return items


async def list_project_canvases(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> list[dict[str, Any]]:
    return await list_canvases(
        session, tenant_id, owner_kind=OWNER_PROJECT, owner_id=project_id
    )


async def get_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    canvas_id: UUID | None = None,
    owner_kind: str | None = None,
    owner_id: UUID | None = None,
    project_id: UUID | None = None,
    slug: str = "main",
) -> dict[str, Any]:
    if canvas_id:
        canvas = await get_canvas_row(session, tenant_id, canvas_id)
        return await _serialize(session, tenant_id, canvas)
    kind, oid = await resolve_owner(
        session, tenant_id, owner_kind=owner_kind, owner_id=owner_id, project_id=project_id
    )
    canvas = await find_canvas(session, tenant_id, owner_kind=kind, owner_id=oid, slug=slug)
    if canvas is None:
        raise HTTPException(status_code=404, detail="Canvas not found")
    return await _serialize(session, tenant_id, canvas)


async def _unique_slug(
    session: AsyncSession,
    tenant_id: UUID,
    owner_kind: str,
    owner_id: UUID,
    slug: str,
    *,
    exclude_id: UUID | None = None,
) -> str:
    base = slug if _SLUG_RE.match(slug) else slugify_title(slug)
    candidate = base
    n = 2
    while True:
        existing = await find_canvas(
            session, tenant_id, owner_kind=owner_kind, owner_id=owner_id, slug=candidate
        )
        if existing is None or existing.id == exclude_id:
            return candidate
        candidate = f"{base[:58]}-{n}"
        n += 1


async def sync_refresh_trigger(
    session: AsyncSession,
    tenant_id: UUID,
    canvas: ProjectCanvas,
    *,
    refresh_cadence: str,
    kick: bool = False,
) -> UUID | None:
    from app.services import triggers as trigger_svc

    existing = await _load_trigger(session, tenant_id, canvas.refresh_trigger_id)
    schedule = cadence_schedule(refresh_cadence)
    if schedule is None:
        if existing:
            await session.delete(existing)
            canvas.refresh_trigger_id = None
        if kick:
            once = await _schedule_once_write(session, tenant_id, canvas)
            return once.id
        return None
    kind, minutes, cron_expr = schedule
    name = f"Refresh canvas · {canvas.title}"[:120]
    instructions = refresh_instructions(
        owner_kind=canvas.owner_kind,
        owner_id=canvas.owner_id,
        slug=canvas.slug,
        canvas_id=canvas.id,
        title=canvas.title,
        brief=canvas.notes or "",
    )
    if existing:
        existing.name = name
        existing.kind = kind
        existing.interval_minutes = minutes
        existing.cron_expr = cron_expr
        existing.agent_id = canvas.managing_agent_id
        existing.instructions = instructions
        existing.enabled = True
        existing.next_run_at = datetime.utcnow() if kick else trigger_svc.compute_next_run(existing)
        session.add(existing)
        return existing.id if kick else None
    trigger = await trigger_svc.create_trigger(
        session,
        tenant_id,
        name=name,
        kind=kind,
        interval_minutes=minutes,
        cron_expr=cron_expr,
        agent_id=canvas.managing_agent_id,
        instructions=instructions,
        enabled=True,
    )
    if kick:
        trigger.next_run_at = datetime.utcnow()
        session.add(trigger)
        await session.commit()
        await session.refresh(trigger)
    canvas.refresh_trigger_id = trigger.id
    return trigger.id if kick else None


async def _schedule_once_write(
    session: AsyncSession, tenant_id: UUID, canvas: ProjectCanvas
) -> Trigger:
    from app.services import triggers as trigger_svc

    return await trigger_svc.create_trigger(
        session,
        tenant_id,
        name=f"Write canvas · {canvas.title}"[:120],
        kind="once",
        agent_id=canvas.managing_agent_id,
        instructions=refresh_instructions(
            owner_kind=canvas.owner_kind,
            owner_id=canvas.owner_id,
            slug=canvas.slug,
            canvas_id=canvas.id,
            title=canvas.title,
            brief=canvas.notes or "",
        ),
        enabled=True,
        run_at=datetime.utcnow(),
    )


async def _fire_canvas_trigger(tenant_id: UUID, trigger_id: UUID) -> None:
    from app.db.session import async_session_factory
    from app.services.triggers import fire_trigger, get_trigger

    try:
        async with async_session_factory() as session:
            trigger = await get_trigger(session, tenant_id, trigger_id)
            await fire_trigger(session, trigger)
    except Exception:
        logger.exception("canvas write kick failed trigger=%s", trigger_id)


def _schedule_kick(tenant_id: UUID, trigger_id: UUID | None) -> None:
    if not trigger_id or os.environ.get("PYTEST_CURRENT_TEST"):
        return
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(_fire_canvas_trigger(tenant_id, trigger_id))


async def create_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    owner_kind: str,
    owner_id: UUID,
    title: str,
    slug: str | None = None,
    managing_agent_id: UUID | None = None,
    refresh_minutes: int | None = None,
    refresh_cadence: str | None = None,
    notes: str | None = None,
    updated_by_type: str = "user",
    updated_by_id: str = "",
) -> dict[str, Any]:
    kind, oid = await resolve_owner(
        session, tenant_id, owner_kind=owner_kind, owner_id=owner_id
    )
    name = (title or "").strip() or "Canvas"
    slug_key = await _unique_slug(
        session, tenant_id, kind, oid, (slug or slugify_title(name)).strip().lower()
    )
    agent_id = await resolve_managing_agent(
        session, tenant_id, owner_kind=kind, owner_id=oid, agent_id=managing_agent_id
    )
    source, tree = _empty_document()
    brief = (notes or "").strip() or None
    if brief and len(brief) > 2000:
        brief = brief[:2000]
    canvas = ProjectCanvas(
        tenant_id=tenant_id,
        owner_kind=kind,
        owner_id=oid,
        project_id=oid if kind == OWNER_PROJECT else None,
        slug=slug_key,
        title=name[:160],
        schema_version=CANVAS_SCHEMA_VERSION,
        revision=1,
        source=source,
        tree_json=json.dumps(tree),
        managing_agent_id=agent_id,
        notes=brief,
        updated_by_type=(updated_by_type or "user")[:32],
        updated_by_id=(updated_by_id or "")[:64],
    )
    session.add(canvas)
    await session.commit()
    await session.refresh(canvas)
    cadence = resolve_refresh_cadence(
        refresh_cadence=refresh_cadence,
        refresh_minutes=refresh_minutes,
        default=DEFAULT_REFRESH_CADENCE,
    )
    kick_id = await sync_refresh_trigger(
        session, tenant_id, canvas, refresh_cadence=cadence, kick=True
    )
    session.add(canvas)
    await session.commit()
    await session.refresh(canvas)
    _schedule_kick(tenant_id, kick_id)
    return await _serialize(session, tenant_id, canvas)


async def patch_canvas_meta(
    session: AsyncSession,
    tenant_id: UUID,
    canvas_id: UUID,
    *,
    title: str | None = None,
    slug: str | None = None,
    managing_agent_id: UUID | None = None,
    refresh_minutes: int | None = None,
    refresh_cadence: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    canvas = await get_canvas_row(session, tenant_id, canvas_id)
    if title is not None:
        canvas.title = (title.strip() or canvas.title)[:160]
    if slug is not None:
        canvas.slug = await _unique_slug(
            session,
            tenant_id,
            canvas.owner_kind,
            canvas.owner_id,
            slug.strip().lower(),
            exclude_id=canvas.id,
        )
    if managing_agent_id is not None:
        canvas.managing_agent_id = await resolve_managing_agent(
            session,
            tenant_id,
            owner_kind=canvas.owner_kind,
            owner_id=canvas.owner_id,
            agent_id=managing_agent_id or None,
        )
    if notes is not None:
        canvas.notes = (notes.strip() or None)
        if canvas.notes and len(canvas.notes) > 2000:
            canvas.notes = canvas.notes[:2000]
    if (
        refresh_cadence is not None
        or refresh_minutes is not None
        or managing_agent_id is not None
        or title is not None
        or notes is not None
    ):
        trigger = await _load_trigger(session, tenant_id, canvas.refresh_trigger_id)
        cadence = resolve_refresh_cadence(
            refresh_cadence=refresh_cadence,
            refresh_minutes=refresh_minutes,
            default=cadence_from_trigger(trigger),
        )
        await sync_refresh_trigger(session, tenant_id, canvas, refresh_cadence=cadence, kick=False)
    canvas.updated_at = datetime.utcnow()
    session.add(canvas)
    await session.commit()
    await session.refresh(canvas)
    return await _serialize(session, tenant_id, canvas)


async def delete_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    canvas_id: UUID,
    *,
    permanent: bool = False,
    commit: bool = True,
    user_id: UUID | None = None,
) -> dict[str, bool]:
    canvas = await get_canvas_row(session, tenant_id, canvas_id, include_deleted=permanent)
    if not permanent:
        from app.services.trash import load_tenant, move_to_bin

        tenant = await load_tenant(session, tenant_id)
        await move_to_bin(
            session,
            tenant,
            resource_type="canvas",
            row=canvas,
            user_id=user_id,
            commit=commit,
        )
        return {"ok": True}
    trigger = await _load_trigger(session, tenant_id, canvas.refresh_trigger_id)
    if trigger:
        await session.delete(trigger)
    await session.delete(canvas)
    if commit:
        await session.commit()
    return {"ok": True}


def _compile_payload(*, source: Any = None, tree: Any = None) -> tuple[str, dict[str, Any]]:
    try:
        return compile_canvas(
            source=str(source) if source is not None else None,
            tree=tree,
        )
    except CanvasCompileError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def put_canvas_source(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    canvas: ProjectCanvas | None = None,
    canvas_id: UUID | None = None,
    owner_kind: str | None = None,
    owner_id: UUID | None = None,
    project_id: UUID | None = None,
    slug: str = "main",
    title: str | None = None,
    source: Any = None,
    tree: Any = None,
    notes: str | None = None,
    expected_revision: int | None = None,
    updated_by_type: str = "agent",
    updated_by_id: str = "",
    reset: bool = False,
    create_if_missing: bool = False,
) -> dict[str, Any]:
    if canvas is None and canvas_id:
        canvas = await get_canvas_row(session, tenant_id, canvas_id)
    if canvas is None:
        kind, oid = await resolve_owner(
            session, tenant_id, owner_kind=owner_kind, owner_id=owner_id, project_id=project_id
        )
        canvas = await find_canvas(session, tenant_id, owner_kind=kind, owner_id=oid, slug=slug)
        if canvas is None:
            if not create_if_missing:
                raise HTTPException(status_code=404, detail="Canvas not found")
            created = await create_canvas(
                session,
                tenant_id,
                owner_kind=kind,
                owner_id=oid,
                title=(title or slug or "Canvas"),
                slug=slug,
                updated_by_type=updated_by_type,
                updated_by_id=updated_by_id,
            )
            canvas = await get_canvas_row(session, tenant_id, UUID(created["id"]))

    if expected_revision is not None and expected_revision != canvas.revision:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Canvas was updated elsewhere; reload and try again.",
                "revision": canvas.revision,
            },
        )

    if reset:
        compiled_source, compiled_tree = _empty_document()
        canvas.notes = "Cleared canvas"
    else:
        if source is None and tree is None:
            raise HTTPException(status_code=400, detail="Provide source or tree.")
        compiled_source, compiled_tree = _compile_payload(source=source, tree=tree)
        if notes is not None:
            canvas.notes = (notes.strip() or None)
            if canvas.notes and len(canvas.notes) > 2000:
                canvas.notes = canvas.notes[:2000]
    if title is not None:
        canvas.title = (title.strip() or canvas.title)[:160]
    canvas.source = compiled_source
    canvas.tree_json = json.dumps(compiled_tree)
    canvas.layout_json = "{}"
    canvas.widgets_json = "[]"
    canvas.schema_version = CANVAS_SCHEMA_VERSION
    canvas.revision = int(canvas.revision or 0) + 1
    canvas.updated_by_type = (updated_by_type or "agent")[:32]
    canvas.updated_by_id = (updated_by_id or "")[:64]
    canvas.updated_at = datetime.utcnow()
    session.add(canvas)
    await session.commit()
    await session.refresh(canvas)
    return await _serialize(session, tenant_id, canvas)


async def apply_canvas_document(
    session: AsyncSession,
    tenant_id: UUID,
    after: dict[str, Any],
    *,
    change_kind: str = "update",
) -> dict[str, Any]:
    """Govern apply path for resource_type=project_canvas."""
    if change_kind == "delete":
        canvas_id = str(after.get("canvas_id") or after.get("id") or "").strip()
        if not canvas_id:
            raise HTTPException(status_code=400, detail="canvas_id required")
        return await delete_canvas(session, tenant_id, UUID(canvas_id))
    if change_kind == "create":
        owner_kind = str(after.get("owner_kind") or OWNER_PROJECT)
        owner_raw = str(after.get("owner_id") or after.get("project_id") or "").strip()
        if not owner_raw:
            raise HTTPException(status_code=400, detail="owner_id required")
        result = await create_canvas(
            session,
            tenant_id,
            owner_kind=owner_kind,
            owner_id=UUID(owner_raw),
            title=str(after.get("title") or "Canvas"),
            slug=str(after.get("slug") or "") or None,
            managing_agent_id=UUID(after["managing_agent_id"]) if after.get("managing_agent_id") else None,
            refresh_minutes=int(after["refresh_minutes"]) if after.get("refresh_minutes") is not None else None,
            refresh_cadence=str(after.get("refresh_cadence") or "") or None,
            notes=str(after.get("notes") or "") or None,
            updated_by_type="agent",
            updated_by_id=str(after.get("agent_id") or after.get("updated_by_id") or ""),
        )
        return {"status": "applied", "canvas": result}

    canvas_id_raw = str(after.get("canvas_id") or after.get("id") or "").strip()
    project_raw = str(after.get("project_id") or "").strip()
    owner_kind = str(after.get("owner_kind") or (OWNER_PROJECT if project_raw else "")).strip() or None
    owner_raw = str(after.get("owner_id") or project_raw).strip()
    slug = str(after.get("slug") or "main").strip().lower() or "main"
    agent_id = str(after.get("agent_id") or after.get("updated_by_id") or "")
    result = await put_canvas_source(
        session,
        tenant_id,
        canvas_id=UUID(canvas_id_raw) if canvas_id_raw else None,
        owner_kind=owner_kind,
        owner_id=UUID(owner_raw) if owner_raw else None,
        project_id=UUID(project_raw) if project_raw else None,
        slug=slug,
        title=str(after["title"]) if after.get("title") is not None else None,
        source=after.get("source"),
        tree=after.get("tree"),
        notes=str(after.get("notes") or "") or None,
        reset=bool(after.get("reset") or after.get("reset_to_default")),
        updated_by_type="agent",
        updated_by_id=agent_id,
        create_if_missing=True,
    )
    return {"status": "applied", "canvas": result}


# Back-compat names used by older routers/tests.
async def get_or_create_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    slug: str = "main",
) -> ProjectCanvas:
    """Load a project canvas by slug; create an empty one only if none exist yet for that slug."""
    canvas = await find_canvas(
        session, tenant_id, owner_kind=OWNER_PROJECT, owner_id=project_id, slug=slug
    )
    if canvas is not None:
        return canvas
    created = await create_canvas(
        session,
        tenant_id,
        owner_kind=OWNER_PROJECT,
        owner_id=project_id,
        title="Canvas",
        slug=slug,
        updated_by_type="system",
    )
    return await get_canvas_row(session, tenant_id, UUID(created["id"]))


async def put_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    **kwargs: Any,
) -> dict[str, Any]:
    return await put_canvas_source(
        session,
        tenant_id,
        project_id=project_id,
        owner_kind=OWNER_PROJECT,
        owner_id=project_id,
        create_if_missing=True,
        **kwargs,
    )
