"""Canvas nodes as snapshot documents with Agenda-backed refresh."""

from __future__ import annotations

from app.core.time import utcnow

import asyncio
import contextvars
import json
import logging
import os
import re
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.project import Project
from app.models.project_canvas import (
    CANVAS_SCHEMA_VERSION,
    KIND_DASHBOARD,
    KIND_IMAGE,
    ProjectCanvas,
)
from app.models.signal import Signal
from app.services.canvas_content import (
    CanvasContentError,
    content_is_empty,
    materialize_image,
    normalize_kind,
    prepare_content,
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

# Set for the whole turn when Agenda woke the agent only to refresh a dashboard.
canvas_refresh_wake: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "canvas_refresh_wake", default=False
)

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
MIN_REFRESH_MINUTES = 5
REFRESH_CADENCES = ("manual", "hourly", "daily", "weekly", "monthly", "custom")
DEFAULT_REFRESH_CADENCE = "daily"
_PRESET_CRONS = {
    "0 7 * * *": "daily",
    "0 7 * * 1": "weekly",
    "0 7 1 * *": "monthly",
}


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
    canvas_id: UUID,
    signal_id: UUID,
    slug: str,
    title: str = "",
    brief: str = "",
    folder_id: UUID | None = None,
    folder_lines: str = "",
) -> str:
    if folder_id:
        lookup = (
            f"This canvas lives in conversation {signal_id}, filed in folder {folder_id}. "
            "Use list_queue_items, list_project_docs and list_project_resources, "
            "then embed those numbers."
        )
    else:
        lookup = (
            f"This canvas lives in conversation {signal_id}. Fetch the figures it "
            "needs with your tools, then embed those numbers."
        )
    brief_line = f"What it must show: {brief.strip()}\n" if (brief or "").strip() else ""
    folder_block = f"{folder_lines.strip()}\n" if (folder_lines or "").strip() else ""
    return (
        f"Write or refresh snapshot canvas '{title or slug}' "
        f"(canvas_id={canvas_id}, signal_id={signal_id}, slug={slug}).\n"
        f"{brief_line}"
        f"{lookup}\n"
        f"{folder_block}"
        "This wake is only a canvas refresh. Call get_folder_canvas, then "
        "update_folder_canvas with this canvas_id and a full bokito/canvas document. "
        "Import only from bokito/canvas. Embed figures you just fetched, including "
        "the folder counts above when they are present. Do not create another canvas. "
        "Do not ask the operator, do not call create_decision_request, and do not "
        "call propose_action. Do not promise live tiles. Omit empty cards. "
        "After the write, reply with only HEARTBEAT_OK."
    )


def is_canvas_refresh_trigger(name: str, instructions: str = "") -> bool:
    """True when this Agenda rule exists only to rewrite one snapshot."""
    title = (name or "").strip()
    body = (instructions or "").lstrip()
    return (
        title.startswith("Refresh canvas")
        or title.startswith("Write canvas")
        or body.startswith("Write or refresh snapshot canvas")
    )


def cadence_schedule(cadence: str, cron_expr: str = "") -> tuple[str, int, str] | None:
    key = (cadence or "").strip().lower()
    if key == "custom":
        expr = " ".join((cron_expr or "").split())
        if len(expr.split()) != 5:
            return None
        return ("cron", 0, expr)
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
    if not trigger or not trigger.enabled or trigger.kind == "once":
        return "manual"
    if trigger.kind == "interval":
        if int(trigger.interval_minutes or 0) == 60:
            return "hourly"
        return "custom"
    if trigger.kind != "cron":
        return "manual"
    expr = " ".join((trigger.cron_expr or "").split())
    if len(expr.split()) != 5:
        return "manual"
    return _PRESET_CRONS.get(expr, "custom")


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


