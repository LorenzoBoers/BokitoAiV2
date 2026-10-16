"""Check U10b decision landed on ask thread with message_id."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

ASK = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")


async def main() -> None:
    async with async_session_factory() as s:
        msgs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, kind, decision_id, left(body_text, 100)
                    FROM signal_messages
                    WHERE signal_id = :sid AND created_at > now() - interval '10 minutes'
                    ORDER BY created_at
                    """
                ),
                {"sid": str(ASK)},
            )
        ).fetchall()
        print("=== recent msgs on ask ===")
        for m in msgs:
            print(m)
        decs = (
            await s.execute(
                text(
                    """
                    SELECT id, signal_id, status, title, message_id, created_at
                    FROM decision_requests
                    WHERE title ILIKE '%U10%' AND created_at > now() - interval '15 minutes'
                    ORDER BY created_at DESC
                    """
                )
            )
        ).fetchall()
        print("=== U10 decisions ===")
        for d in decs:
            print(d)


if __name__ == "__main__":
    asyncio.run(main())
