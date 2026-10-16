"""Probe Ask thread recent msgs + decisions for U23 live."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

SID = "84c74f47-51bd-476c-ac12-4fcf1ac6f912"


async def main() -> None:
    async with async_session_factory() as s:
        msgs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, kind, left(coalesce(body_text, ''), 140)
                    FROM signal_messages
                    WHERE signal_id = CAST(:id AS uuid)
                      AND created_at > now() - interval '15 minutes'
                    ORDER BY created_at DESC
                    LIMIT 20
                    """
                ),
                {"id": SID},
            )
        ).fetchall()
        print("msgs", len(msgs))
        for row in msgs:
            print(row)
        print("---decisions---")
        decs = (
            await s.execute(
                text(
                    """
                    SELECT id::text, status, coalesce(title, ''),
                           left(coalesce(question, ''), 80),
                           revealed_at, created_at
                    FROM decision_requests
                    WHERE signal_id = CAST(:id AS uuid)
                      AND created_at > now() - interval '30 minutes'
                    ORDER BY created_at DESC
                    LIMIT 8
                    """
                ),
                {"id": SID},
            )
        ).fetchall()
        for row in decs:
            print(row)
        floor = (
            await s.execute(
                text(
                    """
                    SELECT status, left(coalesce(floor_json::text, ''), 240)
                    FROM signals WHERE id = CAST(:id AS uuid)
                    """
                ),
                {"id": SID},
            )
        ).first()
        print("FLOOR", floor)


if __name__ == "__main__":
    asyncio.run(main())