async def _require_signal(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> Signal:
    signal = await session.get(Signal, signal_id)
    if signal is None or signal.tenant_id != tenant_id or signal.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return signal


async def _live_folder_id(
    session: AsyncSession, tenant_id: UUID, signal: Signal | None
) -> UUID | None:
    """The folder a canvas shows under: its home conversation's folder, when alive."""
    if signal is None or not signal.project_id:
        return None
    project = await session.get(Project, signal.project_id)
    if project is None or project.tenant_id != tenant_id or project.deleted_at is not None:
        return None
    return project.id


async def default_location(
    session: AsyncSession, tenant_id: UUID, canvas_id: UUID | None = None
) -> dict[str, Any]:
    """Where a canvas link without a folder lands.

    The named canvas when it is alive, else the canvas touched last, else the
    folder General. A canvas whose conversation sits in no folder opens in
    that conversation.
    """
    from app.services.works_in import folder_href, general_folder

    row = None
    signal = None
    for named in ([ProjectCanvas.id == canvas_id] if canvas_id else [], []):
        found = (
            await session.execute(
                select(ProjectCanvas, Signal)
                .join(Signal, Signal.id == ProjectCanvas.signal_id)
                .where(
                    *named,
                    ProjectCanvas.tenant_id == tenant_id,
                    ProjectCanvas.deleted_at.is_(None),
                    Signal.tenant_id == tenant_id,
                    Signal.deleted_at.is_(None),
                )
                .order_by(ProjectCanvas.updated_at.desc())
                .limit(1)
            )
        ).first()
        if found is not None:
            row, signal = found
            break
    if row is not None:
        folder_id = await _live_folder_id(session, tenant_id, signal)
        if folder_id:
            return {
                "folder_id": str(folder_id),
                "canvas_id": str(row.id),
                "href": folder_href(folder_id, "canvas", canvas=str(row.id)),
            }
        return {
            "folder_id": None,
            "canvas_id": str(row.id),
            "href": canvas_on_thread(
                _thread_path(row.managing_agent_id or signal.agent_id, signal.id),
                row.id,
            ),
        }
    folder = await general_folder(session, tenant_id)
    await session.commit()
    return {"folder_id": str(folder.id), "canvas_id": None, "href": folder_href(folder.id, "canvas")}


async def resolve_managing_agent(
    session: AsyncSession,
    tenant_id: UUID,
    *,
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
    from app.services.lead_agent import get_lead_agent

    lead = await get_lead_agent(session, tenant_id)
    return lead.id if lead else None


def serialize_canvas(
    canvas: ProjectCanvas,
    *,
    trigger: Trigger | None = None,
    folder_id: UUID | None = None,
) -> dict[str, Any]:
    tree = _parse_json(canvas.tree_json, EMPTY_TREE)
    if not isinstance(tree, dict) or not tree.get("type"):
        tree = dict(EMPTY_TREE)
    kind = (getattr(canvas, "kind", None) or KIND_DASHBOARD).strip() or KIND_DASHBOARD
    if kind == KIND_DASHBOARD:
        source = canvas.source or EMPTY_SOURCE
        empty = is_empty_tree(tree)
    else:
        source = canvas.source or ""
        empty = content_is_empty(kind, source)
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
        "folder_id": str(folder_id) if folder_id else None,
        "slug": canvas.slug,
        "title": canvas.title,
        "kind": kind,
        "language": canvas.language if kind == "code" else None,
        "schema_version": canvas.schema_version,
        "revision": canvas.revision,
        "source": source,
        "tree": tree,
        "empty": empty,
        "managing_agent_id": str(canvas.managing_agent_id) if canvas.managing_agent_id else None,
        "signal_id": str(canvas.signal_id) if canvas.signal_id else None,
        "refresh_trigger_id": str(canvas.refresh_trigger_id) if canvas.refresh_trigger_id else None,
        "refresh_minutes": refresh_minutes,
        "refresh_cadence": cadence,
        "refresh_cron": (
            " ".join((trigger.cron_expr or "").split())
            if cadence == "custom" and trigger and trigger.kind == "cron"
            else None
        ),
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


def _thread_path(agent_id: UUID | None, signal_id: UUID) -> str:
    if agent_id:
        return f"/communication/agent/{agent_id}/t/{signal_id}"
    return f"/communication/inbox/open/t/{signal_id}"


def canvas_on_thread(path: str, canvas_id: UUID | str) -> str:
    """Open a canvas beside its conversation. ``/cockpit/canvas`` is gone."""
    from urllib.parse import parse_qsl, urlencode

    base, _, query = (path or "").partition("?")
    pairs = [(key, value) for key, value in parse_qsl(query, keep_blank_values=True) if key != "canvas"]
    pairs.append(("canvas", str(canvas_id)))
    return f"{base}?{urlencode(pairs)}"


async def _home_payloads(
    session: AsyncSession, tenant_id: UUID, canvas: ProjectCanvas
) -> dict[str, Any]:
    from app.services.agent_avatar import avatar_payload

    extra: dict[str, Any] = {"thread": None, "managing_agent": None, "folder_id": None}
    agent = None
    if canvas.managing_agent_id:
        agent = await session.get(Agent, canvas.managing_agent_id)
        if agent is not None and agent.tenant_id == tenant_id:
            extra["managing_agent"] = {
                "id": str(agent.id),
                "name": agent.name,
                "path": f"/agents/{agent.id}",
                **avatar_payload(agent),
            }
    if canvas.signal_id:
        signal = await session.get(Signal, canvas.signal_id)
        if signal is not None and signal.tenant_id == tenant_id and signal.deleted_at is None:
            extra["thread"] = {
                "id": str(signal.id),
                "title": (signal.subject or canvas.title or "Conversation").strip()[:120],
                "path": _thread_path(canvas.managing_agent_id or signal.agent_id, signal.id),
            }
            folder_id = await _live_folder_id(session, tenant_id, signal)
            extra["folder_id"] = str(folder_id) if folder_id else None
    return extra


async def _serialize(
    session: AsyncSession, tenant_id: UUID, canvas: ProjectCanvas
) -> dict[str, Any]:
    trigger = await _load_trigger(session, tenant_id, canvas.refresh_trigger_id)
    payload = serialize_canvas(canvas, trigger=trigger)
    payload.update(await _home_payloads(session, tenant_id, canvas))
    return payload


async def ensure_canvas_thread(
    session: AsyncSession,
    tenant_id: UUID,
    canvas: ProjectCanvas,
    *,
    prefer_signal_id: UUID | None = None,
    new_thread: bool = False,
) -> Any:
    """The conversation this canvas lives in. Opens a new one when the home is gone.

    A replacement thread keeps the folder of the thread it replaces, so a
    canvas does not drop out of its folder when its conversation is binned.
    """
    from app.services.thread_schedule import create_schedule_thread

    def _live(signal: Signal | None) -> bool:
        return signal is not None and signal.tenant_id == tenant_id and signal.deleted_at is None

    prefer = await session.get(Signal, prefer_signal_id) if prefer_signal_id else None
    current = await session.get(Signal, canvas.signal_id) if canvas.signal_id else None
    if not new_thread:
        if _live(prefer):
            canvas.signal_id = prefer.id
            return prefer
        if _live(current):
            return current
        trigger = await _load_trigger(session, tenant_id, canvas.refresh_trigger_id)
        if trigger and trigger.signal_id:
            signal = await session.get(Signal, trigger.signal_id)
            if _live(signal):
                canvas.signal_id = signal.id
                return signal
    agent = (
        await session.get(Agent, canvas.managing_agent_id) if canvas.managing_agent_id else None
    )
    folder_source = prefer if prefer is not None and prefer.tenant_id == tenant_id else current
    if folder_source is not None and folder_source.tenant_id != tenant_id:
        folder_source = None
    signal = await create_schedule_thread(
        session,
        tenant_id,
        subject=canvas.title or "Canvas",
        agent=agent,
        project_id=await _live_folder_id(session, tenant_id, folder_source),
    )
    canvas.signal_id = signal.id
    return signal


async def _bind_home(
    session: AsyncSession, tenant_id: UUID, canvas: ProjectCanvas
) -> bool:
    """Keep the canvas on a live thread and its refresh rule on the same one.

    A binned home is replaced before the refresh rule is pointed at it.
    Otherwise every read sets the rule back onto that binned thread, and
    ``ensure_trigger_thread`` mints a new Agenda row.
    """
    changed = False
    home = await session.get(Signal, canvas.signal_id) if canvas.signal_id else None
    if home is None or home.tenant_id != tenant_id or home.deleted_at is not None:
        await ensure_canvas_thread(session, tenant_id, canvas)
        changed = True
    trigger = await _load_trigger(session, tenant_id, canvas.refresh_trigger_id)
    if trigger and canvas.signal_id and trigger.signal_id != canvas.signal_id:
        trigger_home = await session.get(Signal, trigger.signal_id) if trigger.signal_id else None
        canvas_home = await session.get(Signal, canvas.signal_id)
        trigger_live = (
            trigger_home is not None
            and trigger_home.tenant_id == tenant_id
            and trigger_home.deleted_at is None
        )
        # The canvas still names the assistant chat it was asked in. Pointing
        # the rule back there makes ensure_trigger_thread mint a new thread
        # on every read. The thread the rule already has is the home.
        if trigger_live and canvas_home is not None and canvas_home.channel == "assistant":
            canvas.signal_id = trigger_home.id
        else:
            trigger.signal_id = canvas.signal_id
            session.add(trigger)
            from app.services.thread_schedule import ensure_trigger_thread

            await ensure_trigger_thread(session, trigger)
            if trigger.signal_id and trigger.signal_id != canvas.signal_id:
                canvas.signal_id = trigger.signal_id
        changed = True
    if changed:
        session.add(canvas)
    return changed


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
    signal_id: UUID,
    slug: str,
) -> ProjectCanvas | None:
    slug_key = (slug or "main").strip().lower()
    from app.services.trash import alive

    return (
        await session.execute(
            select(ProjectCanvas).where(
                ProjectCanvas.tenant_id == tenant_id,
                ProjectCanvas.signal_id == signal_id,
                ProjectCanvas.slug == slug_key,
                alive(ProjectCanvas),
            )
        )
    ).scalar_one_or_none()


def _title_key(title: str) -> str:
    return " ".join((title or "").casefold().split())


async def find_canvas_by_title(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    signal_id: UUID,
    title: str,
) -> ProjectCanvas | None:
    """The living canvas in this conversation whose title matches, ignoring case and spacing."""
    key = _title_key(title)
    if not key:
        return None
    from app.services.trash import alive

    rows = (
        await session.execute(
            select(ProjectCanvas).where(
                ProjectCanvas.tenant_id == tenant_id,
                ProjectCanvas.signal_id == signal_id,
                alive(ProjectCanvas),
            )
        )
    ).scalars().all()
    for row in rows:
        if _title_key(row.title) == key:
            return row
    return None


async def list_canvases_for_folder(
    session: AsyncSession, tenant_id: UUID, folder_id: UUID
) -> list[dict[str, Any]]:
    """Canvases whose home conversation is filed in this folder or below it."""
    from app.services import folders
    from app.services.trash import alive

    await _require_project(session, tenant_id, folder_id)
    catalog = await folders.load_catalog(session, tenant_id)
    folder_ids = folders.folder_subtree_ids(catalog, folder_id)
    result = await session.execute(
        select(ProjectCanvas)
        .join(Signal, Signal.id == ProjectCanvas.signal_id)
        .where(
            ProjectCanvas.tenant_id == tenant_id,
            Signal.tenant_id == tenant_id,
            Signal.project_id.in_(folder_ids),
            alive(ProjectCanvas),
        )
        .order_by(ProjectCanvas.created_at)
    )
    items = []
    dirty = False
    for canvas in result.scalars().all():
        changed = False
        legacy = _document_from_legacy(canvas) if (canvas.kind or KIND_DASHBOARD) == KIND_DASHBOARD else None
        if legacy is not None and (
            not (canvas.source or "").strip()
            or canvas.schema_version < CANVAS_SCHEMA_VERSION
            or not (_parse_json(canvas.tree_json, {}) or {}).get("type")
        ):
            source, tree = legacy
            canvas.source = source
            canvas.tree_json = json.dumps(tree)
            canvas.schema_version = CANVAS_SCHEMA_VERSION
            changed = True
        if await _bind_home(session, tenant_id, canvas):
            changed = True
        if changed:
            session.add(canvas)
            dirty = True
        items.append(await _serialize(session, tenant_id, canvas))
    if dirty:
        await session.commit()
    return items


async def list_canvases_for_signal(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID
) -> list[dict[str, Any]]:
    from app.services.trash import alive

    result = await session.execute(
        select(ProjectCanvas)
        .where(
            ProjectCanvas.tenant_id == tenant_id,
            ProjectCanvas.signal_id == signal_id,
            alive(ProjectCanvas),
        )
        .order_by(ProjectCanvas.created_at)
    )
    items = []
    dirty = False
    for canvas in result.scalars().all():
        if await _bind_home(session, tenant_id, canvas):
            dirty = True
        items.append(await _serialize(session, tenant_id, canvas))
    if dirty:
        await session.commit()
    return items


async def list_project_canvases(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> list[dict[str, Any]]:
    return await list_canvases_for_folder(session, tenant_id, project_id)


async def get_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    canvas_id: UUID | None = None,
    signal_id: UUID | None = None,
    slug: str = "main",
) -> dict[str, Any]:
    if canvas_id:
        canvas = await get_canvas_row(session, tenant_id, canvas_id)
    else:
        if signal_id is None:
            raise HTTPException(status_code=400, detail="canvas_id or signal_id required")
        canvas = await find_canvas(session, tenant_id, signal_id=signal_id, slug=slug)
        if canvas is None:
            raise HTTPException(status_code=404, detail="Canvas not found")
    if await _bind_home(session, tenant_id, canvas):
        await session.commit()
        await session.refresh(canvas)
    return await _serialize(session, tenant_id, canvas)


async def _unique_slug(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    slug: str,
    *,
    exclude_id: UUID | None = None,
) -> str:
    base = slug if _SLUG_RE.match(slug) else slugify_title(slug)
    candidate = base
    n = 2
    while True:
        existing = await find_canvas(session, tenant_id, signal_id=signal_id, slug=candidate)
        if existing is None or existing.id == exclude_id:
            return candidate
        candidate = f"{base[:58]}-{n}"
        n += 1


async def _canvas_folder_id(
    session: AsyncSession, tenant_id: UUID, canvas: ProjectCanvas
) -> UUID | None:
    home = await session.get(Signal, canvas.signal_id) if canvas.signal_id else None
    return await _live_folder_id(session, tenant_id, home)


async def _folder_lines(session: AsyncSession, tenant_id: UUID, folder_id: UUID | None) -> str:
    if not folder_id:
        return ""
    from app.services.projects import folder_digest

    return await folder_digest(session, tenant_id, folder_id)


async def _refresh_instructions_for(
    session: AsyncSession, tenant_id: UUID, canvas: ProjectCanvas
) -> str:
    folder_id = await _canvas_folder_id(session, tenant_id, canvas)
    return refresh_instructions(
        canvas_id=canvas.id,
        signal_id=canvas.signal_id,
        slug=canvas.slug,
        title=canvas.title,
        brief=canvas.notes or "",
        folder_id=folder_id,
        folder_lines=await _folder_lines(session, tenant_id, folder_id),
    )


async def _keep_refresh_thread(
    session: AsyncSession,
    tenant_id: UUID,
    canvas: ProjectCanvas,
    trigger: Trigger,
) -> None:
    """Reuse the wake's thread. Do not point the rule back at an assistant chat.

    ``ensure_trigger_thread`` leaves an assistant chat and opens a new one.
    Saving the canvas used to do that on every update, so one weekly canvas
    became several identical conversations.
    """
    from app.models.signal import Signal
    from app.services.thread_schedule import ensure_trigger_thread

    held = await session.get(Signal, trigger.signal_id) if trigger.signal_id else None
    held_live = (
        held is not None and held.tenant_id == tenant_id and held.deleted_at is None
    )
    canvas_home = await session.get(Signal, canvas.signal_id) if canvas.signal_id else None
    if not held_live:
        trigger.signal_id = canvas.signal_id
    elif (
        canvas_home is not None
        and canvas_home.deleted_at is None
        and canvas_home.channel != "assistant"
    ):
        trigger.signal_id = canvas.signal_id
    session.add(trigger)
    if trigger.signal_id or not held_live:
        await ensure_trigger_thread(session, trigger)
    if trigger.signal_id and trigger.signal_id != canvas.signal_id:
        canvas.signal_id = trigger.signal_id


async def sync_refresh_trigger(
    session: AsyncSession,
    tenant_id: UUID,
    canvas: ProjectCanvas,
    *,
    refresh_cadence: str,
    refresh_cron: str | None = None,
    kick: bool = False,
) -> UUID | None:
    from app.services import triggers as trigger_svc

    existing = await _load_trigger(session, tenant_id, canvas.refresh_trigger_id)
    if (canvas.kind or KIND_DASHBOARD) != KIND_DASHBOARD:
        if existing:
            await session.delete(existing)
            canvas.refresh_trigger_id = None
        return None
    key = (refresh_cadence or "").strip().lower()
    cron = " ".join((refresh_cron or "").split())
    if key == "custom" and not cron and existing and existing.kind == "cron":
        cron = " ".join((existing.cron_expr or "").split())
    if key == "custom" and len(cron.split()) != 5:
        raise HTTPException(
            status_code=400,
            detail="Custom refresh needs a five-field cron expression",
        )
    if key == "custom" and trigger_svc.next_cron_run(cron, utcnow()) is None:
        raise HTTPException(status_code=400, detail="Invalid cron expression")
    schedule = cadence_schedule(key, cron)
    if key == "custom" and schedule is None:
        raise HTTPException(status_code=400, detail="Invalid cron expression")
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
    instructions = await _refresh_instructions_for(session, tenant_id, canvas)
    if existing:
        existing.name = name
        existing.kind = kind
        existing.interval_minutes = minutes
        existing.cron_expr = cron_expr
        existing.agent_id = canvas.managing_agent_id
        existing.signal_id = canvas.signal_id or existing.signal_id
        existing.instructions = instructions
        existing.enabled = True
        # A kick fires once below. Leaving next_run_at in the past lets the
        # scheduler start a second copy of the same wake.
        if kick and (existing.next_run_at is None or existing.next_run_at <= utcnow()):
            existing.next_run_at = trigger_svc.compute_next_run(existing, utcnow())
        elif not kick:
            existing.next_run_at = trigger_svc.compute_next_run(existing)
        session.add(existing)
        await _keep_refresh_thread(session, tenant_id, canvas, existing)
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
        signal_id=canvas.signal_id,
        defer_thread=canvas.signal_id is None and not kick,
    )
    canvas.refresh_trigger_id = trigger.id
    if trigger.signal_id and trigger.signal_id != canvas.signal_id:
        canvas.signal_id = trigger.signal_id
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
        signal_id=canvas.signal_id,
        instructions=await _refresh_instructions_for(session, tenant_id, canvas),
        enabled=True,
        run_at=utcnow(),
        hold=True,
    )


