"""Workstream engine: CRUD and the ordered playbook run loop.

A run walks six canonical step kinds in order. Reply and decision steps may
branch to another step; all other steps continue linearly. Failures pause
with a decision instead of failing silently.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun, RunEvent
from app.models.auth import Tenant
from app.models.case import Case
from app.models.orchestra import (
    WORKSTREAM_INPUT_KINDS,
    WORKSTREAM_ON_DEADLINE,
    WORKSTREAM_STEP_KINDS,
    WORKSTREAM_WAIT_KINDS,
    Workstream,
    WorkstreamRun,
    WorkstreamStep,
)
from app.models.signal import Signal, SignalMessage

logger = logging.getLogger(__name__)

# Runs execute at most this many steps per advance call (safety valve).
MAX_STEPS_PER_ADVANCE = 30

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


def _mock_execution() -> bool:
    return os.environ.get("BOKITO_MOCK_EXECUTION", "").lower() in ("1", "true", "yes")


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def _step_retry_limit(session: AsyncSession, tenant_id: UUID) -> int:
    """Workspace retry limit; defaults to two automatic retries."""
    tenant = await session.get(Tenant, tenant_id)
    settings = _parse_json(tenant.settings_json if tenant else "{}")
    raw = settings.get("workstream_step_retry_limit", 2)
    try:
        return max(0, min(int(raw), 10))
    except (TypeError, ValueError):
        return 2


async def _source_signal(
    session: AsyncSession, tenant_id: UUID, run: WorkstreamRun
) -> Signal | None:
    if run.signal_id:
        return (
            await session.execute(
                select(Signal).where(
                    Signal.id == run.signal_id, Signal.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
    if not run.input_ref:
        return None
    try:
        ref_id = UUID(run.input_ref)
    except ValueError:
        return None
    if run.input_kind == "signal":
        return (
            await session.execute(
                select(Signal).where(Signal.id == ref_id, Signal.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
    if run.input_kind == "case":
        case = (
            await session.execute(
                select(Case).where(Case.id == ref_id, Case.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if case:
            return (
                await session.execute(
                    select(Signal).where(
                        Signal.id == case.signal_id, Signal.tenant_id == tenant_id
                    )
                )
            ).scalar_one_or_none()
    return None


async def _source_cases(session: AsyncSession, tenant_id: UUID, run: WorkstreamRun) -> list[Case]:
    if run.input_kind != "case":
        return []
    rows = list(
        (
            await session.execute(
                select(Case).where(
                    Case.tenant_id == tenant_id,
                    Case.workstream_run_id == run.id,
                )
            )
        ).scalars()
    )
    if rows or not run.input_ref:
        return rows
    try:
        case_id = UUID(run.input_ref)
    except ValueError:
        return []
    case = (
        await session.execute(
            select(Case).where(Case.id == case_id, Case.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    return [case] if case else []


async def _set_source_case_status(
    session: AsyncSession,
    tenant_id: UUID,
    run: WorkstreamRun,
    status: str | None = None,
    *,
    stage_key: str | None = None,
) -> None:
    """Move the run's tickets to a stage, or to the first stage of a status kind."""
    from app.services.ticket_stages import move_case_stage

    for case in await _source_cases(session, tenant_id, run):
        try:
            await move_case_stage(
                session,
                tenant_id,
                case,
                status=status,
                stage_key=stage_key,
                actor_type="workstream_run",
                actor_id=str(run.id),
            )
        except HTTPException:
            # A step names a stage the ticket's workstream no longer has.
            logger.warning("Unknown stage %s on run %s", stage_key, run.id)


def _parse_ids(raw: str | None) -> list[str]:
    try:
        data = json.loads(raw or "[]")
        return [str(v) for v in data] if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _render_template(value: Any, fields: dict[str, Any]) -> Any:
    """Recursively replace `{field}` tokens while preserving unknown tokens."""
    if isinstance(value, str):
        return re.sub(
            r"\{([A-Za-z_][A-Za-z0-9_.-]*)\}",
            lambda match: str(fields.get(match.group(1), match.group(0))),
            value,
        )
    if isinstance(value, list):
        return [_render_template(item, fields) for item in value]
    if isinstance(value, dict):
        return {key: _render_template(item, fields) for key, item in value.items()}
    return value


def _template_fields(run: WorkstreamRun) -> dict[str, Any]:
    fields = _parse_json(run.context_json)
    fields.update(_parse_json(run.input_text) if run.input_text.strip().startswith("{") else {})
    fields.setdefault("input", run.input_text)
    fields.setdefault("signal_id", str(run.signal_id) if run.signal_id else "")
    return fields


# ---------------------------------------------------------------------------
# Serialization


def serialize_workstream(ws: Workstream, *, steps_count: int | None = None) -> dict[str, Any]:
    from app.services.ticket_stages import workstream_stages

    out = {
        "id": str(ws.id),
        "project_id": str(ws.project_id) if ws.project_id else None,
        "name": ws.name,
        "description": ws.description,
        "enabled": ws.enabled,
        "is_default": ws.is_default,
        "module_slug": ws.module_slug,
        "template_slug": ws.template_slug,
        "stages": workstream_stages(ws),
        "created_at": _iso(ws.created_at),
        "updated_at": _iso(ws.updated_at),
    }
    if steps_count is not None:
        out["steps_count"] = steps_count
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
        "current_step_id": str(run.current_step_id) if run.current_step_id else None,
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
    from sqlalchemy import func

    from app.services.trash import alive

    query = select(Workstream).where(Workstream.tenant_id == tenant_id, alive(Workstream))
    if project_id is not None:
        query = query.where(Workstream.project_id == project_id)
    rows = list((await session.execute(query.order_by(Workstream.name))).scalars().all())
    counts: dict[UUID, int] = {}
    if rows:
        count_rows = await session.execute(
            select(WorkstreamStep.workstream_id, func.count())
            .where(WorkstreamStep.workstream_id.in_([w.id for w in rows]))
            .group_by(WorkstreamStep.workstream_id)
        )
        counts = {r[0]: int(r[1]) for r in count_rows.all()}
    return [serialize_workstream(w, steps_count=counts.get(w.id, 0)) for w in rows]


