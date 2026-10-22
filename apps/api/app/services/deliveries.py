"""Delivered: where the work from a conversation ended up.

One ``SignalEvent`` with ``event_type='delivered'`` per result: a reply sent
on a channel, an item in a folder's Works in (connection, canvas, board), a
write through a connection no folder holds, the folder itself, or knowledge
the agents read. The payload carries the labels and link the timeline chip and
Why draw; clients do not look anything up.

``record_delivery`` dedupes on (signal, target_kind, works_in_key, ref).

``settle_outcome`` sums one closed episode into one ``outcome`` event and
``Signal.outcome_json``: what kind of result, where it landed, which flow, and
how autonomous it was. Closing is done; an outcome without a known
destination is still an outcome.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.signal import SignalEvent

DELIVERED = "delivered"
TARGET_REPLY = "reply"
TARGET_FOLDER = "folder"
TARGET_WORKS_IN = "works_in"
TARGET_KNOWLEDGE = "knowledge"
TARGETS = (TARGET_REPLY, TARGET_FOLDER, TARGET_WORKS_IN, TARGET_KNOWLEDGE)
# Works in key for a write through a connection no folder holds.
CONNECTION_KEY_PREFIX = "connection:"

# Every write through a connection ends in ``record_connection_write``:
# module verbs ({slug}_{verb}) in the tool executor, and these approved
# decision actions in the decision resolver. Proposing tools write nothing.
APPROVED_CONNECTION_WRITES = {
    "calendar_propose_event": "calendar_create_event",
    "calendar_propose_update": "calendar_update_event",
}
# Tools that take a connection id but only change Bokito's own settings.
CONNECTION_SETTINGS_TOOLS = frozenset({"set_module_default_connection", "set_connection_scope"})


def _payload(row: SignalEvent) -> dict[str, Any]:
    try:
        data = json.loads(row.payload_json or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


async def list_deliveries(session: AsyncSession, signal_id: UUID, *, limit: int = 50) -> list[dict[str, Any]]:
    """Deliveries on one conversation, newest first."""
    rows = (
        await session.execute(
            select(SignalEvent)
            .where(SignalEvent.signal_id == signal_id, SignalEvent.event_type == DELIVERED)
            .order_by(SignalEvent.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [{**_payload(row), "at": row.created_at.isoformat() + "Z"} for row in rows]


async def record_delivery(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID | None,
    *,
    target_kind: str,
    folder_id: UUID | None = None,
    works_in_key: str = "",
    ref: str = "",
    agent_id: UUID | None = None,
    user_id: UUID | None = None,
    flow_id: UUID | None = None,
    channel: str = "",
    title: str = "",
    href: str | None = None,
    connection_id: UUID | None = None,
    provider: str = "",
) -> SignalEvent | None:
    """Add one ``delivered`` event (flushed, not committed). Returns None on a duplicate."""
    if signal_id is None or target_kind not in TARGETS:
        return None
    existing = (
        await session.execute(
            select(SignalEvent)
            .where(SignalEvent.signal_id == signal_id, SignalEvent.event_type == DELIVERED)
            .order_by(SignalEvent.created_at.desc())
            .limit(200)
        )
    ).scalars().all()
    for row in existing:
        data = _payload(row)
        if (
            data.get("target_kind") == target_kind
            and (data.get("works_in_key") or "") == works_in_key
            and (data.get("ref") or "") == ref
        ):
            return None

    payload: dict[str, Any] = {"target_kind": target_kind, "works_in_key": works_in_key, "ref": ref}
    item_type, _, item_id = works_in_key.partition(":")
    if item_type in ("resource", "canvas") and item_id:
        payload[f"{item_type}_id"] = item_id
    if channel:
        payload["channel"] = channel
    if title:
        payload["title"] = title
    if connection_id:
        payload["connection_id"] = str(connection_id)
    if provider:
        payload["provider"] = provider
    if flow_id:
        payload["flow_id"] = str(flow_id)
    if agent_id:
        payload["agent_id"] = str(agent_id)
    if user_id:
        payload["user_id"] = str(user_id)
    if folder_id:
        from app.services.works_in import folder_href, item_for_key

        folder = await session.get(Project, folder_id)
        if folder is None or folder.tenant_id != tenant_id or folder.deleted_at is not None:
            return None
        payload["folder_id"] = str(folder.id)
        payload["folder_name"] = folder.name
        payload["href"] = folder_href(folder.id)
        if works_in_key:
            item = await item_for_key(session, tenant_id, folder.id, works_in_key)
            if item is None:
                return None
            payload["item_kind"] = item["kind"]
            payload["item_label"] = item["label"]
            if item.get("canvas_kind"):
                payload["canvas_kind"] = item["canvas_kind"]
            payload["href"] = item["href"] or payload["href"]
    if href:
        payload["href"] = href

    if agent_id:
        actor_type, actor_id = "agent", str(agent_id)
    elif user_id:
        actor_type, actor_id = "user", str(user_id)
    else:
        actor_type, actor_id = "system", ""
    row = SignalEvent(
        signal_id=signal_id,
        tenant_id=tenant_id,
        event_type=DELIVERED,
        actor_type=actor_type,
        actor_id=actor_id,
        payload_json=json.dumps(payload),
    )
    session.add(row)
    await session.flush()
    return row


async def flow_destination(session: AsyncSession, ws: Any) -> dict[str, Any] | None:
    """The flow's "Delivers to" with display labels, or None when unset or gone."""
    from app.services.works_in import folder_href, item_for_key

    if not getattr(ws, "deliver_folder_id", None):
        return None
    folder = await session.get(Project, ws.deliver_folder_id)
    if folder is None or folder.tenant_id != ws.tenant_id or folder.deleted_at is not None:
        return None
    out: dict[str, Any] = {
        "folder_id": str(folder.id),
        "folder_name": folder.name,
        "works_in_key": "",
        "item_kind": "",
        "item_label": "",
        "href": folder_href(folder.id),
    }
    key = ws.deliver_works_in_key or ""
    if key:
        item = await item_for_key(session, ws.tenant_id, folder.id, key)
        if item is not None:
            out.update(works_in_key=key, item_kind=item["kind"], item_label=item["label"], href=item["href"] or out["href"])
    return out


