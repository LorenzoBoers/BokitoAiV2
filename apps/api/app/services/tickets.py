"""Tickets: a conversation filed under a category moves through a playbook.

A *category* is a hashtag with a playbook (`SignalTag.workstream_id`). Filing
it on a conversation makes that conversation the ticket: `Signal.ticket_tag_id`
plus `stage_key` in the playbook's stage pipeline. A conversation has at most
one ticket; a second request is a split. The folder is never chosen at
filing: it follows from the conversation's tags (`services.folders`). A
folder's board shows every flow with a ticket in its subtree.

Stage moves come from a run entering a step with a ``stage_key``, a run
changing state, or a person moving the card. Every move is written to the
conversation as a ``ticket_stage_changed`` event.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.exceptions import AppError, NotFoundError, status_error
from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.signal import (
    CATEGORY_CREATE_MODES,
    TICKET_STAGE_KINDS,
    Signal,
    SignalEvent,
    SignalTag,
)
from app.services.customer_verify import thread_assurance_valid
from app.services.stage_checkups import checkup_payload, checkup_trigger

_SLUG_RE = re.compile(r"[^a-z0-9]+")

STAGE_KIND_NAMES: dict[str, dict[str, str]] = {
    "en": {"open": "Not started", "waiting": "Waiting", "done": "Done"},
    "nl": {"open": "Niet gestart", "waiting": "Wachtend", "done": "Klaar"},
}


def stage_name_for_kind(stages: list[dict[str, Any]], kind: str, language: str = "en") -> str:
    """Localized stage title, with a numeric suffix when the title is taken."""
    names = STAGE_KIND_NAMES.get(language if language in STAGE_KIND_NAMES else "en", STAGE_KIND_NAMES["en"])
    base = names.get(kind, kind)
    taken = {str(stage.get("name") or "").strip().lower() for stage in stages}
    name = base
    n = 2
    while name.lower() in taken:
        name = f"{base} {n}"
        n += 1
    return name


def insert_named_stage(stages_json: str, *, kind: str, index: int, language: str) -> str:
    """Append or insert one stage. The server picks the title."""
    if kind not in ("open", "waiting", "done"):
        raise ValueError("Unknown stage kind")
    try:
        stages = json.loads(stages_json or "[]")
    except json.JSONDecodeError:
        stages = []
    if not isinstance(stages, list):
        stages = []
    name = stage_name_for_kind(stages, kind, language)
    index = max(0, min(int(index), len(stages)))
    stages.insert(
        index,
        {
            "key": "",
            "name": name,
            "kind": kind,
            "auto_close_conversation": False,
            "fields": [],
            "owner": None,
            "checkup_minutes": 0,
            "waiting_on": "",
            "checklist": [],
            "exit_requires_checklist": False,
        },
    )
    return validate_stages(stages)


def workspace_language(tenant: Any) -> str:
    raw = getattr(tenant, "settings_json", None) or "{}"
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        data = {}
    if not isinstance(data, dict):
        return "en"
    lang = str(data.get("ai_workspace_language") or data.get("ui_language") or "en").lower()
    return "nl" if lang.startswith("nl") else "en"


def default_stages(language: str = "en") -> list[dict[str, Any]]:
    """The default pipeline (open, waiting, done), named in the workspace language."""
    stages: list[dict[str, Any]] = []
    for kind in ("open", "waiting", "done"):
        stages.append(
            {
                "key": kind,
                "name": stage_name_for_kind(stages, kind, language),
                "kind": kind,
                "auto_close_conversation": False,
                "fields": [],
                "owner": None,
                "checkup_minutes": 0,
                "waiting_on": "",
                "checklist": [],
                "exit_requires_checklist": False,
            }
        )
    return stages


DEFAULT_TICKET_STAGES: list[dict[str, Any]] = default_stages("en")
STAGE_FIELD_TYPES = ("text", "textarea", "number", "enum")
MAX_FIELDS_PER_STAGE = 8
MAX_ENUM_OPTIONS = 20


def slugify(value: str) -> str:
    text = _SLUG_RE.sub("-", (value or "").strip().lower()).strip("-")
    return text[:64] or "item"


# ---------------------------------------------------------------------------
# Stage pipeline


def _stage_auto_close(item: dict[str, Any], kind: str) -> bool:
    """Only ``done`` stages may auto-close the conversation; default off."""
    if kind != "done":
        return False
    return bool(item.get("auto_close_conversation"))


STAGE_OWNER_KINDS = ("user", "agent", "department")
MIN_CHECKUP_MINUTES = 60
MAX_CHECKUP_MINUTES = 60 * 24 * 30


def parse_stage_owner(raw: Any) -> dict[str, str] | None:
    """Who owns a ticket in this stage: ``{kind, id}`` or None (keep the owner)."""
    if not isinstance(raw, dict):
        return None
    kind = str(raw.get("kind") or "")
    owner_id = str(raw.get("id") or "").strip()
    if kind not in STAGE_OWNER_KINDS or not owner_id:
        return None
    try:
        UUID(owner_id)
    except ValueError:
        return None
    return {"kind": kind, "id": owner_id}


def parse_checkup_minutes(raw: Any, kind: str) -> int:
    """Check-up rhythm in minutes; 0 is off. Done stages never check up."""
    if kind == "done":
        return 0
    try:
        minutes = int(raw or 0)
    except (TypeError, ValueError):
        return 0
    if minutes <= 0:
        return 0
    return max(MIN_CHECKUP_MINUTES, min(MAX_CHECKUP_MINUTES, minutes))


def parse_enum_options(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw[:MAX_ENUM_OPTIONS]:
        value = str(item or "").strip()[:80]
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def parse_stage_fields(raw: Any) -> list[dict[str, Any]]:
    """Optional intake fields on a stage (key, name, type, required, options)."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw[:MAX_FIELDS_PER_STAGE]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        ftype = str(item.get("type") or "text").strip().lower()
        if ftype not in STAGE_FIELD_TYPES:
            ftype = "text"
        key = slugify(str(item.get("key") or name))
        if not key or key in seen:
            continue
        seen.add(key)
        field: dict[str, Any] = {
            "key": key,
            "name": name[:80],
            "type": ftype,
            "required": bool(item.get("required")),
        }
        if ftype == "enum":
            field["options"] = parse_enum_options(item.get("options"))
        out.append(field)
    return out


def parse_stages(raw: str | None) -> list[dict[str, Any]]:
    try:
        data = json.loads(raw or "[]")
    except json.JSONDecodeError:
        data = []
    stages: list[dict[str, Any]] = []
    if isinstance(data, list):
        for item in data:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "").strip()
            kind = str(item.get("kind") or "")
            if key and kind in TICKET_STAGE_KINDS:
                stages.append(
                    {
                        "key": key,
                        "name": str(item.get("name") or key),
                        "kind": kind,
                        "auto_close_conversation": _stage_auto_close(item, kind),
                        "fields": parse_stage_fields(item.get("fields")),
                        "owner": parse_stage_owner(item.get("owner")),
                        "checkup_minutes": parse_checkup_minutes(item.get("checkup_minutes"), kind),
                        **_stage_work(item, kind),
                    }
                )
    return stages or [dict(s) for s in DEFAULT_TICKET_STAGES]


def _stage_work(item: dict[str, Any], kind: str) -> dict[str, Any]:
    """Who a stage waits on and its checklist (``services.ticket_work``)."""
    from app.services.ticket_work import parse_checklist, parse_waiting_on

    checklist = parse_checklist(item.get("checklist"))
    return {
        "waiting_on": "" if kind == "done" else parse_waiting_on(item.get("waiting_on")),
        "checklist": checklist,
        "exit_requires_checklist": bool(item.get("exit_requires_checklist")) and bool(checklist),
    }


