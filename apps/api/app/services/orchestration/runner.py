"""Background segment runner for single-agent tasks.

One `AgentTask` = one agent working towards a goal, possibly across multiple
segments (checkpoint + re-enqueue). Multi-step orchestration is the
Workstream engine (`app.services.workstreams`); this runner only executes
plain tasks: queue workflow wakes, delegation, trigger wakes, ad-hoc jobs.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentRun, RunEvent
from app.models.orchestration import AgentTask
from app.services.agent.loop import AgentLoop
from app.services.orchestration.dispatcher import add_task_artifact
from app.services.orchestration.eval import run_eval_checkpoint
from app.services.orchestration.profiles import apply_snapshot_to_agent, resolve_runtime_snapshot
from app.services.orchestration.queue import enqueue_agent_task_segment
from app.gateway.publish import publish_run_event, publish_signal_message
from app.models.signal import Signal, SignalMessage


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


async def _mirror_task_message(
    session: AsyncSession,
    task: AgentTask,
    *,
    kind: str,
    body: str,
    agent_id: UUID | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Surface orchestration progress in the linked Messages thread."""
    if not task.signal_id:
        return
    text = (body or "").strip()
    if not text:
        return
    signal = (
        await session.execute(select(Signal).where(Signal.id == task.signal_id, Signal.tenant_id == task.tenant_id))
    ).scalar_one_or_none()
    if not signal:
        return
    now = datetime.utcnow()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=task.tenant_id,
        kind=kind,
        direction="internal",
        role="assistant",
        author_agent_id=agent_id,
        body_text=text[:8000],
        body_preview=text[:200],
        metadata_json=json.dumps(
            {
                "task_id": str(task.id),
                **(metadata or {}),
            }
        ),
        received_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.has_unread = True
    signal.updated_at = now
    session.add(signal)
    await session.flush()
    await publish_signal_message(signal, message)


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


