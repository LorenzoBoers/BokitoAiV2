"""Check for participant_turn_pass after U22 force."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

SID = "84c74f47-51bd-476c-ac12-4fcf1ac6f912"


async def main() -> None:
    async with async_session_factory() as s:
        evs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, event_type, left(payload_json::text, 240)
                    FROM signal_events
                    WHERE signal_id = CAST(:sid AS uuid)
                      AND (
                        event_type LIKE 'participant_turn%'
                        OR event_type LIKE '%pass%'
                      )
                    ORDER BY created_at DESC
                    LIMIT 15
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        for r in evs:
            print(r[0], r[1], r[2])
        msgs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, kind, left(coalesce(body_text,''), 120)
                    FROM signal_messages
                    WHERE signal_id = CAST(:sid AS uuid)
                    ORDER BY created_at DESC
                    LIMIT 8
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        print("---MSGS---")
        for r in msgs:
            print(r[0], r[1], repr(r[2]))


asyncio.run(main())