def workstream_stages(ws: Workstream | None) -> list[dict[str, Any]]:
    return parse_stages(ws.stages_json if ws else None)


def is_direct(stages: list[dict[str, Any]]) -> bool:
    """A flow without a waiting stage is handled in the conversation itself: no board."""
    kinds = [s.get("kind") for s in stages]
    return "waiting" not in kinds and kinds.count("open") <= 1


def direct_stages_json(stages: list[dict[str, Any]], language: str) -> str:
    """Keep the first open and the first done stage; that is direct handling."""
    defaults = {s["kind"]: s for s in default_stages(language)}
    keep = [
        next((s for s in stages if s.get("kind") == kind), defaults[kind]) for kind in ("open", "done")
    ]
    return validate_stages(keep)


def staged_json(stages: list[dict[str, Any]], language: str) -> str:
    """Give a direct flow its waiting stage back, before the done stage."""
    done_at = next((i for i, s in enumerate(stages) if s.get("kind") == "done"), len(stages))
    return insert_named_stage(json.dumps(stages), kind="waiting", index=done_at, language=language)


def default_stages_json(language: str = "en") -> str:
    """The default pipeline, stored explicitly so a flow never has empty stages."""
    return json.dumps(default_stages(language))


def has_explicit_stages(ws: Workstream | None) -> bool:
    """True when ``stages_json`` holds at least one valid stage of its own."""
    if ws is None:
        return False
    try:
        data = json.loads(ws.stages_json or "[]")
    except json.JSONDecodeError:
        return False
    return isinstance(data, list) and any(
        isinstance(item, dict)
        and str(item.get("key") or "").strip()
        and str(item.get("kind") or "") in TICKET_STAGE_KINDS
        for item in data
    )