async def list_steps(
    session: AsyncSession, tenant_id: UUID, workstream_id: UUID
) -> list[WorkstreamStep]:
    result = await session.execute(
        select(WorkstreamStep)
        .where(
            WorkstreamStep.workstream_id == workstream_id,
            WorkstreamStep.tenant_id == tenant_id,
        )
        .order_by(WorkstreamStep.position)
    )
    return list(result.scalars().all())


def _validate_step_payload(payload: dict[str, Any]) -> None:
    kind = payload.get("kind", "agent_task")
    if kind not in WORKSTREAM_STEP_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid step kind: {kind}")
    wait_kind = payload.get("wait_kind", "input")
    if wait_kind not in WORKSTREAM_WAIT_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid wait kind: {wait_kind}")
    on_deadline = payload.get("on_deadline", "continue")
    if on_deadline not in WORKSTREAM_ON_DEADLINE:
        raise HTTPException(status_code=400, detail=f"Invalid on_deadline: {on_deadline}")
    if kind == "schedule" and int(payload.get("deadline_hours") or 0) < 1:
        raise HTTPException(
            status_code=400, detail="Schedule steps need deadline_hours of at least 1."
        )
    if not str(payload.get("name") or "").strip():
        raise HTTPException(status_code=400, detail="Step name is required.")


async def replace_steps(
    session: AsyncSession,
    tenant_id: UUID,
    workstream_id: UUID,
    steps: list[dict[str, Any]],
) -> list[WorkstreamStep]:
    """Replace the step list. Steps with a known id keep it (running runs
    reference steps by id), removed steps are deleted, positions follow the
    submitted order."""
    ws = await get_workstream(session, tenant_id, workstream_id)
    existing = {str(s.id): s for s in await list_steps(session, tenant_id, workstream_id)}
    for payload in steps:
        _validate_step_payload(payload)

    seen: set[str] = set()
    out: list[WorkstreamStep] = []
    for position, payload in enumerate(steps):
        sid = str(payload.get("id") or "")
        row = existing.get(sid)
        if row is None:
            row = WorkstreamStep(tenant_id=tenant_id, workstream_id=ws.id, name="")
        else:
            seen.add(sid)
        row.position = position
        row.name = str(payload.get("name") or "").strip()
        row.kind = payload.get("kind", "agent_task")
        row.goal = str(payload.get("goal") or "")
        agent_id = payload.get("agent_id")
        row.agent_id = UUID(str(agent_id)) if agent_id else None
        row.agent_role = str(payload.get("agent_role") or "")
        row.wait_kind = payload.get("wait_kind", "input")
        row.deadline_hours = int(payload.get("deadline_hours") or 0)
        row.on_deadline = payload.get("on_deadline", "continue")
        row.knowledge_section_ids_json = json.dumps(
            [str(v) for v in (payload.get("knowledge_section_ids") or [])]
        )
        row.config_json = json.dumps(payload.get("config") or {})
        row.stage_key = str(payload.get("stage_key") or "")
        session.add(row)
        out.append(row)

    removed_ids = [UUID(sid) for sid in existing if sid not in seen]
    if removed_ids:
        await session.execute(
            sa_delete(WorkstreamStep).where(WorkstreamStep.id.in_(removed_ids))
        )
    ws.updated_at = datetime.utcnow()
    session.add(ws)
    await session.flush()
    return out


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
    from sqlalchemy import update as sa_update

    await session.execute(
        sa_update(WorkstreamRun)
        .where(WorkstreamRun.workstream_id == ws.id)
        .values(workstream_id=None)
    )
    await session.execute(
        sa_delete(WorkstreamStep).where(WorkstreamStep.workstream_id == ws.id)
    )
    await session.delete(ws)
    await session.flush()


