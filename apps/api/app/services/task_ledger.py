"""Work promotion: real work stays on AgentRun (no shadow kind=job task).

Plain chat Q&A stays Run-only. The moment an agent performs work — its first
mutating/gated tool call or any module tool call — ``promote_run_to_task``
marks the run as work without minting an ``AgentTask``. Queue items
(``feature|bug|task|idea|risk``) and explicit orchestration creates still use
``AgentTask``. ``settle_run_task`` is a no-op for the retired promotion path.
"""

from __future__ import annotations

from app.core.time import utcnow

import json
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
        "propose_action",
        "attach_items",
        "list_tags",
        "handoff_to_human",
        "resolve_decision",
        "post_internal_note",
        "update_progress",
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
) -> AgentTask | None:
    """Mark a run as real work without creating a shadow ``kind=job`` task.

    Idempotent. Returns an existing linked task when one is already attached
    (queue / orchestration). Otherwise stamps work metadata on the run and
    returns ``None``.
    """
    if run.task_id is not None:
        existing = await session.get(AgentTask, run.task_id)
        if existing is not None:
            return existing

    try:
        snapshot = json.loads(run.result_json or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        snapshot = {}
    if not isinstance(snapshot, dict):
        snapshot = {}
    snapshot["work"] = {
        "promoted": True,
        "origin": _run_origin(run, trust),
        "title": (title or run.subject or "Agent work")[:200],
        "signal_id": str(signal_id) if signal_id else None,
        "first_tool": first_tool,
    }
    run.result_json = json.dumps(snapshot)
    session.add(run)
    await session.commit()
    return None


async def settle_run_task(session: AsyncSession, run: AgentRun) -> None:
    """Mirror a finished run onto a linked ledger Task when one exists.

    Promotion no longer creates tasks; this only settles orchestration/queue
    rows that still point at the run.
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
    # Legacy promoted job rows: leave them; new promotions do not create these.
    if promoted and task.kind == "job":
        return
    if task.status not in ("running", "queued"):
        return

    task.status = "completed" if run.status == "completed" else run.status
    task.completed_at = run.completed_at or utcnow()
    task.updated_at = utcnow()
    session.add(task)
    await session.commit()
