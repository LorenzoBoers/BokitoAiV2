"""List teams and open turn/owner mix."""
from __future__ import annotations

import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


def _url() -> str:
    url = os.environ["DATABASE_URL"]
    if "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


async def main() -> None:
    eng = create_async_engine(_url())
    async with eng.connect() as c:
        print(
            "teams:",
            (
                await c.execute(text("select name, kind, pinned from teams order by name"))
            ).fetchall(),
        )
        print(
            "members:",
            (
                await c.execute(
                    text("select member_kind, count(*) from team_members group by 1")
                )
            ).fetchall(),
        )
        print(
            "open turns:",
            (
                await c.execute(
                    text(
                        """
                        select turn_kind, turn_reason, assignee_kind, count(*)
                        from signals
                        where status='open' and deleted_at is null
                        group by 1,2,3
                        order by 4 desc
                        """
                    )
                )
            ).fetchall(),
        )
    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main())
