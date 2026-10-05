"""One serializer for `AgentTask` rows: agent jobs and project queue items alike."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal

from app.models.orchestration import AgentTask

WorkItemView = Literal["summary", "job", "queue"]


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _json(raw: str | None) -> Any:
    try:
        return json.loads(raw or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}


def _sid(value: Any) -> str | None:
    return str(value) if value else None


def serialize_work_item(
    task: AgentTask,
    *,
    view: WorkItemView = "summary",
    links: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """``summary`` for lists and tools; ``job`` adds execution state; ``queue`` adds triage fields."""
    out: dict[str, Any] = {
        "id": str(task.id),
        "kind": task.kind,
        "title": task.title,
        "body": task.description,
        "status": task.status,
        "priority": task.priority,
        "origin_type": task.origin,
        "project_id": _sid(task.project_id),
        "signal_id": _sid(task.signal_id),
        "message_id": _sid(task.message_id),
        "assignee_kind": task.assignee_kind,
        "assigned_agent_id": _sid(task.assignee_agent_id),
        "assignee_user_id": _sid(task.assignee_user_id),
        "created_at": _iso(task.created_at),
        "updated_at": _iso(task.updated_at),
        "completed_at": _iso(task.completed_at),
    }
    if view == "job":
        out.update(
            {
                "pause_reason": task.pause_reason,
                "workstream_id": _sid(task.workstream_id),
                "current_step_id": _sid(task.current_step_id),
                "context": _json(task.context_json),
                "success_criteria": _json(task.success_criteria_json),
                "trigger_type": task.trigger_type,
                "scheduled_for": _iso(task.scheduled_for),
            }
        )
    elif view == "queue":
        out.update(
            {
                "duplicate_of_id": _sid(task.duplicate_of_id),
                "created_by_type": task.created_by_type,
                "created_by_id": task.created_by_id,
                "impact_summary": task.impact_summary,
                "analyzed_at": _iso(task.analyzed_at),
                "metadata": _json(task.metadata_json),
                "links": links or [],
            }
        )
    return out
