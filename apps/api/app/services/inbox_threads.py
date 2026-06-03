"""Multichannel inbox service backing the dashboard inbox contract.

Serializes threads/messages/events into the snake_case shape the dashboard
inbox normalizers (`apps/dashboard/src/lib/inbox-api.ts`) expect.
"""

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership, User
from app.models.inbox_threads import (
    InboxEvent,
    InboxMessage,
    InboxThread,
    InboxThreadPin,
    user_numeric_id,
)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def serialize_thread(thread: InboxThread, *, is_pinned: bool = False) -> dict[str, Any]:
    return {
        "id": thread.id,
        "organisation_id": str(thread.tenant_id),
        "email_connection_id": thread.email_connection_id,
        "graph_conversation_id": thread.graph_conversation_id,
        "email_subject": thread.email_subject,
        "contact_email": thread.contact_email,
        "contact_name": thread.contact_name,
        "contact_phone": thread.contact_phone,
        "status": thread.status,
        "priority": thread.priority,
        "assigned_to_user_id": thread.assigned_to_user_id,
        "tags": json.loads(thread.tags_json or "[]"),
        "last_message_at": _iso(thread.last_message_at),
        "has_unread": thread.has_unread,
        "is_pinned": is_pinned,
        "channel": thread.channel,
        "created_at": _iso(thread.created_at),
    }


def serialize_message(message: InboxMessage) -> dict[str, Any]:
    return {
        "id": message.id,
        "thread_id": message.thread_id,
        "connection_id": message.connection_id,
        "direction": message.direction,
        "from_address": message.from_address,
        "to_addresses": message.to_addresses,
        "subject": message.subject,
        "body_preview": message.body_preview,
        "body_html": message.body_html,
        "graph_message_id": message.graph_message_id,
        "in_reply_to": message.in_reply_to,
        "author_user_id": message.author_user_id,
        "is_read": message.is_read,
        "send_status": message.send_status,
        "attachments": json.loads(message.attachments_json or "[]"),
        "received_at": _iso(message.received_at),
        "created_at": _iso(message.created_at),
    }


def serialize_event(event: InboxEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "thread_id": event.thread_id,
        "event_type": event.event_type,
        "actor_user_id": event.actor_user_id,
        "payload": json.loads(event.payload_json or "{}"),
        "created_at": _iso(event.created_at),
    }


async def _pinned_ids(session: AsyncSession, tenant_id: UUID, user_num: int) -> set[int]:
    result = await session.execute(
        select(InboxThreadPin.thread_id).where(
            InboxThreadPin.tenant_id == tenant_id, InboxThreadPin.user_id == user_num
        )
    )
    return {row for row in result.scalars().all()}


async def list_threads(
    session: AsyncSession,
    tenant_id: UUID,
    user_num: int,
    *,
    view: str = "all_open",
    search: str | None = None,
    assignee_id: int | None = None,
    tag: str | None = None,
    connection_id: int | None = None,
    page: int = 1,
    per_page: int = 30,
) -> dict[str, Any]:
    pinned = await _pinned_ids(session, tenant_id, user_num)

    query = select(InboxThread).where(InboxThread.tenant_id == tenant_id)

    if view == "all_open":
        query = query.where(InboxThread.status == "open")
    elif view == "mine":
        query = query.where(InboxThread.status == "open", InboxThread.assigned_to_user_id == user_num)
    elif view == "unassigned":
        query = query.where(InboxThread.status == "open", InboxThread.assigned_to_user_id.is_(None))
    elif view == "pending":
        query = query.where(InboxThread.status == "pending")
    elif view == "closed":
        query = query.where(InboxThread.status == "closed")
    elif view == "spam":
        query = query.where(InboxThread.status == "spam")
    elif view == "pinned":
        if pinned:
            query = query.where(InboxThread.id.in_(pinned))
        else:
            query = query.where(InboxThread.id.is_(None))  # empty

    if assignee_id:
        query = query.where(InboxThread.assigned_to_user_id == assignee_id)
    if connection_id:
        query = query.where(InboxThread.email_connection_id == connection_id)
    if search:
        like = f"%{search}%"
        query = query.where(
            InboxThread.email_subject.ilike(like) | InboxThread.contact_email.ilike(like)
        )

    count_result = await session.execute(select(func.count()).select_from(query.subquery()))
    items_total = count_result.scalar_one()

    query = query.order_by(InboxThread.last_message_at.desc())
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await session.execute(query)
    threads = list(result.scalars().all())

    # Pinned threads to top within the current page set.
    threads.sort(key=lambda t: (t.id not in pinned, -(t.last_message_at.timestamp() if t.last_message_at else 0)))

    items = [serialize_thread(t, is_pinned=t.id in pinned) for t in threads]
    next_page = page + 1 if page * per_page < items_total else None
    return {
        "items": items,
        "curPage": page,
        "itemsTotal": items_total,
        "nextPage": next_page,
    }


async def get_thread(
    session: AsyncSession, tenant_id: UUID, user_num: int, thread_id: int
) -> dict[str, Any] | None:
    result = await session.execute(
        select(InboxThread).where(InboxThread.id == thread_id, InboxThread.tenant_id == tenant_id)
    )
    thread = result.scalar_one_or_none()
    if not thread:
        return None
    pinned = await _pinned_ids(session, tenant_id, user_num)
    messages_result = await session.execute(
        select(InboxMessage)
        .where(InboxMessage.thread_id == thread_id)
        .order_by(InboxMessage.created_at)
    )
    events_result = await session.execute(
        select(InboxEvent).where(InboxEvent.thread_id == thread_id).order_by(InboxEvent.created_at)
    )
    return {
        "thread": serialize_thread(thread, is_pinned=thread_id in pinned),
        "messages": [serialize_message(m) for m in messages_result.scalars().all()],
        "events": [serialize_event(e) for e in events_result.scalars().all()],
    }


