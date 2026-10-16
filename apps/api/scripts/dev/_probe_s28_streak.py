"""Inspect streak remnant + recent participant_turn events for S28."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")


async def main() -> None:
    async with async_session_factory() as s:
        row = (
            await s.execute(
                text("SELECT active_turn_json FROM signals WHERE id = :id"),
                {"id": str(HOST)},
            )
        ).scalar()
        print("active", row)
        evs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, event_type,
                           left(coalesce(payload_json, ''), 140)
                    FROM signal_events
                    WHERE signal_id = :id
                      AND event_type LIKE 'participant_turn%'
                    ORDER BY created_at DESC
                    LIMIT 20
                    """
                ),
                {"id": str(HOST)},
            )
        ).fetchall()
        for e in evs:
            print(e)


if __name__ == "__main__":
    asyncio.run(main())
