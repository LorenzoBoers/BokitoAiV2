"""Inspect S35 peer thread floor + recent timeout events."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import desc, select

from app.db.session import async_session_factory
from app.models.signal import Signal, SignalEvent

SID = UUID("e1be17a5-827f-4cbc-aafe-ea059dda3d1f")


async def main() -> None:
    async with async_session_factory() as s:
        sig = await s.get(Signal, SID)
        print("floor", sig.active_turn_json if sig else None)
        evs = (
            await s.execute(
                select(SignalEvent)
                .where(SignalEvent.signal_id == SID)
                .order_by(desc(SignalEvent.created_at))
                .limit(8)
            )
        ).scalars().all()
        for e in evs:
            print(e.event_type, (e.payload_json or "")[:200])


if __name__ == "__main__":
    asyncio.run(main())