def intake_fields(stages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fields collected when filing: from the first open (niet gestart) stage."""
    for stage in stages:
        if stage.get("kind") == "open" and stage.get("fields"):
            return list(stage["fields"])
    return []


def all_stage_fields(stages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduped field defs across all stages (first definition wins)."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for stage in stages:
        for field in stage.get("fields") or []:
            key = str(field.get("key") or "")
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(dict(field))
    return out


def parse_ticket_fields(raw: str | None) -> dict[str, str]:
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) if v is not None else "" for k, v in data.items()}


def missing_required_stage_fields(
    stage: dict[str, Any] | None, values: dict[str, str]
) -> list[dict[str, Any]]:
    """Required fields on ``stage`` that have no value yet."""
    if not stage:
        return []
    missing: list[dict[str, Any]] = []
    for field in stage.get("fields") or []:
        if not field.get("required"):
            continue
        if not str(values.get(field["key"], "")).strip():
            missing.append(dict(field))
    return missing


def raise_stage_fields_required(stage: dict[str, Any], missing: list[dict[str, Any]]) -> None:
    names = ", ".join(str(field.get("name") or field.get("key")) for field in missing)
    raise status_error(
        status_code=400,
        detail={
            "code": "stage_fields_required",
            "message": f"Fill required fields before moving to {stage.get('name') or stage.get('key')}: {names}",
            "stage_key": stage.get("key"),
            "stage_name": stage.get("name") or stage.get("key"),
            "fields": missing,
        },
    )


def normalize_ticket_fields(
    fields: list[dict[str, Any]], values: Any, *, require: bool = False
) -> dict[str, str]:
    """Keep only known keys; enforce required when ``require`` (operator filing)."""
    raw = values if isinstance(values, dict) else {}
    out: dict[str, str] = {}
    for field in fields:
        key = str(field["key"])
        value = str(raw.get(key, "")).strip()
        if field.get("type") == "number" and value:
            try:
                float(value.replace(",", "."))
            except ValueError as exc:
                raise status_error(
                    status_code=400, detail=f"Field '{field['name']}' must be a number"
                ) from exc
        if field.get("type") == "enum" and value:
            options = {str(opt) for opt in (field.get("options") or [])}
            if value not in options:
                raise status_error(
                    status_code=400,
                    detail=f"Field '{field['name']}' must be one of the allowed options",
                )
        if require and field.get("required") and not value:
            raise status_error(
                status_code=400, detail=f"Field '{field['name']}' is required"
            )
        if value:
            out[key] = value[:500]
    return out


def validate_stages(raw: Any) -> str:
    """Normalize an operator-edited stage list to ``stages_json``."""
    if not isinstance(raw, list) or not raw:
        raise AppError("A pipeline needs at least one stage", code="app_error", status_code=400)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise AppError("Invalid stage", code="app_error", status_code=400)
        name = str(item.get("name") or "").strip()
        kind = str(item.get("kind") or "")
        if not name or kind not in TICKET_STAGE_KINDS:
            raise AppError("Each stage needs a name and a kind", code="app_error", status_code=400)
        key = slugify(str(item.get("key") or name))
        if key in seen:
            raise status_error(status_code=400, detail=f"Duplicate stage '{name}'")
        seen.add(key)
        fields = parse_stage_fields(item.get("fields"))
        if len(item.get("fields") or []) > MAX_FIELDS_PER_STAGE:
            raise status_error(
                status_code=400,
                detail=f"At most {MAX_FIELDS_PER_STAGE} fields per stage",
            )
        for field in fields:
            if field["type"] == "enum" and len(field.get("options") or []) < 2:
                raise status_error(
                    status_code=400,
                    detail=f"Choice list '{field['name']}' needs at least two options",
                )
        out.append(
            {
                "key": key,
                "name": name[:60],
                "kind": kind,
                "auto_close_conversation": _stage_auto_close(item, kind),
                "fields": fields,
                "owner": parse_stage_owner(item.get("owner")),
                "checkup_minutes": parse_checkup_minutes(item.get("checkup_minutes"), kind),
                **_stage_work(item, kind),
            }
        )
    from app.services.ticket_work import validate_checklist_keys

    validate_checklist_keys(out)
    if not any(s["kind"] == "done" for s in out):
        raise AppError("A pipeline needs at least one done stage", code="app_error", status_code=400)
    if out[0]["kind"] != "open":
        raise status_error(
            status_code=400,
            detail="The first stage must be not-started",
        )
    if sum(1 for s in out if s["kind"] == "open") > 1:
        raise status_error(
            status_code=400,
            detail="A pipeline has only one not-started stage",
        )
    if not stage_kinds_in_order([s["kind"] for s in out]):
        raise status_error(
            status_code=400,
            detail="Stages must run not-started, then active, then done",
        )
    return json.dumps(out)


# Not-started, then active, then done, then closed. A later group never
# moves in front of an earlier one.
_STAGE_KIND_RANK = {"open": 0, "waiting": 1, "done": 2, "closed": 3}


def stage_kinds_in_order(kinds: list[str]) -> bool:
    """True when each stage is the same group as the previous one, or a later group."""
    prev = -1
    for kind in kinds:
        rank = _STAGE_KIND_RANK.get(kind)
        if rank is None or rank < prev:
            return False
        prev = rank
    return True


def waiting_stage_progress(stages: list[dict[str, Any]], index: int) -> float | None:
    """How full the active-stage pie is.

    Active stages are the steps between not-started and done. With ``n`` of
    them, the one at position ``i`` (0-based) fills ``(i + 1) / (n + 1)`` of
    the ring, so a single active stage is half and the last one stays short of
    a full circle.
    """
    if index < 0 or index >= len(stages) or stages[index].get("kind") != "waiting":
        return None
    group = [i for i, stage in enumerate(stages) if stage.get("kind") == "waiting"]
    if not group:
        return None
    return (group.index(index) + 1) / (len(group) + 1)


def stage_payload(signal: Signal, stages: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    if not stages or not signal.stage_key:
        return None
    found = next(((i, s) for i, s in enumerate(stages) if s["key"] == signal.stage_key), None)
    if found is None:
        return None
    index, stage = found
    row = dict(stage)
    progress = waiting_stage_progress(stages, index)
    if progress is not None:
        row["progress"] = progress
    return row


# ---------------------------------------------------------------------------
# Categories (hashtags with a playbook)


def serialize_category(row: SignalTag, *, workstream: Workstream | None = None) -> dict[str, Any]:
    from app.services.signal_tags import serialize_tag

    out = serialize_tag(row)
    out.update(
        {
            "create_mode": row.create_mode,
            "ask_threshold": row.ask_threshold,
            "auto_threshold": row.auto_threshold,
            "requires_verification": row.requires_verification,
            "module_slug": row.module_slug,
            "template_slug": row.template_slug,
            "sort_order": row.sort_order,
            "intake_fields": [],
        }
    )
    if workstream is not None:
        out["workstream_name"] = workstream.name
        out["intake_fields"] = intake_fields(workstream_stages(workstream))
    return out


EMPTY_CATEGORY_COUNTS: dict[str, int] = {
    "open": 0,
    "waiting": 0,
    "proposed": 0,
    "filed_7d": 0,
    "filed_prev_7d": 0,
}


async def category_counts(session: AsyncSession, tenant_id: UUID) -> dict[UUID, dict[str, int]]:
    """Live tickets per category by status, and filings over the last two weeks."""
    from sqlalchemy import case

    from app.services.trash import alive

    now = utcnow()
    week, two_weeks = now - timedelta(days=7), now - timedelta(days=14)
    rows = await session.execute(
        select(
            Signal.ticket_tag_id,
            Signal.ticket_status,
            func.count(),
            func.sum(case((Signal.ticket_filed_at >= week, 1), else_=0)),
            func.sum(case(((Signal.ticket_filed_at >= two_weeks) & (Signal.ticket_filed_at < week), 1), else_=0)),
        )
        .where(Signal.tenant_id == tenant_id, Signal.ticket_tag_id.is_not(None), alive(Signal))
        .group_by(Signal.ticket_tag_id, Signal.ticket_status)
    )
    out: dict[UUID, dict[str, int]] = {}
    for tag_id, status, count, recent, previous in rows.all():
        row = out.setdefault(tag_id, dict(EMPTY_CATEGORY_COUNTS))
        if status in ("open", "waiting", "proposed"):
            row[status] += int(count or 0)
        if status == "proposed":
            continue
        row["filed_7d"] += int(recent or 0)
        row["filed_prev_7d"] += int(previous or 0)
    return out


async def list_categories(session: AsyncSession, tenant_id: UUID) -> list[SignalTag]:
    rows = await session.execute(
        select(SignalTag)
        .join(Workstream, Workstream.id == SignalTag.workstream_id)
        .where(
            SignalTag.tenant_id == tenant_id,
            Workstream.tenant_id == tenant_id,
            Workstream.deleted_at.is_(None),
        )
        .order_by(SignalTag.sort_order, SignalTag.name)
    )
    return list(rows.scalars().all())


async def get_category(session: AsyncSession, tenant_id: UUID, tag_id: UUID) -> SignalTag:
    row = await session.get(SignalTag, tag_id)
    if row is None or row.tenant_id != tenant_id:
        raise NotFoundError("Category not found")
    if row.workstream_id is None:
        raise status_error(
            status_code=400,
            detail="This label has no flow.",
        )
    return row


async def find_category(session: AsyncSession, tenant_id: UUID, ref: str) -> SignalTag | None:
    """Look a category up by id or hashtag name (with or without ``#``)."""
    from app.services.signal_tags import normalize_tag

    raw = (ref or "").strip()
    if not raw:
        return None
    try:
        row = await session.get(SignalTag, UUID(raw))
    except ValueError:
        row = None
    if row is None:
        row = (
            await session.execute(
                select(SignalTag).where(
                    SignalTag.tenant_id == tenant_id, SignalTag.name == normalize_tag(raw)
                )
            )
        ).scalar_one_or_none()
    if row is None or row.tenant_id != tenant_id or row.workstream_id is None:
        return None
    return row


def apply_category_config(row: SignalTag, patch: dict[str, Any]) -> None:
    """Intake settings an operator (or an accepted platform change) may edit."""
    if "create_mode" in patch and patch["create_mode"] is not None:
        mode = str(patch["create_mode"])
        if mode not in CATEGORY_CREATE_MODES:
            raise AppError("Invalid create_mode", code="app_error", status_code=400)
        row.create_mode = mode
    for key in ("ask_threshold", "auto_threshold"):
        if key in patch and patch[key] is not None:
            setattr(row, key, max(0, min(11, int(patch[key]))))
    if "requires_verification" in patch and patch["requires_verification"] is not None:
        row.requires_verification = bool(patch["requires_verification"])
    if "sort_order" in patch and patch["sort_order"] is not None:
        row.sort_order = int(patch["sort_order"])


async def ensure_platform_tags(
    session: AsyncSession, tenant_id: UUID, *, commit: bool = True
) -> None:
    """Seed the starter hashtags on a new workspace. Missing names are added;
    renamed or deleted seeds stay that way after the first run."""
    from app.models.auth import Tenant
    from app.modules.catalog import PLATFORM_TAG_SEEDS

    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        return
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    if not isinstance(settings, dict) or settings.get("tag_seeds_done"):
        return
    existing = set(
        (
            await session.execute(select(SignalTag.name).where(SignalTag.tenant_id == tenant_id))
        ).scalars()
    )
    now = utcnow()
    for spec in PLATFORM_TAG_SEEDS:
        if spec["name"] in existing:
            continue
        session.add(
            SignalTag(
                tenant_id=tenant_id,
                name=spec["name"],
                description=spec["description"],
                sort_order=int(spec.get("sort_order", 0)),
                created_at=now,
                updated_at=now,
            )
        )
    settings["tag_seeds_done"] = True
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    if commit:
        await session.commit()
    else:
        await session.flush()


async def install_tag_template(
    session: AsyncSession, tenant_id: UUID, module_slug: str, template_slug: str
) -> SignalTag:
    """Register a module's hashtag. It becomes a category once a playbook is attached."""
    from app.modules.catalog import get_tag_template
    from app.services.signal_tags import normalize_tag

    template = get_tag_template(module_slug, template_slug)
    if template is None:
        raise NotFoundError("Tag template not found")
    name = normalize_tag(template.name)
    rows = (
        await session.execute(
            select(SignalTag).where(
                SignalTag.tenant_id == tenant_id,
                (SignalTag.template_slug == template.slug) | (SignalTag.name == name),
            )
        )
    ).scalars().all()
    if rows:
        return rows[0]
    row = SignalTag(
        tenant_id=tenant_id,
        name=name,
        description=template.description,
        create_mode=template.create_mode,
        ask_threshold=template.ask_threshold,
        auto_threshold=template.auto_threshold,
        requires_verification=template.requires_verification,
        module_slug=module_slug,
        template_slug=template.slug,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


def category_catalog_lines_from_rows(rows: list[SignalTag]) -> list[str]:
    """`name - when to use it` lines from already-loaded category rows."""
    lines: list[str] = []
    for row in rows:
        if not bool(row.ai_auto_tag):
            continue
        description = (row.description or "").strip()
        lines.append(f"{row.name} - {description}" if description else row.name)
    return lines


async def category_catalog_lines(session: AsyncSession, tenant_id: UUID) -> list[str]:
    """`name - when to use it` lines for the triage prompt."""
    return category_catalog_lines_from_rows(await list_categories(session, tenant_id))


# ---------------------------------------------------------------------------
# Folders
#
# A ticket's folder is not chosen at filing: it follows from the
# conversation's tags (`services.folders.refile`), the action tag included.
# Filing never asks "which project?"; when the tags leave the folder open,
# `refile` asks "which folder?" in the thread.


async def folder_path_payload(session: AsyncSession, signal: Signal) -> dict[str, Any] | None:
    from app.services.folders import effective_tag_ids, load_catalog, serialize_folder_paths

    catalog = await load_catalog(session, signal.tenant_id)
    paths = serialize_folder_paths(catalog, await effective_tag_ids(session, signal))
    return paths[0] if paths else None


# ---------------------------------------------------------------------------
# Ticket state on a conversation


async def _signal(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> Signal:
    row = (
        await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("Thread not found")
    return row


async def ticket_payload(
    session: AsyncSession, signal: Signal, *, tag: SignalTag | None = None
) -> dict[str, Any] | None:
    """The conversation's ticket with its pipeline, project choices and current stage."""
    if signal.ticket_tag_id is None:
        return None
    tag = tag or await session.get(SignalTag, signal.ticket_tag_id)
    if tag is None:
        return None
    ws = await session.get(Workstream, tag.workstream_id) if tag.workstream_id else None
    stages = workstream_stages(ws)
    field_defs = all_stage_fields(stages)
    from app.models.auth import Tenant
    from app.services.signal_catalog import signal_policy
    from app.services.signal_tags import label_mark
    from app.services.ticket_work import checklist_rows, entry_policy, next_step, proposals_payload

    live = ws is not None and ws.deleted_at is None
    color, icon = label_mark(tag, flow_live=live)
    tenant = await session.get(Tenant, signal.tenant_id)
    soon_days = signal_policy(tenant)["due_soon_days"]
    policy, threshold = entry_policy(ws, tenant)
    return {
        "signal_id": str(signal.id),
        "tag_id": str(tag.id),
        "name": tag.name,
        "color": color,
        "icon": icon,
        "status": signal.ticket_status or "open",
        "stage_key": signal.stage_key or None,
        "stage": stage_payload(signal, stages),
        "stages": stages,
        "certainty": signal.ticket_certainty,
        "folder_id": str(signal.project_id) if signal.project_id else None,
        "project_id": str(signal.project_id) if signal.project_id else None,
        "folder_path": await folder_path_payload(session, signal),
        "workstream_id": str(ws.id) if live else None,
        "workstream_name": ws.name if live else None,
        "filed_at": signal.ticket_filed_at.isoformat() if signal.ticket_filed_at else None,
        "field_defs": field_defs,
        "fields": parse_ticket_fields(signal.ticket_fields_json),
        "checkup": checkup_payload(await checkup_trigger(session, signal)),
        "due": {
            "at": signal.due_at.isoformat() if signal.due_at else None,
            "source": signal.due_source or None,
            "basis": signal.due_basis or "",
        },
        "checklist": checklist_rows(stages, signal),
        "next_step": next_step(signal, stages, now=utcnow(), soon_days=soon_days),
        "proposals": await proposals_payload(session, signal),
        "stage_entry": {"policy": policy, "threshold": threshold},
    }


async def tickets_by_signal(
    session: AsyncSession, tenant_id: UUID, signals: list[Signal]
) -> dict[UUID, dict[str, Any]]:
    """Compact ticket chip (category and stage) for each conversation in a list."""
    tag_ids = {s.ticket_tag_id for s in signals if s.ticket_tag_id}
    if not tag_ids:
        return {}
    tags = {
        t.id: t
        for t in (
            await session.execute(
                select(SignalTag).where(SignalTag.tenant_id == tenant_id, SignalTag.id.in_(tag_ids))
            )
        ).scalars()
    }
    ws_ids = {t.workstream_id for t in tags.values() if t.workstream_id}
    streams: dict[UUID, Workstream] = {}
    if ws_ids:
        streams = {
            ws.id: ws
            for ws in (
                await session.execute(select(Workstream).where(Workstream.id.in_(ws_ids)))
            ).scalars()
        }
    from app.services.ticket_work import due_state, soon_days_for

    soon_days = await soon_days_for(session, tenant_id)
    now = utcnow()
    done = ("done", "closed")
    out: dict[UUID, dict[str, Any]] = {}
    for signal in signals:
        tag = tags.get(signal.ticket_tag_id) if signal.ticket_tag_id else None
        if tag is None:
            continue
        ws = streams.get(tag.workstream_id) if tag.workstream_id else None
        from app.services.signal_tags import label_mark

        live = ws is not None and ws.deleted_at is None
        color, icon = label_mark(tag, flow_live=live)
        out[signal.id] = {
            "tag_id": str(tag.id),
            "name": tag.name,
            "color": color,
            "icon": icon,
            "status": signal.ticket_status or "open",
            "stage": stage_payload(signal, workstream_stages(ws)),
            "project_id": str(signal.project_id) if signal.project_id else None,
            "due_at": signal.due_at.isoformat() if signal.due_at else None,
            "due_state": due_state(signal.due_at, now, soon_days) if signal.ticket_status not in done else "",
        }
    return out


async def move_ticket_stage(
    session: AsyncSession,
    signal: Signal,
    *,
    stage_key: str | None = None,
    status: str | None = None,
    actor_type: str = "system",
    actor_id: str = "",
    ws: Workstream | None = None,
) -> bool:
    """Move a ticket to ``stage_key``, or to the first stage of ``status``'s kind.

    A status move keeps the current stage when it already has that kind.
    Returns whether anything changed.
    """
    if signal.ticket_tag_id is None:
        return False
    if ws is None:
        tag = await session.get(SignalTag, signal.ticket_tag_id)
        ws = await session.get(Workstream, tag.workstream_id) if tag and tag.workstream_id else None
    stages = workstream_stages(ws)
    current = next((s for s in stages if s["key"] == signal.stage_key), None)
    if stage_key is not None:
        target = next((s for s in stages if s["key"] == stage_key), None)
        if target is None:
            raise AppError("Unknown stage for this ticket", code="app_error", status_code=400)
    elif status is not None:
        if current is not None and current["kind"] == status:
            target = current
        else:
            target = next((s for s in stages if s["kind"] == status), None)
        if target is None:
            return False
    else:
        return False
    if current is not None and current["key"] == target["key"] and signal.ticket_status == target["kind"]:
        return False
    # First enter after filing skips this: intake is collected on file.
    # Later moves (board, ticket panel, close, agents) must fill the target.
    if current is not None:
        missing = missing_required_stage_fields(target, parse_ticket_fields(signal.ticket_fields_json))
        if missing:
            raise_stage_fields_required(target, missing)
        from app.services.ticket_work import guard_checklist_exit

        guard_checklist_exit(stages, signal, current, target)
    signal.stage_key = target["key"]
    signal.ticket_status = target["kind"]
    signal.updated_at = utcnow()
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="ticket_stage_changed",
            actor_type=actor_type,
            actor_id=actor_id,
            payload_json=json.dumps(
                {
                    "from_stage": current["name"] if current else None,
                    "to_stage": target["name"],
                    "to_key": target["key"],
                    "to_kind": target["kind"],
                    "auto_close_conversation": bool(target.get("auto_close_conversation")),
                }
            ),
        )
    )
    if target.get("kind") == "done" and target.get("auto_close_conversation") and signal.status != "closed":
        _auto_close_conversation_for_done_stage(
            session,
            signal,
            actor_type=actor_type,
            actor_id=actor_id,
            stage_name=str(target.get("name") or target["key"]),
        )
    if target.get("kind") == "done" and signal.status == "closed":
        from app.services.deliveries import settle_outcome

        await settle_outcome(session, signal)
    from app.services.stage_checkups import on_stage_entered

    await on_stage_entered(session, signal, target, actor_type=actor_type, actor_id=actor_id)
    return True


async def resolve_open_ticket_for_close(
    session: AsyncSession,
    signal: Signal,
    *,
    fields: dict[str, Any] | None = None,
    actor_id: str = "",
) -> None:
    """Move an open ticket to its first done stage before the conversation closes.

    Missing required fields raise 409 and leave the thread open. A proposed
    ticket, or one that is already done, is left alone.
    """
    if signal.ticket_tag_id is None:
        return
    if (signal.ticket_status or "") in ("done", "closed", "proposed"):
        return
    tag = await session.get(SignalTag, signal.ticket_tag_id)
    if tag is None or tag.workstream_id is None:
        return
    ws = await session.get(Workstream, tag.workstream_id)
    if fields:
        defs = all_stage_fields(workstream_stages(ws))
        current = parse_ticket_fields(signal.ticket_fields_json)
        current.update(normalize_ticket_fields(defs, fields, require=False))
        for key, value in fields.items():
            if str(value).strip() == "":
                current.pop(str(key), None)
        signal.ticket_fields_json = json.dumps(current)
        signal.updated_at = utcnow()
        session.add(signal)
    try:
        await move_ticket_stage(
            session,
            signal,
            status="done",
            actor_type="user",
            actor_id=actor_id,
            ws=ws,
        )
    except (HTTPException, AppError) as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        if detail.get("code") in ("stage_fields_required", "checklist_required"):
            raise status_error(
                status_code=409,
                detail={
                    **detail,
                    "signal_id": str(signal.id),
                    "ticket_name": tag.name if tag else "",
                },
            ) from exc
        raise


async def settle_ticket_on_close(
    session: AsyncSession,
    signal: Signal,
    *,
    actor_type: str = "system",
    actor_id: str = "",
) -> bool:
    """Settle a conversation that closed: move an open ticket to its done stage,
    then record the episode's outcome.

    A flow without a done stage, or a done stage that still needs fields, leaves
    the ticket where it is. Closing the conversation still succeeds. Returns
    whether the ticket moved.
    """
    from app.services.deliveries import settle_outcome

    if signal.status != "closed":
        return False
    moved = False
    if signal.ticket_tag_id is not None and (signal.ticket_status or "") != "done":
        try:
            moved = await move_ticket_stage(
                session,
                signal,
                status="done",
                actor_type=actor_type,
                actor_id=actor_id,
            )
        except (HTTPException, AppError):
            moved = False
    await settle_outcome(session, signal)
    return moved


def _auto_close_conversation_for_done_stage(
    session: AsyncSession,
    signal: Signal,
    *,
    actor_type: str,
    actor_id: str,
    stage_name: str,
) -> None:
    """Close the conversation when a done stage opts into auto-close."""
    if signal.status == "closed":
        return
    from app.services.ai_handling import on_status_change

    signal.status = "closed"
    signal.has_unread = False
    on_status_change(session, signal, actor_id=actor_id or "")
    signal.updated_at = utcnow()
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="thread_updated",
            actor_type=actor_type or "system",
            actor_id=actor_id or "",
            payload_json=json.dumps(
                {
                    "status": "closed",
                    "via": "ticket_done_auto_close",
                    "stage": stage_name,
                }
            ),
        )
    )


def _log_filed(
    session: AsyncSession,
    signal: Signal,
    tag: SignalTag,
    previous: str | None,
    actor_type: str,
    actor_id: str,
) -> None:
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="category_set",
            actor_type=actor_type or "system",
            actor_id=actor_id or "",
            payload_json=json.dumps(
                {
                    "category": tag.name,
                    "previous": previous,
                    "proposed": signal.ticket_status == "proposed",
                    "project_id": str(signal.project_id) if signal.project_id else None,
                }
            ),
        )
    )


