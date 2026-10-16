"""List recent open assistant/internal threads for UX QA."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory


async def main() -> None:
    async with async_session_factory() as s:
        r = await s.execute(
            text(
                """
                SELECT id::text, COALESCE(subject, '') AS subject,
                       channel_type, status,
                       COALESCE(owner_agent_id::text, '') AS owner_agent
                FROM signals
                WHERE channel_type IN ('assistant', 'internal')
                  AND status = 'open'
                ORDER BY updated_at DESC NULLS LAST
                LIMIT 12
                """
            )
        )
        for row in r:
            print("|".join(str(x) for x in row))


if __name__ == "__main__":
    asyncio.run(main())
