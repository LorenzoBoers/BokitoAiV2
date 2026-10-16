"""Force S35 deadline timeout via flush_deferred_participant_turn."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID, uuid4

from sqlalchemy import desc, select

from app.db.session import async_session_factory
from app.models.signal import Signal, SignalEvent
from app.services.participant_turns import flush_deferred_participant_turn

SID = UUID("e1be17a5-827f-4cbc-aafe-ea059dda3d1f")
BOKITO = UUID("8d4dede2-751e-4475-b614-206a8415c577")
ORCH = UUID("cc965b16-aff8-44a2-a0ea-29ebd4e5bccf")


async def main() -> None:
    async with async_session_factory() as s:
        sig = await s.get(Signal, SID)
        if not sig:
            print("missing")
            return
        floor = {
            "kind": "agent",
            "ref_id": str(BOKITO),
            "name": "Bokito assistant",
            "nonce": str(uuid4()),
            "deadline": "2000-01-01T00:00:00",
            "prompt": "s35force",
            "requested_by_kind": "agent",
            "requested_by_id": str(ORCH),
            "streak": 1,
            "streak_at": "2000-01-01T00:00:00",
            "deferred": True,
        }
        sig.active_turn_json = json.dumps(floor)
        s.add(sig)
        await s.flush()
        result = await flush_deferred_participant_turn(s, sig)
        await s.commit()
        print("flush", result)
        ev = (
            await s.execute(
                select(SignalEvent)
                .where(SignalEvent.signal_id == SID)
                .where(SignalEvent.event_type == "participant_turn_timeout")
                .order_by(desc(SignalEvent.created_at))
                .limit(1)
            )
        ).scalar_one_or_none()
        print("event", ev.payload_json if ev else None)
        print("floor_after", sig.active_turn_json)


if __name__ == "__main__":
    asyncio.run(main())