async def clear_ticket(session: AsyncSession, signal: Signal) -> str | None:
    """Take the category off a conversation. Flushes."""
    if signal.ticket_tag_id is None:
        return None
    tag = await session.get(SignalTag, signal.ticket_tag_id)
    from app.services.stage_checkups import remove_checkup

    await remove_checkup(session, signal)
    signal.ticket_tag_id = None
    signal.ticket_status = ""
    signal.stage_key = ""
    signal.ticket_certainty = None
    signal.ticket_filed_at = None
    signal.ticket_fields_json = "{}"
    signal.updated_at = utcnow()
    session.add(signal)
    await session.flush()
    from app.services.folders import refile

    # The action tag may have been the tag that placed the conversation.
    await refile(session, signal)
    return tag.name if tag else None


async def _status_update(session: AsyncSession, signal: Signal, text: str) -> None:
    from app.gateway.publish import publish_signal_message
    from app.models.signal import SignalMessage

    now = utcnow()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        kind="status_update",
        role="assistant",
        direction="outbound",
        body_text=text,
        body_preview=text[:200],
        received_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.updated_at = now
    session.add(signal)
    await session.flush()
    await publish_signal_message(signal, message)


async def _ask_operator(
    session: AsyncSession,
    signal: Signal,
    tag: SignalTag,
    *,
    summary: str,
    user_id: UUID | None,
    agent_id: UUID | None,
) -> None:
    """A Decision in the thread: file this ticket, or dismiss."""
    from app.services.signal_decisions import create_decision

    options: list[dict[str, Any]] = [
        {
            "id": "approve",
            "label": "File this ticket",
            "action_type": "update_ticket",
            "payload": {"signal_id": str(signal.id), "status": "open"},
        }
    ]
    options.append(
        {
            "id": "reject",
            "label": "Dismiss",
            "action_type": "update_ticket",
            "payload": {"signal_id": str(signal.id), "status": "dismissed"},
        }
    )
    await create_decision(
        session,
        signal.tenant_id,
        title=f"{tag.name}: {signal.subject or tag.name}",
        summary=summary or f"Review this {tag.name} ticket from the conversation.",
        options=options,
        user_id=user_id,
        agent_id=agent_id,
        signal_id=signal.id,
        source_type="ticket",
        source_id=str(signal.id),
    )
    await _status_update(
        session, signal, "I've asked the team to review this. You can keep talking here."
    )


