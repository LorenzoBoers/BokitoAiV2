"""Probe tool activity + whether Brave Search is configured."""
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
    sid = "e8105925-445f-4db4-82af-b5245bd0886c"
    aid = "cc965b16-aff8-44a2-a0ea-29ebd4e5bccf"
    eng = create_async_engine(_url())
    async with eng.connect() as c:
        print("BRAVE_env_set", bool((os.environ.get("BRAVE_SEARCH_API_KEY") or "").strip()))
        tables = (
            await c.execute(
                text(
                    """
                    select table_name from information_schema.tables
                    where table_schema='public'
                      and (table_name ilike '%run%' or table_name ilike '%activ%'
                           or table_name ilike '%secret%' or table_name='agents')
                    order by 1
                    """
                )
            )
        ).scalars().all()
        print("tables", tables)

        ag = (
            await c.execute(
                text(
                    """
                    select id::text, name, left(coalesce(tools_json,''),300),
                           left(coalesce(settings_json,''),300)
                    from agents where id=:id
                    """
                ),
                {"id": aid},
            )
        ).fetchall()
        print("agent", ag)

        if "run_events" in tables:
            rows = (
                await c.execute(
                    text(
                        """
                        select e.id::text, e.event_type, left(coalesce(e.payload_json,''),400), e.created_at
                        from run_events e
                        join agent_runs r on r.id = e.run_id
                        where r.signal_id = :sid
                        order by e.created_at desc
                        limit 30
                        """
                    ),
                    {"sid": sid},
                )
            ).fetchall()
            print("run_events", len(rows))
            for r in rows[:20]:
                print(r)

        if "agent_runs" in tables:
            runs = (
                await c.execute(
                    text(
                        """
                        select id::text, status, left(coalesce(result_json,''),160), created_at
                        from agent_runs
                        where signal_id=:sid
                        order by created_at desc limit 10
                        """
                    ),
                    {"sid": sid},
                )
            ).fetchall()
            print("runs", runs)

        if "platform_secrets" in tables:
            secs = (
                await c.execute(
                    text("select provider, last4, updated_at from platform_secrets order by 1")
                )
            ).fetchall()
            print("platform_secrets", secs)


if __name__ == "__main__":
    asyncio.run(main())
