"""Migrate InboxThread rows to Signal threads (one-time or idempotent)."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime

from sqlalchemy import select
from sqlmodel import SQLModel

from app.db.session import async_session_factory, engine
from app.models.auth import Membership, User
from app.models.inbox_threads import InboxEvent, InboxMessage, InboxThread, InboxThreadPin, user_numeric_id
from app.models.signal import Signal, SignalEvent, SignalMessage, SignalThreadPin


async def migrate_inbox_to_signals() -> dict[str, int]:
    async with async_session_factory() as session:
        threads = (await session.execute(select(InboxThread))).scalars().all()
        migrated = 0
        skipped = 0

        user_uuid_by_num: dict[int, str] = {}
        users = (await session.execute(select(User))).scalars().all()
        for user in users:
            user_uuid_by_num[user_numeric_id(user.id)] = str(user.id)

        for thread in threads:
            existing = (
                await session.execute(
                    select(Signal).where(Signal.legacy_inbox_thread_id == thread.id)
                )
            ).scalar_one_or_none()
            if existing:
                skipped += 1
                continue

            assignee_uuid = None
            if thread.assigned_to_user_id is not None:
                for user in users:
                    if user_numeric_id(user.id) == thread.assigned_to_user_id:
                        assignee_uuid = user.id
                        break

            signal = Signal(
                tenant_id=thread.tenant_id,
                channel=thread.channel or "email",
                source="email",
                external_id=thread.graph_conversation_id or "",
                legacy_inbox_thread_id=thread.id,
                subject=thread.email_subject,
                contact_email=thread.contact_email,
                contact_name=thread.contact_name,
                contact_phone=thread.contact_phone,
                status=thread.status,
                priority=thread.priority,
                assigned_user_id=assignee_uuid,
                tags_json=thread.tags_json,
                has_unread=thread.has_unread,
                last_message_at=thread.last_message_at,
                created_at=thread.created_at,
                updated_at=datetime.utcnow(),
            )
            session.add(signal)
            await session.flush()

            messages = (
                await session.execute(
                    select(InboxMessage).where(InboxMessage.thread_id == thread.id)
                )
            ).scalars().all()
            for msg in messages:
                author_uuid = None
                if msg.author_user_id is not None:
                    for user in users:
                        if user_numeric_id(user.id) == msg.author_user_id:
                            author_uuid = user.id
                            break
                session.add(
                    SignalMessage(
                        signal_id=signal.id,
                        tenant_id=thread.tenant_id,
                        kind="internal_note" if msg.direction == "internal" else "user_message",
                        direction=msg.direction,
                        role="user",
                        author_user_id=author_uuid,
                        from_address=msg.from_address,
                        to_addresses=msg.to_addresses or "[]",
                        subject=msg.subject,
                        body_text=msg.body_preview or "",
                        body_preview=msg.body_preview,
                        body_html=msg.body_html or "",
                        external_id=msg.graph_message_id or "",
                        send_status=msg.send_status,
                        received_at=msg.received_at,
                        created_at=msg.created_at,
                    )
                )

            events = (
                await session.execute(select(InboxEvent).where(InboxEvent.thread_id == thread.id))
            ).scalars().all()
            for evt in events:
                actor_uuid = None
                if evt.actor_user_id is not None:
                    for user in users:
                        if user_numeric_id(user.id) == evt.actor_user_id:
                            actor_uuid = user.id
                            break
                session.add(
                    SignalEvent(
                        signal_id=signal.id,
                        tenant_id=thread.tenant_id,
                        event_type=evt.event_type,
                        actor_type="user" if actor_uuid else "system",
                        actor_id=str(actor_uuid) if actor_uuid else "",
                        payload_json=evt.payload_json,
                        created_at=evt.created_at,
                    )
                )

            pins = (
                await session.execute(select(InboxThreadPin).where(InboxThreadPin.thread_id == thread.id))
            ).scalars().all()
            for pin in pins:
                pin_user_uuid = None
                for user in users:
                    if user_numeric_id(user.id) == pin.user_id:
                        pin_user_uuid = user.id
                        break
                if pin_user_uuid:
                    session.add(
                        SignalThreadPin(
                            tenant_id=pin.tenant_id,
                            user_id=pin_user_uuid,
                            signal_id=signal.id,
                            created_at=pin.created_at,
                        )
                    )

            migrated += 1

        await session.commit()
        return {"migrated": migrated, "skipped": skipped, "total_inbox": len(threads)}


async def main() -> None:
    stats = await migrate_inbox_to_signals()
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
