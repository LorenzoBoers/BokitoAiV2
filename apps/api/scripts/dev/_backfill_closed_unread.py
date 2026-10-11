"""Clear has_unread on closed/spam threads (badge hygiene; badges already filter open)."""
from __future__ import annotations

import asyncio
import os
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


def _async_url(raw: str) -> str:
    if raw.startswith("postgresql://"):
        return raw.replace("postgresql://", "postgresql+asyncpg://", 1)
    if raw.startswith("postgres://"):
        return raw.replace("postgres://", "postgresql+asyncpg://", 1)
    return raw


async def main(*, apply: bool) -> None:
    eng = create_async_engine(_async_url(os.environ["DATABASE_URL"]))
    async with eng.begin() as c:
        before = (
            await c.execute(
                text(
                    """
                    SELECT status, COUNT(*) AS n
                    FROM signals
                    WHERE status IN ('closed', 'spam') AND has_unread
                    GROUP BY status
                    ORDER BY status
                    """
                )
            )
        ).all()
        print("before:", before)
        if apply:
            result = await c.execute(
                text(
                    """
                    UPDATE signals
                    SET has_unread = false, updated_at = CURRENT_TIMESTAMP
                    WHERE status IN ('closed', 'spam') AND has_unread
                    """
                )
            )
            print("updated:", result.rowcount)
        else:
            print("dry-run only; pass --apply to update")
    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main(apply="--apply" in sys.argv))
