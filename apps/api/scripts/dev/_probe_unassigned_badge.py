"""One-off: open vs closed unread counts for Unassigned badge diagnosis."""
from __future__ import annotations

import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


def _async_url(raw: str) -> str:
    if raw.startswith("postgresql://"):
        return raw.replace("postgresql://", "postgresql+asyncpg://", 1)
    if raw.startswith("postgres://"):
        return raw.replace("postgres://", "postgresql+asyncpg://", 1)
    return raw


async def main() -> None:
    eng = create_async_engine(_async_url(os.environ["DATABASE_URL"]))
    async with eng.connect() as c:
        rows = (
            await c.execute(
                text(
                    """
                    SELECT t.slug,
                      COUNT(*) FILTER (
                        WHERE s.status = 'open'
                          AND s.has_unread
                          AND s.assignee_kind = 'team'
                      ) AS badge_unassigned,
                      COUNT(*) FILTER (
                        WHERE s.status = 'closed'
                          AND s.has_unread
                          AND s.assignee_kind = 'team'
                      ) AS closed_team_unread,
                      COUNT(*) FILTER (
                        WHERE s.status = 'closed' AND s.has_unread
                      ) AS closed_unread_any,
                      COUNT(*) FILTER (
                        WHERE s.status = 'open' AND s.assignee_kind = 'team'
                      ) AS open_team_total
                    FROM signals s
                    JOIN tenants t ON t.id = s.tenant_id
                    GROUP BY t.slug
                    HAVING COUNT(*) FILTER (
                      WHERE s.has_unread OR s.assignee_kind = 'team'
                    ) > 0
                    ORDER BY badge_unassigned DESC
                    LIMIT 30
                    """
                )
            )
        ).mappings().all()
        for r in rows:
            print(dict(r))
    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main())