async def _fire_canvas_trigger(tenant_id: UUID, trigger_id: UUID) -> None:
    from app.db.session import async_session_factory
    from app.services.triggers import fire_trigger, get_trigger

    try:
        async with async_session_factory() as session:
            trigger = await get_trigger(session, tenant_id, trigger_id)
            # manual keeps the next slot where sync_refresh_trigger left it.
            await fire_trigger(session, trigger, manual=True)
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


async def _fresh_content(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    content_kind: str,
    source: str | None,
    language: str | None,
    image_prompt: str | None,
    image_url: str | None,
) -> tuple[str, dict[str, Any], str | None]:
    """Initial source for a new canvas. A dashboard stays an empty bokito/canvas document."""
    if content_kind == KIND_DASHBOARD:
        if (source or "").strip():
            try:
                text, tree = compile_canvas(source=str(source))
            except CanvasCompileError as exc:
                raise CanvasContentError(str(exc)) from exc
            return text, tree, None
        text, tree = _empty_document()
        return text, tree, None
    if content_kind == KIND_IMAGE and ((image_prompt or "").strip() or (image_url or "").strip()):
        stored = await materialize_image(
            session,
            tenant_id,
            prompt=image_prompt,
            image_url=image_url,
            alt=(image_prompt or "")[:200],
        )
        return stored, dict(EMPTY_TREE), None
    raw = source
    if raw is None and content_kind in (KIND_IMAGE, "email"):
        raw = "{}"
    stored, lang = prepare_content(content_kind, raw or "", language=language, tenant_id=tenant_id)
    return stored, dict(EMPTY_TREE), lang


