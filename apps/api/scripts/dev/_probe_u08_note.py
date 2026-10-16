"""Probe U08 note-mention wake on live QA thread."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

SID = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")


async def main() -> None:
    async with async_session_factory() as s:
        msgs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, role, kind, direction,
                           left(coalesce(body_text,''), 220),
                           left(coalesce(metadata_json::text,''), 280)
                    FROM signal_messages
                    WHERE signal_id = :sid
                    ORDER BY created_at DESC
                    LIMIT 10
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        print("--- messages ---")
        for r in msgs:
            print(r[0], r[1], r[2], r[3], repr(r[4]))
            if r[5] and r[5] != "{}":
                print("  meta:", r[5][:260])

        floor = (
            await s.execute(
                text(
                    """
                    SELECT floor_json, left(coalesce(floor_json::text,''), 400)
                    FROM signals
                    WHERE id = :sid
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchone()
        print("--- floor ---")
        if floor:
            print((floor[1] or "")[:400])

        runs = (
            await s.execute(
                text(
                    """
                    SELECT id, status, created_at, left(coalesce(summary,''), 120)
                    FROM agent_runs
                    WHERE signal_id = :sid
                    ORDER BY created_at DESC
                    LIMIT 6
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        print("--- runs ---")
        for r in runs:
            print(r[0], r[1], r[2], r[3])


if __name__ == "__main__":
    asyncio.run(main())