async def _enter_pipeline(
    session: AsyncSession,
    signal: Signal,
    tag: SignalTag,
    *,
    summary: str = "",
    actor_type: str,
    actor_id: str,
) -> None:
    """Accepted ticket: move to first open stage. Step engine is retired."""
    ws = await session.get(Workstream, tag.workstream_id) if tag.workstream_id else None
    if ws is None:
        return
    await move_ticket_stage(session, signal, status="open", actor_type=actor_type, actor_id=actor_id, ws=ws)
    await session.commit()
    # Stages-only: operators advance tickets through phases; no step runs.


async def file_ticket(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    signal_id: UUID,
    tag_id: UUID,
    project_id: UUID | None = None,
    fields: dict[str, Any] | None = None,
    summary: str = "",
    certainty: int | None = None,
    actor: str = "operator",
    created_by_type: str = "user",
    created_by_id: str = "",
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
    stage_key: str | None = None,
    reason: str = "",
) -> dict[str, Any]:
    """File an action tag on a conversation.

    The folder follows from the conversation's tags (the action tag included);
    an explicit ``project_id`` files the conversation in that folder first,
    which adds that folder's tags. Optional intake ``fields`` come from the
    first open stage. ``stage_key`` places the new ticket past the first
    stage: directly for a person, per the flow's stage-entry policy for an
    agent (under ``first_stage`` the suggestion is dropped).
    """
    from app.services.folders import file_in_folder, refile

    tag = await get_category(session, tenant_id, tag_id)
    signal = await _signal(session, tenant_id, signal_id)
    ws = await session.get(Workstream, tag.workstream_id) if tag.workstream_id else None
    stages = workstream_stages(ws)
    intake = intake_fields(stages)

    previous: str | None = None
    if signal.ticket_tag_id is not None:
        refresh = signal.ticket_status == "proposed" or (
            signal.ticket_status == "waiting" and tag.requires_verification and not signal.stage_key
        )
        if signal.ticket_tag_id == tag.id and not refresh:
            if project_id is not None and actor == "operator":
                await file_in_folder(session, signal, project_id, user_id=user_id, actor_type=created_by_type, actor_id=created_by_id)
                await session.commit()
            return {"ticket": await ticket_payload(session, signal, tag=tag), "existing": True}
        if signal.ticket_tag_id != tag.id and actor != "operator":
            raise status_error(
                status_code=409,
                detail=(
                    "This conversation already has a label with a flow. Split the conversation "
                    "to file the new request on its own label."
                ),
            )
        cleared = await clear_ticket(session, signal)
        if cleared != tag.name:
            previous = cleared

    field_values = normalize_ticket_fields(
        intake, fields or {}, require=actor == "operator"
    )

    score = 10 if certainty is None and actor == "operator" else int(certainty or 0)
    score = max(0, min(10, score))
    now = utcnow()
    signal.ticket_tag_id = tag.id
    signal.ticket_certainty = score
    signal.ticket_filed_at = now
    signal.stage_key = ""
    signal.ticket_fields_json = json.dumps(field_values)
    session.add(signal)
    await session.flush()
    if project_id is not None:
        try:
            await file_in_folder(
                session, signal, project_id, user_id=user_id, actor_type=created_by_type, actor_id=created_by_id
            )
        except LookupError as exc:
            raise NotFoundError("Folder not found") from exc
    else:
        await refile(session, signal, actor_type=created_by_type, actor_id=created_by_id)

    if tag.requires_verification and actor != "operator" and not thread_assurance_valid(signal):
        signal.ticket_status = "waiting"
        session.add(signal)
        _log_filed(session, signal, tag, previous, created_by_type, created_by_id)
        await session.commit()
        return {
            "ticket": await ticket_payload(session, signal, tag=tag),
            "status": "needs_verification",
            "note": "Ask the visitor to confirm their email before this ticket can continue.",
        }

    mode = tag.create_mode
    certain = tag.auto_threshold < 11 and score >= tag.auto_threshold
    ask_operator = False
    if actor == "operator":
        status = "open"
    elif mode == "manual_only":
        status = "proposed"
    elif mode == "ask_operator":
        status, ask_operator = "waiting", True
    elif mode == "auto":
        status = "open" if certain else "proposed"
    else:
        status = "open" if certain or score >= tag.ask_threshold else "proposed"

    signal.ticket_status = status
    session.add(signal)
    _log_filed(session, signal, tag, previous, created_by_type, created_by_id)
    await session.commit()

    extra: dict[str, Any] = {}
    if ask_operator:
        await _ask_operator(
            session, signal, tag, summary=summary, user_id=user_id, agent_id=agent_id
        )
        await session.commit()
        extra["asked_operator"] = True
    elif status == "proposed":
        extra["proposed"] = True
    else:
        await _enter_pipeline(
            session, signal, tag, summary=summary, actor_type=created_by_type, actor_id=created_by_id
        )
        await session.refresh(signal)
        if stage_key and stage_key != signal.stage_key:
            extra.update(
                await _place_new_ticket(
                    session,
                    signal,
                    tag,
                    ws,
                    stage_key=stage_key,
                    agent=actor != "operator",
                    certainty=score,
                    reason=reason or summary,
                    agent_id=agent_id,
                    actor_type=created_by_type,
                    actor_id=created_by_id,
                )
            )
            await session.commit()
            await session.refresh(signal)
    return {"ticket": await ticket_payload(session, signal, tag=tag), **extra}


