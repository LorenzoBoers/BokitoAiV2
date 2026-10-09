"""Publish ``entity.changed`` for every committed write on tracked models.

One session hook instead of a publish call in every writer: whatever code
path creates, updates or deletes a trigger, ticket, tag, project, agent, module
source, calendar event, bin entry, playbook run or team, operators see it
live. A team membership change publishes as an update of its team.

Rows changed in one commit are coalesced per ``(entity, id)``. Calendar sync
can touch hundreds of events, so calendar collapses to one tenant-level event.
Agent runtime churn (status, current activity) already streams as
``agent.status`` and is not repeated here.

New ``SignalMessage`` rows also enqueue a post-commit ``publish_signal_message``
so writers that forget an explicit publish still reach the gateway. Clients
upsert by message id, so an explicit publish plus this safety net is harmless.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_PENDING_KEY = "bokito_entity_events"
_HINTS_KEY = "bokito_entity_hints"
_PENDING_MESSAGES_KEY = "bokito_pending_messages"

_AGENT_RUNTIME_FIELDS = frozenset(
    {
        "runtime_status",
        "current_activity_id",
        "current_activity_summary",
        "current_session_id",
        "current_signal_id",
        "last_active_at",
        "updated_at",
    }
)


def _entity_of(obj: Any) -> str | None:
    from app.models.agent import Agent
    from app.models.calendar import CalendarEvent
    from app.models.module_source import ModuleSource
    from app.models.orchestra import WorkstreamProject, WorkstreamRun
    from app.models.project import Project
    from app.models.signal import Signal, SignalTag
    from app.models.team import Team, TeamMember
    from app.models.trash import TrashEntry
    from app.models.trigger import Trigger

    mapping: tuple[tuple[type, str], ...] = (
        (Trigger, "trigger"),
        (SignalTag, "tag"),
        (Project, "project"),
        (WorkstreamProject, "project"),
        (Agent, "agent"),
        (ModuleSource, "module_source"),
        (CalendarEvent, "calendar"),
        (TrashEntry, "trash"),
        (WorkstreamRun, "workstream_run"),
        (Team, "team"),
        (TeamMember, "team"),
    )
    if isinstance(obj, Signal):
        return "ticket" if _ticket_change(obj) else None
    for cls, name in mapping:
        if isinstance(obj, cls):
            return name
    return None


def _ticket_change(obj: Any) -> bool:
    state = inspect(obj)
    if state.pending:
        return getattr(obj, "ticket_tag_id", None) is not None
    return any(
        state.attrs[key].history.has_changes()
        for key in ("ticket_tag_id", "ticket_status", "stage_key", "project_id")
    )


def _only_runtime_change(obj: Any) -> bool:
    state = inspect(obj)
    changed = {attr.key for attr in state.attrs if attr.history.has_changes()}
    return bool(changed) and changed <= _AGENT_RUNTIME_FIELDS


def _record(session: Session, obj: Any, op: str) -> None:
    entity = _entity_of(obj)
    if entity is None:
        return
    tenant_id = getattr(obj, "tenant_id", None)
    if tenant_id is None:
        return
    if entity == "agent" and op == "updated" and _only_runtime_change(obj):
        return
    if op == "updated" and getattr(obj, "deleted_at", None) is not None:
        op = "deleted"
    team_id = getattr(obj, "team_id", None) if entity == "team" else None
    # A playbook attached to or detached from a project changes that project's board.
    board_project_id = getattr(obj, "workstream_id", None) and getattr(obj, "project_id", None)
    if entity == "ticket":
        op = "updated"
    if team_id is not None:
        op = "updated"
        key_id: str | None = str(team_id)
    elif entity == "project" and board_project_id:
        op = "updated"
        key_id = str(board_project_id)
    elif entity == "calendar":
        key_id = None
    else:
        key_id = str(getattr(obj, "id", "") or "")
    pending: dict[tuple[str, str, str | None], str] = session.info.setdefault(_PENDING_KEY, {})
    if entity == "ticket":
        # The conversation list refreshes the row whose category or stage changed.
        hints: dict[str, dict[str, Any]] = session.info.setdefault(_HINTS_KEY, {})
        hints[key_id or ""] = {"signal_id": key_id or ""}
    current = pending.get((str(tenant_id), entity, key_id))
    if current in ("created", "deleted"):
        return
    pending[(str(tenant_id), entity, key_id)] = op


def _record_message(session: Session, obj: Any) -> None:
    from app.models.signal import SignalMessage

    if not isinstance(obj, SignalMessage):
        return
    message_id = getattr(obj, "id", None)
    signal_id = getattr(obj, "signal_id", None)
    tenant_id = getattr(obj, "tenant_id", None)
    if not message_id or not signal_id or tenant_id is None:
        return
    pending: set[tuple[str, str, str]] = session.info.setdefault(_PENDING_MESSAGES_KEY, set())
    pending.add((str(tenant_id), str(signal_id), str(message_id)))


@event.listens_for(Session, "after_flush")
def _collect(session: Session, flush_context: Any) -> None:  # noqa: ARG001
    try:
        for obj in session.new:
            _record(session, obj, "created")
            _record_message(session, obj)
        for obj in session.dirty:
            if session.is_modified(obj, include_collections=False):
                _record(session, obj, "updated")
        for obj in session.deleted:
            _record(session, obj, "deleted")
    except Exception:  # noqa: BLE001 — live events never break a write
        logger.exception("entity event collection failed")


@event.listens_for(Session, "after_commit")
def _flush_events(session: Session) -> None:
    pending: dict[tuple[str, str, str | None], str] = session.info.pop(_PENDING_KEY, {}) or {}
    hints: dict[str, dict[str, Any]] = session.info.pop(_HINTS_KEY, {}) or {}
    pending_messages: set[tuple[str, str, str]] = session.info.pop(_PENDING_MESSAGES_KEY, set()) or set()
    if not pending and not pending_messages:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    from app.gateway.publish import publish_entity

    signal_ids: set[str] = set()
    for (tenant_id, entity, entity_id), op in pending.items():
        row = hints.get(entity_id or "") if entity == "ticket" else None
        loop.create_task(publish_entity(tenant_id, entity=entity, id=entity_id, op=op, row=row))
        if row and row.get("signal_id"):
            signal_ids.add(row["signal_id"])
    # Safety-net publishes open the process-global session factory. Pytest uses
    # a different SQLite memory DB than that factory, so lookups miss — and
    # thousands of no-op tasks stall the suite. conftest sets this to "0";
    # production leaves it unset (enabled).
    import os

    if os.environ.get("BOKITO_ENTITY_PUBLISH_SAFETY_NET", "1") == "0":
        return
    for signal_id in signal_ids:
        loop.create_task(_publish_thread_row(signal_id))
    for tenant_id, signal_id, message_id in pending_messages:
        loop.create_task(_publish_new_message(tenant_id, signal_id, message_id))


async def _publish_thread_row(signal_id: str) -> None:
    """The conversation row carries the category and stage: push it again."""
    from uuid import UUID

    from app.db.session import async_session_factory
    from app.gateway.publish import publish_thread_update
    from app.models.signal import Signal

    try:
        async with async_session_factory() as session:
            signal = await session.get(Signal, UUID(signal_id))
        if signal is not None:
            await publish_thread_update(signal)
    except Exception:  # noqa: BLE001 — live events never break a write
        logger.exception("thread row publish failed for %s", signal_id)


async def _publish_new_message(tenant_id: str, signal_id: str, message_id: str) -> None:
    """Safety net: a committed SignalMessage always reaches the gateway."""
    from uuid import UUID

    from app.db.session import async_session_factory
    from app.gateway.publish import publish_signal_message
    from app.models.signal import Signal, SignalMessage

    try:
        async with async_session_factory() as session:
            signal = await session.get(Signal, UUID(signal_id))
            message = await session.get(SignalMessage, UUID(message_id))
        if (
            signal is not None
            and message is not None
            and str(signal.tenant_id) == tenant_id
            and str(message.signal_id) == signal_id
        ):
            await publish_signal_message(signal, message)
    except Exception:  # noqa: BLE001 — live events never break a write
        logger.exception("signal message publish failed for %s", message_id)


@event.listens_for(Session, "after_rollback")
def _drop_events(session: Session) -> None:
    session.info.pop(_PENDING_KEY, None)
    session.info.pop(_HINTS_KEY, None)
    session.info.pop(_PENDING_MESSAGES_KEY, None)


def install() -> None:
    """Listeners register on import; calling this keeps the import explicit."""
