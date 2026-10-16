"""How many timeout events would the thread serializer expose?"""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

SID = "14cb3ae9-c892-458b-9e71-05f093d5aa47"


async def main() -> None:
    async with async_session_factory() as s:
        # Mirror typical thread event window if any
        total = (
            await s.execute(
                text(
                    "SELECT count(*) FROM signal_events WHERE signal_id = CAST(:sid AS uuid)"
                ),
                {"sid": SID},
            )
        ).scalar()
        timeouts = (
            await s.execute(
                text(
                    """
                    SELECT created_at, event_type, payload_json->>'reason'
                    FROM signal_events
                    WHERE signal_id = CAST(:sid AS uuid)
                      AND event_type = 'participant_turn_timeout'
                    ORDER BY created_at DESC
                    LIMIT 5
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        print("total_events", total)
        for r in timeouts:
            print(r)


asyncio.run(main())
