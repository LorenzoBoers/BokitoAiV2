"""Probe U23 decisions after live resolve."""
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
                    SELECT created_at, kind, left(coalesce(body_text, ''), 120)
                    FROM signal_messages
                    WHERE signal_id = CAST(:id AS uuid)
                      AND created_at > now() - interval '12 minutes'
                    ORDER BY created_at
                    """
                ),
                {"id": SID},
            )
        ).fetchall()
        print("msgs")
        for m in msgs:
            print(m)
        decs = (
            await s.execute(
                text(
                    """
                    SELECT id::text, status, coalesce(title, ''),
                           coalesce(selected_option, ''), created_at
                    FROM decision_requests
                    WHERE signal_id = CAST(:id AS uuid)
                      AND created_at > now() - interval '20 minutes'
                    ORDER BY created_at DESC
                    LIMIT 8
                    """
                ),
                {"id": SID},
            )
        ).fetchall()
        print("decs")
        for d in decs:
            print(d)


if __name__ == "__main__":
    asyncio.run(main())
