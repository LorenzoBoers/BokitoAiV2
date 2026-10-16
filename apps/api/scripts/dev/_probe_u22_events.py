"""Probe U22 pass / overgeslagen events on Ask thread."""
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
                    SELECT created_at, event_type, left(payload_json::text, 200)
                    FROM signal_events
                    WHERE signal_id = CAST(:sid AS uuid)
                      AND event_type LIKE 'participant_turn%'
                    ORDER BY created_at DESC
                    LIMIT 12
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        print("EVENTS")
        for r in evs:
            print(r[0], r[1], r[2])

        msgs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, kind, left(coalesce(body_text,''), 160)
                    FROM signal_messages
                    WHERE signal_id = CAST(:sid AS uuid)
                    ORDER BY created_at DESC
                    LIMIT 12
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        print("MSGS")
        for r in msgs:
            print(r[0], r[1], repr(r[2]))


asyncio.run(main())
