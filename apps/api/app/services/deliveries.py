"""Delivered: where the work from a conversation ended up.

One ``SignalEvent`` with ``event_type='delivered'`` per result: a reply sent
on a channel, an item in a folder's Works in (connection, canvas, board), the
folder itself, or knowledge the agents read. The payload carries the labels
and link the timeline chip and Why draw; clients do not look anything up.

``record_delivery`` dedupes on (signal, target_kind, works_in_key, ref).
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.signal import SignalEvent

logger = logging.getLogger(__name__)

DELIVERED = "delivered"
TARGET_REPLY = "reply"
TARGET_FOLDER = "folder"
TARGET_WORKS_IN = "works_in"
TARGET_KNOWLEDGE = "knowledge"
TARGETS = (TARGET_REPLY, TARGET_FOLDER, TARGET_WORKS_IN, TARGET_KNOWLEDGE)
ISSUE_CONNECTION_WITHOUT_FOLDER = "connection_without_folder"

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
    """A tool wrote through a connection: deliver into the folder that holds it.

    Without a folder for that connection there is no event; the workspace gets
    a ``connection_without_folder`` issue for the Grid instead.
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
        logger.warning("connection %s wrote (%s) without a folder", connection_id, tool_name)
        from app.services.audit import record_audit

        await record_audit(
            session,
            tenant_id,
            action=f"delivery:{ISSUE_CONNECTION_WITHOUT_FOLDER}",
            actor_type="agent" if agent_id else "system",
            actor_id=str(agent_id or ""),
            resource_type="connection",
            resource_id=str(connection_id),
            summary=f"{tool_name} wrote through {connection.display_name or connection.provider} without a folder",
            commit=False,
        )
        return None
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
    )