async def ensure_default_workstream(
    session: AsyncSession, tenant_id: UUID, project_id: UUID, *, commit: bool = True
) -> Workstream:
    """Return the project's default workstream, creating it when missing.

    Every project must have at least one workstream: agent edits to project
    docs run exclusively through workstream runs.
    """
    rows = list(
        (
            await session.execute(
                select(Workstream).where(
                    Workstream.tenant_id == tenant_id,
                    Workstream.project_id == project_id,
                    Workstream.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    default = next((w for w in rows if w.is_default), None)
    if default:
        return default
    if rows:
        rows[0].is_default = True
        session.add(rows[0])
        if commit:
            await session.commit()
        else:
            await session.flush()
        return rows[0]
    ws = Workstream(
        tenant_id=tenant_id,
        project_id=project_id,
        name=DEFAULT_WORKSTREAM_NAME,
        description=DEFAULT_WORKSTREAM_DESCRIPTION,
        enabled=True,
        is_default=True,
    )
    session.add(ws)
    await session.flush()
    session.add(
        WorkstreamStep(
            tenant_id=tenant_id,
            workstream_id=ws.id,
            position=0,
            name="Assess and execute",
            kind="agent_task",
            goal=DEFAULT_STEP_GOAL,
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
    await replace_steps(session, tenant_id, ws.id, [dict(s) for s in template.steps])
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
    rows = list(
        (
            await session.execute(
                select(Workstream).where(
                    Workstream.tenant_id == tenant_id,
                    Workstream.project_id == project_id,
                    Workstream.enabled.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return await ensure_default_workstream(session, tenant_id, project_id)
    best = max(rows, key=lambda w: (_keyword_score(text, w), w.is_default))
    return best


# ---------------------------------------------------------------------------
# Run engine


async def get_run(session: AsyncSession, tenant_id: UUID, run_id: UUID) -> WorkstreamRun:
    run = (
        await session.execute(
            select(WorkstreamRun).where(
                WorkstreamRun.id == run_id, WorkstreamRun.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


async def start_run(
    session: AsyncSession,
    tenant_id: UUID,
    workstream_id: UUID,
    *,
    input_kind: str = "manual",
    input_text: str = "",
    input_ref: str = "",
    signal_id: UUID | None = None,
    triggered_by_type: str = "user",
    triggered_by_id: str = "",
    advance: bool = True,
) -> WorkstreamRun:
    """Create a run on the first step and (by default) advance it inline.

    Production callers can pass `advance=False` and enqueue the advance on the
    worker instead.
    """
    if input_kind not in WORKSTREAM_INPUT_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid input kind: {input_kind}")
    ws = await get_workstream(session, tenant_id, workstream_id)
    if not ws.enabled:
        raise HTTPException(status_code=400, detail="Workstream is disabled.")
    steps = await list_steps(session, tenant_id, workstream_id)
    if not steps:
        raise HTTPException(
            status_code=400, detail="Add at least one step before running this workstream."
        )
    if signal_id is not None:
        existing = (
            await session.execute(
                select(WorkstreamRun)
                .where(
                    WorkstreamRun.tenant_id == tenant_id,
                    WorkstreamRun.workstream_id == ws.id,
                    WorkstreamRun.signal_id == signal_id,
                )
                .order_by(WorkstreamRun.started_at)
            )
        ).scalars().first()
        if existing is not None:
            return existing
    run = WorkstreamRun(
        tenant_id=tenant_id,
        workstream_id=ws.id,
        project_id=ws.project_id,
        signal_id=signal_id,
        status="running",
        input_kind=input_kind,
        input_ref=input_ref,
        input_text=input_text,
        current_step_id=steps[0].id,
        triggered_by_type=triggered_by_type,
        triggered_by_id=triggered_by_id,
    )
    session.add(run)
    await session.commit()
    if advance:
        from app.services.orchestration.queue import enqueue_workstream_run_advance

        if not await enqueue_workstream_run_advance(str(tenant_id), str(run.id)):
            await advance_run(session, tenant_id, run.id)
        await session.refresh(run)
    return run


async def _resolve_step_agent(
    session: AsyncSession, tenant_id: UUID, step: WorkstreamStep
) -> Agent | None:
    """Fixed agent when set and active, then role fallback, then lead agent."""
    if step.agent_id:
        agent = (
            await session.execute(
                select(Agent).where(
                    Agent.id == step.agent_id,
                    Agent.tenant_id == tenant_id,
                    Agent.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if agent:
            return agent
    if step.agent_role:
        agent = (
            await session.execute(
                select(Agent)
                .where(
                    Agent.tenant_id == tenant_id,
                    Agent.role == step.agent_role,
                    Agent.is_active.is_(True),
                )
                .order_by(Agent.created_at)
                .limit(1)
            )
        ).scalar_one_or_none()
        if agent:
            return agent
    from app.services.lead_agent import get_lead_agent

    return await get_lead_agent(session, tenant_id)


async def _knowledge_context(
    session: AsyncSession, tenant_id: UUID, step: WorkstreamStep
) -> str:
    """Linked handbook sections rendered as context for the step prompt."""
    from app.models.workspace import WorkspaceDoc
    from app.services.workspace import get_section

    parts: list[str] = []
    for sid in _parse_ids(step.knowledge_section_ids_json):
        try:
            section = await get_section(session, tenant_id, UUID(sid))
        except ValueError:
            continue
        if not section:
            continue
        doc = await session.get(WorkspaceDoc, section.doc_id)
        title = doc.title if doc else ""
        heading = section.heading or "Intro"
        parts.append(f"### {title} — {heading}\n{section.content}".strip())
    if not parts:
        return ""
    return "## Linked knowledge (SOPs / handbook)\n\n" + "\n\n".join(parts)


def _step_outputs(run: WorkstreamRun) -> list[dict[str, Any]]:
    ctx = _parse_json(run.context_json)
    outputs = ctx.get("step_outputs")
    return outputs if isinstance(outputs, list) else []


def _append_context(run: WorkstreamRun, key: str, value: Any) -> None:
    ctx = _parse_json(run.context_json)
    ctx[key] = value
    run.context_json = json.dumps(ctx)


def _build_step_prompt(
    ws: Workstream,
    run: WorkstreamRun,
    step: WorkstreamStep,
    knowledge: str,
) -> str:
    parts = [
        f"You are executing step {step.position + 1} ('{step.name}') of the "
        f"workstream '{ws.name}'.",
    ]
    if ws.description.strip():
        parts.append(f"Workstream purpose: {ws.description.strip()}")
    if run.input_text.strip():
        parts.append(f"## Run input ({run.input_kind})\n{run.input_text.strip()}")
    outputs = _step_outputs(run)
    if outputs:
        prior = "\n\n".join(
            f"### Step: {o.get('name')}\n{str(o.get('text') or '')[:4000]}" for o in outputs
        )
        parts.append(f"## Prior step results\n{prior}")
    if knowledge:
        parts.append(knowledge)
    goal = step.goal.strip() or f"Complete the step '{step.name}'."
    parts.append(f"## Your goal for this step\n{goal}")
    if run.input_kind == "queue_item" and run.input_ref:
        parts.append(
            "## Queue task handling\n"
            f"This run executes queue task {run.input_ref}. Link the docs it "
            "touches with link_queue_item_to_doc, keep its status current with "
            "update_queue_item_status (use a concise impact summary), and if it "
            "duplicates existing work, reject it and mention the original."
        )
    parts.append(
        "Work towards the goal using your tools where needed and finish with a "
        "concise report of what you did and the outcome."
    )
    return "\n\n".join(parts)


async def _log_event(
    session: AsyncSession, agent_run: AgentRun, event_type: str, message: str, payload: dict | None = None
) -> None:
    from app.services.orchestration.runner import log_run_event

    await log_run_event(session, agent_run, event_type, message, payload)


async def _execute_agent_step(
    session: AsyncSession,
    tenant_id: UUID,
    ws: Workstream,
    run: WorkstreamRun,
    step: WorkstreamStep,
) -> str:
    """Run one agent step as an AgentRun; returns the step output text."""
    from app.services.orchestration.profiles import (
        apply_snapshot_to_agent,
        resolve_runtime_snapshot,
    )

    agent = await _resolve_step_agent(session, tenant_id, step)
    if not agent:
        raise RuntimeError("No active agent available for this step")

    snapshot = resolve_runtime_snapshot(agent)
    runtime_agent = apply_snapshot_to_agent(agent, snapshot)
    signal_type_id = None
    if run.input_kind == "case" and run.input_ref:
        from app.models.case import Case

        try:
            case = await session.get(Case, UUID(run.input_ref))
        except ValueError:
            case = None
        if case and case.tenant_id == tenant_id:
            signal_type_id = case.case_type_id
    agent_run = AgentRun(
        tenant_id=tenant_id,
        agent_id=agent.id,
        project_id=run.project_id,
        workstream_run_id=run.id,
        signal_type_id=signal_type_id,
        step_id=step.id,
        status="running",
        trigger_type="workstream",
        trigger_id=str(run.id),
        subject=f"{ws.name}: {step.name}",
        runtime_snapshot_json=json.dumps(snapshot),
    )
    session.add(agent_run)
    from app.services.workforce_runtime import apply_agent_runtime, broadcast_agent_live

    apply_agent_runtime(
        agent,
        status="working",
        summary=f"{ws.name}: {step.name}"[:200],
        activity_id=agent_run.id,
    )
    session.add(agent)
    await session.flush()
    await broadcast_agent_live(agent, activity_id=str(agent_run.id))

    knowledge = await _knowledge_context(session, tenant_id, step)
    if run.project_id:
        from app.services.project_work import _project_work_context

        project_ctx = await _project_work_context(session, tenant_id, run.project_id)
        knowledge = f"{project_ctx}\n\n{knowledge}".strip()
    prompt = _build_step_prompt(ws, run, step, knowledge)
    await _log_event(
        session,
        agent_run,
        "step_started",
        f"Step {step.position + 1}: {step.name}",
        {"agent": agent.name, "step_id": str(step.id), "run_id": str(run.id)},
    )

    if _mock_execution():
        text = f"Mock output for step '{step.name}'"
        tokens_in, tokens_out = 100, 50
    else:
        from app.services.agent.loop import AgentLoop

        loop = AgentLoop(session, tenant_id, None, runtime_agent, agent_run)
        loop.usage_scope = "workstream"
        loop.usage_call_type = "workstream"
        text, tokens = await loop.run_chat([{"role": "user", "content": prompt}])
        tokens_in = tokens.get("input_tokens", 0)
        tokens_out = tokens.get("output_tokens", 0)

    agent_run.tokens_input = tokens_in
    agent_run.tokens_output = tokens_out
    agent_run.result_json = json.dumps({"text": text[:8000]})
    agent_run.status = "completed"
    agent_run.completed_at = datetime.utcnow()
    session.add(agent_run)
    await _log_event(
        session,
        agent_run,
        "step_completed",
        text[:500],
        {"tokens_in": tokens_in, "tokens_out": tokens_out},
    )
    from app.services.workforce_runtime import apply_agent_runtime, broadcast_agent_live

    apply_agent_runtime(agent, status="standby")
    session.add(agent)
    await session.flush()
    await broadcast_agent_live(agent)
    signal = await _source_signal(session, tenant_id, run)
    if signal:
        from app.gateway.publish import publish_signal_message

        now = datetime.utcnow()
        message = SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant_id,
            kind="run",
            direction="internal",
            role="assistant",
            author_agent_id=agent.id,
            subject=f"{ws.name}: {step.name}",
            body_text=text[:8000],
            body_preview=text[:200],
            metadata_json=json.dumps(
                {
                    "workstream_id": str(ws.id),
                    "workstream_run_id": str(run.id),
                    "agent_run_id": str(agent_run.id),
                    "step_id": str(step.id),
                    "status": "completed",
                }
            ),
            received_at=now,
        )
        session.add(message)
        signal.last_message_at = now
        signal.updated_at = now
        signal.has_unread = True
        session.add(signal)
        await session.flush()
        await publish_signal_message(signal, message)
    return text


async def _execute_tool_step(
    session: AsyncSession,
    tenant_id: UUID,
    run: WorkstreamRun,
    step: WorkstreamStep,
) -> str:
    """Execute a configured platform tool with run fields available to templates."""
    from app.tools import execute_tool

    config = _parse_json(step.config_json)
    tool_name = str(config.get("tool_name") or "").strip()
    if not tool_name:
        raise RuntimeError("Call tool step requires config.tool_name")
    arguments = _render_template(config.get("arguments") or {}, _template_fields(run))
    if not isinstance(arguments, dict):
        raise RuntimeError("Call tool step config.arguments must be an object")
    agent = await _resolve_step_agent(session, tenant_id, step)
    result = await execute_tool(
        session,
        tenant_id,
        None,
        tool_name,
        arguments,
        signal_id=run.signal_id,
        agent=agent,
        project_id=run.project_id,
        approved=True,
        surface="workstream",
    )
    if result.get("error"):
        raise RuntimeError(str(result["error"]))
    return json.dumps(result, default=str)[:6000]


async def _execute_send_message_step(
    session: AsyncSession,
    tenant_id: UUID,
    run: WorkstreamRun,
    step: WorkstreamStep,
) -> str:
    """Send a templated message back into the tracked signal."""
    from app.tools import execute_tool

    if run.signal_id is None:
        raise RuntimeError("Send message step requires a signal-backed run")
    config = _parse_json(step.config_json)
    body = str(config.get("message") or step.goal or "").strip()
    if not body:
        raise RuntimeError("Send message step requires config.message or a goal")
    rendered = str(_render_template(body, _template_fields(run)))
    agent = await _resolve_step_agent(session, tenant_id, step)
    result = await execute_tool(
        session,
        tenant_id,
        None,
        "send_reply",
        {"signal_id": str(run.signal_id), "body_text": rendered, "send_as": "agent"},
        signal_id=run.signal_id,
        agent=agent,
        project_id=run.project_id,
        approved=True,
        surface="workstream",
    )
    if result.get("error"):
        raise RuntimeError(str(result["error"]))
    return rendered


async def _raise_gate_decision(
    session: AsyncSession, tenant_id: UUID, ws: Workstream, run: WorkstreamRun, step: WorkstreamStep
) -> None:
    from app.services.signal_decisions import create_decision

    payload = {"run_id": str(run.id), "step_id": str(step.id)}
    outputs = _step_outputs(run)
    last = str(outputs[-1].get("text") or "")[:1000] if outputs else ""
    signal = await _source_signal(session, tenant_id, run)
    options = [
        {
            "id": str(option.get("id") or f"option_{index + 1}"),
            "label": str(option.get("label") or f"Option {index + 1}"),
            "action_type": "workstream_continue",
            "payload": {
                **payload,
                "next_step_id": option.get("next_step_id"),
                "next_step_name": option.get("next_step_name"),
                "next_step_position": option.get("next_step_position"),
            },
        }
        for index, option in enumerate(
            _parse_json(step.config_json).get("options")
            or [{"id": "approve", "label": "Continue"}]
        )
    ]
    options.append(
        {
            "id": "cancel",
            "label": "Stop playbook",
            "action_type": "workstream_cancel",
            "payload": payload,
        }
    )
    await create_decision(
        session,
        tenant_id,
        project_id=run.project_id,
        title=step.name,
        summary=step.goal.strip() or last or "Review and approve to continue this workstream run.",
        options=options,
        user_id=signal.assigned_user_id if signal else None,
        signal_id=signal.id if signal else None,
        source_type="workstream_gate",
        source_id=str(run.id),
    )


async def _raise_failure_decision(
    session: AsyncSession, tenant_id: UUID, ws: Workstream, run: WorkstreamRun, error: str
) -> None:
    from app.services.signal_decisions import create_decision

    payload = {"run_id": str(run.id)}
    if run.current_step_id:
        payload["step_id"] = str(run.current_step_id)
    signal = await _source_signal(session, tenant_id, run)
    decision, _ = await create_decision(
        session,
        tenant_id,
        project_id=run.project_id,
        title=f"Playbook stalled: {ws.name}",
        summary=(
            f"Step failed after retries: {error[:500]}. "
            "Retry the step, skip it, or stop the playbook."
        ),
        options=[
            {
                "id": "retry",
                "label": "Retry",
                "action_type": "workstream_retry",
                "payload": payload,
            },
            {
                "id": "skip",
                "label": "Skip step",
                "action_type": "workstream_skip_step",
                "payload": payload,
            },
            {
                "id": "cancel",
                "label": "Stop playbook",
                "action_type": "workstream_cancel",
                "payload": payload,
            },
        ],
        user_id=signal.assigned_user_id if signal else None,
        signal_id=signal.id if signal else None,
        source_type="workstream_failure",
        source_id=str(run.id),
    )
    await _set_source_case_status(session, tenant_id, run, "waiting")


def _worklog_lines(run: WorkstreamRun) -> str:
    lines = []
    for o in _step_outputs(run):
        text = str(o.get("text") or "").strip().splitlines()
        first = text[0] if text else ""
        lines.append(f"- {o.get('name')}: {first[:160]}")
    return "\n".join(lines)


async def _announce_completion(
    session: AsyncSession, tenant_id: UUID, ws: Workstream, run: WorkstreamRun
) -> None:
    """Report the finished run in the agent channel."""
    from app.services.assistant_threads import append_signal_chat_message
    from app.services.platform_watch import ensure_agent_channel

    try:
        channel = await ensure_agent_channel(session, tenant_id)
    except ValueError:
        return
    body = f"Workstream '{ws.name}' completed.\n\n{run.summary}".strip()
    worklog = _worklog_lines(run)
    if worklog:
        body += f"\n\nWorklog:\n{worklog}"
    agent_id = None
    outputs = _step_outputs(run)
    if outputs and outputs[-1].get("agent_id"):
        try:
            agent_id = UUID(str(outputs[-1]["agent_id"]))
        except ValueError:
            agent_id = None
    await append_signal_chat_message(
        session,
        channel,
        role="assistant",
        content=body[:8000],
        author_agent_id=agent_id,
        metadata={"workstream_run_id": str(run.id), "workstream_id": str(ws.id)},
    )


async def _next_step(
    session: AsyncSession, tenant_id: UUID, run: WorkstreamRun, current: WorkstreamStep
) -> WorkstreamStep | None:
    return (
        await session.execute(
            select(WorkstreamStep)
            .where(
                WorkstreamStep.workstream_id == run.workstream_id,
                WorkstreamStep.tenant_id == tenant_id,
                WorkstreamStep.position > current.position,
            )
            .order_by(WorkstreamStep.position)
            .limit(1)
        )
    ).scalar_one_or_none()


async def _sync_queue_item(
    session: AsyncSession, tenant_id: UUID, run: WorkstreamRun
) -> None:
    """Queue items follow their run: completed run completes the item,
    failed/cancelled runs hand it back as planned for a human to re-route.

    Tolerant by design: the agent may have moved the item itself during the
    run, so illegal or redundant transitions are skipped silently.
    """
    if run.input_kind != "queue_item" or not run.input_ref:
        return
    from app.services.project_work import get_queue_item, transition_queue_item

    try:
        item = await get_queue_item(session, tenant_id, UUID(run.input_ref))
    except (HTTPException, ValueError):
        return
    if run.status == "completed":
        target, summary = "completed", run.summary or None
    elif run.status == "failed":
        target, summary = "planned", f"Workstream run failed: {run.error}"[:500]
    elif run.status == "cancelled":
        target, summary = "planned", "Workstream run was cancelled."
    else:
        return
    if item.status in ("completed", "rejected") or item.status == target:
        return
    try:
        await transition_queue_item(
            session,
            tenant_id,
            item.id,
            target,
            actor_type="system",
            actor_id="workstream_run",
            impact_summary=summary,
            commit=False,
        )
    except HTTPException:
        return


async def _finalize_run_sections(
    session: AsyncSession, tenant_id: UUID, run: WorkstreamRun
) -> int:
    """Gate approval promotes the sections written during this run to final."""
    ctx = _parse_json(run.context_json)
    raw_ids = ctx.get("written_section_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        return 0
    ids: list[UUID] = []
    for sid in raw_ids:
        try:
            ids.append(UUID(str(sid)))
        except ValueError:
            continue
    if not ids:
        return 0
    from app.models.workspace import DocSection

    rows = list(
        (
            await session.execute(
                select(DocSection).where(
                    DocSection.id.in_(ids),
                    DocSection.tenant_id == tenant_id,
                    DocSection.status != "final",
                )
            )
        )
        .scalars()
        .all()
    )
    now = datetime.utcnow()
    for section in rows:
        section.status = "final"
        section.status_changed_at = now
        section.status_changed_by_type = "system"
        section.status_changed_by_id = "workstream_gate"
        section.updated_at = now
        session.add(section)
    await session.flush()
    return len(rows)


async def _complete_run(
    session: AsyncSession, tenant_id: UUID, ws: Workstream, run: WorkstreamRun
) -> None:
    outputs = _step_outputs(run)
    last_text = str(outputs[-1].get("text") or "") if outputs else ""
    run.summary = last_text[:2000] or f"Completed all steps of '{ws.name}'."
    run.status = "completed"
    run.current_step_id = None
    run.wait_until = None
    run.completed_at = datetime.utcnow()
    run.updated_at = run.completed_at
    session.add(run)
    await session.flush()
    await _set_source_case_status(session, tenant_id, run, "done")
    await _sync_queue_item(session, tenant_id, run)
    await _announce_completion(session, tenant_id, ws, run)


async def advance_run(
    session: AsyncSession, tenant_id: UUID, run_id: UUID
) -> dict[str, Any]:
    """Process steps from the current position until the run waits, gates,
    completes, or fails. Commits its own progress."""
    run = await get_run(session, tenant_id, run_id)
    if run.status not in ("running",):
        return {"skipped": True, "status": run.status}
    ws = await get_workstream(session, tenant_id, run.workstream_id)

    # Integrity check before executing: agents available, module requirements
    # still met, linked sections present. A failing check pauses the run with
    # a retry/cancel decision instead of failing silently mid-step.
    from app.services.workstream_integrity import check_run_readiness

    steps_for_check = await list_steps(session, tenant_id, ws.id)
    problems = await check_run_readiness(session, tenant_id, ws, steps_for_check)
    if problems:
        error = "Integrity check failed: " + " ".join(problems)
        run.status = "failed"
        run.error = error[:1000]
        run.updated_at = datetime.utcnow()
        session.add(run)
        await _sync_queue_item(session, tenant_id, run)
        await _raise_failure_decision(session, tenant_id, ws, run, error)
        await session.commit()
        return {"failed": True, "error": error}

    for _ in range(MAX_STEPS_PER_ADVANCE):
        if run.current_step_id is None:
            await _complete_run(session, tenant_id, ws, run)
            await session.commit()
            return {"completed": True}
        step = (
            await session.execute(
                select(WorkstreamStep).where(
                    WorkstreamStep.id == run.current_step_id,
                    WorkstreamStep.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if step is None:
            await _complete_run(session, tenant_id, ws, run)
            await session.commit()
            return {"completed": True}
        if step.stage_key:
            await _set_source_case_status(session, tenant_id, run, stage_key=step.stage_key)

        if step.kind in ("wait_for_reply", "schedule"):
            run.status = "waiting"
            run.wait_until = (
                datetime.utcnow() + timedelta(hours=step.deadline_hours)
                if step.deadline_hours > 0
                else None
            )
            run.reminded_at = None
            run.updated_at = datetime.utcnow()
            session.add(run)
            if not step.stage_key:
                await _set_source_case_status(session, tenant_id, run, "waiting")
            await session.commit()
            return {"waiting": True, "wait_kind": "reply" if step.kind == "wait_for_reply" else "time"}

        if step.kind == "ask_decision":
            run.status = "awaiting_gate"
            run.updated_at = datetime.utcnow()
            session.add(run)
            if not step.stage_key:
                await _set_source_case_status(session, tenant_id, run, "waiting")
            await _raise_gate_decision(session, tenant_id, ws, run, step)
            await session.commit()
            return {"awaiting_gate": True, "step_id": str(step.id)}

        try:
            if step.kind == "agent_task":
                text = await _execute_agent_step(session, tenant_id, ws, run, step)
            elif step.kind == "send_message":
                text = await _execute_send_message_step(session, tenant_id, run, step)
            elif step.kind == "call_tool":
                text = await _execute_tool_step(session, tenant_id, run, step)
            else:
                raise RuntimeError(f"Unsupported step kind: {step.kind}")
        except Exception as exc:  # noqa: BLE001 — a failed run must never be silent
            logger.exception("Workstream run %s failed on step %s", run.id, step.id)
            await session.rollback()
            run = await get_run(session, tenant_id, run_id)
            ws = await get_workstream(session, tenant_id, run.workstream_id)
            context = _parse_json(run.context_json)
            retries = context.get("step_retries")
            if not isinstance(retries, dict):
                retries = {}
            retry_count = int(retries.get(str(step.id)) or 0)
            retry_limit = await _step_retry_limit(session, tenant_id)
            if retry_count < retry_limit:
                retries[str(step.id)] = retry_count + 1
                context["step_retries"] = retries
                run.context_json = json.dumps(context)
                run.error = str(exc)[:1000]
                run.updated_at = datetime.utcnow()
                session.add(run)
                await session.commit()
                continue
            run.status = "failed"
            run.error = str(exc)[:1000]
            run.updated_at = datetime.utcnow()
            session.add(run)
            await _sync_queue_item(session, tenant_id, run)
            await _raise_failure_decision(session, tenant_id, ws, run, str(exc))
            await session.commit()

            from app.services.ops_alerts import alert_run_failure

            await alert_run_failure(
                session, tenant_id, subject=ws.name, error=exc, task_id=None
            )
            return {"failed": True, "error": str(exc)}

        outputs = _step_outputs(run)
        context = _parse_json(run.context_json)
        retries = context.get("step_retries")
        if isinstance(retries, dict) and str(step.id) in retries:
            retries.pop(str(step.id), None)
            context["step_retries"] = retries
            run.context_json = json.dumps(context)
        agent_id = None
        if step.agent_id:
            agent_id = str(step.agent_id)
        outputs.append(
            {
                "step_id": str(step.id),
                "name": step.name,
                "kind": step.kind,
                "text": text[:6000],
                "agent_id": agent_id,
            }
        )
        _append_context(run, "step_outputs", outputs)

        nxt = await _next_step(session, tenant_id, run, step)
        run.current_step_id = nxt.id if nxt else None
        run.updated_at = datetime.utcnow()
        session.add(run)
        await session.commit()

    return {"paused": True, "reason": "max_steps_per_advance"}


async def resume_run(
    session: AsyncSession,
    tenant_id: UUID,
    run_id: UUID,
    *,
    input_text: str = "",
    next_step_id: UUID | None = None,
    next_step_name: str = "",
    next_step_position: int | None = None,
    advance: bool = True,
) -> WorkstreamRun:
    """Resume a waiting or gated run past its current step.

    For failed runs this retries the current step instead of skipping it.
    """
    run = await get_run(session, tenant_id, run_id)
    if run.status not in ("waiting", "awaiting_gate", "failed"):
        raise HTTPException(
            status_code=400, detail=f"Cannot resume a run in status {run.status}"
        )
    retry = run.status == "failed"
    if run.status == "awaiting_gate":
        # Gate approval: the human vouched for the work, so the sections
        # written during this run graduate to final.
        await _finalize_run_sections(session, tenant_id, run)
    if input_text.strip():
        received = _parse_json(run.context_json).get("wait_inputs") or []
        received.append({"at": datetime.utcnow().isoformat(), "text": input_text.strip()[:4000]})
        _append_context(run, "wait_inputs", received)

    if not retry and run.current_step_id is not None:
        step = (
            await session.execute(
                select(WorkstreamStep).where(WorkstreamStep.id == run.current_step_id)
            )
        ).scalar_one_or_none()
        if step is not None:
            branch_id = next_step_id
            branch_name = next_step_name
            branch_position = next_step_position
            if branch_id is None and step.kind == "wait_for_reply" and input_text.strip():
                config = _parse_json(step.config_json)
                for branch in config.get("reply_branches") or []:
                    if not isinstance(branch, dict):
                        continue
                    contains = str(branch.get("contains") or "").strip().lower()
                    if contains and contains in input_text.lower():
                        try:
                            branch_id = UUID(str(branch.get("next_step_id")))
                        except (TypeError, ValueError):
                            branch_id = None
                        branch_name = str(branch.get("next_step_name") or "")
                        raw_position = branch.get("next_step_position")
                        branch_position = int(raw_position) if raw_position is not None else None
                        break
            nxt = None
            if branch_id is not None:
                nxt = (
                    await session.execute(
                        select(WorkstreamStep).where(
                            WorkstreamStep.id == branch_id,
                            WorkstreamStep.workstream_id == run.workstream_id,
                            WorkstreamStep.tenant_id == tenant_id,
                        )
                    )
                ).scalar_one_or_none()
            if nxt is None and branch_name.strip():
                nxt = (
                    await session.execute(
                        select(WorkstreamStep).where(
                            WorkstreamStep.workstream_id == run.workstream_id,
                            WorkstreamStep.tenant_id == tenant_id,
                            WorkstreamStep.name == branch_name.strip(),
                        )
                    )
                ).scalars().first()
            if nxt is None and branch_position is not None:
                nxt = (
                    await session.execute(
                        select(WorkstreamStep).where(
                            WorkstreamStep.workstream_id == run.workstream_id,
                            WorkstreamStep.tenant_id == tenant_id,
                            WorkstreamStep.position == branch_position,
                        )
                    )
                ).scalar_one_or_none()
            if nxt is None:
                nxt = await _next_step(session, tenant_id, run, step)
            run.current_step_id = nxt.id if nxt else None

    run.status = "running"
    run.error = ""
    run.wait_until = None
    run.reminded_at = None
    run.updated_at = datetime.utcnow()
    session.add(run)
    await _set_source_case_status(session, tenant_id, run, "open")
    await session.commit()
    if advance:
        from app.services.orchestration.queue import enqueue_workstream_run_advance

        if not await enqueue_workstream_run_advance(str(tenant_id), str(run.id)):
            await advance_run(session, tenant_id, run.id)
        await session.refresh(run)
    return run


async def skip_step_run(session: AsyncSession, tenant_id: UUID, run_id: UUID) -> WorkstreamRun:
    """Skip the current step after a failure decision and continue the playbook."""
    run = await get_run(session, tenant_id, run_id)
    if run.status not in ("waiting", "awaiting_gate", "failed"):
        raise HTTPException(
            status_code=400, detail=f"Cannot skip a step on a run in status {run.status}"
        )
    if run.current_step_id is not None:
        step = (
            await session.execute(
                select(WorkstreamStep).where(WorkstreamStep.id == run.current_step_id)
            )
        ).scalar_one_or_none()
        if step is not None:
            nxt = await _next_step(session, tenant_id, run, step)
            run.current_step_id = nxt.id if nxt else None
            outputs = _step_outputs(run)
            outputs.append(
                {
                    "step_id": str(step.id),
                    "name": step.name,
                    "kind": step.kind,
                    "text": "Skipped after failure decision",
                }
            )
            _append_context(run, "step_outputs", outputs)
    run.status = "running"
    run.error = ""
    run.wait_until = None
    run.reminded_at = None
    run.updated_at = datetime.utcnow()
    session.add(run)
    await _set_source_case_status(session, tenant_id, run, "open")
    await session.commit()
    from app.services.orchestration.queue import enqueue_workstream_run_advance

    if not await enqueue_workstream_run_advance(str(tenant_id), str(run.id)):
        await advance_run(session, tenant_id, run.id)
    await session.refresh(run)
    return run


async def cancel_run(session: AsyncSession, tenant_id: UUID, run_id: UUID) -> WorkstreamRun:
    run = await get_run(session, tenant_id, run_id)
    if run.status in ("completed", "cancelled"):
        return run
    run.status = "cancelled"
    run.wait_until = None
    run.completed_at = datetime.utcnow()
    run.updated_at = run.completed_at
    session.add(run)
    await _set_source_case_status(session, tenant_id, run, "done")
    await _sync_queue_item(session, tenant_id, run)
    await session.commit()
    return run


async def process_due_run_deadlines(session: AsyncSession) -> int:
    """Scheduler sweep: wake waiting runs whose deadline passed.

    Time waits simply continue. Input/event waits follow the step's
    `on_deadline`: continue, remind (in the agent channel) then continue,
    or fail with a decision.
    """
    now = datetime.utcnow()
    due_ids = [
        row[0]
        for row in (
            await session.execute(
                select(WorkstreamRun.id).where(
                    WorkstreamRun.status == "waiting",
                    WorkstreamRun.wait_until.is_not(None),
                    WorkstreamRun.wait_until <= now,
                )
            )
        ).all()
    ]
    woken = 0
    for run_id in due_ids:
        run = (
            await session.execute(
                select(WorkstreamRun).where(WorkstreamRun.id == run_id)
            )
        ).scalar_one_or_none()
        if run is None or run.status != "waiting":
            continue
        step = (
            await session.execute(
                select(WorkstreamStep).where(WorkstreamStep.id == run.current_step_id)
            )
        ).scalar_one_or_none()
        ws = (
            await session.execute(
                select(Workstream).where(Workstream.id == run.workstream_id)
            )
        ).scalar_one_or_none()
        if step is None or ws is None:
            run.status = "cancelled"
            run.completed_at = now
            session.add(run)
            await session.commit()
            continue
        on_deadline = step.on_deadline if step.kind == "wait_for_reply" else "continue"
        if on_deadline == "fail":
            context = _parse_json(run.context_json)
            retries = context.get("step_retries")
            if not isinstance(retries, dict):
                retries = {}
            retry_count = int(retries.get(str(step.id)) or 0)
            retry_limit = await _step_retry_limit(session, run.tenant_id)
            if retry_count < retry_limit:
                retries[str(step.id)] = retry_count + 1
                context["step_retries"] = retries
                run.context_json = json.dumps(context)
                run.wait_until = now + timedelta(hours=max(1, step.deadline_hours))
                run.reminded_at = None
                run.updated_at = now
                session.add(run)
                await session.commit()
                woken += 1
                continue
            run.status = "failed"
            run.error = f"Deadline passed while waiting on step '{step.name}'."
            run.updated_at = now
            session.add(run)
            await _raise_failure_decision(session, run.tenant_id, ws, run, run.error)
            await session.commit()
            woken += 1
            continue
        if on_deadline == "remind_then_continue" and run.reminded_at is None:
            from app.services.assistant_threads import append_signal_chat_message
            from app.services.platform_watch import ensure_agent_channel

            try:
                channel = await ensure_agent_channel(session, run.tenant_id)
                await append_signal_chat_message(
                    session,
                    channel,
                    role="assistant",
                    content=(
                        f"Reminder: workstream '{ws.name}' waited on step "
                        f"'{step.name}' past its deadline and continues now."
                    ),
                    metadata={"workstream_run_id": str(run.id)},
                )
            except ValueError:
                pass
            run.reminded_at = now
            session.add(run)
        # Continue past the wait step.
        nxt = await _next_step(session, run.tenant_id, run, step)
        run.current_step_id = nxt.id if nxt else None
        run.status = "running"
        run.wait_until = None
        run.updated_at = now
        session.add(run)
        await session.commit()
        await advance_run(session, run.tenant_id, run.id)
        woken += 1
    return woken


# ---------------------------------------------------------------------------
# Run detail (worklog)


async def run_detail(session: AsyncSession, tenant_id: UUID, run_id: UUID) -> dict[str, Any]:
    run = await get_run(session, tenant_id, run_id)
    ws = await get_workstream(session, tenant_id, run.workstream_id)
    steps = await list_steps(session, tenant_id, run.workstream_id)
    agent_runs = list(
        (
            await session.execute(
                select(AgentRun)
                .where(AgentRun.workstream_run_id == run.id)
                .order_by(AgentRun.started_at)
            )
        ).scalars().all()
    )
    events_by_run: dict[str, list[dict[str, Any]]] = {}
    if agent_runs:
        event_rows = (
            await session.execute(
                select(RunEvent)
                .where(RunEvent.run_id.in_([r.id for r in agent_runs]))
                .order_by(RunEvent.created_at, RunEvent.sequence)
            )
        ).scalars().all()
        for ev in event_rows:
            events_by_run.setdefault(str(ev.run_id), []).append(
                {
                    "event_type": ev.event_type,
                    "message": ev.message,
                    "payload": _parse_json(ev.payload_json),
                    "created_at": _iso(ev.created_at),
                }
            )
    agents = {}
    if agent_runs:
        agent_rows = (
            await session.execute(
                select(Agent).where(Agent.id.in_({r.agent_id for r in agent_runs}))
            )
        ).scalars().all()
        agents = {a.id: a.name for a in agent_rows}
    return {
        "run": serialize_run(run, workstream_name=ws.name),
        "workstream": serialize_workstream(ws),
        "steps": [serialize_step(s) for s in steps],
        "step_outputs": _step_outputs(run),
        "agent_runs": [
            {
                "id": str(r.id),
                "step_id": str(r.step_id) if r.step_id else None,
                "agent_id": str(r.agent_id),
                "agent_name": agents.get(r.agent_id, ""),
                "status": r.status,
                "subject": r.subject,
                "tokens_input": r.tokens_input,
                "tokens_output": r.tokens_output,
                "started_at": _iso(r.started_at),
                "completed_at": _iso(r.completed_at),
                "events": events_by_run.get(str(r.id), []),
            }
            for r in agent_runs
        ],
    }


async def list_runs(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    workstream_id: UUID | None = None,
    project_id: UUID | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    query = select(WorkstreamRun, Workstream.name).join(
        Workstream, Workstream.id == WorkstreamRun.workstream_id
    ).where(WorkstreamRun.tenant_id == tenant_id)
    if workstream_id is not None:
        query = query.where(WorkstreamRun.workstream_id == workstream_id)
    if project_id is not None:
        query = query.where(WorkstreamRun.project_id == project_id)
    rows = (
        await session.execute(
            query.order_by(WorkstreamRun.started_at.desc()).limit(max(1, min(limit, 200)))
        )
    ).all()
    return [serialize_run(run, workstream_name=name) for run, name in rows]


# ---------------------------------------------------------------------------
# Promotion to knowledge


async def promote_run_to_knowledge(
    session: AsyncSession, tenant_id: UUID, run_id: UUID
) -> dict[str, Any]:
    """Kick off an agent job that distills the run into a knowledge section."""
    run = await get_run(session, tenant_id, run_id)
    if run.status != "completed":
        raise HTTPException(status_code=400, detail="Only completed runs can be promoted.")
    ws = await get_workstream(session, tenant_id, run.workstream_id)
    outputs = _step_outputs(run)
    worklog = "\n\n".join(
        f"### {o.get('name')}\n{str(o.get('text') or '')[:2500]}" for o in outputs
    )
    instructions = (
        f"Distill the completed workstream run of '{ws.name}' into reusable knowledge.\n\n"
        f"Summary: {run.summary}\n\nWorklog:\n{worklog[:12000]}\n\n"
        "Write one focused knowledge section (150-400 words, one topic) with the "
        "durable lesson, procedure, or fact from this run using the write_doc tool "
        "with a page path and section heading. Skip anything one-off or trivial."
    )
    from app.services.orchestration.dispatcher import create_agent_task

    task = await create_agent_task(
        session,
        tenant_id,
        title=f"Promote run to knowledge: {ws.name}",
        description=instructions,
        project_id=run.project_id,
        trigger_type="workstream",
        trigger_id=str(run.id),
        origin="workstream",
        auto_start=True,
    )
    return {"task_id": str(task.id), "status": task.status}
