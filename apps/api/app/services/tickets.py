"""Tickets: a conversation filed under a category moves through a playbook.

A *category* is a hashtag with a playbook (`SignalTag.workstream_id`). Filing
it on a conversation makes that conversation the ticket: `Signal.ticket_tag_id`
plus `stage_key` in the playbook's stage pipeline. A conversation has at most
one ticket; a second request is a split. Filing always settles a project: one
of the playbook's projects, or none. A ticket shows on a project board only
when its playbook is attached to that project and the conversation's
`project_id` is that project.

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

from app.models.orchestra import Workstream, WorkstreamProject, WorkstreamRun
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

DEFAULT_TICKET_STAGES: list[dict[str, Any]] = [
    {
        "key": "open",
        "name": "Open",
        "kind": "open",
        "auto_close_conversation": False,
        "fields": [],
        "owner": None,
        "checkup_minutes": 0,
    },
    {
        "key": "waiting",
        "name": "Waiting",
        "kind": "waiting",
        "auto_close_conversation": False,
        "fields": [],
        "owner": None,
        "checkup_minutes": 0,
    },
    {
        "key": "done",
        "name": "Done",
        "kind": "done",
        "auto_close_conversation": False,
        "fields": [],
        "owner": None,
        "checkup_minutes": 0,
    },
]
SEND_MODES = ("draft", "ask", "send")
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


STAGE_OWNER_KINDS = ("user", "agent", "team")
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
                    }
                )
    return stages or [dict(s) for s in DEFAULT_TICKET_STAGES]


def workstream_stages(ws: Workstream | None) -> list[dict[str, Any]]:
    return parse_stages(ws.stages_json if ws else None)


def default_stages_json() -> str:
    """The default pipeline, stored explicitly so a flow never has empty stages."""
    return json.dumps([dict(s) for s in DEFAULT_TICKET_STAGES])


async def ensure_flow_stages(session: AsyncSession) -> int:
    """Startup backfill: write the default pipeline into flows that have none.

    Older flows were saved without stages and rendered as empty boards; the
    implicit fallback in ``parse_stages`` hid that from the API but not from
    the operator.
    """
    rows = (
        await session.execute(select(Workstream).where(Workstream.deleted_at.is_(None)))
    ).scalars().all()
    fixed = 0
    for ws in rows:
        if has_explicit_stages(ws):
            continue
        ws.stages_json = default_stages_json()
        session.add(ws)
        fixed += 1
    if fixed:
        await session.commit()
    return fixed


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
    raise HTTPException(
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
                raise HTTPException(
                    status_code=400, detail=f"Field '{field['name']}' must be a number"
                ) from exc
        if field.get("type") == "enum" and value:
            options = {str(opt) for opt in (field.get("options") or [])}
            if value not in options:
                raise HTTPException(
                    status_code=400,
                    detail=f"Field '{field['name']}' must be one of the allowed options",
                )
        if require and field.get("required") and not value:
            raise HTTPException(
                status_code=400, detail=f"Field '{field['name']}' is required"
            )
        if value:
            out[key] = value[:500]
    return out


def validate_stages(raw: Any) -> str:
    """Normalize an operator-edited stage list to ``stages_json``."""
    if not isinstance(raw, list) or not raw:
        raise HTTPException(status_code=400, detail="A pipeline needs at least one stage")
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Invalid stage")
        name = str(item.get("name") or "").strip()
        kind = str(item.get("kind") or "")
        if not name or kind not in TICKET_STAGE_KINDS:
            raise HTTPException(status_code=400, detail="Each stage needs a name and a kind")
        key = slugify(str(item.get("key") or name))
        if key in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate stage '{name}'")
        seen.add(key)
        fields = parse_stage_fields(item.get("fields"))
        if len(item.get("fields") or []) > MAX_FIELDS_PER_STAGE:
            raise HTTPException(
                status_code=400,
                detail=f"At most {MAX_FIELDS_PER_STAGE} fields per stage",
            )
        for field in fields:
            if field["type"] == "enum" and len(field.get("options") or []) < 2:
                raise HTTPException(
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
            }
        )
    if not any(s["kind"] == "done" for s in out):
        raise HTTPException(status_code=400, detail="A pipeline needs at least one done stage")
    return json.dumps(out)


def stage_payload(signal: Signal, stages: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    if not stages or not signal.stage_key:
        return None
    return next((dict(s) for s in stages if s["key"] == signal.stage_key), None)


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
            "send_mode": row.send_mode or "send",
            "autonomy_level": row.autonomy_level or "",
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

    now = datetime.utcnow()
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
        .where(SignalTag.tenant_id == tenant_id, SignalTag.workstream_id.is_not(None))
        .order_by(SignalTag.sort_order, SignalTag.name)
    )
    return list(rows.scalars().all())


async def get_category(session: AsyncSession, tenant_id: UUID, tag_id: UUID) -> SignalTag:
    row = await session.get(SignalTag, tag_id)
    if row is None or row.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Category not found")
    if row.workstream_id is None:
        raise HTTPException(
            status_code=400,
            detail="This tag has no playbook. Promote it to a category first.",
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
            raise HTTPException(status_code=400, detail="Invalid create_mode")
        row.create_mode = mode
    for key in ("ask_threshold", "auto_threshold"):
        if key in patch and patch[key] is not None:
            setattr(row, key, max(0, min(11, int(patch[key]))))
    if "send_mode" in patch and patch["send_mode"] is not None:
        mode = str(patch["send_mode"])
        if mode not in SEND_MODES:
            raise HTTPException(status_code=400, detail="Invalid send_mode")
        row.send_mode = mode
    if "autonomy_level" in patch and patch["autonomy_level"] is not None:
        from app.services.agent_rules import parse_scope_autonomy

        row.autonomy_level = parse_scope_autonomy(patch["autonomy_level"])
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
    now = datetime.utcnow()
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
        raise HTTPException(status_code=404, detail="Tag template not found")
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
    """`#name - when to use it` lines from already-loaded category rows."""
    lines: list[str] = []
    for row in rows:
        if not bool(row.ai_auto_tag):
            continue
        description = (row.description or "").strip()
        lines.append(f"#{row.name} - {description}" if description else f"#{row.name}")
    return lines


async def category_catalog_lines(session: AsyncSession, tenant_id: UUID) -> list[str]:
    """`#name - when to use it` lines for the triage prompt."""
    return category_catalog_lines_from_rows(await list_categories(session, tenant_id))


# ---------------------------------------------------------------------------
# Playbook projects


async def playbook_project_ids(
    session: AsyncSession, tenant_id: UUID, workstream_id: UUID
) -> list[UUID]:
    rows = await session.execute(
        select(WorkstreamProject.project_id)
        .join(Project, Project.id == WorkstreamProject.project_id)
        .where(
            WorkstreamProject.tenant_id == tenant_id,
            WorkstreamProject.workstream_id == workstream_id,
        )
        .order_by(Project.name)
    )
    return list(rows.scalars().all())


async def project_choices_by_workstream(
    session: AsyncSession, tenant_id: UUID, workstream_ids: list[UUID]
) -> dict[UUID, list[dict[str, Any]]]:
    """Projects per playbook in one query (names ordered)."""
    unique = list(dict.fromkeys(wid for wid in workstream_ids if wid is not None))
    if not unique:
        return {}
    rows = await session.execute(
        select(WorkstreamProject.workstream_id, Project.id, Project.name)
        .join(Project, Project.id == WorkstreamProject.project_id)
        .where(
            WorkstreamProject.tenant_id == tenant_id,
            WorkstreamProject.workstream_id.in_(unique),
        )
        .order_by(Project.name)
    )
    out: dict[UUID, list[dict[str, Any]]] = {wid: [] for wid in unique}
    for ws_id, pid, name in rows.all():
        out.setdefault(ws_id, []).append({"id": str(pid), "name": name})
    return out


async def project_choices(
    session: AsyncSession, tenant_id: UUID, tag: SignalTag
) -> list[dict[str, Any]]:
    """The projects a ticket of this category may be filed on (plus No project)."""
    if tag.workstream_id is None:
        return []
    by_ws = await project_choices_by_workstream(
        session, tenant_id, [tag.workstream_id]
    )
    return by_ws.get(tag.workstream_id, [])


async def _validate_project(
    session: AsyncSession, tenant_id: UUID, tag: SignalTag, project_id: UUID | None
) -> UUID | None:
    if project_id is None:
        return None
    allowed = await playbook_project_ids(session, tenant_id, tag.workstream_id)
    if project_id not in allowed:
        raise HTTPException(
            status_code=400,
            detail="This project does not use the category's playbook. Pick one of its projects or No project.",
        )
    return project_id


# ---------------------------------------------------------------------------
# Ticket state on a conversation


async def _signal(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> Signal:
    row = (
        await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    return row


async def ticket_run(session: AsyncSession, signal: Signal, workstream_id: UUID | None) -> WorkstreamRun | None:
    if workstream_id is None:
        return None
    return (
        await session.execute(
            select(WorkstreamRun)
            .where(
                WorkstreamRun.tenant_id == signal.tenant_id,
                WorkstreamRun.signal_id == signal.id,
                WorkstreamRun.workstream_id == workstream_id,
            )
            .order_by(WorkstreamRun.started_at.desc())
        )
    ).scalars().first()


async def ticket_payload(
    session: AsyncSession, signal: Signal, *, tag: SignalTag | None = None
) -> dict[str, Any] | None:
    """The conversation's ticket with its pipeline, project choices and current step."""
    if signal.ticket_tag_id is None:
        return None
    tag = tag or await session.get(SignalTag, signal.ticket_tag_id)
    if tag is None:
        return None
    ws = await session.get(Workstream, tag.workstream_id) if tag.workstream_id else None
    stages = workstream_stages(ws)
    run = await ticket_run(session, signal, tag.workstream_id)
    field_defs = all_stage_fields(stages)
    return {
        "signal_id": str(signal.id),
        "tag_id": str(tag.id),
        "name": tag.name,
        "status": signal.ticket_status or "open",
        "stage_key": signal.stage_key or None,
        "stage": stage_payload(signal, stages),
        "stages": stages,
        "certainty": signal.ticket_certainty,
        "project_id": str(signal.project_id) if signal.project_id else None,
        "project_choices": await project_choices(session, signal.tenant_id, tag),
        "workstream_id": str(ws.id) if ws else None,
        "workstream_name": ws.name if ws else None,
        "workstream_run_id": str(run.id) if run else None,
        "current_step_name": None,
        "filed_at": signal.ticket_filed_at.isoformat() if signal.ticket_filed_at else None,
        "field_defs": field_defs,
        "fields": parse_ticket_fields(signal.ticket_fields_json),
        "checkup": checkup_payload(await checkup_trigger(session, signal)),
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
    out: dict[UUID, dict[str, Any]] = {}
    for signal in signals:
        tag = tags.get(signal.ticket_tag_id) if signal.ticket_tag_id else None
        if tag is None:
            continue
        ws = streams.get(tag.workstream_id) if tag.workstream_id else None
        out[signal.id] = {
            "tag_id": str(tag.id),
            "name": tag.name,
            "status": signal.ticket_status or "open",
            "stage": stage_payload(signal, workstream_stages(ws)),
            "project_id": str(signal.project_id) if signal.project_id else None,
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
            raise HTTPException(status_code=400, detail="Unknown stage for this ticket")
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
    signal.stage_key = target["key"]
    signal.ticket_status = target["kind"]
    signal.updated_at = datetime.utcnow()
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
    from app.services.stage_checkups import on_stage_entered

    await on_stage_entered(session, signal, target, actor_type=actor_type, actor_id=actor_id)
    return True


async def settle_ticket_on_close(
    session: AsyncSession,
    signal: Signal,
    *,
    actor_type: str = "system",
    actor_id: str = "",
) -> bool:
    """Move an open ticket to its done stage when the conversation closes.

    A flow without a done stage, or a done stage that still needs fields, leaves
    the ticket where it is. Closing the conversation still succeeds.
    """
    if signal.status != "closed" or signal.ticket_tag_id is None:
        return False
    if (signal.ticket_status or "") == "done":
        return False
    try:
        return await move_ticket_stage(
            session,
            signal,
            status="done",
            actor_type=actor_type,
            actor_id=actor_id,
        )
    except HTTPException:
        return False


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
    signal.updated_at = datetime.utcnow()
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
    """Take the category off a conversation and cancel its playbook run. Flushes."""
    if signal.ticket_tag_id is None:
        return None
    tag = await session.get(SignalTag, signal.ticket_tag_id)
    run = await ticket_run(session, signal, tag.workstream_id if tag else None)
    if run is not None and run.status not in ("completed", "cancelled", "failed"):
        now = datetime.utcnow()
        run.status = "cancelled"
        run.wait_until = None
        run.completed_at = now
        run.updated_at = now
        session.add(run)
    from app.services.stage_checkups import remove_checkup

    await remove_checkup(session, signal)
    signal.ticket_tag_id = None
    signal.ticket_status = ""
    signal.stage_key = ""
    signal.ticket_certainty = None
    signal.ticket_filed_at = None
    signal.ticket_fields_json = "{}"
    signal.updated_at = datetime.utcnow()
    session.add(signal)
    await session.flush()
    return tag.name if tag else None


async def _status_update(session: AsyncSession, signal: Signal, text: str) -> None:
    from app.gateway.publish import publish_signal_message
    from app.models.signal import SignalMessage

    now = datetime.utcnow()
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
    """A Decision in the thread: file on one of the playbook's projects, no project, or dismiss."""
    from app.services.signal_decisions import create_decision

    options: list[dict[str, Any]] = []
    for choice in await project_choices(session, signal.tenant_id, tag):
        options.append(
            {
                "id": f"project:{choice['id']}",
                "label": f"File on {choice['name']}",
                "action_type": "update_ticket",
                "payload": {"signal_id": str(signal.id), "status": "open", "project_id": choice["id"]},
            }
        )
    options.append(
        {
            "id": "approve",
            "label": "File without project" if options else "File this ticket",
            "action_type": "update_ticket",
            "payload": {"signal_id": str(signal.id), "status": "open", "project_id": None},
        }
    )
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
        title=f"#{tag.name}: {signal.subject or tag.name}",
        summary=summary or f"Review this #{tag.name} ticket from the conversation.",
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
    project_chosen: bool = False,
    fields: dict[str, Any] | None = None,
    summary: str = "",
    certainty: int | None = None,
    actor: str = "operator",
    created_by_type: str = "user",
    created_by_id: str = "",
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
) -> dict[str, Any]:
    """File an action tag on a conversation.

    Filing settles the project: ``project_chosen`` with ``project_id`` (one of
    the flow's projects) or ``None`` (No project). A person must choose when
    the flow has projects; an agent that does not choose leaves the ticket
    proposed so the operator picks on the confirm chip. Optional intake
    ``fields`` come from the first open stage.
    """
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
        if signal.ticket_tag_id == tag.id and not refresh and not (actor == "operator" and project_chosen):
            return {"ticket": await ticket_payload(session, signal, tag=tag), "existing": True}
        if signal.ticket_tag_id != tag.id and actor != "operator":
            raise HTTPException(
                status_code=409,
                detail=(
                    "This conversation already has an action tag. Split the conversation "
                    "to give the new request its own action tag."
                ),
            )
        cleared = await clear_ticket(session, signal)
        if cleared != tag.name:
            previous = cleared

    choices = await playbook_project_ids(session, tenant_id, tag.workstream_id)
    if project_chosen:
        chosen_project = await _validate_project(session, tenant_id, tag, project_id)
    elif not choices:
        project_chosen, chosen_project = True, None
    elif actor == "operator":
        raise HTTPException(status_code=400, detail="Choose a project or No project for this ticket.")
    else:
        chosen_project = None

    field_values = normalize_ticket_fields(
        intake, fields or {}, require=actor == "operator"
    )

    score = 10 if certainty is None and actor == "operator" else int(certainty or 0)
    score = max(0, min(10, score))
    now = datetime.utcnow()
    signal.ticket_tag_id = tag.id
    signal.ticket_certainty = score
    signal.ticket_filed_at = now
    signal.stage_key = ""
    signal.ticket_fields_json = json.dumps(field_values)
    if project_chosen:
        signal.project_id = chosen_project

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
    if status == "open" and not project_chosen:
        # Autonomy never skips the project choice: the operator picks it on the chip.
        status = "proposed"

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
        if not project_chosen:
            extra["needs_project"] = True
    else:
        await _enter_pipeline(
            session, signal, tag, summary=summary, actor_type=created_by_type, actor_id=created_by_id
        )
        await session.refresh(signal)
    return {"ticket": await ticket_payload(session, signal, tag=tag), **extra}


async def update_ticket(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    patch: dict[str, Any],
    *,
    actor_type: str = "user",
    actor_id: str = "",
) -> dict[str, Any] | None:
    """Accept, dismiss, move or re-project a ticket. Returns None when it was removed.

    ``status``: ``open`` accepts a proposal (``project_id`` required when the
    playbook has projects), ``dismissed`` drops a proposal or removes the
    category, any other stage kind moves to the first stage of that kind.
    """
    signal = await _signal(session, tenant_id, signal_id)
    if signal.ticket_tag_id is None:
        raise HTTPException(status_code=404, detail="This conversation has no ticket")
    tag = await session.get(SignalTag, signal.ticket_tag_id)
    if tag is None or tag.workstream_id is None:
        raise HTTPException(status_code=400, detail="This category no longer has a playbook")
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
        signal.updated_at = datetime.utcnow()
        session.add(signal)

    if "project_id" in patch:
        raw = patch["project_id"]
        signal.project_id = await _validate_project(
            session, tenant_id, tag, UUID(str(raw)) if raw else None
        )
        session.add(signal)
    elif pending and status == "open":
        if await playbook_project_ids(session, tenant_id, tag.workstream_id):
            raise HTTPException(status_code=400, detail="Choose a project or No project for this ticket.")
        signal.project_id = None

    if pending and status == "open":
        signal.ticket_status = "open"
        session.add(signal)
        await session.commit()
        await _enter_pipeline(session, signal, tag, actor_type=actor_type, actor_id=actor_id)
        await session.refresh(signal)
        return await ticket_payload(session, signal, tag=tag)

    if patch.get("stage_key"):
        if pending:
            raise HTTPException(status_code=400, detail="Accept the ticket before moving it")
        await move_ticket_stage(
            session, signal, stage_key=str(patch["stage_key"]), actor_type=actor_type, actor_id=actor_id
        )
    elif status:
        if status not in TICKET_STAGE_KINDS:
            raise HTTPException(status_code=400, detail="Invalid status")
        if pending:
            raise HTTPException(status_code=400, detail="Accept the ticket before moving it")
        await move_ticket_stage(session, signal, status=status, actor_type=actor_type, actor_id=actor_id)
    await session.commit()
    await session.refresh(signal)
    return await ticket_payload(session, signal, tag=tag)


async def set_ticket_status_for_run(
    session: AsyncSession,
    tenant_id: UUID,
    run: WorkstreamRun,
    *,
    status: str | None = None,
    stage_key: str | None = None,
) -> None:
    """Move the run's ticket when the run enters a staged step or changes state."""
    if run.input_kind != "ticket" or run.signal_id is None:
        return
    signal = await session.get(Signal, run.signal_id)
    if signal is None or signal.tenant_id != tenant_id or signal.ticket_tag_id is None:
        return
    tag = await session.get(SignalTag, signal.ticket_tag_id)
    if tag is None or tag.workstream_id != run.workstream_id:
        return
    if signal.ticket_status == "proposed":
        return
    await move_ticket_stage(
        session,
        signal,
        stage_key=stage_key,
        status=status,
        actor_type="workstream_run",
        actor_id=str(run.id),
    )


# ---------------------------------------------------------------------------
# Project board


async def project_board(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> list[dict[str, Any]]:
    """Every playbook attached to the project, each with its stages and tickets."""
    from app.services.trash import alive

    links = (
        await session.execute(
            select(WorkstreamProject, Workstream)
            .join(Workstream, Workstream.id == WorkstreamProject.workstream_id)
            .where(
                WorkstreamProject.tenant_id == tenant_id,
                WorkstreamProject.project_id == project_id,
                alive(Workstream),
            )
            .order_by(WorkstreamProject.position, Workstream.name)
        )
    ).all()
    if not links:
        return []
    ws_ids = [ws.id for _, ws in links]
    tags = list(
        (
            await session.execute(
                select(SignalTag).where(
                    SignalTag.tenant_id == tenant_id, SignalTag.workstream_id.in_(ws_ids)
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
                        Signal.project_id == project_id,
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
    by_ws: dict[UUID, list[Signal]] = {}
    for signal in signals:
        tag = tag_by_id[signal.ticket_tag_id]
        by_ws.setdefault(tag.workstream_id, []).append(signal)
    checkups = await _checkups_by_signal(session, signals)
    out: list[dict[str, Any]] = []
    for _, ws in links:
        stages = workstream_stages(ws)
        out.append(
            {
                "workstream_id": str(ws.id),
                "name": ws.name,
                "enabled": ws.enabled,
                "stages": stages,
                "tags": [
                    {"id": str(t.id), "name": t.name} for t in tags if t.workstream_id == ws.id
                ],
                "tickets": _board_cards(stages, by_ws.get(ws.id, []), tag_by_id, checkups),
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
) -> list[dict[str, Any]]:
    """Board cards; a ticket on an unknown stage lands on the first stage of its kind."""
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
            }
        )
    return cards


async def workstream_board(
    session: AsyncSession, tenant_id: UUID, workstream_id: UUID
) -> dict[str, Any]:
    """One flow's tickets across every project, grouped into lanes.

    Lanes are the projects the flow is on, in board order, plus ``none`` for
    tickets filed without a project. ``none`` is listed only when it holds
    tickets or when the flow is on no project at all.
    """
    from app.services.trash import alive

    ws = (
        await session.execute(
            select(Workstream).where(
                Workstream.id == workstream_id, Workstream.tenant_id == tenant_id, alive(Workstream)
            )
        )
    ).scalar_one_or_none()
    if ws is None:
        raise HTTPException(status_code=404, detail="Flow not found")
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
        await session.execute(
            select(Project)
            .join(WorkstreamProject, WorkstreamProject.project_id == Project.id)
            .where(
                WorkstreamProject.tenant_id == tenant_id,
                WorkstreamProject.workstream_id == ws.id,
            )
            .order_by(WorkstreamProject.position, Project.name)
        )
    ).scalars().all()
    lane_ids = {p.id for p in projects}
    cards = _board_cards(stages, signals, tag_by_id, await _checkups_by_signal(session, signals))
    lanes: list[dict[str, Any]] = [{"id": str(p.id), "name": p.name} for p in projects]
    # A ticket on a project the flow has since left still shows, in its own lane.
    extra_ids = {s.project_id for s in signals if s.project_id and s.project_id not in lane_ids}
    if extra_ids:
        extra = (
            await session.execute(
                select(Project).where(Project.tenant_id == tenant_id, Project.id.in_(list(extra_ids)))
            )
        ).scalars().all()
        lanes.extend({"id": str(p.id), "name": p.name} for p in sorted(extra, key=lambda p: p.name))
    if not projects or any(c["project_id"] is None for c in cards):
        lanes.append({"id": None, "name": ""})
    return {
        "workstream_id": str(ws.id),
        "name": ws.name,
        "enabled": ws.enabled,
        "stages": stages,
        "tags": [{"id": str(t.id), "name": t.name} for t in tags],
        "lanes": lanes,
        "tickets": cards,
    }
