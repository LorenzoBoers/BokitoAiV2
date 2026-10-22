"""What an approved decision does.

Every action on a decision card is a platform tool: ``resolve_decision`` runs it
through ``execute_tool(approved=True)``, the same path an agent uses. Two kinds
of action are not tools and register here instead:

- record-only choices (``SOFT_ACTIONS``): the answer itself is the outcome;
- settlements that finish something the server started (a folder choice, a
  calendar write, a breaker reset). Their handler runs instead of a tool.

A handler registered with ``then_tool=True`` only prepares the payload; the tool
of the same name runs after it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import DecisionRequest

logger = logging.getLogger(__name__)

SOFT_ACTIONS = frozenset(
    {
        "reject",
        "defer",
        "draft",
        "escalate",
        "acknowledge",
        "approve",
        "human_takeover",
        "assign_me",
        "take_over",
        "setup_integration",
        "accept_platform_change",
        "session_checkout",
    }
)


@dataclass
class DecisionAction:
    session: AsyncSession
    tenant_id: UUID
    decision: DecisionRequest
    action_type: str
    payload: dict[str, Any]
    user_id: UUID | None


Handler = Callable[[DecisionAction], Awaitable[None]]
_HANDLERS: dict[str, tuple[Handler, bool]] = {}


def decision_action(*names: str, then_tool: bool = False) -> Callable[[Handler], Handler]:
    def register(fn: Handler) -> Handler:
        for name in names:
            _HANDLERS[name] = (fn, then_tool)
        return fn

    return register


def settles_without_tool(action_type: str) -> bool:
    entry = _HANDLERS.get(action_type)
    return action_type in SOFT_ACTIONS or (entry is not None and not entry[1])


async def run_decision_action(
    session: AsyncSession,
    tenant_id: UUID,
    decision: DecisionRequest,
    action_type: str,
    payload: dict[str, Any],
    *,
    user_id: UUID | None,
) -> bool:
    """Run the handler for ``action_type``. True when no tool should run after it."""
    entry = _HANDLERS.get(action_type)
    if entry is not None:
        await entry[0](DecisionAction(session, tenant_id, decision, action_type, payload, user_id))
    return settles_without_tool(action_type)


def _error(action: DecisionAction, exc: Exception):
    from app.services.notifications import DecisionActionError

    return DecisionActionError(action.action_type, str(exc))


async def _deliver_connection_write(action: DecisionAction, connection_id: str, result: Any) -> None:
    """An approved action wrote through a connection: record where it landed."""
    from app.services.deliveries import record_connection_write

    try:
        await record_connection_write(
            action.session,
            action.decision.tenant_id,
            action.decision.signal_id,
            tool_name=action.action_type,
            tool_input={"connection_id": connection_id},
            result=result if isinstance(result, dict) else {},
            user_id=action.user_id,
        )
    except Exception:
        logger.exception("delivery after %s failed", action.action_type)


def _when(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


@decision_action("file_ticket", then_tool=True)
async def _file_ticket(action: DecisionAction) -> None:
    action.payload.setdefault("certainty", 10)
    if not action.payload.get("summary") and action.decision.summary:
        action.payload["summary"] = action.decision.summary


@decision_action("file_in_folder")
async def _file_in_folder(action: DecisionAction) -> None:
    from app.services.folders import settle_folder_choice

    try:
        await settle_folder_choice(action.session, action.tenant_id, action.payload, user_id=action.user_id)
    except Exception as exc:
        raise _error(action, exc) from exc


@decision_action("activate_inbox_rule")
async def _activate_inbox_rule(action: DecisionAction) -> None:
    rule_raw = str(action.payload.get("rule_id") or "").strip()
    if not rule_raw:
        return
    from app.services.inbox_rules import update_rule

    try:
        await update_rule(action.session, action.tenant_id, UUID(rule_raw), status="active", user_id=action.user_id)
    except ValueError as exc:
        raise _error(action, exc) from exc


@decision_action("enable_module")
async def _enable_module(action: DecisionAction) -> None:
    slug = str(action.payload.get("module") or "").strip()
    if not slug:
        return
    from app.modules.catalog import set_module_enabled

    try:
        await set_module_enabled(action.session, action.tenant_id, slug, True, actor_id=action.user_id)
    except ValueError:
        pass


@decision_action("calendar_create_event")
async def _calendar_create_event(action: DecisionAction) -> None:
    from app.services.calendar_sync import create_external_event

    payload = action.payload
    conn_raw = str(payload.get("connection_id") or "").strip()
    title = str(payload.get("title") or "").strip()
    start_raw = str(payload.get("start_at") or "").strip()
    end_raw = str(payload.get("end_at") or "").strip()
    if not (conn_raw and title and start_raw and end_raw):
        return
    try:
        written = await create_external_event(
            action.session,
            action.tenant_id,
            connection_id=UUID(conn_raw),
            title=title,
            start_at=_when(start_raw),
            end_at=_when(end_raw),
            description=str(payload.get("description") or ""),
            location=str(payload.get("location") or ""),
            all_day=bool(payload.get("all_day")),
            calendar_id=str(payload.get("calendar_id") or "") or None,
        )
    except Exception as exc:
        raise _error(action, exc) from exc
    await _deliver_connection_write(action, conn_raw, written)


@decision_action("calendar_update_event")
async def _calendar_update_event(action: DecisionAction) -> None:
    from app.services.calendar_sync import event_connection, update_external_event

    payload = action.payload
    event_raw = str(payload.get("event_id") or "").strip()
    if not event_raw:
        return
    try:
        start_raw = str(payload.get("start_at") or "").strip()
        end_raw = str(payload.get("end_at") or "").strip()
        title = payload.get("title")
        written = await update_external_event(
            action.session,
            action.tenant_id,
            UUID(event_raw),
            title=str(title).strip() if title is not None else None,
            start_at=_when(start_raw) if start_raw else None,
            end_at=_when(end_raw) if end_raw else None,
            description=str(payload.get("description")) if "description" in payload else None,
            location=str(payload.get("location")) if "location" in payload else None,
            all_day=payload.get("all_day") if "all_day" in payload else None,
        )
    except Exception as exc:
        raise _error(action, exc) from exc
    _event, conn = await event_connection(action.session, action.tenant_id, UUID(event_raw))
    if conn is not None:
        await _deliver_connection_write(action, str(conn.id), written)


@decision_action("add_module_source")
async def _add_module_source(action: DecisionAction) -> None:
    slug = str(action.payload.get("module") or "").strip()
    url = str(action.payload.get("url") or "").strip()
    title = str(action.payload.get("title") or "").strip()
    if not (slug and url):
        return
    from app.services.module_sources import create_tenant_source, queue_source_index

    try:
        row = await create_tenant_source(action.session, action.tenant_id, slug, title=title or url, url=url)
        await queue_source_index(action.session, row)
    except ValueError:
        pass


@decision_action("orchestration_continue")
async def _orchestration_continue(action: DecisionAction) -> None:
    task_id_raw = action.payload.get("task_id")
    if not task_id_raw:
        return
    from app.services.orchestration.dispatcher import resume_agent_task

    await resume_agent_task(action.session, action.tenant_id, UUID(str(task_id_raw)))


@decision_action("workstream_continue", "workstream_retry", "workstream_skip_step", "workstream_cancel")
async def _retired_step_run(action: DecisionAction) -> None:
    """The step-run ledger is retired; old cards resolve without effect."""


@decision_action("reset_ai_breaker", "keep_ai_assisted")
async def _ai_breaker(action: DecisionAction) -> None:
    account_raw = action.payload.get("channel_account_id")
    if not account_raw:
        return
    from app.models.auth import Tenant
    from app.models.channel import ChannelAccount
    from app.services.ai_handling import reset_breaker

    account = await action.session.get(ChannelAccount, UUID(str(account_raw)))
    tenant = await action.session.get(Tenant, action.tenant_id)
    if account is None or account.tenant_id != action.tenant_id or tenant is None:
        return
    await reset_breaker(
        action.session,
        tenant,
        account,
        keep_assisted=action.action_type == "keep_ai_assisted",
        actor_id=str(action.user_id) if action.user_id else "",
    )


@decision_action("contact_link", "contact_create")
async def _contact(action: DecisionAction) -> None:
    from app.services.contact_identity import apply_decided_link

    if action.decision.signal_id and "signal_id" not in action.payload:
        action.payload["signal_id"] = str(action.decision.signal_id)
    try:
        await apply_decided_link(
            action.session, action.tenant_id, action.action_type, action.payload, user_id=action.user_id
        )
    except (ValueError, PermissionError) as exc:
        raise _error(action, exc) from exc
