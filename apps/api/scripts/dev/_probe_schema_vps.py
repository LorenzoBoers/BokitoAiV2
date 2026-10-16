"""Run on VPS: python scripts/dev/_probe_schema_vps.py"""
from __future__ import annotations

import asyncio
import os

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine


async def main() -> None:
    url = os.environ["DATABASE_URL"]
    if "+asyncpg" not in url and url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    engine = create_async_engine(url)
    async with engine.connect() as conn:
        cols = set(
            (
                await conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'signals'"
                    )
                )
            ).scalars().all()
        )
        need = {"assignee_id", "turn_ref_id", "last_human_owner_json", "floor_json"}
        gone = {
            "assigned_user_id",
            "assignee_team_id",
            "turn_user_id",
            "turn_team_id",
            "active_turn_json",
            "handoff_session_json",
            "last_human_owner_kind",
            "last_human_owner_user_id",
            "last_human_owner_team_id",
        }
        print("have", sorted(need & cols))
        print("missing", sorted(need - cols))
        print("still_present", sorted(gone & cols))
        n = (
            await conn.execute(
                text(
                    "SELECT count(*) FROM agent_tasks "
                    "WHERE kind = 'job' AND context_json LIKE '%promoted%'"
                )
            )
        ).scalar()
        print("promoted_job_tasks", n)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
