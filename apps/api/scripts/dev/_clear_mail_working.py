"""Clear mail host floor / orphan working bubbles."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

MAIL = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT id, left(body_text, 80)
                    FROM signal_messages
                    WHERE signal_id = :sid
                      AND body_text ILIKE 'Working on this%'
                    ORDER BY created_at DESC
                    LIMIT 8
                    """
                ),
                {"sid": str(MAIL)},
            )
        ).fetchall()
        print("working rows", rows)
        await s.execute(
            text(
                """
                DELETE FROM signal_messages
                WHERE signal_id = :sid
                  AND body_text ILIKE 'Working on this%'
                """
            ),
            {"sid": str(MAIL)},
        )
        await s.execute(
            text("UPDATE signals SET floor_json = CAST(:floor AS jsonb) WHERE id = :sid"),
            {"sid": str(MAIL), "floor": "{}"},
        )
        await s.commit()
        print("cleared floor")


if __name__ == "__main__":
    asyncio.run(main())
