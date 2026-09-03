"""Domain event publishers. Fire-and-forget: never break business logic."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.gateway.bus import event_bus

if TYPE_CHECKING:
    from app.models.notification import DecisionRequest
    from app.models.signal import Signal, SignalMessage

logger = logging.getLogger(__name__)

# Message kinds that must never reach widget (visitor) connections.
_OPERATOR_ONLY_KINDS = frozenset({"internal_note", "system_event"})


async def _safe_publish(tenant_id: Any, topics: list[str], event: str, data: dict[str, Any]) -> None:
    try:
        await event_bus.publish(tenant_id, topics, event, data)
    except Exception:
        logger.exception("gateway publish failed: %s", event)


def _thread_row(signal: "Signal") -> dict[str, Any]:
    """Canonical thread row — the same shape the REST list endpoint returns,
    so clients can upsert it directly without a follow-up fetch.

    `is_pinned` is per-user state and stays False here; the dashboard joins
    pins client-side. Agent enrichment is skipped (would need a DB read);
    clients keep the previous row's agent fields on upsert when absent.
    """
    from app.services.signal_threads import serialize_thread

    return serialize_thread(signal)


async def publish_message_delta(
    tenant_id: Any,
    signal_id: Any,
    *,
    delta: str,
    stream_id: str | None = None,
) -> None:
    """Streaming token delta for an in-progress agent reply."""
    await _safe_publish(
        tenant_id,
        [f"signal:{signal_id}"],
        "message.delta",
        {
            "signal_id": str(signal_id),
            "delta": delta,
            "stream_id": stream_id,
        },
    )


async def publish_agent_step(
    tenant_id: Any,
    signal_id: Any,
    *,
    step_type: str,
    name: str = "",
    payload: dict[str, Any] | None = None,
    stream_id: str | None = None,
) -> None:
    """Agent tool call, tool result, or thinking step during a reply."""
    await _safe_publish(
        tenant_id,
        [f"signal:{signal_id}"],
        "agent.step",
        {
            "signal_id": str(signal_id),
            "step_type": step_type,
            "name": name,
            "payload": payload or {},
            "stream_id": stream_id,
        },
    )


async def publish_agent_thinking(
    tenant_id: Any,
    signal_id: Any,
    *,
    delta: str,
    stream_id: str | None = None,
) -> None:
    """Streaming reasoning/thinking delta for an in-progress agent reply."""
    if not delta:
        return
    await _safe_publish(
        tenant_id,
        [f"signal:{signal_id}"],
        "agent.thinking",
        {
            "signal_id": str(signal_id),
            "delta": delta,
            "stream_id": stream_id,
        },
    )


async def publish_signal_message(
    signal: "Signal",
    message: "SignalMessage",
    *,
    decision: "DecisionRequest | None" = None,
) -> None:
    """A message was appended to a thread (any channel, any author).

    Two envelopes so the operator firehose stays light while open threads
    get everything they need to append without a refetch:

    - ``threads`` topic (operator-only): full thread row + message preview.
    - ``signal:{id}`` topic: full serialized message (html, attachments,
      decision options). Internal notes / system events are operator-only.
    """
    from app.services.signal_threads import serialize_message

    thread_row = _thread_row(signal)
    preview = {
        "id": str(message.id),
        "signal_id": str(signal.id),
        "kind": message.kind,
        "direction": message.direction,
        "role": message.role,
        "body_preview": message.body_preview or (message.body_text or "")[:200],
        "decision_id": str(message.decision_id) if message.decision_id else None,
        "created_at": message.created_at.isoformat(),
    }
    await _safe_publish(
        signal.tenant_id,
        ["threads"],
        "message",
        {"audience": "operator", "thread": thread_row, "message": preview},
    )
    await _safe_publish(
        signal.tenant_id,
        [f"signal:{signal.id}"],
        "message",
        {
            "audience": "operator" if message.kind in _OPERATOR_ONLY_KINDS else "all",
            "thread": thread_row,
            "message": serialize_message(message, decision=decision),
        },
    )
    from app.services.push import schedule_notify_thread_message

    schedule_notify_thread_message(signal.id, message.id)


async def publish_thread_update(signal: "Signal") -> None:
    """Thread metadata changed (status, assignment, triage, read state).

    Operator-only: the widget render pipeline only consumes ``message``
    events, and the full row carries internal state (tags, assignee,
    ai_paused) that visitors must not receive. Widget conversations get a
    separate minimal ``conversation`` event (status only) so the visitor UI
    can react to close/reopen, e.g. by showing the CSAT prompt.
    """
    await _safe_publish(
        signal.tenant_id,
        ["threads", f"signal:{signal.id}"],
        "thread",
        {"audience": "operator", "thread": _thread_row(signal)},
    )
    if signal.channel == "widget":
        await _safe_publish(
            signal.tenant_id,
            [f"signal:{signal.id}"],
            "conversation",
            {
                "audience": "all",
                "signal_id": str(signal.id),
                "status": signal.status,
                # Visitor-safe takeover flag: the widget shows/hides its
                # "team member is handling this" banner live on this bit.
                "ai_paused": bool(signal.ai_paused),
            },
        )


async def publish_run_event(
    tenant_id: Any,
    run_id: Any,
    *,
    event_type: str,
    message: str = "",
    payload: dict[str, Any] | None = None,
    sequence: int = 0,
    status: str | None = None,
) -> None:
    """An AgentRun produced a log event or changed status."""
    await _safe_publish(
        tenant_id,
        ["runs", f"run:{run_id}"],
        "agent.run",
        {
            "run_id": str(run_id),
            "type": event_type,
            "message": message,
            "payload": payload or {},
            "sequence": sequence,
            "status": status,
        },
    )


async def publish_decision(
    tenant_id: Any,
    *,
    decision_id: Any,
    status: str,
    title: str = "",
    signal_id: Any | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """A DecisionRequest was created or resolved."""
    topics = ["decisions", "threads"]
    if signal_id:
        topics.append(f"signal:{signal_id}")
    await _safe_publish(
        tenant_id,
        topics,
        "decision",
        {
            "decision_id": str(decision_id),
            "status": status,
            "title": title,
            "signal_id": str(signal_id) if signal_id else None,
            "payload": payload or {},
        },
    )
    if status == "awaiting_human":
        from app.services.channel_registry import is_parked_channel
        from app.services.push import schedule_notify_decision

        schedule_notify_decision(decision_id, signal_id=signal_id)
        if not is_parked_channel("slack"):
            from app.services.slack_notify import schedule_notify_decision_slack

            schedule_notify_decision_slack(decision_id, signal_id=signal_id)


async def publish_notification(tenant_id: Any, *, notification_id: Any, kind: str, title: str) -> None:
    await _safe_publish(
        tenant_id,
        ["notifications"],
        "notification",
        {"notification_id": str(notification_id), "kind": kind, "title": title},
    )


async def publish_presence(tenant_id: Any, *, user_id: UUID | None, device: str, online: bool) -> None:
    await _safe_publish(
        tenant_id,
        ["presence"],
        "presence",
        {"user_id": str(user_id) if user_id else None, "device": device, "online": online},
    )
