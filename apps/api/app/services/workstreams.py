"""Flow (workstream) CRUD and stages-only helpers.

Playbooks are stage pipelines on conversations. The old step-run ledger is
retired; attribution for agent work uses ``AgentRun.workstream_id``.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import AgentRun
from app.models.orchestra import (
    WORKSTREAM_INPUT_KINDS,
    Workstream,
    WorkstreamRun,
    WorkstreamStep,
)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _parse_ids(raw: str | None) -> list[str]:
    try:
        data = json.loads(raw or "[]")
        return [str(v) for v in data] if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


# ---------------------------------------------------------------------------
# Serialization


def serialize_workstream(
    ws: Workstream,
    *,
    stages_count: int | None = None,
    project_ids: list[str] | None = None,
    tags: list[dict[str, str]] | None = None,
    steps_count: int | None = None,  # deprecated alias ignored
) -> dict[str, Any]:
    from app.services.tickets import workstream_stages

    stages = workstream_stages(ws)
    tag_rows = tags or []
    # ``name`` is the operator title; ``tags[0]`` is the action-tag label beside it.
    # Fall back to the tag only when the stored title is empty (legacy rows).
    title = (ws.name or "").strip() or (tag_rows[0]["name"] if tag_rows else "")
    out = {
        "id": str(ws.id),
        "project_ids": project_ids or [],
        "name": title,
        "description": ws.description,
        "module_slug": ws.module_slug,
        "template_slug": ws.template_slug,
        "stages": stages,
        "stages_count": stages_count if stages_count is not None else len(stages),
        "tags": tag_rows,
        "created_at": _iso(ws.created_at),
        "updated_at": _iso(ws.updated_at),
    }
    return out


async def playbook_tags_map(
    session: AsyncSession, tenant_id: UUID, workstream_ids: list[UUID]
) -> dict[UUID, list[dict[str, str]]]:
    if not workstream_ids:
        return {}
    from app.models.signal import SignalTag

    rows = await session.execute(
        select(SignalTag.workstream_id, SignalTag.id, SignalTag.name, SignalTag.color, SignalTag.icon)
        .where(
            SignalTag.tenant_id == tenant_id,
            SignalTag.workstream_id.in_(workstream_ids),
        )
        .order_by(SignalTag.name)
    )
    out: dict[UUID, list[dict[str, str]]] = {}
    from app.services.signal_tags import flow_label_color, flow_label_icon

    for ws_id, tag_id, name, color, icon in rows.all():
        if ws_id is None:
            continue
        out.setdefault(ws_id, []).append(
            {
                "id": str(tag_id),
                "name": name,
                "color": flow_label_color(color),
                "icon": flow_label_icon(icon),
            }
        )
    return out


def serialize_step(step: WorkstreamStep) -> dict[str, Any]:
    return {
        "id": str(step.id),
        "workstream_id": str(step.workstream_id),
        "position": step.position,
        "name": step.name,
        "kind": step.kind,
        "goal": step.goal,
        "agent_id": str(step.agent_id) if step.agent_id else None,
        "agent_role": step.agent_role,
        "wait_kind": step.wait_kind,
        "deadline_hours": step.deadline_hours,
        "on_deadline": step.on_deadline,
        "knowledge_section_ids": _parse_ids(step.knowledge_section_ids_json),
        "config": _parse_json(step.config_json),
        "stage_key": step.stage_key or None,
    }


def serialize_run(run: WorkstreamRun, *, workstream_name: str | None = None) -> dict[str, Any]:
    out = {
        "id": str(run.id),
        "workstream_id": str(run.workstream_id),
        "project_id": str(run.project_id) if run.project_id else None,
        "signal_id": str(run.signal_id) if run.signal_id else None,
        "status": run.status,
        "input_kind": run.input_kind,
        "input_ref": run.input_ref,
        "input_text": run.input_text,
        "current_step_id": None,
        "wait_until": _iso(run.wait_until),
        "summary": run.summary,
        "error": run.error,
        "triggered_by_type": run.triggered_by_type,
        "triggered_by_id": run.triggered_by_id,
        "started_at": _iso(run.started_at),
        "completed_at": _iso(run.completed_at),
        "updated_at": _iso(run.updated_at),
    }
    if workstream_name is not None:
        out["workstream_name"] = workstream_name
    return out


# ---------------------------------------------------------------------------
# Definition CRUD


async def flow_folder_map(
    session: AsyncSession, tenant_id: UUID, workstream_ids: list[UUID]
) -> dict[UUID, list[str]]:
    """Folders whose filterset includes an action tag of each flow.

    ``project_ids`` on the API is derived this way — there is no direct
    flow↔folder attachment table.
    """
    if not workstream_ids:
        return {}
    from app.models.project import Project, ProjectTagLink
    from app.models.signal import SignalTag

    rows = await session.execute(
        select(SignalTag.workstream_id, Project.id)
        .join(ProjectTagLink, ProjectTagLink.tag_id == SignalTag.id)
        .join(Project, Project.id == ProjectTagLink.project_id)
        .where(
            SignalTag.tenant_id == tenant_id,
            SignalTag.workstream_id.in_(workstream_ids),
            Project.tenant_id == tenant_id,
            Project.deleted_at.is_(None),
        )
        .order_by(Project.name)
    )
    out: dict[UUID, list[str]] = {}
    for ws_id, project_id in rows.all():
        if ws_id is None:
            continue
        pid = str(project_id)
        bucket = out.setdefault(ws_id, [])
        if pid not in bucket:
            bucket.append(pid)
    return out


async def serialize_workstream_full(
    session: AsyncSession, ws: Workstream, *, stages_count: int | None = None
) -> dict[str, Any]:
    projects = await flow_folder_map(session, ws.tenant_id, [ws.id])
    tags = await playbook_tags_map(session, ws.tenant_id, [ws.id])
    return serialize_workstream(
        ws,
        stages_count=stages_count,
        project_ids=projects.get(ws.id, []),
        tags=tags.get(ws.id, []),
    )


async def get_workstream(
    session: AsyncSession, tenant_id: UUID, workstream_id: UUID
) -> Workstream:
    from app.services.trash import alive

    ws = (
        await session.execute(
            select(Workstream).where(
                Workstream.id == workstream_id,
                Workstream.tenant_id == tenant_id,
                alive(Workstream),
            )
        )
    ).scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Workstream not found")
    return ws


async def list_workstreams(
    session: AsyncSession, tenant_id: UUID, *, project_id: UUID | None = None
) -> list[dict[str, Any]]:
    """List operator Flows — workstreams that have an action tag."""
    from app.models.signal import SignalTag
    from app.services.trash import alive

    tagged = select(SignalTag.workstream_id).where(
        SignalTag.tenant_id == tenant_id,
        SignalTag.workstream_id.isnot(None),
    )
    query = select(Workstream).where(
        Workstream.tenant_id == tenant_id,
        alive(Workstream),
        Workstream.id.in_(tagged),
    )
    if project_id is not None:
        from app.models.project import ProjectTagLink

        query = query.where(
            Workstream.id.in_(
                select(SignalTag.workstream_id)
                .join(ProjectTagLink, ProjectTagLink.tag_id == SignalTag.id)
                .where(
                    ProjectTagLink.project_id == project_id,
                    SignalTag.workstream_id.is_not(None),
                )
            )
        )
    rows = list((await session.execute(query.order_by(Workstream.name))).scalars().all())
    ids = [w.id for w in rows]
    projects = await flow_folder_map(session, tenant_id, ids)
    tags = await playbook_tags_map(session, tenant_id, ids)
    activity = await playbook_ticket_activity(session, tenant_id, rows)
    out = []
    for w in rows:
        row = serialize_workstream(w, project_ids=projects.get(w.id, []), tags=tags.get(w.id, []))
        counts, last_at = activity.get(w.id, ({}, None))
        row["ticket_counts"] = counts
        row["last_activity_at"] = _iso(last_at)
        out.append(row)
    return out


async def playbook_ticket_activity(
    session: AsyncSession, tenant_id: UUID, flows: list[Workstream]
) -> dict[UUID, tuple[dict[str, int], datetime | None]]:
    """Live tickets per stage key and the latest ticket message, per flow.

    A ticket on a stage the flow no longer has counts on its first stage, the
    same place the board shows it.
    """
    if not flows:
        return {}
    from sqlalchemy import func

    from app.models.signal import Signal, SignalTag
    from app.services.tickets import workstream_stages

    rows = await session.execute(
        select(
            SignalTag.workstream_id,
            Signal.stage_key,
            func.count(Signal.id),
            func.max(Signal.last_message_at),
        )
        .join(SignalTag, SignalTag.id == Signal.ticket_tag_id)
        .where(
            Signal.tenant_id == tenant_id,
            SignalTag.workstream_id.in_([w.id for w in flows]),
            Signal.ticket_status != "proposed",
            Signal.deleted_at.is_(None),
        )
        .group_by(SignalTag.workstream_id, Signal.stage_key)
    )
    stages_by_ws = {w.id: [s["key"] for s in workstream_stages(w)] for w in flows}
    out: dict[UUID, tuple[dict[str, int], datetime | None]] = {}
    for ws_id, stage_key, count, last_at in rows.all():
        keys = stages_by_ws.get(ws_id) or []
        if not keys:
            continue
        key = stage_key if stage_key in keys else keys[0]
        counts, latest = out.get(ws_id, ({}, None))
        counts[key] = counts.get(key, 0) + int(count)
        if last_at is not None and (latest is None or last_at > latest):
            latest = last_at
        out[ws_id] = (counts, latest)
    return out


async def list_steps(
    session: AsyncSession, tenant_id: UUID, workstream_id: UUID
) -> list[WorkstreamStep]:
    """Step engine retired — playbooks are stages-only."""
    return []


async def replace_steps(
    session: AsyncSession,
    tenant_id: UUID,
    workstream_id: UUID,
    steps: list[dict[str, Any]],
) -> list[WorkstreamStep]:
    raise HTTPException(status_code=410, detail="Workstream steps are retired; use stages.")


async def delete_workstream(
    session: AsyncSession,
    tenant_id: UUID,
    workstream_id: UUID,
    *,
    permanent: bool = False,
) -> None:
    if not permanent:
        from app.services.trash import load_tenant, move_to_bin

        ws = await get_workstream(session, tenant_id, workstream_id)
        tenant = await load_tenant(session, tenant_id)
        await move_to_bin(
            session,
            tenant,
            resource_type="playbook",
            row=ws,
            user_id=None,
            commit=True,
        )
        return
    ws = (
        await session.execute(
            select(Workstream).where(
                Workstream.id == workstream_id, Workstream.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Workstream not found")
    from app.models.signal import SignalTag
    from app.services.signal_tags import set_tag_playbook

    linked = (
        await session.execute(
            select(SignalTag.id).where(
                SignalTag.tenant_id == tenant_id,
                SignalTag.workstream_id == ws.id,
            )
        )
    ).scalars()
    for tag_id in list(linked):
        await set_tag_playbook(session, tenant_id, tag_id, workstream_id=None, commit=False)
    await session.delete(ws)
    await session.flush()


async def install_template(
    session: AsyncSession, tenant_id: UUID, module_slug: str, template_slug: str
) -> Workstream:
    """Copy a module workstream template to the tenant.

    Only possible while the module is installed and the requirements manifest
    holds; the tenant owns (and may edit) the copy.
    """
    from app.modules.catalog import get_workstream_template
    from app.services.workstream_integrity import check_template_requirements

    template = get_workstream_template(module_slug, template_slug)
    if template is None:
        raise HTTPException(status_code=404, detail="Unknown workstream template")
    problems = await check_template_requirements(session, tenant_id, template)
    if problems:
        raise HTTPException(
            status_code=400,
            detail="Template requirements not met: " + " ".join(problems),
        )
    ws = Workstream(
        tenant_id=tenant_id,
        name=template.name,
        description=template.description,
        module_slug=template.module_slug,
        template_slug=template.slug,
    )
    session.add(ws)
    await session.flush()
    await session.commit()
    await session.refresh(ws)
    return ws


# ---------------------------------------------------------------------------
# Run engine (retired — stages live on Signal; attribution on AgentRun)


_RETIRED_RUN = HTTPException(
    status_code=410,
    detail="Workstream runs are retired; ticket stages live on the conversation.",
)


async def get_run(session: AsyncSession, tenant_id: UUID, run_id: UUID) -> WorkstreamRun:
    del session, tenant_id, run_id
    raise _RETIRED_RUN


async def start_run(
    session: AsyncSession,
    tenant_id: UUID,
    workstream_id: UUID,
    *,
    input_kind: str = "manual",
    input_text: str = "",
    input_ref: str = "",
    signal_id: UUID | None = None,
    project_id: UUID | None = None,
    triggered_by_type: str = "user",
    triggered_by_id: str = "",
    advance: bool = True,
) -> WorkstreamRun:
    """Stages-only: validate the playbook and return an in-memory receipt."""
    del advance
    if input_kind not in WORKSTREAM_INPUT_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid input kind: {input_kind}")
    ws = await get_workstream(session, tenant_id, workstream_id)
    now = datetime.utcnow()
    return WorkstreamRun(
        tenant_id=tenant_id,
        workstream_id=ws.id,
        project_id=project_id,
        signal_id=signal_id,
        status="completed",
        input_kind=input_kind,
        input_ref=input_ref,
        input_text=input_text,
        summary="Stages-only playbook (no run ledger).",
        triggered_by_type=triggered_by_type,
        triggered_by_id=triggered_by_id,
        completed_at=now,
        updated_at=now,
        started_at=now,
    )


async def advance_run(
    session: AsyncSession, tenant_id: UUID, run_id: UUID
) -> dict[str, Any]:
    del session, tenant_id, run_id
    return {"skipped": True, "retired": True}


async def resume_run(
    session: AsyncSession,
    tenant_id: UUID,
    run_id: UUID,
    **_: Any,
) -> WorkstreamRun:
    del session, tenant_id, run_id
    raise _RETIRED_RUN


async def skip_step_run(session: AsyncSession, tenant_id: UUID, run_id: UUID) -> WorkstreamRun:
    del session, tenant_id, run_id
    raise _RETIRED_RUN


async def cancel_run(session: AsyncSession, tenant_id: UUID, run_id: UUID) -> WorkstreamRun:
    del session, tenant_id, run_id
    raise _RETIRED_RUN


async def process_due_run_deadlines(session: AsyncSession) -> int:
    del session
    return 0


async def run_detail(session: AsyncSession, tenant_id: UUID, run_id: UUID) -> dict[str, Any]:
    del session, tenant_id, run_id
    raise _RETIRED_RUN


async def list_runs(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    workstream_id: UUID | None = None,
    project_id: UUID | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """List AgentRuns attributed to a playbook (replaces workstream_runs ledger)."""
    query = (
        select(AgentRun, Workstream.name)
        .outerjoin(Workstream, Workstream.id == AgentRun.workstream_id)
        .where(AgentRun.tenant_id == tenant_id)
    )
    if workstream_id is not None:
        query = query.where(AgentRun.workstream_id == workstream_id)
    if project_id is not None:
        query = query.where(AgentRun.project_id == project_id)
    rows = (
        await session.execute(
            query.order_by(AgentRun.started_at.desc()).limit(max(1, min(limit, 200)))
        )
    ).all()
    items: list[dict[str, Any]] = []
    for run, name in rows:
        items.append(
            {
                "id": str(run.id),
                "workstream_id": str(run.workstream_id) if run.workstream_id else None,
                "workstream_name": name,
                "project_id": str(run.project_id) if run.project_id else None,
                "signal_id": str(run.signal_id) if run.signal_id else None,
                "status": run.status,
                "subject": run.subject,
                "started_at": _iso(run.started_at),
                "completed_at": _iso(run.completed_at),
            }
        )
    return items


async def promote_run_to_knowledge(
    session: AsyncSession, tenant_id: UUID, run_id: UUID
) -> dict[str, Any]:
    del session, tenant_id, run_id
    raise _RETIRED_RUN
