"""Inspect the empty outbound mail body on the 'wie jullie' thread."""
from __future__ import annotations

import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


def _url() -> str:
    url = os.environ["DATABASE_URL"]
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def main() -> None:
    eng = create_async_engine(_url())
    async with eng.connect() as c:
        rows = (
            await c.execute(
                text(
                    """
                    select s.id::text, s.subject, s.assignee_kind, s.agent_id::text,
                           s.assigned_user_id::text, s.assignee_team_id::text
                    from signals s
                    where s.subject ilike '%wie jullie%'
                    order by s.updated_at desc nulls last
                    limit 5
                    """
                )
            )
        ).fetchall()
        print("signals", rows)
        if not rows:
            return
        sid = rows[0][0]
        msgs = (
            await c.execute(
                text(
                    """
                    select id::text, kind, direction, role,
                           left(coalesce(body_text, ''), 200),
                           coalesce(body_html, ''),
                           author_user_id, author_agent_id::text, from_address,
                           created_at, left(coalesce(metadata_json, ''), 500)
                    from signal_messages
                    where signal_id = :sid
                    order by created_at
                    """
                ),
                {"sid": sid},
            )
        ).fetchall()
        for m in msgs:
            print("---")
            print(
                m[0],
                m[1],
                m[2],
                m[3],
                "author_user",
                m[6],
                "author_agent",
                m[7],
                "from",
                m[8],
                "at",
                m[9],
            )
            print("text:", repr(m[4]))
            html = m[5] or ""
            print("html_len:", len(html))
            print("html:", repr(html[:2000]))
            print("meta:", repr(m[10]))


if __name__ == "__main__":
    asyncio.run(main())