async def validate_flow_destination(
    session: AsyncSession, tenant_id: UUID, folder_id: UUID, works_in_key: str
) -> None:
    """422 unless the folder is alive in this workspace and holds that Works in key."""
    from fastapi import HTTPException

    from app.services.works_in import item_for_key

    folder = await session.get(Project, folder_id)
    if folder is None or folder.tenant_id != tenant_id or folder.deleted_at is not None:
        raise HTTPException(status_code=422, detail="Unknown folder for Delivers to")
    if works_in_key and await item_for_key(session, tenant_id, folder.id, works_in_key) is None:
        raise HTTPException(status_code=422, detail="That Works in item is not in this folder")


async def deliver_flow_ticket(
    session: AsyncSession, signal: Any, ws: Any, *, actor_type: str = "system", actor_id: str = ""
) -> SignalEvent | None:
    """A ticket reached a done stage: deliver to the flow's destination once.

    Skipped when the conversation already delivered into a folder; replies and
    kept corrections do not count.
    """
    if ws is None or not getattr(ws, "deliver_folder_id", None):
        return None
    rows = (
        await session.execute(
            select(SignalEvent).where(SignalEvent.signal_id == signal.id, SignalEvent.event_type == DELIVERED)
        )
    ).scalars().all()
    if any(_payload(row).get("target_kind") in (TARGET_FOLDER, TARGET_WORKS_IN) for row in rows):
        return None
    agent_id = user_id = None
    try:
        if actor_type == "agent" and actor_id:
            agent_id = UUID(actor_id)
        elif actor_type == "user" and actor_id:
            user_id = UUID(actor_id)
    except ValueError:
        pass
    key = ws.deliver_works_in_key or ""
    return await record_delivery(
        session,
        signal.tenant_id,
        signal.id,
        target_kind=TARGET_WORKS_IN if key else TARGET_FOLDER,
        folder_id=ws.deliver_folder_id,
        works_in_key=key,
        ref=f"flow:{ws.id}",
        agent_id=agent_id,
        user_id=user_id,
        flow_id=ws.id,
    )


