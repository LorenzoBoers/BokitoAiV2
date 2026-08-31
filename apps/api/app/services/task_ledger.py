"""Lazy Task promotion: every run that performs real work lands in the ledger.

Plain chat Q&A stays Run-only. The moment an agent performs work — its first
mutating/gated tool call or any module tool call — the run is promoted to a
Task (``promote_run_to_task``), so Cockpit, Agenda, and Projects all read one
work spine. ``settle_run_task`` mirrors the run's terminal status back onto
promoted tasks when the run finishes.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import AgentRun
from app.models.orchestration import AgentTask

# Tools that are "just replying" or escalating — never work on their own.
# Module propose tools ({slug}_propose_*) DO count: proposing a booking is work.
_NON_WORK_TOOLS = frozenset(
    {
        "send_reply",
        "send_message",
        "create_decision_request",
        "handoff_to_human",
        "resolve_decision",
    }
)


def is_work_tool(name: str) -> bool:
    """True when calling this tool means the agent is performing real work."""
    if name in _NON_WORK_TOOLS:
        return False
    from app.modules.catalog import MODULE_TOOL_PREFIXES
    from app.tools.registry import get_tool_spec

    spec = get_tool_spec(name)
    if spec is None:
        return False
    if spec.mutating or spec.gated:
        return True
    return any(name.startswith(prefix) for prefix in MODULE_TOOL_PREFIXES.values())


def _run_origin(run: AgentRun, trust: str = "operator") -> str:
    trigger_type = str(run.trigger_type or "")
    if trigger_type.startswith("trigger"):
        return "trigger"
    if trust == "external" or trigger_type == "inbound":
        return "inbound"
    return "chat"


async def promote_run_to_task(
    session: AsyncSession,
    run: AgentRun,
    *,
    title: str = "",
    trust: str = "operator",
    signal_id: Any = None,
    first_tool: str = "",
) -> AgentTask:
    """Attach a ledger Task to a run that just started performing work.

    Idempotent: returns the existing task when the run already carries one.
    """
    if run.task_id is not None:
        existing = await session.get(AgentTask, run.task_id)
        if existing is not None:
            return existing

    task = AgentTask(
        tenant_id=run.tenant_id,
        signal_id=signal_id,
        kind="job",
        title=(title or run.subject or "Agent work")[:200],
        description="",
        status="running",
        origin=_run_origin(run, trust),
        assignee_kind="agent",
        assignee_agent_id=run.agent_id,
        trigger_type=run.trigger_type,
        trigger_id=run.trigger_id,
        context_json=json.dumps(
            {
                "promoted": True,
                "agent_id": str(run.agent_id),
                "run_id": str(run.id),
                "first_tool": first_tool,
            }
        ),
    )
    session.add(task)
    await session.flush()
    run.task_id = task.id
    session.add(run)
    await session.commit()
    await session.refresh(task)
    return task


async def settle_run_task(session: AsyncSession, run: AgentRun) -> None:
    """Mirror a finished run's status onto its promoted ledger Task.

    Only tasks created by promotion are settled here; orchestration-owned
    tasks (workstreams, queue intake) manage their own lifecycle in the runner.
    """
    if run.task_id is None or run.status == "running":
        return
    task = await session.get(AgentTask, run.task_id)
    if task is None:
        return
    try:
        promoted = bool(json.loads(task.context_json or "{}").get("promoted"))
    except (json.JSONDecodeError, AttributeError):
        promoted = False
    if not promoted or task.status not in ("running", "queued"):
        return
    task.status = "completed" if run.status == "completed" else run.status
    task.completed_at = run.completed_at or datetime.utcnow()
    task.updated_at = datetime.utcnow()
    session.add(task)
    await session.commit()
