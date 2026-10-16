"""Inspect Orchestrator live/presence fields that drive Stop button."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

ORCH = UUID("cc965b16-aff8-44a2-a0ea-29ebd4e5bccf")
ASK = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")


async def main() -> None:
    async with async_session_factory() as s:
        cols = (
            await s.execute(
                text(
                    """
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'agents'
                    ORDER BY ordinal_position
                    """
                )
            )
        ).fetchall()
        names = [c[0] for c in cols]
        print("agent cols sample", [n for n in names if any(x in n for x in ("live", "status", "activ", "current", "run"))])
        row = (
            await s.execute(
                text(
                    """
                    SELECT id, name, status, current_signal_id, last_active_at,
                           left(coalesce(settings_json::text,''),200)
                    FROM agents WHERE id = :aid
                    """
                ),
                {"aid": str(ORCH)},
            )
        ).fetchone()
        print("agent", row)
        # agent_runs open?
        runs = (
            await s.execute(
                text(
                    """
                    SELECT id, signal_id, status, started_at
                    FROM agent_runs
                    WHERE agent_id = :aid AND status IN ('running','queued','in_progress','active')
                    ORDER BY started_at DESC LIMIT 5
                    """
                ),
                {"aid": str(ORCH)},
            )
        ).fetchall()
        print("open runs", runs)
        # chat turns?
        try:
            chats = (
                await s.execute(
                    text(
                        """
                        SELECT column_name FROM information_schema.columns
                        WHERE table_name LIKE '%chat%' OR table_name LIKE '%turn%'
                        LIMIT 40
                        """
                    )
                )
            ).fetchall()
            print("chat-ish cols tables skipped; floor:")
        except Exception as e:
            print(e)
        floor = (
            await s.execute(
                text("SELECT left(coalesce(floor_json::text,''),800) FROM signals WHERE id=:sid"),
                {"sid": str(ASK)},
            )
        ).fetchone()
        print("floor", floor[0] if floor else None)


if __name__ == "__main__":
    asyncio.run(main())