async def _execute_agent_segment(
    session: AsyncSession,
    tenant_id: UUID,
    task: AgentTask,
    agent: Agent,
    *,
    prompt: str,
    parent_run_id: UUID | None = None,
    run_role: str = "main",
    segment_index: int = 0,
) -> tuple[AgentRun, str]:
    snapshot = resolve_runtime_snapshot(agent)
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
        parent_run_id=parent_run_id,
        run_role=run_role,
        segment_index=segment_index,
        runtime_snapshot_json=json.dumps(snapshot),
        status="running",
        trigger_type=task.trigger_type,
        subject=task.title,
    )
    session.add(run)
    agent.runtime_status = "active"
    agent.current_activity_summary = task.title[:200]
    session.add(agent)
    await session.flush()

    _merge_context(task, "active_run_id", str(run.id))
    session.add(task)

    await log_run_event(
        session,
        run,
        "segment_started",
        f"Started segment {segment_index} with {snapshot.get('model')}",
        {"model": snapshot.get("model"), "agent": agent.name},
    )

    messages = [*checkpoint_messages, {"role": "user", "content": prompt}]
    loop = AgentLoop(session, tenant_id, task.created_by, runtime_agent, run)
    loop.usage_scope = "orchestration"
    loop.usage_call_type = "orchestration"
    text, tokens = await loop.run_chat(messages)

    tokens_in = tokens.get("input_tokens", 0)
    tokens_out = tokens.get("output_tokens", 0)
    run.tokens_input = tokens_in
    run.tokens_output = tokens_out
    run.result_json = json.dumps({"text": text[:8000]})
    run.checkpoint_json = json.dumps([*messages, {"role": "assistant", "content": text}][-40:])
    run.status = "completed"
    run.completed_at = datetime.utcnow()
    session.add(run)

    # Usage is metered inside AgentLoop.run_chat; derive a cents figure for budget tracking.
    if loop.resolved_call is not None:
        from app.services.model_resolution import compute_costs

        provider_micros, customer_micros = compute_costs(loop.resolved_call, tokens_in, tokens_out)
        billed = customer_micros if loop.resolved_call.billable else provider_micros
        cost_cents = max(1, round(billed / 10000))
    else:
        cost_cents = max(1, (tokens_in + tokens_out) // 100)

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
        name="output",
        artifact_type="text",
        content={"text": text},
        run_id=run.id,
    )

    await _mirror_task_message(
        session,
        task,
        kind="status_update",
        body=f"**{task.title}**\n\n{text}",
        agent_id=agent.id,
        metadata={"run_id": str(run.id), "segment_index": segment_index, "agent_name": agent.name},
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
    if task.status in ("completed", "failed", "cancelled", "rejected"):
        return {"skipped": True, "reason": task.status}

    task.status = "running"
    session.add(task)
    await session.flush()

    ctx = _parse_json(task.context_json)
    segment_index = int(ctx.get("segment_index") or 0)

    agent: Agent | None = None
    if task.assignee_agent_id:
        agent = (
            await session.execute(
                select(Agent).where(
                    Agent.id == task.assignee_agent_id,
                    Agent.tenant_id == tenant_id,
                    Agent.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
    if not agent:
        ctx_agent_id = ctx.get("agent_id")
        if ctx_agent_id:
            agent = (
                await session.execute(
                    select(Agent).where(Agent.id == UUID(str(ctx_agent_id)), Agent.tenant_id == tenant_id)
                )
            ).scalar_one_or_none()
        if not agent:
            from app.services.lead_agent import get_lead_agent

            agent = await get_lead_agent(session, tenant_id)

    if not agent:
        task.status = "failed"
        task.completed_at = datetime.utcnow()
        session.add(task)
        await _mirror_task_message(
            session,
            task,
            kind="status_update",
            body="Task failed: no active agent available.",
            metadata={"reason": "no_agent"},
        )
        await session.commit()

        from app.services.ops_alerts import alert_run_failure

        await alert_run_failure(
            session,
            tenant_id,
            subject=task.title or "agent task",
            error="No active agent available",
            task_id=task.id,
        )
        return {"failed": True, "reason": "no_agent"}

    # Workflow wakes (project queue analysis/verify) carry their run
    # instructions in context so the task description stays the original request.
    prompt = str(ctx.get("instructions") or "") or task.description or task.title

    try:
        run, text = await _execute_agent_segment(
            session,
            tenant_id,
            task,
            agent,
            prompt=prompt,
            segment_index=segment_index,
        )
    except Exception as exc:  # noqa: BLE001 - never leave the task stuck on "running"
        await session.rollback()
        task = (
            await session.execute(
                select(AgentTask).where(AgentTask.id == task_id, AgentTask.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if task is not None:
            task.status = "failed"
            task.completed_at = datetime.utcnow()
            session.add(task)
            await _mirror_task_message(
                session,
                task,
                kind="status_update",
                body=f"Task failed while executing: {exc}",
                agent_id=agent.id if agent else None,
                metadata={"reason": "agent_error"},
            )
            await session.commit()

            from app.services.ops_alerts import alert_run_failure

            await alert_run_failure(
                session,
                tenant_id,
                subject=task.title or "agent task",
                error=exc,
                task_id=task.id,
            )
        return {"failed": True, "reason": "agent_error"}

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

    if task.success_criteria_json and task.success_criteria_json.strip() not in ("", "{}"):
        checkpoint = await run_eval_checkpoint(
            session,
            tenant_id,
            agent_task_id=task.id,
            run_id=run.id,
            step_id=None,
            eval_kind="rubric",
            criteria_json=task.success_criteria_json,
            output_text=text,
            context=ctx,
            retry_count=int(ctx.get("retry_count") or 0),
        )
        await log_run_event(
            session,
            run,
            "eval_result",
            "Evaluation passed" if checkpoint.passed else "Evaluation failed",
            {"passed": checkpoint.passed, "eval_kind": "rubric"},
        )
        if not checkpoint.passed:
            retries = int(ctx.get("retry_count") or 0)
            if retries < 2:
                ctx["retry_count"] = retries + 1
                task.context_json = json.dumps(ctx)
                session.add(task)
                await session.commit()
                if not await enqueue_agent_task_segment(str(tenant_id), str(task.id)):
                    return await run_agent_task_segment(session, tenant_id, task_id)
                return {"retry": True, "retry_count": retries + 1}

            task.status = "failed"
            task.completed_at = datetime.utcnow()
            session.add(task)
            await _mirror_task_message(
                session,
                task,
                kind="status_update",
                body="Task evaluation failed after retries.",
                agent_id=agent.id if agent else None,
                metadata={"reason": "eval_failed"},
            )
            await session.commit()

            from app.services.ops_alerts import alert_run_failure

            await alert_run_failure(
                session,
                tenant_id,
                subject=task.title or "agent task",
                error="Task evaluation failed after retries",
                task_id=task.id,
            )
            return {"failed": True, "reason": "eval_failed"}

    if ctx.get("workflow"):
        # Workflow task: the agent moves the status via tools during the run
        # (planned / verifying / completed). Only apply the fallback when the
        # agent left the task in the transient "running" state.
        if task.status == "running":
            task.status = str(ctx.get("workflow_fallback_status") or "planned")
        if task.status == "completed" and task.completed_at is None:
            task.completed_at = datetime.utcnow()
        task.updated_at = datetime.utcnow()
        session.add(task)
        await session.commit()
        return {"completed": True, "run_id": str(run.id), "workflow_status": task.status}

    task.status = "completed"
    task.completed_at = datetime.utcnow()
    task.updated_at = datetime.utcnow()
    session.add(task)
    await _mirror_task_message(
        session,
        task,
        kind="task_result",
        body=f"Task completed: {task.title}",
        agent_id=agent.id if agent else None,
        metadata={"run_id": str(run.id), "status": "completed"},
    )
    await session.commit()
    return {"completed": True, "run_id": str(run.id)}
