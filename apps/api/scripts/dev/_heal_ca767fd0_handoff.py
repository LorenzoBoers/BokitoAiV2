"""Close leftover handoff on ca767fd0 after streak loop."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.signal import Signal

SID = UUID("ca767fd0-393f-4366-828b-1ef97c164f73")


async def main() -> None:
    async with async_session_factory() as s:
        sig = (await s.execute(select(Signal).where(Signal.id == SID))).scalar_one()
        raw = json.loads(sig.handoff_session_json or "{}")
        raw["status"] = "done"
        raw["complete_reason"] = "heal_streak_loop"
        sig.handoff_session_json = json.dumps(raw)
        sig.active_turn_json = "{}"
        s.add(sig)
        await s.commit()
        print("healed", raw.get("id"), raw.get("status"))


if __name__ == "__main__":
    asyncio.run(main())