async def _get_thread_row(session: AsyncSession, tenant_id: UUID, thread_id: int) -> InboxThread | None:
    result = await session.execute(
        select(InboxThread).where(InboxThread.id == thread_id, InboxThread.tenant_id == tenant_id)
    )
    return result.scalar_one_or_none()


async def patch_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_num: int,
    thread_id: int,
    *,
    status: str | None = None,
    assigned_to_user_id: int | None = None,
    tags: list[str] | None = None,
    priority: str | None = None,
) -> dict[str, Any] | None:
    thread = await _get_thread_row(session, tenant_id, thread_id)
    if not thread:
        return None
    if status is not None:
        thread.status = status
    if assigned_to_user_id is not None:
        thread.assigned_to_user_id = assigned_to_user_id or None
    if tags is not None:
        thread.tags_json = json.dumps(tags)
    if priority is not None:
        thread.priority = priority
    session.add(thread)
    session.add(
        InboxEvent(
            thread_id=thread_id,
            tenant_id=tenant_id,
            event_type="thread_updated",
            actor_user_id=user_num,
            payload_json=json.dumps({"status": status, "priority": priority}),
        )
    )
    await session.commit()
    await session.refresh(thread)
    pinned = await _pinned_ids(session, tenant_id, user_num)
    return serialize_thread(thread, is_pinned=thread_id in pinned)


async def set_read(
    session: AsyncSession, tenant_id: UUID, user_num: int, thread_id: int, *, read: bool
) -> dict[str, Any] | None:
    thread = await _get_thread_row(session, tenant_id, thread_id)
    if not thread:
        return None
    thread.has_unread = not read
    session.add(thread)
    await session.commit()
    await session.refresh(thread)
    pinned = await _pinned_ids(session, tenant_id, user_num)
    return serialize_thread(thread, is_pinned=thread_id in pinned)


async def delete_thread(session: AsyncSession, tenant_id: UUID, thread_id: int) -> bool:
    thread = await _get_thread_row(session, tenant_id, thread_id)
    if not thread:
        return False
    for model in (InboxMessage, InboxEvent):
        rows = await session.execute(select(model).where(model.thread_id == thread_id))
        for row in rows.scalars().all():
            await session.delete(row)
    pins = await session.execute(select(InboxThreadPin).where(InboxThreadPin.thread_id == thread_id))
    for pin in pins.scalars().all():
        await session.delete(pin)
    await session.delete(thread)
    await session.commit()
    return True


async def reply_to_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_num: int,
    thread_id: int,
    *,
    body_text: str,
    body_html: str | None = None,
    action: str = "send",
    direction: str = "outbound",
) -> dict[str, Any] | None:
    thread = await _get_thread_row(session, tenant_id, thread_id)
    if not thread:
        return None
    now = datetime.utcnow()
    message = InboxMessage(
        thread_id=thread_id,
        tenant_id=tenant_id,
        connection_id=thread.email_connection_id,
        direction=direction,
        from_address="",
        to_addresses=thread.contact_email,
        subject=thread.email_subject,
        body_preview=body_text[:200],
        body_html=body_html or f"<p>{body_text}</p>",
        author_user_id=user_num,
        is_read=True,
        send_status="sent" if direction == "outbound" else None,
        received_at=now,
        created_at=now,
    )
    session.add(message)
    thread.last_message_at = now
    if action == "send_and_close":
        thread.status = "closed"
    elif action == "send_and_pending":
        thread.status = "pending"
    session.add(thread)
    session.add(
        InboxEvent(
            thread_id=thread_id,
            tenant_id=tenant_id,
            event_type="reply_sent" if direction == "outbound" else "note_added",
            actor_user_id=user_num,
            payload_json=json.dumps({"action": action}),
        )
    )
    await session.commit()
    await session.refresh(message)
    return serialize_message(message)


async def list_pins(session: AsyncSession, tenant_id: UUID, user_num: int) -> dict[str, list[int]]:
    pinned = await _pinned_ids(session, tenant_id, user_num)
    return {"thread_ids": sorted(pinned)}


async def pin_thread(session: AsyncSession, tenant_id: UUID, user_num: int, thread_id: int) -> None:
    existing = await session.execute(
        select(InboxThreadPin).where(
            InboxThreadPin.tenant_id == tenant_id,
            InboxThreadPin.user_id == user_num,
            InboxThreadPin.thread_id == thread_id,
        )
    )
    if existing.scalar_one_or_none():
        return
    session.add(InboxThreadPin(tenant_id=tenant_id, user_id=user_num, thread_id=thread_id))
    await session.commit()


async def unpin_thread(session: AsyncSession, tenant_id: UUID, user_num: int, thread_id: int) -> None:
    existing = await session.execute(
        select(InboxThreadPin).where(
            InboxThreadPin.tenant_id == tenant_id,
            InboxThreadPin.user_id == user_num,
            InboxThreadPin.thread_id == thread_id,
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
    # V1 mock-fallback: no live mailbox sync in bokito mode.
    return []
