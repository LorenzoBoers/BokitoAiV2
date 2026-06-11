"""Domain event publishers. Fire-and-forget: never break business logic."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.gateway.bus import event_bus

if TYPE_CHECKING:
    from app.models.signal import Signal, SignalMessage

logger = logging.getLogger(__name__)


async def _safe_publish(tenant_id: Any, topics: list[str], event: str, data: dict[str, Any]) -> None:
    try:
        await event_bus.publish(tenant_id, topics, event, data)
    except Exception:
        logger.exception("gateway publish failed: %s", event)


def _thread_summary(signal: "Signal") -> dict[str, Any]:
    return {
        "signal_id": str(signal.id),
        "channel": signal.channel,
        "subject": signal.subject,
        "status": signal.status,
        "has_unread": signal.has_unread,
        "assigned_user_id": str(signal.assigned_user_id) if signal.assigned_user_id else None,
        "owner_user_id": str(signal.owner_user_id) if signal.owner_user_id else None,
        "last_message_at": signal.last_message_at.isoformat() if signal.last_message_at else None,
    }


async def publish_signal_message(signal: "Signal", message: "SignalMessage") -> None:
    """A message was appended to a thread (any channel, any author)."""
    await _safe_publish(
        signal.tenant_id,
        ["threads", f"signal:{signal.id}"],
        "message",
        {
            "thread": _thread_summary(signal),
            "message": {
                "id": str(message.id),
                "signal_id": str(signal.id),
                "kind": message.kind,
                "direction": message.direction,
                "role": message.role,
                "body_text": message.body_text,
                "body_preview": message.body_preview,
                "decision_id": str(message.decision_id) if message.decision_id else None,
                "created_at": message.created_at.isoformat(),
            },
        },
    )


async def publish_thread_update(signal: "Signal") -> None:
    """Thread metadata changed (status, assignment, triage, read state)."""
    await _safe_publish(
        signal.tenant_id,
        ["threads", f"signal:{signal.id}"],
        "thread",
        {"thread": _thread_summary(signal)},
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
