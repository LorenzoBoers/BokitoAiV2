"""Recent max_consecutive / streak events on mail host."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

SID = "14cb3ae9-c892-458b-9e71-05f093d5aa47"


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT created_at, event_type, left(payload_json::text, 240)
                    FROM signal_events
                    WHERE signal_id = CAST(:sid AS uuid)
                      AND (
                        event_type ILIKE '%streak%'
                        OR event_type ILIKE '%consecutive%'
                        OR payload_json::text ILIKE '%max_consecutive%'
                        OR payload_json::text ILIKE '%te veel%'
                      )
                    ORDER BY created_at DESC
                    LIMIT 10
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        for r in rows:
            print(r[0], r[1], r[2])
        if not rows:
            print("no matching events; last 8:")
            rows2 = (
                await s.execute(
                    text(
                        """
                        SELECT created_at, event_type, left(payload_json::text, 160)
                        FROM signal_events
                        WHERE signal_id = CAST(:sid AS uuid)
                        ORDER BY created_at DESC
                        LIMIT 8
                        """
                    ),
                    {"sid": SID},
                )
            ).fetchall()
            for r in rows2:
                print(r[0], r[1], r[2])


asyncio.run(main())
