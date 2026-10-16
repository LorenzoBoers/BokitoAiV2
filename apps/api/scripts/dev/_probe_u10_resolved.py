from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory


async def main() -> None:
    async with async_session_factory() as s:
        r = (
            await s.execute(
                text(
                    """
                    SELECT status, chosen_option_id, resolved_at
                    FROM decision_requests
                    WHERE id = 'f4a4e5a0-3f94-4849-b99c-d51e1b31f515'
                    """
                )
            )
        ).fetchone()
        print("DEC", r)


if __name__ == "__main__":
    asyncio.run(main())