def _result_ref(result: dict[str, Any]) -> str:
    for source in (result, result.get("result"), result.get("data")):
        if not isinstance(source, dict):
            continue
        for key in ("external_ref", "ref", "url", "id"):
            value = source.get(key)
            if isinstance(value, (str, int)) and str(value).strip():
                return str(value).strip()[:255]
    return ""


async def record_connection_write(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID | None,
    *,
    tool_name: str,
    tool_input: dict[str, Any],
    result: dict[str, Any],
    agent_id: UUID | None = None,
    user_id: UUID | None = None,
) -> SignalEvent | None:
    """A tool wrote through a connection: the connection and its ref are the destination.

    A folder that holds the connection in its Works in adds that context; without
    one the delivery still counts, keyed on the connection.
    """
    from app.models.integration import IntegrationConnection
    from app.services.works_in import resource_for_connection, resource_key

    raw = str(tool_input.get("connection_id") or result.get("connection_id") or "").strip()
    try:
        connection_id = UUID(raw)
    except ValueError:
        return None
    connection = await session.get(IntegrationConnection, connection_id)
    if connection is None or connection.tenant_id != tenant_id:
        return None
    ref = _result_ref(result)
    resource = await resource_for_connection(session, tenant_id, connection_id, ref)
    if resource is None:
        return await record_delivery(
            session,
            tenant_id,
            signal_id,
            target_kind=TARGET_WORKS_IN,
            works_in_key=f"{CONNECTION_KEY_PREFIX}{connection_id}",
            ref=ref,
            agent_id=agent_id,
            user_id=user_id,
            title=connection.display_name or connection.provider,
            connection_id=connection_id,
            provider=connection.provider,
        )
    return await record_delivery(
        session,
        tenant_id,
        signal_id,
        target_kind=TARGET_WORKS_IN,
        folder_id=resource.project_id,
        works_in_key=resource_key(resource.id),
        ref=ref,
        agent_id=agent_id,
        user_id=user_id,
        connection_id=connection_id,
        provider=connection.provider,
    )


OUTCOME = "outcome"
# What the episode produced, strongest first.
OUTCOME_CHANGED = "changed"  # written through a connection
OUTCOME_RECORDED = "recorded"  # placed in a folder, Works in item or knowledge
OUTCOME_ANSWERED = "answered"  # a reply left on a channel
OUTCOME_HANDLED_EXTERNALLY = "handled_externally"
OUTCOME_NO_ACTION = "no_action"
OUTCOME_DONE = "done"  # closed, destination unknown
OUTCOME_KINDS = (
    OUTCOME_CHANGED,
    OUTCOME_RECORDED,
    OUTCOME_ANSWERED,
    OUTCOME_HANDLED_EXTERNALLY,
    OUTCOME_NO_ACTION,
    OUTCOME_DONE,
)
AUTONOMY_LEVELS = ("autonomous", "assisted", "manual")
# Events that do not reopen an episode on their own.
_PASSIVE_EVENTS = frozenset({OUTCOME, "thread_updated", "ticket_stage_changed", "read"})


def _destination(data: dict[str, Any]) -> dict[str, Any]:
    keys = ("target_kind", "channel", "folder_id", "folder_name", "item_kind", "item_label", "title",
            "connection_id", "provider", "ref", "href")
    return {key: data[key] for key in keys if data.get(key)}


def _outcome_kind(destinations: list[dict[str, Any]], *, handled: bool, no_reply: bool) -> str:
    kinds = {d.get("target_kind") for d in destinations}
    if any(d.get("connection_id") for d in destinations):
        return OUTCOME_CHANGED
    if kinds & {TARGET_WORKS_IN, TARGET_FOLDER, TARGET_KNOWLEDGE}:
        return OUTCOME_RECORDED
    if TARGET_REPLY in kinds:
        return OUTCOME_ANSWERED
    if handled:
        return OUTCOME_HANDLED_EXTERNALLY
    if no_reply:
        return OUTCOME_NO_ACTION
    return OUTCOME_DONE


