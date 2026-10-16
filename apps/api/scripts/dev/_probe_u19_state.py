"""Inspect floor/handoff state for live UX thread."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

THREAD = "84c74f47-51bd-476c-ac12-4fcf1ac6f912"


async def main() -> None:
    async with async_session_factory() as s:
        r = await s.execute(
            text(
                """
                SELECT id::text, channel, status,
                       COALESCE(floor_json::text, '') AS floor_json
                FROM signals
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {"id": THREAD},
        )
        print("SIGNAL", r.first())
        runs = await s.execute(
            text(
                """
                SELECT id::text, status, COALESCE(trigger_id,''), created_at,
                       finished_at, COALESCE(error,'') AS err
                FROM agent_runs
                WHERE trigger_id = :id
                   OR conversation_id::text = :id
                ORDER BY created_at DESC
                LIMIT 6
                """
            ),
            {"id": THREAD},
        )
        print("RUNS")
        for run in runs:
            print(run)
        msgs = await s.execute(
            text(
                """
                SELECT id::text, role, LEFT(COALESCE(body,''), 140), created_at
                FROM signal_messages
                WHERE signal_id = CAST(:id AS uuid)
                ORDER BY created_at DESC
                LIMIT 8
                """
            ),
            {"id": THREAD},
        )
        print("MSGS")
        for m in msgs:
            print(m)


if __name__ == "__main__":
    asyncio.run(main())
