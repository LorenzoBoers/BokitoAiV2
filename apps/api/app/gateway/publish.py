"""Domain event publishers. Fire-and-forget: never break business logic."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.gateway.bus import event_bus

if TYPE_CHECKING:
    from app.models.notification import DecisionRequest, Notification
    from app.models.signal import Signal, SignalMessage

logger = logging.getLogger(__name__)

# Message kinds that must never reach widget (visitor) connections.
_OPERATOR_ONLY_KINDS = frozenset({"internal_note", "system_event"})


def _is_personal_helper_thread(signal: "Signal") -> bool:
    """In-app Bokito helper chats must not land on the Communication firehose."""
    from app.services.personal_assistant import PERSONAL_THREAD_SOURCE

    return (getattr(signal, "source", None) or "") == PERSONAL_THREAD_SOURCE


async def _safe_publish(tenant_id: Any, topics: list[str], event: str, data: dict[str, Any]) -> None:
    try:
        await event_bus.publish(tenant_id, topics, event, data)
    except Exception:
        logger.exception("gateway publish failed: %s", event)


def _thread_row(
    signal: "Signal",
    ai_handling: dict[str, Any] | None = None,
    extras: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Canonical thread row — the same shape the REST list endpoint returns,
    so clients can upsert it directly without a follow-up fetch.

    `is_pinned` is per-user state and stays False here; the dashboard joins
    pins client-side. Agent enrichment is skipped (would need a DB read);
    clients keep the previous row's agent, ai_handling, tags and category
    fields on upsert when absent.
    """
    from app.services.signal_threads import serialize_thread

    return serialize_thread(signal, ai_handling=ai_handling, **(extras or {}))


async def _row_extras(signal: "Signal") -> dict[str, Any]:
    """Tags and category for the live row, read in a short session."""
    try:
        from app.db.session import async_session_factory
        from app.services.signal_tags import signal_tag_names
        from app.services.ticket_stages import category_by_signal

        async with async_session_factory() as session:
            categories = await category_by_signal(session, signal.tenant_id, [signal.id])
            return {
                "tags": await signal_tag_names(session, signal.id),
                "category_case": categories.get(signal.id),
            }
    except Exception:  # noqa: BLE001 ? publishing never breaks business logic
        return {}


async def _handling_payload(signal: "Signal") -> dict[str, Any] | None:
    """Resolve AI handling in a short session; None when that is not possible."""
    try:
        from app.db.session import async_session_factory
        from app.models.auth import Tenant
        from app.services.ai_handling import load_layers, resolve_ai_handling

        async with async_session_factory() as session:
            tenant = await session.get(Tenant, signal.tenant_id)
            from app.models.agent import Agent

            account, contact = await load_layers(session, signal.tenant_id, signal)
            agent = await session.get(Agent, signal.agent_id) if signal.agent_id else None
            return resolve_ai_handling(tenant, account, contact, signal, agent=agent).to_payload()
    except Exception:  # noqa: BLE001 — publishing never breaks business logic
        return None


TURN_EVENTS = frozenset({"agent.turn", "agent.activity", "agent.thinking", "message.delta"})


