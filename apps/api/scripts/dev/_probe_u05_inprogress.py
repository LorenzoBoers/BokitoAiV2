"""Check if U05 bubbles left in_progress=true (ghost Bezig source)."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

SID = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT created_at, kind,
                           left(body_text, 60),
                           left(metadata_json::text, 350)
                    FROM signal_messages
                    WHERE signal_id = :sid
                      AND created_at > '2026-10-15 20:23:00'
                    ORDER BY created_at
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        for r in rows:
            print(r[0], r[1], repr(r[2]))
            print(" ", r[3][:340])


if __name__ == "__main__":
    asyncio.run(main())
