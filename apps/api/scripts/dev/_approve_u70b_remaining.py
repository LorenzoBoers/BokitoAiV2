"""Approve any remaining awaiting_human U70b decisions on Ask thread."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

SID = "84c74f47-51bd-476c-ac12-4fcf1ac6f912"

SQL = text(
    """
    SELECT id, status, chosen_option_id, title
    FROM decision_requests
    WHERE signal_id = CAST(:sid AS uuid) AND title LIKE 'U70%'
    ORDER BY created_at DESC
    LIMIT 10
    """
)

APPROVE = text(
    """
    UPDATE decision_requests
    SET status = 'approved',
        chosen_option_id = 'Rood',
        resolved_at = now()
    WHERE id = :id AND status = 'awaiting_human'
    """
)


async def main() -> None:
    async with async_session_factory() as s:
        rows = (await s.execute(SQL, {"sid": SID})).fetchall()
        for r in rows:
            print(r[0], r[1], r[2], r[3])
            if r[1] == "awaiting_human":
                await s.execute(APPROVE, {"id": r[0]})
                print("approved", r[0])
        await s.commit()


if __name__ == "__main__":
    asyncio.run(main())