async def publish_turn_event(
    tenant_id: Any,
    signal_id: Any,
    event: str,
    data: dict[str, Any],
) -> None:
    """Live agent turn: turn start/end, activity items, thinking and speech deltas.

    Shapes are documented in ``services/agent/turn.py``.
    """
    if event not in TURN_EVENTS:
        raise ValueError(f"Unknown turn event: {event}")
    await _safe_publish(
        tenant_id,
        [f"signal:{signal_id}"],
        event,
        {"signal_id": str(signal_id), **data},
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
    if not _is_personal_helper_thread(signal):
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


async def publish_thread_update(
    signal: "Signal",
    *,
    ai_handling: dict[str, Any] | None = None,
    tags: list[str] | None = None,
) -> None:
    """Thread metadata changed (status, assignment, triage, read state).

    Operator-only: the widget render pipeline only consumes ``message``
    events, and the full row carries internal state (tags, assignee,
    AI handling) that visitors must not receive. Widget conversations get a
    separate minimal ``conversation`` event (status only) so the visitor UI
    can react to close/reopen, e.g. by showing the CSAT prompt.

    Callers that publish before committing pass ``tags`` so the row does not
    carry the committed (old) tags.
    """
    if ai_handling is None:
        ai_handling = await _handling_payload(signal)
    extras = await _row_extras(signal)
    if tags is not None:
        extras["tags"] = tags
    topics = [f"signal:{signal.id}"]
    if not _is_personal_helper_thread(signal):
        topics.insert(0, "threads")
    await _safe_publish(
        signal.tenant_id,
        topics,
        "thread",
        {
            "audience": "operator",
            "thread": _thread_row(signal, ai_handling, extras),
        },
    )
    if signal.channel == "widget":
        from app.services.ai_handling import is_held

        effective = (ai_handling or {}).get("effective")
        await _safe_publish(
            signal.tenant_id,
            [f"signal:{signal.id}"],
            "conversation",
            {
                "audience": "all",
                "signal_id": str(signal.id),
                "status": signal.status,
                # Visitor-safe takeover flag (effective manual): the widget
                # shows/hides its "team member is handling this" banner on it.
                "ai_paused": is_held(signal) or effective == "manual",
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


async def publish_notification(notification: "Notification") -> None:
    """A notification row was created; push and email go through ``services/notify.py``.

    Carries the full bell row plus ``user_id`` so each client prepends only
    its own notices (``user_id`` null = everyone) without a refetch.
    """
    from app.services.notify import serialize_notification

    await _safe_publish(
        notification.tenant_id,
        ["notifications"],
        "notification",
        {
            "notification_id": str(notification.id),
            "kind": notification.kind,
            "title": notification.title,
            "tier": notification.tier or 2,
            "row": serialize_notification(notification),
        },
    )


async def publish_presence(
    tenant_id: Any,
    *,
    user_id: UUID | None,
    device: str,
    online: bool,
    status: str | None = None,
) -> None:
    await _safe_publish(
        tenant_id,
        ["presence"],
        "presence",
        {
            "user_id": str(user_id) if user_id else None,
            "device": device,
            "online": online,
            "status": status or ("available" if online else "offline"),
        },
    )


async def publish_agent_status(
    tenant_id: Any,
    *,
    agent_id: UUID,
    status: str,
    summary: str | None = None,
    thread_id: str | None = None,
    activity_id: str | None = None,
    last_active_at: int | None = None,
) -> None:
    """Broadcast live agent work: corner status plus what and where."""
    await _safe_publish(
        tenant_id,
        ["presence", "agents"],
        "agent.status",
        {
            "agent_id": str(agent_id),
            "status": status,
            "summary": (summary or "").strip() or None,
            "thread_id": thread_id,
            "activity_id": activity_id,
            "last_active_at": last_active_at,
        },
    )


ENTITY_KINDS = frozenset(
    {"trigger", "case", "project", "agent", "module_source", "calendar", "trash", "workstream_run", "team"}
)
ENTITY_OPS = frozenset({"created", "updated", "deleted"})


async def publish_entity(
    tenant_id: Any,
    *,
    entity: str,
    id: Any,
    op: str = "updated",
    row: dict[str, Any] | None = None,
) -> None:
    """A domain row changed. One event for every entity without its own
    stream, so the dashboard live store can patch or refetch instead of
    polling. ``row`` is the REST shape when cheap to build, else omitted."""
    if entity not in ENTITY_KINDS:
        raise ValueError(f"Unknown entity: {entity}")
    if op not in ENTITY_OPS:
        raise ValueError(f"Unknown entity op: {op}")
    await _safe_publish(
        tenant_id,
        ["entities"],
        "entity.changed",
        {"entity": entity, "id": str(id) if id is not None else None, "op": op, "row": row},
    )
