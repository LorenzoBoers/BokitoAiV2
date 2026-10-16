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
    WorkstreamProject,
    WorkstreamRun,
    WorkstreamStep,
)

# Every project gets this workstream so queue items always have a route.
DEFAULT_WORKSTREAM_NAME = "Review and execute"
DEFAULT_WORKSTREAM_DESCRIPTION = (
    "Default project workstream: assess the input, update the project "
    "documentation, and execute what is needed."
)
DEFAULT_STEP_GOAL = (
    "Assess the run input against the project documentation. Link the queue "
    "item to the documents it touches (link_queue_item_to_doc), update the "
    "affected sections with write_doc (pass `section` to edit one `##` "
    "section; keep sections at one topic, roughly 150-400 words), and execute "
    "what the input asks for. Finish with a concise report of what changed "
    "and why."
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
        "enabled": ws.enabled,
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
        select(SignalTag.workstream_id, SignalTag.id, SignalTag.name)
        .where(
            SignalTag.tenant_id == tenant_id,
            SignalTag.workstream_id.in_(workstream_ids),
        )
        .order_by(SignalTag.name)
    )
    out: dict[UUID, list[dict[str, str]]] = {}
    for ws_id, tag_id, name in rows.all():
        if ws_id is None:
            continue
        out.setdefault(ws_id, []).append({"id": str(tag_id), "name": name})
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


async def playbook_project_map(
    session: AsyncSession, tenant_id: UUID, workstream_ids: list[UUID]
) -> dict[UUID, list[str]]:
    if not workstream_ids:
        return {}
    from app.models.project import Project

    rows = await session.execute(
        select(WorkstreamProject.workstream_id, WorkstreamProject.project_id)
        .join(Project, Project.id == WorkstreamProject.project_id)
        .where(
            WorkstreamProject.tenant_id == tenant_id,
            WorkstreamProject.workstream_id.in_(workstream_ids),
            Project.deleted_at.is_(None),
        )
        .order_by(WorkstreamProject.created_at)
    )
    out: dict[UUID, list[str]] = {}
    for ws_id, project_id in rows.all():
        out.setdefault(ws_id, []).append(str(project_id))
    return out


async def serialize_workstream_full(
    session: AsyncSession, ws: Workstream, *, stages_count: int | None = None
) -> dict[str, Any]:
    projects = await playbook_project_map(session, ws.tenant_id, [ws.id])
    tags = await playbook_tags_map(session, ws.tenant_id, [ws.id])
    return serialize_workstream(
        ws,
        stages_count=stages_count,
        project_ids=projects.get(ws.id, []),
        tags=tags.get(ws.id, []),
    )


async def set_playbook_projects(
    session: AsyncSession, tenant_id: UUID, ws: Workstream, project_ids: list[UUID]
) -> None:
    """Replace the projects a playbook is attached to.

    Tickets filed on a detached project keep their project_id but leave that
    project's board, because the board only shows attached playbooks.
    """
    from app.models.project import Project

    wanted = list(dict.fromkeys(project_ids))
    if wanted:
        found = set(
            (
                await session.execute(
                    select(Project.id).where(
                        Project.tenant_id == tenant_id,
                        Project.id.in_(wanted),
                        Project.deleted_at.is_(None),
                    )
                )
            ).scalars()
        )
        missing = [str(pid) for pid in wanted if pid not in found]
        if missing:
            raise HTTPException(status_code=400, detail=f"Unknown project: {missing[0]}")
    existing = {
        row.project_id: row
        for row in (
            await session.execute(
                select(WorkstreamProject).where(
                    WorkstreamProject.tenant_id == tenant_id,
                    WorkstreamProject.workstream_id == ws.id,
                )
            )
        ).scalars()
    }
    for pid, row in existing.items():
        if pid not in wanted:
            await session.delete(row)
    for pid in wanted:
        if pid not in existing:
            session.add(WorkstreamProject(tenant_id=tenant_id, workstream_id=ws.id, project_id=pid))
    await session.flush()


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
    """List operator Flows — workstreams that have an action tag.

    Internal project defaults ("Review and execute") have no action tag and
    must not appear on `/workstreams` or in agent ``list_playbooks``.
    """
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
        query = query.where(
            Workstream.id.in_(
                select(WorkstreamProject.workstream_id).where(
                    WorkstreamProject.project_id == project_id
                )
            )
        )
    rows = list((await session.execute(query.order_by(Workstream.name))).scalars().all())
    ids = [w.id for w in rows]
    projects = await playbook_project_map(session, tenant_id, ids)
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
    await session.delete(ws)
    await session.flush()


async def _untagged_default_ids(session: AsyncSession, tenant_id: UUID) -> list[UUID]:
    """Alive Review-and-execute workstreams that are not operator Flows."""
    from app.models.signal import SignalTag

    tagged = select(SignalTag.workstream_id).where(
        SignalTag.tenant_id == tenant_id,
        SignalTag.workstream_id.isnot(None),
    )
    rows = (
        await session.execute(
            select(Workstream.id)
            .where(
                Workstream.tenant_id == tenant_id,
                Workstream.name == DEFAULT_WORKSTREAM_NAME,
                Workstream.deleted_at.is_(None),
                Workstream.id.notin_(tagged),
            )
            .order_by(Workstream.created_at)
        )
    ).scalars().all()
    return list(rows)