async def _place_new_ticket(
    session: AsyncSession,
    signal: Signal,
    tag: SignalTag,
    ws: Workstream | None,
    *,
    stage_key: str,
    agent: bool,
    certainty: int | None,
    reason: str,
    agent_id: UUID | None,
    actor_type: str,
    actor_id: str,
) -> dict[str, Any]:
    if not agent:
        await move_ticket_stage(session, signal, stage_key=stage_key, actor_type=actor_type, actor_id=actor_id, ws=ws)
        return {}
    try:
        made = await _agent_stage_request(
            session,
            signal,
            tag,
            ws,
            stage_key=stage_key,
            status=None,
            certainty=certainty,
            reason=reason,
            agent_id=agent_id,
            actor_id=actor_id,
        )
    except (HTTPException, AppError) as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        if detail.get("code") != "stage_moves_by_people":
            raise
        return {"stage_note": detail["message"]}
    return {"proposals_made": made} if made else {}


async def update_ticket(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    patch: dict[str, Any],
    *,
    actor_type: str = "user",
    actor_id: str = "",
) -> dict[str, Any] | None:
    """Accept, dismiss, move or refile a ticket. Returns None when it was removed.

    ``status``: ``open`` accepts a proposal, ``dismissed`` drops a proposal or
    removes the category, any other stage kind moves to the first stage of
    that kind. ``project_id`` files the conversation in that folder (adds its
    tags); ``None`` takes it out of its folder. ``due_at`` (``None`` clears)
    with ``due_source`` / ``due_basis`` sets the deadline; ``checklist`` maps
    item keys to ``done`` / ``open``.

    An agent's stage move follows the flow's stage-entry policy, its deadline
    is always a proposal and its ticks stay proposed (``services.ticket_work``).
    The payload carries ``proposals_made`` when something became a decision.
    """
    from app.services import ticket_work as work

    signal = await _signal(session, tenant_id, signal_id)
    if signal.ticket_tag_id is None:
        raise NotFoundError("This conversation has no ticket")
    tag = await session.get(SignalTag, signal.ticket_tag_id)
    if tag is None or tag.workstream_id is None:
        raise AppError("This category no longer has a playbook", code="app_error", status_code=400)
    pending = signal.ticket_status == "proposed" or (signal.ticket_status == "waiting" and not signal.stage_key)
    status = str(patch.get("status") or "")

    if status in ("dismissed", "removed") or (pending and status == "done"):
        await clear_ticket(session, signal)
        await session.commit()
        return None

    if "fields" in patch:
        ws = await session.get(Workstream, tag.workstream_id)
        defs = all_stage_fields(workstream_stages(ws))
        current = parse_ticket_fields(signal.ticket_fields_json)
        current.update(normalize_ticket_fields(defs, patch.get("fields") or {}, require=False))
        # Drop keys cleared to empty string.
        raw_fields = patch.get("fields") if isinstance(patch.get("fields"), dict) else {}
        for key, value in raw_fields.items():
            if str(value).strip() == "":
                current.pop(str(key), None)
        signal.ticket_fields_json = json.dumps(current)
        signal.updated_at = utcnow()
        session.add(signal)

    if "project_id" in patch:
        from app.services.folders import file_in_folder

        raw = patch["project_id"]
        try:
            await file_in_folder(
                session,
                signal,
                UUID(str(raw)) if raw else None,
                actor_type=actor_type,
                actor_id=actor_id,
            )
        except LookupError as exc:
            raise NotFoundError("Folder not found") from exc
        except ValueError as exc:
            raise AppError("project_id must be a folder id or null", code="app_error", status_code=400) from exc

    agent = actor_type == "agent"
    agent_id = _uuid_or_none(actor_id) if agent else None
    user_id = _uuid_or_none(actor_id) if actor_type == "user" else None
    ws = await session.get(Workstream, tag.workstream_id)
    stages = workstream_stages(ws)
    made: list[dict[str, Any]] = []

    if patch.get("checklist"):
        if not isinstance(patch["checklist"], dict):
            raise AppError("checklist maps item keys to 'done' or 'open'", code="app_error", status_code=400)
        work.apply_checklist(
            session,
            signal,
            stages,
            patch["checklist"],
            actor_type=actor_type,
            actor_id=actor_id,
            message_id=str(patch.get("message_id") or "") or None,
        )

    if "due_at" in patch:
        due = work.parse_due_input(patch["due_at"])
        source = str(patch.get("due_source") or "")
        basis = str(patch.get("due_basis") or "")
        if agent:
            if due is not None and due != signal.due_at:
                made.append(
                    await work.propose_due(session, signal, tag, due, source=source, basis=basis, agent_id=agent_id)
                )
        elif await work.set_due(
            session, signal, due, source=source or "manual", basis=basis, actor_type=actor_type, actor_id=actor_id
        ):
            await work.settle_after_person_due(session, signal, user_id=user_id)
    elif not agent and signal.due_at and ("due_source" in patch or "due_basis" in patch):
        await work.set_due(
            session,
            signal,
            signal.due_at,
            source=str(patch.get("due_source") or signal.due_source),
            basis=str(patch["due_basis"] if "due_basis" in patch else signal.due_basis),
            actor_type=actor_type,
            actor_id=actor_id,
        )

    if pending and status == "open":
        signal.ticket_status = "open"
        session.add(signal)
        await session.commit()
        await _enter_pipeline(session, signal, tag, actor_type=actor_type, actor_id=actor_id)
        await session.refresh(signal)
        return await ticket_payload(session, signal, tag=tag)

    stage_key = str(patch.get("stage_key") or "") or None
    if status and not stage_key and status not in TICKET_STAGE_KINDS:
        raise AppError("Invalid status", code="app_error", status_code=400)
    if stage_key or status:
        if pending:
            raise AppError("Accept the ticket before moving it", code="app_error", status_code=400)
        move_status = None if stage_key else status
        if agent:
            made.extend(
                await _agent_stage_request(
                    session,
                    signal,
                    tag,
                    ws,
                    stage_key=stage_key,
                    status=move_status,
                    certainty=patch.get("certainty"),
                    reason=str(patch.get("reason") or ""),
                    agent_id=agent_id,
                    actor_id=actor_id,
                )
            )
        else:
            moved = await move_ticket_stage(
                session, signal, stage_key=stage_key, status=move_status, actor_type=actor_type, actor_id=actor_id, ws=ws
            )
            if moved:
                await work.settle_after_person_move(session, signal, user_id=user_id)
    await session.commit()
    await session.refresh(signal)
    payload = await ticket_payload(session, signal, tag=tag)
    if payload is not None and made:
        payload["proposals_made"] = made
    return payload