async def settle_outcome(session: AsyncSession, signal: Any) -> dict[str, Any] | None:
    """Sum the episode that just closed into one ``outcome`` event (flushed, not committed).

    The episode runs from the previous outcome (or the start of the
    conversation) to now. A second close without new activity is a no-op.
    """
    from datetime import datetime

    from app.models.learning import Feedback
    from app.models.notification import DecisionRequest
    from app.models.signal import SignalMessage, SignalTag

    if signal is None or signal.status != "closed":
        return None
    now = datetime.utcnow()
    events = (
        await session.execute(
            select(SignalEvent)
            .where(SignalEvent.signal_id == signal.id)
            .order_by(SignalEvent.created_at.asc())
        )
    ).scalars().all()
    last_outcome = next((row for row in reversed(events) if row.event_type == OUTCOME), None)
    since = last_outcome.created_at if last_outcome else (signal.created_at or now)
    episode = [row for row in events if row.created_at >= since and row is not last_outcome]
    messages = (
        await session.execute(
            select(SignalMessage).where(SignalMessage.signal_id == signal.id, SignalMessage.created_at >= since)
        )
    ).scalars().all()
    if last_outcome is not None and not messages and all(row.event_type in _PASSIVE_EVENTS for row in episode):
        return None

    destinations: list[dict[str, Any]] = []
    agent_acted = human_acted = False
    handled = no_reply = False
    rule_id = None
    for row in episode:
        data = _payload(row)
        if row.event_type == "rule_applied":
            rule_id = data.get("rule_id") or rule_id
            agent_acted = True
            if data.get("delivery") == "auto_closed":
                no_reply = True
        elif row.event_type == DELIVERED:
            destinations.append(_destination(data))
            if data.get("agent_id"):
                agent_acted = True
            elif data.get("user_id") and data.get("target_kind") != TARGET_KNOWLEDGE:
                human_acted = True
        elif row.event_type == "handled_externally":
            handled = True
            if row.actor_type == "user":
                human_acted = True
            elif row.actor_type == "agent":
                agent_acted = True
        elif row.event_type == "no_reply_noted":
            no_reply = True
            if row.actor_type == "agent":
                agent_acted = True
    for message in messages:
        if message.direction != "outbound" or message.kind not in ("user_message", "agent_message"):
            continue
        if message.author_agent_id:
            agent_acted = True
        elif message.author_user_id:
            human_acted = True

    decisions = (
        await session.execute(
            select(DecisionRequest).where(DecisionRequest.signal_id == signal.id, DecisionRequest.created_at >= since)
        )
    ).scalars().all()
    rejected = sum(1 for d in decisions if d.status == "rejected")
    if decisions:
        agent_acted = True
    if any(d.resolved_by_user_id for d in decisions):
        human_acted = True
    corrections = 0
    decision_ids = [str(d.id) for d in decisions]
    if decision_ids:
        corrections = len(
            (
                await session.execute(
                    select(Feedback.id).where(
                        Feedback.tenant_id == signal.tenant_id,
                        Feedback.subject_type == "draft_edit",
                        Feedback.subject_id.in_(decision_ids),
                    )
                )
            ).all()
        )
    if corrections:
        human_acted = True
    # A customer asking for changes corrects the work; no person acted.
    corrections += sum(
        1 for row in episode if row.event_type == "client_verdict" and _payload(row).get("verdict") == "changes_requested"
    )

    if agent_acted and not human_acted:
        autonomy = "autonomous"
    elif agent_acted:
        autonomy = "assisted"
    else:
        autonomy = "manual"

    flow_id = None
    if signal.ticket_tag_id:
        tag = await session.get(SignalTag, signal.ticket_tag_id)
        if tag is not None and tag.workstream_id:
            flow_id = str(tag.workstream_id)

    outcome = {
        "kind": _outcome_kind(destinations, handled=handled, no_reply=no_reply),
        "destinations": destinations,
        "flow_id": flow_id,
        "label_id": str(signal.ticket_tag_id) if signal.ticket_tag_id else None,
        "autonomy_used": autonomy,
        "corrections": corrections,
        "rejected_decisions": rejected,
        "rule_id": rule_id,
        "duration_s": max(0, int((now - since).total_seconds())),
        "closed_at": now.isoformat() + "Z",
    }
    signal.outcome_json = json.dumps(outcome)
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type=OUTCOME,
            actor_type="system",
            actor_id="",
            payload_json=json.dumps(outcome),
        )
    )
    await session.flush()
    return outcome
