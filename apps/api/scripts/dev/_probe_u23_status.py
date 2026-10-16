"""U23 decision + floor status."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

SID = "84c74f47-51bd-476c-ac12-4fcf1ac6f912"


async def main() -> None:
    async with async_session_factory() as s:
        cols = (
            await s.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'decision_requests'
                    ORDER BY 1
                    """
                )
            )
        ).fetchall()
        print("cols", [c[0] for c in cols])
        decs = (
            await s.execute(
                text(
                    """
                    SELECT id::text, status, coalesce(title, ''), created_at
                    FROM decision_requests
                    WHERE signal_id = CAST(:id AS uuid)
                      AND created_at > now() - interval '25 minutes'
                    ORDER BY created_at DESC
                    LIMIT 5
                    """
                ),
                {"id": SID},
            )
        ).fetchall()
        print("decs", decs)
        floor = (
            await s.execute(
                text(
                    """
                    SELECT left(coalesce(floor_json::text, ''), 300)
                    FROM signals WHERE id = CAST(:id AS uuid)
                    """
                ),
                {"id": SID},
            )
        ).first()
        print("floor", floor)
        last = (
            await s.execute(
                text(
                    """
                    SELECT created_at, kind, left(coalesce(body_text, ''), 100)
                    FROM signal_messages
                    WHERE signal_id = CAST(:id AS uuid)
                    ORDER BY created_at DESC
                    LIMIT 6
                    """
                ),
                {"id": SID},
            )
        ).fetchall()
        print("last")
        for row in last:
            print(row)


if __name__ == "__main__":
    asyncio.run(main())
