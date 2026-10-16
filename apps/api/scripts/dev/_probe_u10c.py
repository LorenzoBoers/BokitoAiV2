from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory


async def main() -> None:
    async with async_session_factory() as s:
        msgs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, kind, decision_id, left(body_text,120)
                    FROM signal_messages
                    WHERE signal_id = '84c74f47-51bd-476c-ac12-4fcf1ac6f912'
                      AND created_at > now() - interval '8 minutes'
                    ORDER BY created_at
                    """
                )
            )
        ).fetchall()
        print("msgs")
        for m in msgs:
            print(m)
        decs = (
            await s.execute(
                text(
                    """
                    SELECT id, signal_id, status, title, message_id, created_at
                    FROM decision_requests
                    WHERE title ILIKE '%U10c%' OR title ILIKE '%klaar%'
                    ORDER BY created_at DESC LIMIT 8
                    """
                )
            )
        ).fetchall()
        print("decs", decs)


if __name__ == "__main__":
    asyncio.run(main())
