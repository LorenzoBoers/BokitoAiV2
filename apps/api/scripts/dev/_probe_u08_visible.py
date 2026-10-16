"""Check U08 messages still present and what GET thread would return."""
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
                    SELECT id, created_at, role, kind, direction,
                           left(body_text, 120)
                    FROM signal_messages
                    WHERE signal_id = :sid
                      AND created_at > '2026-10-15 20:08:00'
                    ORDER BY created_at
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        print("--- since U02 ---")
        for r in rows:
            print(r[0], r[1], r[2], r[3], r[4], repr(r[5]))


if __name__ == "__main__":
    asyncio.run(main())
