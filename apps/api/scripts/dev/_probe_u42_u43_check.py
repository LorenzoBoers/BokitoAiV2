"""Inspect U42/U43 replies on the ask thread from the last probe run."""
from __future__ import annotations

import asyncio
import sys

from sqlalchemy import text

from app.db.session import async_session_factory

TID = sys.argv[1] if len(sys.argv) > 1 else "84c74f47-51bd-476c-ac12-4fcf1ac6f912"


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT created_at::text, role, author_agent_id::text,
                           left(coalesce(body_text,''), 400)
                    FROM signal_messages
                    WHERE signal_id = :id
                    ORDER BY created_at DESC
                    LIMIT 20
                    """
                ),
                {"id": TID},
            )
        ).fetchall()
        for r in rows:
            print("---", r[0], r[1], r[2])
            print(r[3])


if __name__ == "__main__":
    sys.path.insert(0, "/opt/bokito-dev/apps/api")
    asyncio.run(main())
