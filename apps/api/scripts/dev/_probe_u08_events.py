"""Probe U08 note: events + floor after structured mention."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

SID = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")


async def main() -> None:
    async with async_session_factory() as s:
        row = (
            await s.execute(
                text("SELECT floor_json FROM signals WHERE id = :sid"),
                {"sid": str(SID)},
            )
        ).fetchone()
        print("--- floor ---")
        print((row[0] or "")[:800] if row else None)

        ev = (
            await s.execute(
                text(
                    """
                    SELECT created_at, event_type,
                           left(coalesce(payload_json, ''), 220)
                    FROM signal_events
                    WHERE signal_id = :sid
                      AND created_at > now() - interval '30 minutes'
                    ORDER BY created_at DESC
                    LIMIT 25
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        print("--- events ---")
        for r in ev:
            print(r[0], r[1], (r[2] or "")[:200])


if __name__ == "__main__":
    asyncio.run(main())