def _uuid_or_none(raw: Any) -> UUID | None:
    try:
        return UUID(str(raw)) if raw else None
    except ValueError:
        return None


async def _agent_stage_request(
    session: AsyncSession,
    signal: Signal,
    tag: SignalTag,
    ws: Workstream | None,
    *,
    stage_key: str | None,
    status: str | None,
    certainty: Any,
    reason: str,
    agent_id: UUID | None,
    actor_id: str,
) -> list[dict[str, Any]]:
    """An agent asks to place the ticket: move, propose or refuse per the flow's policy."""
    from app.models.auth import Tenant
    from app.services import ticket_work as work

    stages = workstream_stages(ws)
    current = next((s for s in stages if s["key"] == signal.stage_key), None)
    target = work.resolve_target(stages, signal.stage_key, stage_key=stage_key, status=status)
    if target is None or (current is not None and current["key"] == target["key"]):
        return []
    try:
        score = max(0, min(10, int(certainty))) if certainty is not None else None
    except (TypeError, ValueError):
        score = None
    policy, threshold = work.entry_policy(ws, await session.get(Tenant, signal.tenant_id))
    if policy == "first_stage":
        raise status_error(
            status_code=409,
            detail={
                "code": "stage_moves_by_people",
                "message": "People move the stages of this flow. Say in the conversation which stage fits.",
            },
        )
    if work.agent_places_directly(policy, threshold, score):
        await move_ticket_stage(session, signal, stage_key=target["key"], actor_type="agent", actor_id=actor_id, ws=ws)
        return []
    return [
        await work.propose_stage(
            session, signal, tag, target, current=current, certainty=score, reason=reason, agent_id=agent_id
        )
    ]


async def set_ticket_status_for_run(
    session: AsyncSession,
    tenant_id: UUID,
    run: Any,
    *,
    status: str | None = None,
    stage_key: str | None = None,
) -> None:
    """Retired step-run hook — ticket stages are moved from the conversation."""
    del session, tenant_id, run, status, stage_key
    return

# ---------------------------------------------------------------------------
# Project board


async def project_board(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, *, tag_ids: list[UUID] | None = None
) -> list[dict[str, Any]]:
    """Flow boards of a folder: every flow that already has a ticket on a
    conversation in this folder's subtree. Boards roll up from children.
    Flows are not attached to folders — membership is the matching threads.

    ``tag_ids`` adds AND filters (virtual path segments under a group folder).
    """
    from app.services.communication_nav import list_predicates
    from app.services.folders import load_catalog
    from app.services.signal_tags import flow_label_color, flow_label_icon
    from app.services.trash import alive

    catalog = await load_catalog(session, tenant_id)

    filters: dict[str, Any] = {"project_id": project_id}
    if tag_ids:
        filters["path"] = tag_ids
    predicates = await list_predicates(session, tenant_id, filters, catalog)
    if predicates is None:
        return []

    ticket_scope = [
        Signal.tenant_id == tenant_id,
        Signal.ticket_tag_id.is_not(None),
        Signal.ticket_status != "proposed",
        Signal.deleted_at.is_(None),
        *predicates,
    ]
    signals = list(
        (await session.execute(select(Signal).where(*ticket_scope).order_by(Signal.last_message_at.desc()))).scalars()
    )
    ticket_tag_ids = [s.ticket_tag_id for s in signals if s.ticket_tag_id is not None]
    if not ticket_tag_ids:
        return []
    tag_rows = list(
        (
            await session.execute(
                select(SignalTag).where(
                    SignalTag.tenant_id == tenant_id,
                    SignalTag.workstream_id.is_not(None),
                    SignalTag.id.in_(ticket_tag_ids),
                )
            )
        ).scalars()
    )
    ws_ids = list(dict.fromkeys(t.workstream_id for t in tag_rows if t.workstream_id is not None))
    if not ws_ids:
        return []
    flows = list(
        (
            await session.execute(
                select(Workstream).where(Workstream.tenant_id == tenant_id, Workstream.id.in_(ws_ids), alive(Workstream))
            )
        ).scalars()
    )
    order = {wid: i for i, wid in enumerate(ws_ids)}
    flows.sort(key=lambda ws: (order.get(ws.id, 0), ws.name.lower()))
    tags = list(
        (
            await session.execute(
                select(SignalTag).where(SignalTag.tenant_id == tenant_id, SignalTag.workstream_id.in_([f.id for f in flows]))
            )
        ).scalars()
    )
    tag_by_id = {t.id: t for t in tags}
    signals = [s for s in signals if s.ticket_tag_id in tag_by_id]
    by_ws: dict[UUID, list[Signal]] = {}
    for signal in signals:
        tag = tag_by_id[signal.ticket_tag_id]
        by_ws.setdefault(tag.workstream_id, []).append(signal)
    checkups = await _checkups_by_signal(session, signals)
    from app.services.ticket_work import soon_days_for

    soon_days = await soon_days_for(session, tenant_id)
    out: list[dict[str, Any]] = []
    for ws in flows:
        stages = workstream_stages(ws)
        if is_direct(stages):
            continue
        out.append(
            {
                "workstream_id": str(ws.id),
                "name": ws.name,
                "stages": stages,
                "tags": [
                    {
                        "id": str(t.id),
                        "name": t.name,
                        "color": flow_label_color(t.color),
                        "icon": flow_label_icon(getattr(t, "icon", None)),
                    }
                    for t in tags
                    if t.workstream_id == ws.id
                ],
                "tickets": _board_cards(stages, by_ws.get(ws.id, []), tag_by_id, checkups, soon_days=soon_days),
            }
        )
    return out