async def _find_or_create_shared_default(
    session: AsyncSession, tenant_id: UUID
) -> Workstream:
    """One shared untagged default per tenant — folders must not mint copies."""
    ids = await _untagged_default_ids(session, tenant_id)
    if ids:
        ws = await session.get(Workstream, ids[0])
        if ws is not None:
            return ws
    ws = Workstream(
        tenant_id=tenant_id,
        name=DEFAULT_WORKSTREAM_NAME,
        description=DEFAULT_WORKSTREAM_DESCRIPTION,
        enabled=True,
    )
    session.add(ws)
    await session.flush()
    return ws


async def prune_internal_default_workstreams(
    session: AsyncSession, tenant_id: UUID, *, commit: bool = True
) -> dict[str, int]:
    """Collapse duplicate Review-and-execute copies onto one shared default.

    Soft-deletes extras and re-points alive project links at the shared row.
    Operator Flows (with an action tag) are untouched.
    """
    from app.models.project import Project

    ids = await _untagged_default_ids(session, tenant_id)
    if not ids:
        return {"kept": 0, "pruned": 0, "relinked": 0}
    keep_id = ids[0]
    drop_ids = ids[1:]
    relinked = 0
    if drop_ids:
        links = (
            await session.execute(
                select(WorkstreamProject).where(
                    WorkstreamProject.tenant_id == tenant_id,
                    WorkstreamProject.workstream_id.in_(drop_ids),
                )
            )
        ).scalars().all()
        alive_project_ids = set(
            (
                await session.execute(
                    select(Project.id).where(
                        Project.tenant_id == tenant_id,
                        Project.deleted_at.is_(None),
                    )
                )
            ).scalars().all()
        )
        already = set(
            (
                await session.execute(
                    select(WorkstreamProject.project_id).where(
                        WorkstreamProject.tenant_id == tenant_id,
                        WorkstreamProject.workstream_id == keep_id,
                    )
                )
            ).scalars().all()
        )
        for link in links:
            if link.project_id in alive_project_ids and link.project_id not in already:
                session.add(
                    WorkstreamProject(
                        tenant_id=tenant_id,
                        workstream_id=keep_id,
                        project_id=link.project_id,
                        is_default=True,
                    )
                )
                already.add(link.project_id)
                relinked += 1
            await session.delete(link)
        now = datetime.utcnow()
        for ws_id in drop_ids:
            ws = await session.get(Workstream, ws_id)
            if ws is None or ws.deleted_at is not None:
                continue
            ws.deleted_at = now
            session.add(ws)
    if commit:
        await session.commit()
    else:
        await session.flush()
    return {"kept": 1, "pruned": len(drop_ids), "relinked": relinked}


async def ensure_default_workstream(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, *, commit: bool = True
) -> Workstream:
    """Return the project's default playbook, creating/linking it when missing.

    Every project must have at least one playbook: agent edits to project
    docs run exclusively through playbook runs. Defaults are shared per
    tenant (no action tag) so folders do not flood the Flows list.
    """
    links = (
        await session.execute(
            select(WorkstreamProject, Workstream)
            .join(Workstream, Workstream.id == WorkstreamProject.workstream_id)
            .where(
                WorkstreamProject.tenant_id == tenant_id,
                WorkstreamProject.project_id == project_id,
                Workstream.deleted_at.is_(None),
            )
            .order_by(WorkstreamProject.created_at)
        )
    ).all()
    default = next((ws for link, ws in links if link.is_default), None)
    if default:
        return default
    if links:
        link, ws = links[0]
        link.is_default = True
        session.add(link)
        if commit:
            await session.commit()
        else:
            await session.flush()
        return ws
    ws = await _find_or_create_shared_default(session, tenant_id)
    session.add(
        WorkstreamProject(
            tenant_id=tenant_id, workstream_id=ws.id, project_id=project_id, is_default=True
        )
    )
    if commit:
        await session.commit()
    else:
        await session.flush()
    return ws


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
        enabled=True,
        module_slug=template.module_slug,
        template_slug=template.slug,
    )
    session.add(ws)
    await session.flush()
    await session.commit()
    await session.refresh(ws)
    return ws


def _keyword_score(text: str, candidate: Workstream) -> int:
    """Overlap between meaningful workstream-name/description words and the
    input text. Deterministic and cheap; the default workstream breaks ties."""
    words = {
        w
        for w in f"{candidate.name} {candidate.description}".lower().split()
        if len(w) >= 4
    }
    haystack = text.lower()
    return sum(1 for w in words if w in haystack)


async def choose_workstream_for_input(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, text: str
) -> Workstream:
    """Pick the project workstream that best matches the input text.

    Keyword overlap against name + description; the default workstream wins
    ties and serves as fallback. Creates the default when the project has no
    workstreams at all.
    """
    rows = (
        await session.execute(
            select(WorkstreamProject.is_default, Workstream)
            .join(Workstream, Workstream.id == WorkstreamProject.workstream_id)
            .where(
                WorkstreamProject.tenant_id == tenant_id,
                WorkstreamProject.project_id == project_id,
                Workstream.enabled.is_(True),
                Workstream.deleted_at.is_(None),
            )
        )
    ).all()
    if not rows:
        return await ensure_default_workstream(session, tenant_id, project_id)
    best = max(rows, key=lambda r: (_keyword_score(text, r[1]), r[0]))
    return best[1]

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
    if not ws.enabled:
        raise HTTPException(status_code=400, detail="Workstream is disabled.")
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
