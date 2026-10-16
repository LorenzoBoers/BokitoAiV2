from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory


async def main() -> None:
    async with async_session_factory() as s:
        d = (
            await s.execute(
                text(
                    """
                    SELECT id, status, message_id, title, chosen_option_id
                    FROM decision_requests
                    WHERE id = 'aa2fed87-d4a2-4d3e-bc44-513794770542'
                    """
                )
            )
        ).fetchone()
        print("dec", d)
        m = (
            await s.execute(
                text(
                    """
                    SELECT id, kind, left(body_text, 80), created_at
                    FROM signal_messages
                    WHERE id = '23cbbbc6-c0c7-4892-8aa1-a7fe45d98715'
                    """
                )
            )
        ).fetchone()
        print("msg", m)
        recent = (
            await s.execute(
                text(
                    """
                    SELECT created_at, kind, decision_id, left(body_text, 80)
                    FROM signal_messages
                    WHERE signal_id = '84c74f47-51bd-476c-ac12-4fcf1ac6f912'
                    ORDER BY created_at DESC
                    LIMIT 12
                    """
                )
            )
        ).fetchall()
        print("recent")
        for r in recent:
            print(r)


if __name__ == "__main__":
    asyncio.run(main())