async def _checkups_by_signal(session: AsyncSession, signals: list[Signal]) -> dict[UUID, datetime]:
    from app.models.trigger import Trigger
    from app.services.stage_checkups import CHECKUP

    ids = [s.id for s in signals]
    if not ids:
        return {}
    rows = await session.execute(
        select(Trigger.signal_id, Trigger.next_run_at).where(
            Trigger.signal_id.in_(ids),
            Trigger.purpose == CHECKUP,
            Trigger.enabled.is_(True),
            Trigger.deleted_at.is_(None),
        )
    )
    return {sid: at for sid, at in rows.all() if sid and at}


def _board_cards(
    stages: list[dict[str, Any]],
    signals: list[Signal],
    tag_by_id: dict[UUID, SignalTag],
    checkups: dict[UUID, datetime] | None = None,
    *,
    soon_days: int,
) -> list[dict[str, Any]]:
    """Board cards; a ticket on an unknown stage lands on the first stage of its kind."""
    from app.services.ticket_work import next_step

    now = utcnow()
    keys = {s["key"] for s in stages}
    first_by_kind: dict[str, str] = {}
    for s in stages:
        first_by_kind.setdefault(s["kind"], s["key"])
    cards = []
    for signal in signals:
        key = signal.stage_key if signal.stage_key in keys else first_by_kind.get(
            signal.ticket_status or "open", stages[0]["key"]
        )
        tag = tag_by_id[signal.ticket_tag_id]
        cards.append(
            {
                "signal_id": str(signal.id),
                "subject": signal.subject,
                "contact_name": signal.contact_name or signal.contact_email,
                "contact_id": str(signal.contact_id) if signal.contact_id else None,
                "channel": signal.channel,
                "tag_id": str(tag.id),
                "tag": tag.name,
                "stage_key": key,
                "status": signal.ticket_status or "open",
                "project_id": str(signal.project_id) if signal.project_id else None,
                "last_message_at": signal.last_message_at.isoformat() if signal.last_message_at else None,
                "assigned_user_id": str(signal.assigned_user_id) if signal.assigned_user_id else None,
                "assignee_kind": signal.assignee_kind or None,
                "agent_id": str(signal.agent_id) if signal.agent_id else None,
                "fields": parse_ticket_fields(signal.ticket_fields_json),
                "checkup_at": (
                    checkups[signal.id].replace(microsecond=0).isoformat()
                    if checkups and signal.id in checkups
                    else None
                ),
                "due_at": signal.due_at.isoformat() if signal.due_at else None,
                "next_step": next_step(signal, stages, now=now, soon_days=soon_days),
            }
        )
    return cards


async def workstream_board(
    session: AsyncSession, tenant_id: UUID, workstream_id: UUID
) -> dict[str, Any]:
    """One flow's tickets across every project, grouped into lanes.

    Candidate lanes are folders whose filterset includes the flow's action tag
    (``project_tag_links``). Tickets on other folders still get their own lane.
    ``none`` appears only when at least one ticket has no project. The client
    hides empty candidate lanes by default.
    """
    from app.models.project import ProjectTagLink
    from app.services.trash import alive

    ws = (
        await session.execute(
            select(Workstream).where(
                Workstream.id == workstream_id, Workstream.tenant_id == tenant_id, alive(Workstream)
            )
        )
    ).scalar_one_or_none()
    if ws is None:
        raise NotFoundError("Flow not found")
    stages = workstream_stages(ws)
    tags = list(
        (
            await session.execute(
                select(SignalTag).where(
                    SignalTag.tenant_id == tenant_id, SignalTag.workstream_id == ws.id
                )
            )
        ).scalars()
    )
    tag_by_id = {t.id: t for t in tags}
    signals = (
        list(
            (
                await session.execute(
                    select(Signal)
                    .where(
                        Signal.tenant_id == tenant_id,
                        Signal.ticket_tag_id.in_(list(tag_by_id)),
                        Signal.ticket_status != "proposed",
                        Signal.deleted_at.is_(None),
                    )
                    .order_by(Signal.last_message_at.desc())
                )
            ).scalars()
        )
        if tag_by_id
        else []
    )
    projects = (
        list(
            (
                await session.execute(
                    select(Project)
                    .join(ProjectTagLink, ProjectTagLink.project_id == Project.id)
                    .where(
                        ProjectTagLink.tenant_id == tenant_id,
                        ProjectTagLink.tag_id.in_(list(tag_by_id)),
                        Project.tenant_id == tenant_id,
                        Project.deleted_at.is_(None),
                    )
                    .order_by(Project.name)
                    .distinct()
                )
            ).scalars()
        )
        if tag_by_id
        else []
    )
    lane_ids = {p.id for p in projects}
    from app.services.ticket_work import soon_days_for

    cards = _board_cards(
        stages,
        signals,
        tag_by_id,
        await _checkups_by_signal(session, signals),
        soon_days=await soon_days_for(session, tenant_id),
    )
    lanes: list[dict[str, Any]] = [{"id": str(p.id), "name": p.name} for p in projects]
    # A ticket filed on a folder that does not share the flow label still shows.
    extra_ids = {s.project_id for s in signals if s.project_id and s.project_id not in lane_ids}
    if extra_ids:
        extra = (
            await session.execute(
                select(Project).where(Project.tenant_id == tenant_id, Project.id.in_(list(extra_ids)))
            )
        ).scalars().all()
        lanes.extend({"id": str(p.id), "name": p.name} for p in sorted(extra, key=lambda p: p.name))
    if any(c["project_id"] is None for c in cards):
        lanes.append({"id": None, "name": ""})
    return {
        "workstream_id": str(ws.id),
        "name": ws.name,
        "stages": stages,
        "tags": [{"id": str(t.id), "name": t.name} for t in tags],
        "lanes": lanes,
        "tickets": cards,
    }
