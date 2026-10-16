"""Probe U05 ghost Bezig after reply completed."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

SID = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")
ORCH = UUID("cc965b16-aff8-44a2-a0ea-29ebd4e5bccf")


async def main() -> None:
    async with async_session_factory() as s:
        floor = (
            await s.execute(
                text("SELECT floor_json FROM signals WHERE id = :sid"),
                {"sid": str(SID)},
            )
        ).fetchone()
        print("floor", (floor[0] or "")[:600] if floor else None)

        agent = (
            await s.execute(
                text(
                    """
                    SELECT name, runtime_status, is_active, last_active_at
                    FROM agents WHERE id = :aid
                    """
                ),
                {"aid": str(ORCH)},
            )
        ).fetchone()
        print("agent", agent)

        msgs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, kind, left(body_text, 80)
                    FROM signal_messages
                    WHERE signal_id = :sid
                    ORDER BY created_at DESC
                    LIMIT 5
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        print("--- msgs ---")
        for r in msgs:
            print(r[0], r[1], repr(r[2]))


if __name__ == "__main__":
    asyncio.run(main())