async def _open_canvas_thread(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    subject: str,
    agent_id: UUID | None,
    folder_id: UUID | None,
    actor_type: str = "user",
    actor_id: str = "",
) -> Signal:
    """A new conversation for a canvas, filed in ``folder_id`` when given."""
    from app.services import folders
    from app.services.thread_schedule import create_schedule_thread

    agent = await session.get(Agent, agent_id) if agent_id else None
    signal = await create_schedule_thread(
        session, tenant_id, subject=subject or "Canvas", agent=agent
    )
    if folder_id is not None:
        try:
            await folders.file_in_folder(
                session,
                signal,
                folder_id,
                actor_type=(actor_type or "user")[:32],
                actor_id=actor_id or "",
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Folder not found") from exc
    return signal


async def create_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    signal_id: UUID | None = None,
    title: str,
    slug: str | None = None,
    managing_agent_id: UUID | None = None,
    refresh_minutes: int | None = None,
    refresh_cadence: str | None = None,
    refresh_cron: str | None = None,
    notes: str | None = None,
    updated_by_type: str = "user",
    updated_by_id: str = "",
    kick: bool = True,
    force_new: bool = False,
    new_thread: bool = False,
    folder_id: UUID | None = None,
    canvas_kind: str | None = None,
    language: str | None = None,
    source: str | None = None,
    image_prompt: str | None = None,
    image_url: str | None = None,
) -> dict[str, Any]:
    """Add a canvas to a conversation.

    ``signal_id`` names the home conversation. ``new_thread`` opens a fresh
    one instead, filed in ``folder_id`` when given.
    """
    if signal_id is None and not new_thread:
        raise HTTPException(status_code=400, detail="signal_id or new_thread required")
    if folder_id is not None:
        await _require_project(session, tenant_id, folder_id)
    home = None if new_thread else await _require_signal(session, tenant_id, signal_id)
    name = (title or "").strip() or "Canvas"
    if home is not None and not force_new:
        existing = await find_canvas_by_title(
            session, tenant_id, signal_id=home.id, title=name
        )
        if existing is not None:
            brief = (notes or "").strip() or None
            if brief and len(brief) > 2000:
                brief = brief[:2000]
            meta_changed = any(
                value is not None
                for value in (brief, managing_agent_id, refresh_cadence, refresh_minutes, refresh_cron)
            )
            if meta_changed:
                if (refresh_cron or "").strip() and not (refresh_cadence or "").strip():
                    refresh_cadence = "custom"
                payload = await patch_canvas_meta(
                    session,
                    tenant_id,
                    existing.id,
                    notes=brief,
                    managing_agent_id=managing_agent_id,
                    refresh_cadence=refresh_cadence,
                    refresh_minutes=refresh_minutes,
                    refresh_cron=refresh_cron,
                )
            else:
                payload = await _serialize(session, tenant_id, existing)
            payload["reused"] = True
            return payload
    agent_id = await resolve_managing_agent(
        session, tenant_id, agent_id=managing_agent_id
    )
    try:
        content_kind = normalize_kind(canvas_kind)
    except CanvasContentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        source_text, tree, language_text = await _fresh_content(
            session,
            tenant_id,
            content_kind=content_kind,
            source=source,
            language=language,
            image_prompt=image_prompt,
            image_url=image_url,
        )
    except CanvasContentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    brief = (notes or "").strip() or None
    if brief and len(brief) > 2000:
        brief = brief[:2000]
    if home is None:
        home = await _open_canvas_thread(
            session,
            tenant_id,
            subject=name,
            agent_id=agent_id,
            folder_id=folder_id,
            actor_type=updated_by_type,
            actor_id=updated_by_id,
        )
    slug_key = await _unique_slug(
        session, tenant_id, home.id, (slug or slugify_title(name)).strip().lower()
    )
    canvas = ProjectCanvas(
        tenant_id=tenant_id,
        signal_id=home.id,
        slug=slug_key,
        title=name[:160],
        kind=content_kind,
        language=language_text,
        schema_version=CANVAS_SCHEMA_VERSION,
        revision=1,
        source=source_text,
        tree_json=json.dumps(tree),
        managing_agent_id=agent_id,
        notes=brief,
        updated_by_type=(updated_by_type or "user")[:32],
        updated_by_id=(updated_by_id or "")[:64],
    )
    session.add(canvas)
    await session.commit()
    await session.refresh(canvas)
    if (refresh_cron or "").strip() and not (refresh_cadence or "").strip():
        refresh_cadence = "custom"
    cadence = resolve_refresh_cadence(
        refresh_cadence=refresh_cadence,
        refresh_minutes=refresh_minutes,
        default=DEFAULT_REFRESH_CADENCE,
    )
    kick_id = await sync_refresh_trigger(
        session,
        tenant_id,
        canvas,
        refresh_cadence=cadence,
        refresh_cron=refresh_cron,
        kick=kick,
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
    refresh_cron: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    canvas = await get_canvas_row(session, tenant_id, canvas_id)
    await ensure_canvas_thread(session, tenant_id, canvas)
    if title is not None:
        canvas.title = (title.strip() or canvas.title)[:160]
    if slug is not None:
        canvas.slug = await _unique_slug(
            session,
            tenant_id,
            canvas.signal_id,
            slug.strip().lower(),
            exclude_id=canvas.id,
        )
    if managing_agent_id is not None:
        canvas.managing_agent_id = await resolve_managing_agent(
            session,
            tenant_id,
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
        if (refresh_cron or "").strip() and not (refresh_cadence or "").strip():
            refresh_cadence = "custom"
        cadence = resolve_refresh_cadence(
            refresh_cadence=refresh_cadence,
            refresh_minutes=refresh_minutes,
            default=cadence_from_trigger(trigger),
        )
        await sync_refresh_trigger(
            session,
            tenant_id,
            canvas,
            refresh_cadence=cadence,
            refresh_cron=refresh_cron,
            kick=False,
        )
    canvas.updated_at = utcnow()
    session.add(canvas)
    await session.commit()
    await session.refresh(canvas)
    return await _serialize(session, tenant_id, canvas)


async def disable_refresh_trigger_for_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    canvas: ProjectCanvas,
) -> None:
    """Stop Agenda wakes when a canvas is binned — soft-delete must not leave cron live."""
    from app.models.signal import Signal
    from app.services.thread_schedule import mirror_next_at

    trigger = await _load_trigger(session, tenant_id, canvas.refresh_trigger_id)
    if not trigger:
        return
    trigger.enabled = False
    trigger.next_run_at = None
    trigger.last_status = "canvas_binned"
    session.add(trigger)
    if trigger.signal_id:
        signal = await session.get(Signal, trigger.signal_id)
        if signal is not None and signal.tenant_id == tenant_id:
            mirror_next_at(signal, trigger)
            session.add(signal)


async def resume_refresh_trigger_for_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    canvas: ProjectCanvas,
) -> None:
    """Re-arm a canvas refresh wake after restore from Bin."""
    from app.models.signal import Signal
    from app.services import triggers as trigger_svc
    from app.services.thread_schedule import mirror_next_at

    trigger = await _load_trigger(session, tenant_id, canvas.refresh_trigger_id)
    if not trigger:
        return
    trigger.enabled = True
    trigger.next_run_at = trigger_svc.compute_next_run(trigger)
    if trigger.last_status == "canvas_binned":
        trigger.last_status = ""
    session.add(trigger)
    if trigger.signal_id:
        signal = await session.get(Signal, trigger.signal_id)
        if signal is not None and signal.tenant_id == tenant_id:
            mirror_next_at(signal, trigger)
            session.add(signal)


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

        # Binning used to leave refresh cron enabled → ghost Agenda blocks.
        await disable_refresh_trigger_for_canvas(session, tenant_id, canvas)
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


