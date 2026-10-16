"""Probe active_turn + recent events/messages for A2A QA thread."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import select, text

from app.db.session import async_session_factory
from app.models.signal import Signal

SID = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")


async def main() -> None:
    async with async_session_factory() as s:
        sig = (await s.execute(select(Signal).where(Signal.id == SID))).scalar_one()
        print("active_turn:", sig.active_turn_json)
        rows = (
            await s.execute(
                text(
                    """
          SELECT created_at, event_type, actor_type,
                 left(coalesce(payload_json,''), 140)
          FROM signal_events WHERE signal_id = :sid
          ORDER BY created_at DESC LIMIT 20
        """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        print("--- events ---")
        for r in rows:
            print(r[0], r[1], r[2], (r[3] or "")[:120])
        msgs = (
            await s.execute(
                text(
                    """
          SELECT created_at, role, left(coalesce(content,''), 120)
          FROM signal_messages WHERE signal_id = :sid
          ORDER BY created_at DESC LIMIT 12
        """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        print("--- messages ---")
        for r in msgs:
            print(r[0], r[1], (r[2] or "")[:100])


if __name__ == "__main__":
    asyncio.run(main())
