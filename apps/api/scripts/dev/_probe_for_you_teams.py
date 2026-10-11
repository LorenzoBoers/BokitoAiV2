"""Probe open ownership vs custom-team membership for For you."""
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
                    select assignee_kind, source, count(*)
                    from signals
                    where status='open' and deleted_at is null
                    group by 1,2 order by 3 desc limit 30
                    """
                )
            )
        ).fetchall()
        print("open by assignee_kind/source:")
        for r in rows:
            print(tuple(r))

        rows2 = (
            await c.execute(
                text(
                    """
                    select t.name, t.kind, count(*)
                    from signals s
                    join teams t on t.id = s.assignee_team_id
                    where s.status='open' and s.deleted_at is null
                      and s.assignee_kind='team'
                    group by 1,2 order by 3 desc limit 20
                    """
                )
            )
        ).fetchall()
        print("open team-owned by team:")
        for r in rows2:
            print(tuple(r))

        rows3 = (
            await c.execute(
                text(
                    """
                    select t.name, coalesce(t.kind,''), count(tm.id)
                    from teams t
                    left join team_members tm
                      on tm.team_id=t.id and tm.member_kind='user'
                    where coalesce(t.kind,'') not in ('people','agents')
                    group by 1,2 order by 3 desc limit 20
                    """
                )
            )
        ).fetchall()
        print("custom teams member counts:")
        for r in rows3:
            print(tuple(r))

        # For a sample user on a custom team: how many for_you-ish team-owned?
        rows4 = (
            await c.execute(
                text(
                    """
                    select u.email, t.name, count(s.id) as team_owned_open
                    from team_members tm
                    join teams t on t.id = tm.team_id
                    join users u on u.id = tm.user_id
                    left join signals s
                      on s.assignee_kind='team'
                     and s.assignee_team_id = t.id
                     and s.status='open'
                     and s.deleted_at is null
                     and s.source <> 'team'
                    where tm.member_kind='user'
                      and coalesce(t.kind,'') not in ('people','agents')
                    group by u.email, t.name
                    order by team_owned_open desc
                    limit 15
                    """
                )
            )
        ).fetchall()
        print("user x custom-team open team-owned (excl source=team):")
        for r in rows4:
            print(tuple(r))
    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main())