_COMPILE_TIMEOUT_SECONDS = 15


def _compile_payload(*, source: Any = None, tree: Any = None) -> tuple[str, dict[str, Any]] | str:
    """Return ``(source, tree)``, or an error string.

    Compile failures stay values. Raising from ``asyncio.to_thread`` while an
    AsyncSession holds a connection makes the next ``await`` on that session
    raise MissingGreenlet and ends the agent turn instead of returning a
    tool error.
    """
    try:
        return compile_canvas(
            source=str(source) if source is not None else None,
            tree=tree,
        )
    except CanvasCompileError as exc:
        return str(exc) or "Canvas source is not valid."


async def _compile_payload_async(*, source: Any = None, tree: Any = None) -> tuple[str, dict[str, Any]]:
    """Compile off the event loop so a stuck parser cannot freeze the API."""
    try:
        compiled = await asyncio.wait_for(
            asyncio.to_thread(_compile_payload, source=source, tree=tree),
            timeout=_COMPILE_TIMEOUT_SECONDS,
        )
    except TimeoutError as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                "Canvas source took too long to compile. "
                "Use a smaller document with fewer nodes."
            ),
        ) from exc
    if isinstance(compiled, str):
        raise HTTPException(status_code=400, detail=compiled)
    return compiled


async def put_canvas_source(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    canvas: ProjectCanvas | None = None,
    canvas_id: UUID | None = None,
    signal_id: UUID | None = None,
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
    language: str | None = None,
    image_prompt: str | None = None,
    image_url: str | None = None,
) -> dict[str, Any]:
    if isinstance(source, (dict, list)):
        source = _source_text(source)
    if canvas is None and canvas_id:
        canvas = await get_canvas_row(session, tenant_id, canvas_id)
    if canvas is None:
        if signal_id is None:
            raise HTTPException(status_code=400, detail="canvas_id or signal_id required")
        canvas = await find_canvas(session, tenant_id, signal_id=signal_id, slug=slug)
        if canvas is None:
            if not create_if_missing:
                raise HTTPException(status_code=404, detail="Canvas not found")
            created = await create_canvas(
                session,
                tenant_id,
                signal_id=signal_id,
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

    content_kind = (canvas.kind or KIND_DASHBOARD).strip() or KIND_DASHBOARD
    if canvas_refresh_wake.get() and content_kind != KIND_DASHBOARD:
        raise HTTPException(status_code=400, detail="A refresh wake only updates a dashboard.")
    await ensure_canvas_thread(session, tenant_id, canvas)

    if reset:
        if content_kind == KIND_DASHBOARD:
            compiled_source, compiled_tree = _empty_document()
        else:
            compiled_source, _tree, language_text = await _fresh_content(
                session,
                tenant_id,
                content_kind=content_kind,
                source=None,
                language=None,
                image_prompt=None,
                image_url=None,
            )
            compiled_tree = _tree
            canvas.language = language_text
        canvas.notes = "Cleared canvas"
    elif content_kind == KIND_DASHBOARD:
        if source is None and tree is None:
            raise HTTPException(status_code=400, detail="Provide source or tree.")
        compiled_source, compiled_tree = await _compile_payload_async(source=source, tree=tree)
    else:
        if source is None and not (image_prompt or "").strip() and not (image_url or "").strip():
            raise HTTPException(status_code=400, detail="Provide source for this canvas.")
        try:
            if content_kind == KIND_IMAGE and (
                (image_prompt or "").strip() or (image_url or "").strip()
            ):
                compiled_source = await materialize_image(
                    session,
                    tenant_id,
                    prompt=image_prompt,
                    image_url=image_url,
                    alt=(image_prompt or "")[:200],
                )
                language_text = None
            else:
                compiled_source, language_text = prepare_content(
                    content_kind,
                    str(source or ""),
                    language=language if language is not None else canvas.language,
                    tenant_id=tenant_id,
                )
        except CanvasContentError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        compiled_tree = dict(EMPTY_TREE)
        canvas.language = language_text
    if notes is not None and not reset:
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
    canvas.updated_at = utcnow()
    session.add(canvas)
    await session.commit()
    await session.refresh(canvas)
    return await _serialize(session, tenant_id, canvas)


def _source_text(value: Any) -> str | None:
    """Keep a string source. A tool JSON object is stored as JSON text, not its Python repr."""
    from app.services.canvas_content import coerce_canvas_source

    if isinstance(value, (dict, list)):
        return coerce_canvas_source(value)
    if value is None:
        return None
    return str(value)


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
        signal_raw = str(after.get("signal_id") or "").strip()
        folder_raw = str(after.get("folder_id") or "").strip()
        new_thread = bool(after.get("new_thread"))
        result = await create_canvas(
            session,
            tenant_id,
            signal_id=UUID(signal_raw) if signal_raw and not new_thread else None,
            new_thread=new_thread,
            folder_id=UUID(folder_raw) if folder_raw and new_thread else None,
            title=str(after.get("title") or "Canvas"),
            slug=str(after.get("slug") or "") or None,
            managing_agent_id=UUID(after["managing_agent_id"]) if after.get("managing_agent_id") else None,
            refresh_minutes=int(after["refresh_minutes"]) if after.get("refresh_minutes") is not None else None,
            refresh_cadence=str(after.get("refresh_cadence") or "") or None,
            refresh_cron=str(after.get("refresh_cron") or "") or None,
            notes=str(after.get("notes") or "") or None,
            updated_by_type="agent",
            updated_by_id=str(after.get("agent_id") or after.get("updated_by_id") or ""),
            kick=bool(after.get("kick", True)),
            force_new=bool(after.get("force_new")),
            canvas_kind=str(after.get("canvas_kind") or after.get("kind") or "") or None,
            language=str(after.get("language") or "") or None,
            source=_source_text(after.get("source")),
            image_prompt=str(after.get("image_prompt") or "") or None,
            image_url=str(after.get("image_url") or "") or None,
        )
        return {"status": "applied", "canvas": result}

    canvas_id_raw = str(after.get("canvas_id") or after.get("id") or "").strip()
    signal_raw = str(after.get("signal_id") or "").strip()
    slug = str(after.get("slug") or "").strip().lower()
    if not canvas_id_raw and not (signal_raw and slug):
        raise HTTPException(status_code=400, detail="canvas_id, or signal_id and slug, required")
    signal_id = UUID(signal_raw) if signal_raw else None
    agent_id = str(after.get("agent_id") or after.get("updated_by_id") or "")
    has_document = (
        after.get("source") is not None
        or after.get("tree") is not None
        or bool(after.get("reset") or after.get("reset_to_default"))
        or bool(str(after.get("image_prompt") or "").strip())
        or bool(str(after.get("image_url") or "").strip())
    )
    has_meta = bool(
        after.get("refresh_cadence") or after.get("refresh_cron") or after.get("managing_agent_id")
    )
    result: dict[str, Any] | None = None
    if has_document or not has_meta:
        result = await put_canvas_source(
            session,
            tenant_id,
            canvas_id=UUID(canvas_id_raw) if canvas_id_raw else None,
            signal_id=signal_id,
            slug=slug or "main",
            title=str(after["title"]) if after.get("title") is not None else None,
            source=_source_text(after.get("source")) if isinstance(after.get("source"), (dict, list)) else after.get("source"),
            tree=after.get("tree"),
            notes=str(after.get("notes") or "") or None,
            reset=bool(after.get("reset") or after.get("reset_to_default")),
            updated_by_type="agent",
            updated_by_id=agent_id,
            create_if_missing=False,
            language=str(after.get("language") or "") or None,
            image_prompt=str(after.get("image_prompt") or "") or None,
            image_url=str(after.get("image_url") or "") or None,
        )
    if has_meta:
        if result and result.get("id"):
            canvas_id = UUID(str(result["id"]))
        elif canvas_id_raw:
            canvas_id = UUID(canvas_id_raw)
        else:
            found = await get_canvas(session, tenant_id, signal_id=signal_id, slug=slug)
            canvas_id = UUID(str(found["id"]))
        manager = UUID(str(after["managing_agent_id"])) if after.get("managing_agent_id") else None
        result = await patch_canvas_meta(
            session,
            tenant_id,
            canvas_id,
            managing_agent_id=manager,
            refresh_cadence=str(after.get("refresh_cadence") or "") or None,
            refresh_cron=str(after.get("refresh_cron") or "") or None,
        )
    return {"status": "applied", "canvas": result}

