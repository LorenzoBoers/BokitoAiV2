"""Flow (workstream) CRUD and stages-only helpers.

Playbooks are stage pipelines on conversations. The old step-run ledger is
retired; attribution for agent work uses ``AgentRun.workstream_id``.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.exceptions import AppError, NotFoundError, status_error
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
    from app.services.flow_schema import display_nodes, graph_for
    from app.services.tickets import workstream_stages

    stages = workstream_stages(ws)
    schema = graph_for(getattr(ws, "flow_source", "") or "", stages)
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
        "autonomy": ws.autonomy or "",
        "department_id": str(ws.department_id) if ws.department_id else None,
        # Own setting only; "" / null follow the workspace ticket policy.
        "stage_entry_policy": ws.stage_entry_policy or "",
        "stage_entry_threshold": ws.stage_entry_threshold,
        **recipe_of(ws),
        "stages": stages,
        "flow_source": schema["source"],
        "flow_graph": {
            "nodes": display_nodes(schema),
            "edges": schema["edges"],
            "errors": schema["errors"],
        },
        "stages_count": stages_count if stages_count is not None else len(stages),
        "tags": tag_rows,
        "created_at": _iso(ws.created_at),
        "updated_at": _iso(ws.updated_at),
    }
    return out


RECIPE_FIELDS = ("instructions", "capabilities", "expected_outcome")
CONNECTION_CAPABILITY = "connection:"
MAX_INSTRUCTIONS = 4000
MAX_CAPABILITIES = 40
MAX_EXPECTED_OUTCOME = 500


def recipe_of(ws: Workstream) -> dict[str, Any]:
    """How the flow handles the work its label names: method, capabilities, outcome.

    The flow label is the work kind; there is no separate list. ``direct`` is
    derived from the stages: without a waiting stage the work is finished in
    the conversation and the flow has no board.
    """
    from app.services.tickets import is_direct, workstream_stages

    return {
        "instructions": ws.instructions or "",
        "capabilities": _parse_ids(ws.capabilities_json),
        "expected_outcome": ws.expected_outcome or "",
        "direct": is_direct(workstream_stages(ws)),
    }


async def apply_recipe(session: AsyncSession, ws: Workstream, patch: dict[str, Any]) -> bool:
    """Set the recipe fields present in ``patch``. Returns whether anything changed.

    ``capabilities`` are tool names or ``connection:{id}`` of this workspace;
    unknown ones are rejected (422) so the agent never gets a dead reference.
    """
    from app.models.integration import IntegrationConnection
    from app.tools.registry import get_tool_spec

    before = recipe_of(ws)
    if patch.get("instructions") is not None:
        ws.instructions = str(patch["instructions"]).strip()[:MAX_INSTRUCTIONS]
    if patch.get("expected_outcome") is not None:
        ws.expected_outcome = str(patch["expected_outcome"]).strip()[:MAX_EXPECTED_OUTCOME]
    if patch.get("capabilities") is not None:
        raw = patch["capabilities"]
        if not isinstance(raw, list):
            raise status_error(status_code=422, detail="capabilities must be a list")
        caps: list[str] = []
        for item in raw[:MAX_CAPABILITIES]:
            cap = str(item or "").strip()
            if not cap or cap in caps:
                continue
            if cap.startswith(CONNECTION_CAPABILITY):
                try:
                    conn_id = UUID(cap[len(CONNECTION_CAPABILITY):])
                except ValueError:
                    raise status_error(status_code=422, detail=f"Unknown connection {cap}") from None
                conn = await session.get(IntegrationConnection, conn_id)
                if conn is None or conn.tenant_id != ws.tenant_id:
                    raise status_error(status_code=422, detail=f"Unknown connection {cap}")
            elif get_tool_spec(cap) is None:
                raise status_error(status_code=422, detail=f"Unknown tool {cap}")
            caps.append(cap)
        ws.capabilities_json = json.dumps(caps)
    return recipe_of(ws) != before


FLOW_AUTONOMY = ("", "manual", "assisted", "autonomous")


async def set_flow_autonomy(
    session: AsyncSession, tenant: Any, ws: Workstream, value: str, *, user_id: UUID | None = None
) -> str | None:
    """Set the flow's dial. Returns the pending Govern change id when it must wait.

    Equal to or stricter than the workspace mode applies now. Looser (or clearing
    a dial back to a looser default) becomes a Govern change with a decision.
    """
    from app.services.ai_handling import mode_rank, workspace_mode
    from app.services.audit import record_audit

    value = (value or "").strip().lower()
    if value not in FLOW_AUTONOMY:
        raise status_error(status_code=422, detail="autonomy must be manual, assisted, autonomous or empty")
    before = ws.autonomy or ""
    base = workspace_mode(tenant)
    target = value or base
    current = before or base
    if mode_rank(target) > mode_rank(current) and mode_rank(target) > mode_rank(base):
        from app.services.platform_changes import propose_platform_change

        change, _ = await propose_platform_change(
            session,
            tenant,
            resource_type="workstream",
            change_kind="update",
            resource_id=str(ws.id),
            before={"workstream_id": str(ws.id), "autonomy": before},
            after={"workstream_id": str(ws.id), "autonomy": value},
            summary=f"Autonomy of flow {ws.name}: {value or 'workspace default'}",
            user_id=user_id,
            mode="ask",
        )
        return str(change.id)
    ws.autonomy = value
    session.add(ws)
    await record_audit(
        session,
        tenant.id,
        action="govern:flow_autonomy",
        actor_type="user" if user_id else "system",
        actor_id=str(user_id or ""),
        resource_type="workstream",
        resource_id=str(ws.id),
        outcome="applied",
        summary=f"Autonomy of {ws.name}: {value or 'workspace default'}",
        before={"autonomy": before},
        after={"autonomy": value},
        commit=False,
    )
    return None


async def recipe_block(session: AsyncSession, signal: Any) -> str:
    """The approach for this conversation's flow, for the agent's system prompt."""
    from app.models.integration import IntegrationConnection
    from app.models.signal import SignalTag

    if signal is None or not getattr(signal, "ticket_tag_id", None):
        return ""
    tag = await session.get(SignalTag, signal.ticket_tag_id)
    if tag is None or tag.workstream_id is None:
        return ""
    ws = await session.get(Workstream, tag.workstream_id)
    if ws is None or ws.deleted_at is not None:
        return ""
    recipe = recipe_of(ws)
    if not (recipe["instructions"] or recipe["capabilities"] or recipe["expected_outcome"] or recipe["direct"]):
        return ""
    lines = [f"## Approach: flow {ws.name or tag.name} ({tag.name})"]
    if tag.description:
        lines.append(f"Handles: {tag.description}")
    if recipe["direct"]:
        lines.append("Handled directly: finish the work in this conversation and close it; there is no waiting stage.")
    if recipe["instructions"]:
        lines.append(recipe["instructions"])
    if recipe["capabilities"]:
        names: list[str] = []
        for cap in recipe["capabilities"]:
            if cap.startswith(CONNECTION_CAPABILITY):
                try:
                    conn = await session.get(IntegrationConnection, UUID(cap[len(CONNECTION_CAPABILITY):]))
                except ValueError:
                    conn = None
                if conn is not None:
                    names.append(f"connection {conn.display_name or conn.provider} ({conn.id})")
            else:
                names.append(cap)
        if names:
            lines.append(f"Use: {', '.join(names)}.")
    if recipe["expected_outcome"]:
        lines.append(f"Done means: {recipe['expected_outcome'].rstrip('.')}.")
    return "\n".join(lines)


async def apply_stage_entry(
    session: AsyncSession,
    ws: Workstream,
    *,
    policy: str | None,
    threshold: int | None,
    actor_id: str,
) -> None:
    """Set the flow's stage-entry dial and record it in the audit log."""
    from app.services.audit import record_audit
    from app.services.ticket_work import ENTRY_POLICIES

    before = {"stage_entry_policy": ws.stage_entry_policy or "", "stage_entry_threshold": ws.stage_entry_threshold}
    if policy is not None:
        if policy and policy not in ENTRY_POLICIES:
            raise status_error(status_code=400, detail=f"stage_entry_policy must be one of {', '.join(ENTRY_POLICIES)}")
        ws.stage_entry_policy = policy
    if threshold is not None:
        if threshold != -1 and not 0 <= threshold <= 10:
            raise AppError("stage_entry_threshold must be 0-10, or -1 to follow the workspace", code="app_error", status_code=400)
        ws.stage_entry_threshold = None if threshold == -1 else threshold
    after = {"stage_entry_policy": ws.stage_entry_policy or "", "stage_entry_threshold": ws.stage_entry_threshold}
    if before == after:
        return
    await record_audit(
        session,
        ws.tenant_id,
        action="govern:flow_stage_entry",
        actor_type="user",
        actor_id=actor_id,
        resource_type="workstream",
        resource_id=str(ws.id),
        outcome="applied",
        summary=f"Stage entry on {ws.name}: {after['stage_entry_policy'] or 'workspace default'}",
        before=before,
        after=after,
        commit=False,
    )


