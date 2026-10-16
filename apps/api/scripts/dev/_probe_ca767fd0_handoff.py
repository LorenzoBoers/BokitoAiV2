"""Probe handoff loop on thread ca767fd0."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.signal import Signal, SignalEvent, SignalMessage

SID = UUID("ca767fd0-393f-4366-828b-1ef97c164f73")


async def main() -> None:
    async with async_session_factory() as s:
        sig = (await s.execute(select(Signal).where(Signal.id == SID))).scalar_one_or_none()
        if not sig:
            print("NO_SIGNAL")
            return
        print("subject", sig.subject)
        print("agent_id", sig.agent_id)
        print("active_turn", sig.active_turn_json)
        print("handoff", getattr(sig, "handoff_session_json", None))
        msgs = (
            await s.execute(
                select(SignalMessage)
                .where(SignalMessage.signal_id == SID)
                .order_by(SignalMessage.created_at.asc())
            )
        ).scalars().all()
        print("--- messages", len(msgs))
        for m in msgs:
            try:
                meta = json.loads(m.metadata_json or "{}")
            except json.JSONDecodeError:
                meta = {}
            body = (m.body_text or "")[:180].replace("\n", " ")
            print(
                m.created_at.isoformat(),
                "kind=" + str(m.kind),
                "agent=" + str(m.author_agent_id),
                "user=" + str(m.author_user_id),
                "|",
                body,
            )
        evs = (
            await s.execute(
                select(SignalEvent)
                .where(SignalEvent.signal_id == SID)
                .order_by(SignalEvent.created_at.asc())
            )
        ).scalars().all()
        print("--- events", len(evs))
        for e in evs:
            payload = e.payload_json or ""
            if len(payload) > 240:
                payload = payload[:240] + "..."
            print(
                e.created_at.isoformat(),
                e.event_type,
                "actor=" + str(e.actor_type) + ":" + str(e.actor_id),
                payload,
            )


if __name__ == "__main__":
    asyncio.run(main())
