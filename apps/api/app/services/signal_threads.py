"""Signal thread service with inbox-parity for the unified Messages hub."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership, User
from app.models.email import EmailAccount
from app.models.inbox_threads import user_numeric_id
from app.models.notification import DecisionRequest
from app.models.signal import (
    EXTERNAL_CHANNELS,
    Signal,
    SignalEvent,
    SignalMessage,
    SignalThreadPin,
    is_internal_channel,
)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _user_uuid_from_num(session_users: dict[int, UUID], user_num: int | None) -> UUID | None:
    if user_num is None:
        return None
    return session_users.get(user_num)


async def _user_map(session: AsyncSession, tenant_id: UUID) -> dict[int, UUID]:
    result = await session.execute(
        select(User).join(Membership, Membership.user_id == User.id).where(Membership.tenant_id == tenant_id)
    )
    return {user_numeric_id(u.id): u.id for u in result.scalars().all()}


async def resolve_email_account_by_numeric_id(
    session: AsyncSession,
    tenant_id: UUID,
    numeric_id: int,
) -> UUID | None:
    result = await session.execute(select(EmailAccount).where(EmailAccount.tenant_id == tenant_id))
    for account in result.scalars().all():
        if user_numeric_id(account.id) == numeric_id:
            return account.id
    return None


def serialize_thread(
    signal: Signal,
    *,
    is_pinned: bool = False,
    user_num: int | None = None,
) -> dict[str, Any]:
    assignee_num = user_numeric_id(signal.assigned_user_id) if signal.assigned_user_id else None
    email_conn_id = user_numeric_id(signal.email_account_id) if signal.email_account_id else None
    folder = "internal" if is_internal_channel(signal.channel) else "external"
    return {
        "id": str(signal.id),
        "organisation_id": str(signal.tenant_id),
        "email_connection_id": email_conn_id,
        "connection_id": str(signal.connection_id) if signal.connection_id else None,
        "graph_conversation_id": signal.external_id or "",
        "email_subject": signal.subject,
        "contact_email": signal.contact_email,
        "contact_name": signal.contact_name,
        "contact_phone": signal.contact_phone,
        "status": signal.status,
        "priority": signal.priority,
        "assigned_to_user_id": assignee_num,
        "tags": json.loads(signal.tags_json or "[]"),
        "last_message_at": _iso(signal.last_message_at),
        "has_unread": signal.has_unread,
        "is_pinned": is_pinned,
        "channel": signal.channel,
        "folder": folder,
        "project_id": str(signal.project_id) if signal.project_id else None,
        "legacy_inbox_thread_id": signal.legacy_inbox_thread_id,
        "created_at": _iso(signal.created_at),
    }


def serialize_message(message: SignalMessage) -> dict[str, Any]:
    author_num = user_numeric_id(message.author_user_id) if message.author_user_id else None
    payload: dict[str, Any] = {}
    if message.decision_id:
        payload["decision_id"] = str(message.decision_id)
    if message.author_agent_id:
        payload["agent_id"] = str(message.author_agent_id)
    return {
        "id": str(message.id),
        "thread_id": str(message.signal_id),
        "signal_id": str(message.signal_id),
        "connection_id": None,
        "kind": message.kind,
        "direction": message.direction,
        "from_address": message.from_address,
        "to_addresses": message.to_addresses,
        "subject": message.subject,
        "body_preview": message.body_preview or message.body_text[:200],
        "body_text": message.body_text,
        "body_html": message.body_html or None,
        "graph_message_id": message.external_id,
        "in_reply_to": None,
        "author_user_id": author_num,
        "is_read": message.direction != "inbound",
        "send_status": message.send_status,
        "attachments": json.loads(message.attachments_json or "[]"),
        "decision_id": str(message.decision_id) if message.decision_id else None,
        "payload": payload,
        "received_at": _iso(message.received_at),
        "created_at": _iso(message.created_at),
    }


def serialize_event(event: SignalEvent, *, user_num_map: dict[UUID, int] | None = None) -> dict[str, Any]:
    actor_num = None
    if user_num_map and event.actor_id:
        try:
            actor_num = user_num_map.get(UUID(event.actor_id))
        except ValueError:
            actor_num = None
    return {
        "id": str(event.id),
        "thread_id": str(event.signal_id),
        "signal_id": str(event.signal_id),
        "event_type": event.event_type,
        "actor_user_id": actor_num,
        "payload": json.loads(event.payload_json or "{}"),
        "created_at": _iso(event.created_at),
    }


async def _pinned_ids(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> set[UUID]:
    result = await session.execute(
        select(SignalThreadPin.signal_id).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
        )
    )
    return {row for row in result.scalars().all()}


async def _signals_with_open_decisions(session: AsyncSession, tenant_id: UUID) -> set[UUID]:
    result = await session.execute(
        select(SignalMessage.signal_id)
        .join(DecisionRequest, DecisionRequest.id == SignalMessage.decision_id)
        .where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "decision_request",
            DecisionRequest.status == "awaiting_human",
        )
    )
    return {row for row in result.scalars().all()}


async def _signals_with_message_kind(session: AsyncSession, tenant_id: UUID, kind: str) -> set[UUID]:
    result = await session.execute(
        select(SignalMessage.signal_id.distinct()).where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == kind,
        )
    )
    return {row for row in result.scalars().all()}


async def _signals_with_outbound_messages(session: AsyncSession, tenant_id: UUID) -> set[UUID]:
    result = await session.execute(
        select(SignalMessage.signal_id.distinct()).where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.direction == "outbound",
        )
    )
    return {row for row in result.scalars().all()}


async def list_threads(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    *,
    view: str = "all_open",
    folder: str | None = None,
    search: str | None = None,
    assignee_id: int | None = None,
    tag: str | None = None,
    connection_id: str | None = None,
    email_connection_id: int | None = None,
    project_id: str | None = None,
    page: int = 1,
    per_page: int = 30,
) -> dict[str, Any]:
    pinned = await _pinned_ids(session, tenant_id, user_id)
    query = select(Signal).where(Signal.tenant_id == tenant_id)

    if folder == "external":
        query = query.where(Signal.channel.in_(EXTERNAL_CHANNELS))
    elif folder == "internal":
        query = query.where(Signal.channel == "internal")

    if project_id:
        try:
            query = query.where(Signal.project_id == UUID(project_id))
        except ValueError:
            return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}

    if view == "all_open":
        query = query.where(Signal.status == "open")
    elif view == "mine":
        query = query.where(Signal.status == "open", Signal.assigned_user_id == user_id)
    elif view == "unassigned":
        query = query.where(Signal.status == "open", Signal.assigned_user_id.is_(None))
    elif view == "pending":
        query = query.where(Signal.status == "pending")
    elif view == "closed":
        query = query.where(Signal.status == "closed")
    elif view == "spam":
        query = query.where(Signal.status == "spam")
    elif view == "pinned":
        if pinned:
            query = query.where(Signal.id.in_(pinned))
        else:
            query = query.where(Signal.id.is_(None))
    elif view == "awaiting_decision":
        open_dec = await _signals_with_open_decisions(session, tenant_id)
        if open_dec:
            query = query.where(Signal.id.in_(open_dec))
        else:
            query = query.where(Signal.id.is_(None))
    elif view == "updates":
        ids = await _signals_with_message_kind(session, tenant_id, "status_update")
        query = query.where(Signal.id.in_(ids) if ids else Signal.id.is_(None))
    elif view == "results":
        ids = await _signals_with_message_kind(session, tenant_id, "task_result")
        query = query.where(Signal.id.in_(ids) if ids else Signal.id.is_(None))
    elif view == "outbound":
        ids = await _signals_with_outbound_messages(session, tenant_id)
        query = query.where(
            Signal.channel.in_(EXTERNAL_CHANNELS),
            Signal.id.in_(ids) if ids else Signal.id.is_(None),
        )
    elif view == "external":
        query = query.where(Signal.channel.in_(EXTERNAL_CHANNELS), Signal.status == "open")
    elif view == "internal":
        query = query.where(Signal.channel == "internal")

    if assignee_id is not None:
        user_map = await _user_map(session, tenant_id)
        assignee_uuid = user_map.get(assignee_id)
        if assignee_uuid:
            query = query.where(Signal.assigned_user_id == assignee_uuid)
        else:
            query = query.where(Signal.id.is_(None))

    if connection_id:
        try:
            query = query.where(Signal.connection_id == UUID(connection_id))
        except ValueError:
            pass

    if email_connection_id is not None:
        account_id = await resolve_email_account_by_numeric_id(session, tenant_id, email_connection_id)
        if account_id:
            query = query.where(Signal.email_account_id == account_id)
        else:
            query = query.where(Signal.id.is_(None))

    if search:
        like = f"%{search}%"
        query = query.where(Signal.subject.ilike(like) | Signal.contact_email.ilike(like))

    count_result = await session.execute(select(func.count()).select_from(query.subquery()))
    items_total = count_result.scalar_one()

    query = query.order_by(Signal.last_message_at.desc())
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await session.execute(query)
    threads = list(result.scalars().all())
    threads.sort(
        key=lambda t: (
            t.id not in pinned,
            -(t.last_message_at.timestamp() if t.last_message_at else 0),
        )
    )

    items = [serialize_thread(t, is_pinned=t.id in pinned, user_num=user_num) for t in threads]
    next_page = page + 1 if page * per_page < items_total else None
    return {"items": items, "curPage": page, "itemsTotal": items_total, "nextPage": next_page}


async def get_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
) -> dict[str, Any] | None:
    result = await session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return None
    pinned = await _pinned_ids(session, tenant_id, user_id)
    messages_result = await session.execute(
        select(SignalMessage).where(SignalMessage.signal_id == signal_id).order_by(SignalMessage.created_at)
    )
    events_result = await session.execute(
        select(SignalEvent).where(SignalEvent.signal_id == signal_id).order_by(SignalEvent.created_at)
    )
    rev_map = {v: k for k, v in (await _user_map(session, tenant_id)).items()}
    return {
        "thread": serialize_thread(signal, is_pinned=signal_id in pinned),
        "messages": [serialize_message(m) for m in messages_result.scalars().all()],
        "events": [serialize_event(e, user_num_map=rev_map) for e in events_result.scalars().all()],
    }


async def _get_signal_row(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> Signal | None:
    result = await session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
    )
    return result.scalar_one_or_none()


async def patch_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    signal_id: UUID,
    *,
    status: str | None = None,
    assigned_to_user_id: int | None = None,
    tags: list[str] | None = None,
    priority: str | None = None,
) -> dict[str, Any] | None:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    if status is not None:
        signal.status = status
    if assigned_to_user_id is not None:
        user_map = await _user_map(session, tenant_id)
        signal.assigned_user_id = user_map.get(assigned_to_user_id) if assigned_to_user_id else None
    if tags is not None:
        signal.tags_json = json.dumps(tags)
    if priority is not None:
        signal.priority = priority
    signal.updated_at = datetime.utcnow()
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type="thread_updated",
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps({"status": status, "priority": priority}),
        )
    )
    await session.commit()
    await session.refresh(signal)
    pinned = await _pinned_ids(session, tenant_id, user_id)
    return serialize_thread(signal, is_pinned=signal_id in pinned, user_num=user_num)


async def set_read(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    signal_id: UUID,
    *,
    read: bool,
) -> dict[str, Any] | None:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    signal.has_unread = not read
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    pinned = await _pinned_ids(session, tenant_id, user_id)
    return serialize_thread(signal, is_pinned=signal_id in pinned, user_num=user_num)


async def delete_thread(session: AsyncSession, tenant_id: UUID, signal_id: UUID) -> bool:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return False
    for model in (SignalMessage, SignalEvent, SignalThreadPin):
        rows = await session.execute(select(model).where(model.signal_id == signal_id))
        for row in rows.scalars().all():
            await session.delete(row)
    await session.delete(signal)
    await session.commit()
    return True


async def reply_to_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    signal_id: UUID,
    *,
    body_text: str,
    body_html: str | None = None,
    action: str = "send",
    direction: str = "outbound",
    kind: str = "user_message",
) -> dict[str, Any] | None:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    now = datetime.utcnow()
    message = SignalMessage(
        signal_id=signal_id,
        tenant_id=tenant_id,
        kind=kind if direction == "internal" else "user_message",
        direction=direction,
        role="user" if direction != "internal" else "system",
        author_user_id=user_id,
        from_address="",
        to_addresses=signal.contact_email,
        subject=signal.subject,
        body_text=body_text,
        body_preview=body_text[:200],
        body_html=body_html or f"<p>{body_text}</p>",
        send_status="sent" if direction == "outbound" else None,
        received_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.updated_at = now
    if action == "send_and_close":
        signal.status = "closed"
    elif action == "send_and_pending":
        signal.status = "pending"
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type="reply_sent" if direction == "outbound" else "note_added",
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps({"action": action}),
        )
    )
    await session.commit()
    await session.refresh(message)
    return serialize_message(message)


async def list_pins(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> dict[str, list[str]]:
    pinned = await _pinned_ids(session, tenant_id, user_id)
    return {"thread_ids": [str(tid) for tid in sorted(pinned, key=str)]}


async def pin_thread(session: AsyncSession, tenant_id: UUID, user_id: UUID, signal_id: UUID) -> None:
    existing = await session.execute(
        select(SignalThreadPin).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
            SignalThreadPin.signal_id == signal_id,
        )
    )
    if existing.scalar_one_or_none():
        return
    session.add(SignalThreadPin(tenant_id=tenant_id, user_id=user_id, signal_id=signal_id))
    await session.commit()


async def unpin_thread(session: AsyncSession, tenant_id: UUID, user_id: UUID, signal_id: UUID) -> None:
    existing = await session.execute(
        select(SignalThreadPin).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
            SignalThreadPin.signal_id == signal_id,
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        await session.delete(row)
        await session.commit()


async def list_members(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(User).join(Membership, Membership.user_id == User.id).where(Membership.tenant_id == tenant_id)
    )
    members = []
    for user in result.scalars().all():
        members.append(
            {
                "id": user_numeric_id(user.id),
                "name": user.display_name or user.email,
                "email": user.email,
                "avatar_url": None,
            }
        )
    return members


async def sync_status(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    return []


async def resolve_message_decision(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    message_id: UUID,
    *,
    action: str,
) -> dict[str, Any]:
    from app.services.decisions import resolve_decision_message

    msg_result = await session.execute(
        select(SignalMessage).where(
            SignalMessage.id == message_id,
            SignalMessage.signal_id == signal_id,
            SignalMessage.tenant_id == tenant_id,
        )
    )
    message = msg_result.scalar_one_or_none()
    if not message or not message.decision_id:
        raise HTTPException(status_code=404, detail="Decision message not found")
    await resolve_decision_message(session, tenant_id, message.decision_id, action=action, user_id=user_id)
    session.add(
        SignalMessage(
            signal_id=signal_id,
            tenant_id=tenant_id,
            kind="system_event",
            direction="system",
            role="system",
            body_text=f"Decision {action}",
            body_preview=f"Decision {action}",
            author_user_id=user_id,
        )
    )
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type=f"decision_{action}",
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps({"decision_id": str(message.decision_id), "action": action}),
        )
    )
    await session.commit()
    return {"ok": True, "action": action}