async def playbook_tags_map(
    session: AsyncSession, tenant_id: UUID, workstream_ids: list[UUID]
) -> dict[UUID, list[dict[str, str]]]:
    if not workstream_ids:
        return {}
    from app.models.signal import SignalTag

    rows = await session.execute(
        select(
            SignalTag.workstream_id,
            SignalTag.id,
            SignalTag.name,
            SignalTag.color,
            SignalTag.icon,
            SignalTag.department_id,
        )
        .where(
            SignalTag.tenant_id == tenant_id,
            SignalTag.workstream_id.in_(workstream_ids),
        )
        .order_by(SignalTag.name)
    )
    out: dict[UUID, list[dict[str, str]]] = {}
    from app.services.signal_tags import flow_label_color, flow_label_icon

    for ws_id, tag_id, name, color, icon, department_id in rows.all():
        if ws_id is None:
            continue
        out.setdefault(ws_id, []).append(
            {
                "id": str(tag_id),
                "name": name,
                "color": flow_label_color(color),
                "icon": flow_label_icon(icon),
                "department_id": str(department_id) if department_id else "",
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
        raise NotFoundError("Workstream not found")
    return ws


def operator_flows_query(tenant_id: UUID):
    """Operator Flows: living workstreams with an action tag. The flows list and the Grid share it."""
    from app.models.signal import SignalTag
    from app.services.trash import alive

    tagged = select(SignalTag.workstream_id).where(
        SignalTag.tenant_id == tenant_id,
        SignalTag.workstream_id.isnot(None),
    )
    return select(Workstream).where(
        Workstream.tenant_id == tenant_id,
        alive(Workstream),
        Workstream.id.in_(tagged),
    )


async def operator_flows(session: AsyncSession, tenant_id: UUID) -> list[Workstream]:
    return list((await session.execute(operator_flows_query(tenant_id).order_by(Workstream.name))).scalars().all())


async def list_workstreams(
    session: AsyncSession, tenant_id: UUID, *, project_id: UUID | None = None
) -> list[dict[str, Any]]:
    """List operator Flows — workstreams that have an action tag."""
    from app.models.signal import SignalTag

    query = operator_flows_query(tenant_id)
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
    raise status_error(status_code=410, detail="Workstream steps are retired; use stages.")


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
        raise NotFoundError("Workstream not found")
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
        raise NotFoundError("Unknown workstream template")
    problems = await check_template_requirements(session, tenant_id, template)
    if problems:
        raise status_error(
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


_RETIRED_RUN = status_error(
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
        raise status_error(status_code=400, detail=f"Invalid input kind: {input_kind}")
    ws = await get_workstream(session, tenant_id, workstream_id)
    now = utcnow()
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
