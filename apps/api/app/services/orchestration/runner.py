"""Background segment runner: one workstream step or single-agent task chunk."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun, RunEvent
from app.models.notification import DecisionRequest
from app.models.orchestration import AgentTask
from app.models.orchestra import Workstream, WorkstreamRun, WorkstreamStep, WorkstreamStepRun
from app.models.usage import UsageLedger
from app.services.agent.loop import AgentLoop
from app.services.orchestration.dispatcher import add_task_artifact
from app.services.orchestration.eval import run_eval_checkpoint
from app.services.orchestration.profiles import apply_snapshot_to_agent, resolve_runtime_snapshot
from app.services.orchestration.queue import enqueue_agent_task_segment
from app.gateway.publish import publish_run_event
from app.services.signal_decisions import append_decision_to_signal


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _merge_context(task: AgentTask, key: str, value: Any) -> None:
    ctx = _parse_json(task.context_json)
    ctx[key] = value
    task.context_json = json.dumps(ctx)


async def _next_event_sequence(session: AsyncSession, run_id: UUID) -> int:
    result = await session.execute(
        select(RunEvent.sequence).where(RunEvent.run_id == run_id).order_by(RunEvent.sequence.desc()).limit(1)
    )
    row = result.scalar_one_or_none()
    return (row or 0) + 1


async def log_run_event(
    session: AsyncSession,
    run: AgentRun,
    event_type: str,
    message: str,
    payload: dict | None = None,
    *,
    detail_level: str = "summary",
) -> None:
    seq = await _next_event_sequence(session, run.id)
    session.add(
        RunEvent(
            run_id=run.id,
            tenant_id=run.tenant_id,
            event_type=event_type,
            message=message,
            payload_json=json.dumps(payload or {}),
            sequence=seq,
            detail_level=detail_level,
        )
    )
    await session.flush()
    await publish_run_event(
        run.tenant_id,
        run.id,
        event_type=event_type,
        message=message,
        payload=payload or {},
        sequence=seq,
        status=run.status,
    )


def _build_handoff_prompt(step: WorkstreamStep, task: AgentTask, step_outputs: dict[str, Any]) -> str:
    template = step.handoff_template.strip() or step.prompt_template.strip()
    ctx = _parse_json(task.context_json)
    ctx["task_title"] = task.title
    ctx["task_description"] = task.description
    ctx["step_outputs"] = step_outputs
    if template:
        out = template
        for key, val in ctx.items():
            if isinstance(val, (str, int, float, bool)):
                out = out.replace(f"{{{{{key}}}}}", str(val))
        return out
    parts = [f"Task: {task.title}", task.description]
    if step_outputs:
        parts.append("Prior step outputs:\n" + json.dumps(step_outputs, indent=2)[:6000])
    parts.append(f"Execute step: {step.name}")
    return "\n\n".join(p for p in parts if p)


async def _resolve_step_agent(
    session: AsyncSession, tenant_id: UUID, step: WorkstreamStep, task: AgentTask
) -> Agent | None:
    if step.agent_id:
        result = await session.execute(
            select(Agent).where(Agent.id == step.agent_id, Agent.tenant_id == tenant_id, Agent.is_active.is_(True))
        )
        agent = result.scalar_one_or_none()
        if agent:
            return agent

    ctx = _parse_json(task.context_json)
    aid = ctx.get("agent_id")
    if aid:
        result = await session.execute(
            select(Agent).where(Agent.id == UUID(str(aid)), Agent.tenant_id == tenant_id)
        )
        agent = result.scalar_one_or_none()
        if agent:
            return agent

    if step.agent_profile_id:
        from app.models.orchestra import AgentProfile

        prof = (
            await session.execute(
                select(AgentProfile).where(
                    AgentProfile.id == step.agent_profile_id, AgentProfile.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if prof:
            return Agent(
                tenant_id=tenant_id,
                name=prof.name,
                role="assistant",
                model=prof.model,
                provider=prof.provider,
                system_prompt=prof.system_prompt,
                tools_json=prof.tools_json,
            )

    fallback = (
        await session.execute(
            select(Agent)
            .where(Agent.tenant_id == tenant_id, Agent.is_active.is_(True))
            .order_by(Agent.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()
    return fallback


async def _execute_agent_segment(
    session: AsyncSession,
    tenant_id: UUID,
    task: AgentTask,
    agent: Agent,
    *,
    step: WorkstreamStep | None,
    prompt: str,
    workstream_run: WorkstreamRun | None,
    parent_run_id: UUID | None = None,
    run_role: str = "main",
    segment_index: int = 0,
) -> tuple[AgentRun, str]:
    snapshot = await resolve_runtime_snapshot(
        session,
        tenant_id,
        agent=agent,
        step_runtime_profile_id=step.runtime_profile_id if step else None,
        task_runtime_profile_id=task.default_runtime_profile_id,
        legacy_agent_profile_id=step.agent_profile_id if step else None,
    )
    runtime_agent = apply_snapshot_to_agent(agent, snapshot)

    checkpoint_messages: list[dict] = []
    existing_run_id = _parse_json(task.context_json).get("active_run_id")
    if existing_run_id and segment_index > 0:
        prev = (
            await session.execute(
                select(AgentRun).where(AgentRun.id == UUID(str(existing_run_id)), AgentRun.task_id == task.id)
            )
        ).scalar_one_or_none()
        if prev and prev.checkpoint_json:
            try:
                checkpoint_messages = json.loads(prev.checkpoint_json)
            except json.JSONDecodeError:
                checkpoint_messages = []

    run = AgentRun(
        tenant_id=tenant_id,
        agent_id=agent.id,
        project_id=task.project_id,
        task_id=task.id,
        workstream_run_id=workstream_run.id if workstream_run else None,
        step_id=step.id if step else None,
        parent_run_id=parent_run_id,
        run_role=run_role,
        segment_index=segment_index,
        runtime_snapshot_json=json.dumps(snapshot),
        status="running",
        trigger_type=task.trigger_type,
        subject=step.name if step else task.title,
    )
    session.add(run)
    agent.runtime_status = "active"
    agent.current_activity_summary = (step.name if step else task.title)[:200]
    session.add(agent)
    await session.flush()

    _merge_context(task, "active_run_id", str(run.id))
    session.add(task)

    await log_run_event(
        session,
        run,
        "segment_started",
        f"Started segment {segment_index} with {snapshot.get('model')}",
        {"model": snapshot.get("model"), "agent": agent.name, "step": step.name if step else None},
    )

    messages = [*checkpoint_messages, {"role": "user", "content": prompt}]
    loop = AgentLoop(session, tenant_id, task.created_by, runtime_agent, run)
    text, tokens = await loop.run_chat(messages)

    tokens_in = tokens.get("input_tokens", 0)
    tokens_out = tokens.get("output_tokens", 0)
    cost_cents = max(1, (tokens_in + tokens_out) // 100)
    run.tokens_input = tokens_in
    run.tokens_output = tokens_out
    run.result_json = json.dumps({"text": text[:8000]})
    run.checkpoint_json = json.dumps([*messages, {"role": "assistant", "content": text}][-40:])
    run.status = "completed"
    run.completed_at = datetime.utcnow()
    session.add(run)

    session.add(
        UsageLedger(
            tenant_id=tenant_id,
            scope="orchestration",
            scope_id=str(run.id),
            provider=runtime_agent.provider,
            model=runtime_agent.model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_cents=cost_cents,
        )
    )

    context_window = max(1, int(snapshot.get("max_tokens") or runtime_agent.max_tokens or 4096))
    context_pct = min(100, round((tokens_in + tokens_out) / context_window * 100))
    await log_run_event(
        session,
        run,
        "context_usage",
        f"Context ~{context_pct}% | {tokens_in + tokens_out} tokens | {cost_cents} cents",
        {
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "context_pct": context_pct,
            "cost_cents": cost_cents,
            "max_cost_cents": int(snapshot.get("max_cost_cents") or 0),
        },
    )

    await log_run_event(session, run, "segment_completed", text[:500], {"tokens": tokens}, detail_level="full")
    await add_task_artifact(
        session,
        tenant_id,
        task.id,
        name=step.name if step else "output",
        artifact_type="text",
        content={"text": text},
        run_id=run.id,
    )

    agent.runtime_status = "standby"
    session.add(agent)
    await session.flush()
    return run, text


async def run_agent_task_segment(session: AsyncSession, tenant_id: UUID, task_id: UUID) -> dict[str, Any]:
    task = (
        await session.execute(select(AgentTask).where(AgentTask.id == task_id, AgentTask.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if not task:
        return {"skipped": True, "reason": "task_not_found"}
    if task.status in ("completed", "failed", "cancelled"):
        return {"skipped": True, "reason": task.status}

    task.status = "running"
    session.add(task)
    await session.flush()

    ctx = _parse_json(task.context_json)
    step_outputs: dict[str, Any] = ctx.get("step_outputs") or {}
    segment_index = int(ctx.get("segment_index") or 0)

    workstream_run: WorkstreamRun | None = None
    if task.workstream_run_id:
        workstream_run = (
            await session.execute(select(WorkstreamRun).where(WorkstreamRun.id == task.workstream_run_id))
        ).scalar_one_or_none()

    step: WorkstreamStep | None = None
    if task.workstream_id:
        if task.current_step_id:
            step = (
                await session.execute(
                    select(WorkstreamStep).where(
                        WorkstreamStep.id == task.current_step_id,
                        WorkstreamStep.tenant_id == tenant_id,
                    )
                )
            ).scalar_one_or_none()
        else:
            step = (
                await session.execute(
                    select(WorkstreamStep)
                    .where(WorkstreamStep.workstream_id == task.workstream_id)
                    .order_by(WorkstreamStep.order)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if step:
                task.current_step_id = step.id
                session.add(task)

    if step and step.step_kind == "human_gate":
        decision = DecisionRequest(
            tenant_id=tenant_id,
            project_id=task.project_id,
            title=f"Approval: {step.name}",
            body=task.description or step.prompt_template or "Review and approve to continue.",
            status="pending",
            action_type="orchestration_continue",
            action_payload_json=json.dumps({"task_id": str(task.id), "step_id": str(step.id)}),
        )
        session.add(decision)
        await session.flush()
        if task.signal_id:
            await append_decision_to_signal(session, tenant_id, decision, project_id=task.project_id)
        task.status = "awaiting_decision"
        task.pause_reason = "human_gate"
        session.add(task)
        await session.commit()
        return {"paused": True, "reason": "human_gate"}

    agent = await _resolve_step_agent(session, tenant_id, step, task) if step else None
    if not agent:
        ctx_agent_id = ctx.get("agent_id")
        if ctx_agent_id:
            agent = (
                await session.execute(
                    select(Agent).where(Agent.id == UUID(str(ctx_agent_id)), Agent.tenant_id == tenant_id)
                )
            ).scalar_one_or_none()
        if not agent:
            agent = (
                await session.execute(
                    select(Agent)
                    .where(Agent.tenant_id == tenant_id, Agent.is_active.is_(True))
                    .order_by(Agent.created_at)
                    .limit(1)
                )
            ).scalar_one_or_none()

    if not agent:
        task.status = "failed"
        task.completed_at = datetime.utcnow()
        session.add(task)
        await session.commit()
        return {"failed": True, "reason": "no_agent"}

    prompt = _build_handoff_prompt(step, task, step_outputs) if step else (task.description or task.title)
    step_run: WorkstreamStepRun | None = None
    if workstream_run and step:
        step_run = WorkstreamStepRun(
            run_id=workstream_run.id,
            step_id=step.id,
            tenant_id=tenant_id,
            status="running",
            iteration=segment_index + 1,
        )
        session.add(step_run)
        await session.flush()

    run, text = await _execute_agent_segment(
        session,
        tenant_id,
        task,
        agent,
        step=step,
        prompt=prompt,
        workstream_run=workstream_run,
        segment_index=segment_index,
    )

    # Refresh context: the segment persisted active_run_id, so re-read before mutating.
    ctx = _parse_json(task.context_json)

    # Cost budget enforcement: accumulate spend per task and pause if a profile cap is exceeded.
    snapshot = _parse_json(run.runtime_snapshot_json)
    max_cost = int(snapshot.get("max_cost_cents") or 0)
    spent = int(ctx.get("cost_cents") or 0) + max(1, (run.tokens_input + run.tokens_output) // 100)
    ctx["cost_cents"] = spent
    task.context_json = json.dumps(ctx)
    session.add(task)
    if max_cost > 0 and spent >= max_cost:
        await log_run_event(
            session,
            run,
            "budget_exceeded",
            f"Cost budget reached: {spent}/{max_cost} cents",
            {"spent_cents": spent, "max_cost_cents": max_cost},
        )
        task.status = "paused"
        task.pause_reason = "budget_exceeded"
        session.add(task)
        await session.commit()
        return {"paused": True, "reason": "budget_exceeded"}

    eval_criteria = step.success_criteria_json if step else task.success_criteria_json
    eval_kind = step.eval_kind if step else "rubric"
    if eval_criteria and eval_criteria.strip() not in ("", "{}"):
        checkpoint = await run_eval_checkpoint(
            session,
            tenant_id,
            agent_task_id=task.id,
            run_id=run.id,
            step_id=step.id if step else None,
            eval_kind=eval_kind,
            criteria_json=eval_criteria,
            output_text=text,
            context=ctx,
            retry_count=int(ctx.get("retry_count") or 0),
        )
        await log_run_event(
            session,
            run,
            "eval_result",
            "Evaluation passed" if checkpoint.passed else "Evaluation failed",
            {"passed": checkpoint.passed, "eval_kind": eval_kind},
        )
        if not checkpoint.passed:
            retries = int(ctx.get("retry_count") or 0)
            max_retries = step.max_retries if step else 2
            if retries < max_retries:
                ctx["retry_count"] = retries + 1
                task.context_json = json.dumps(ctx)
                session.add(task)
                await session.commit()
                await enqueue_agent_task_segment(str(tenant_id), str(task.id))
                return {"retry": True, "retry_count": retries + 1}

            next_step_id = step.on_eval_fail_step if step else None
            if next_step_id:
                task.current_step_id = next_step_id
                ctx["retry_count"] = 0
                task.context_json = json.dumps(ctx)
                session.add(task)
                await session.commit()
                await enqueue_agent_task_segment(str(tenant_id), str(task.id))
                return {"advanced": True, "on_eval_fail": True}

            task.status = "failed"
            task.completed_at = datetime.utcnow()
            session.add(task)
            if step_run:
                step_run.status = "failed"
                step_run.log_text = text[:2000]
                session.add(step_run)
            await session.commit()
            return {"failed": True, "reason": "eval_failed"}

    if step_run:
        step_run.status = "success"
        step_run.log_text = text[:4000]
        step_run.output_json = json.dumps({"text": text[:2000]})
        step_run.tokens_in = run.tokens_input
        step_run.tokens_out = run.tokens_output
        session.add(step_run)

    if step:
        step_outputs[str(step.id)] = {"name": step.name, "text": text[:4000], "agent_id": str(agent.id)}
        ctx["step_outputs"] = step_outputs
        ctx["segment_index"] = segment_index + 1
        ctx["retry_count"] = 0
        task.context_json = json.dumps(ctx)

        next_step_id = step.on_success_step
        if not next_step_id:
            remaining = (
                await session.execute(
                    select(WorkstreamStep)
                    .where(WorkstreamStep.workstream_id == task.workstream_id, WorkstreamStep.order > step.order)
                    .order_by(WorkstreamStep.order)
                    .limit(1)
                )
            ).scalar_one_or_none()
            next_step_id = remaining.id if remaining else None

        if next_step_id:
            task.current_step_id = next_step_id
            session.add(task)
            await session.commit()
            await enqueue_agent_task_segment(str(tenant_id), str(task.id))
            return {"continued": True, "next_step_id": str(next_step_id)}

    task.status = "completed"
    task.completed_at = datetime.utcnow()
    session.add(task)
    if workstream_run:
        workstream_run.status = "completed"
        workstream_run.completed_at = datetime.utcnow()
        session.add(workstream_run)
    await session.commit()
    return {"completed": True, "run_id": str(run.id)}


async def start_workstream_as_task(
    session: AsyncSession,
    tenant_id: UUID,
    workstream_id: UUID,
    *,
    title: str | None = None,
    description: str = "",
    trigger_type: str = "manual",
) -> AgentTask:
    ws = (
        await session.execute(
            select(Workstream).where(Workstream.id == workstream_id, Workstream.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not ws:
        raise ValueError("Workstream not found")

    ws_run = WorkstreamRun(
        tenant_id=tenant_id,
        workstream_id=workstream_id,
        trigger_type=trigger_type,
        status="running",
    )
    session.add(ws_run)
    await session.flush()

    first_step = (
        await session.execute(
            select(WorkstreamStep)
            .where(WorkstreamStep.workstream_id == workstream_id)
            .order_by(WorkstreamStep.order)
            .limit(1)
        )
    ).scalar_one_or_none()

    from app.services.orchestration.dispatcher import create_agent_task

    task = await create_agent_task(
        session,
        tenant_id,
        title=title or ws.name,
        description=description or ws.description,
        workstream_id=workstream_id,
        trigger_type=trigger_type,
        auto_start=False,
    )
    task.workstream_run_id = ws_run.id
    task.current_step_id = first_step.id if first_step else None
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task
