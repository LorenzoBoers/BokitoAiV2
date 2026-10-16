"""Probe U44 decisions on Ask."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

SID = "84c74f47-51bd-476c-ac12-4fcf1ac6f912"
EXTRA = "a2e4837d-3d58-4327-8f43-7d585d3948ce"


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT
                      id::text,
                      status,
                      left(title, 80),
                      left(summary, 80),
                      chosen_option_id,
                      created_at
                    FROM decision_requests
                    WHERE signal_id = CAST(:sid AS uuid)
                      AND (
                        title ILIKE '%U44%'
                        OR title ILIKE '%u44%'
                        OR summary ILIKE '%U44%'
                      )
                    ORDER BY created_at DESC
                    LIMIT 10
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        print("u44_count", len(rows))
        for r in rows:
            print(
                f"{r[5]} status={r[1]} title={r[2]!r} sum={r[3]!r} chosen={r[4]}"
            )


asyncio.run(main())
