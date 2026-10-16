"""Reproduce GET thread detail for the 500 thread."""
from __future__ import annotations

import asyncio
import traceback
from uuid import UUID

from sqlalchemy import select, text

from app.db.session import async_session_factory
from app.models.auth import Membership, User
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.signal_threads import get_thread, serialize_event

SID = UUID("ec8d606c-71dc-44f8-bb4f-9b3c9977e922")


async def main() -> None:
    async with async_session_factory() as session:
        sig = await session.get(Signal, SID)
        if sig is None:
            print("SIGNAL MISSING")
            return
        membership = (
            await session.execute(
                select(Membership).where(Membership.tenant_id == sig.tenant_id).limit(1)
            )
        ).scalar_one_or_none()
        user = await session.get(User, membership.user_id) if membership else None
        print(
            "signal ok",
            sig.id,
            "tenant",
            sig.tenant_id,
            "channel",
            sig.channel,
            "user",
            user.id if user else None,
        )
        # Probe raw event payloads
        evs = (
            await session.execute(
                select(SignalEvent)
                .where(SignalEvent.signal_id == SID)
                .order_by(SignalEvent.created_at.desc())
                .limit(40)
            )
        ).scalars().all()
        print("events", len(evs))
        for e in evs:
            try:
                serialize_event(e)
            except Exception as exc:  # noqa: BLE001
                print("BAD EVENT", e.id, e.event_type, type(exc).__name__, exc, e.payload_json[:200])
        msgs = (
            await session.execute(
                select(SignalMessage)
                .where(SignalMessage.signal_id == SID)
                .order_by(SignalMessage.created_at.desc())
                .limit(40)
            )
        ).scalars().all()
        print("msgs", len(msgs))
        for m in msgs:
            try:
                json_ok = True
                import json

                json.loads(m.attachments_json or "[]")
                json.loads(m.metadata_json or "{}")
            except Exception as exc:  # noqa: BLE001
                json_ok = False
                print("BAD MSG JSON", m.id, type(exc).__name__, exc)
        if user is None:
            return
        try:
            detail = await get_thread(session, sig.tenant_id, user.id, SID, limit=80)
            print("OK keys", sorted(detail.keys()) if isinstance(detail, dict) else type(detail))
            if isinstance(detail, dict):
                print(
                    "msgs",
                    len(detail.get("messages") or []),
                    "events",
                    len(detail.get("events") or []),
                    "participants",
                    len(detail.get("participants") or []),
                )
        except Exception:
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
