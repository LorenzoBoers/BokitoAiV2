"""Inspect wake prompt + active_turn for qa_v4 chain."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.signal import Signal, SignalEvent, SignalMessage

SID = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")


async def main() -> None:
    async with async_session_factory() as s:
        sig = await s.get(Signal, SID)
        print("ACTIVE_TURN_JSON", getattr(sig, "active_turn_json", None))
        print("ACTIVE_TURN_EXPIRES", getattr(sig, "active_turn_expires_at", None))
        evs = (
            await s.execute(
                select(SignalEvent)
                .where(SignalEvent.signal_id == SID)
                .where(SignalEvent.event_type == "participant_turn_requested")
                .order_by(SignalEvent.created_at.desc())
                .limit(4)
            )
        ).scalars().all()
        for e in evs:
            try:
                p = json.loads(e.payload_json or "{}")
            except json.JSONDecodeError:
                p = {}
            print("--- REQ", e.created_at, "actor", e.actor_type, e.actor_id)
            print("name", p.get("name"), "nonce", p.get("nonce"))
            print("prompt:", (p.get("prompt") or "")[:800])
        msgs = (
            await s.execute(
                select(SignalMessage)
                .where(SignalMessage.signal_id == SID)
                .order_by(SignalMessage.created_at.desc())
                .limit(10)
            )
        ).scalars().all()
        print("=== HOST MSGS ===")
        for m in msgs:
            print(
                m.created_at,
                m.role,
                m.kind,
                (m.body_text or "")[:280].replace("\n", " "),
            )


if __name__ == "__main__":
    asyncio.run(main())
