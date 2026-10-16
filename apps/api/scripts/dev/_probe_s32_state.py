"""Probe host thread state for S32."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory
from app.models.signal import Signal

SID = UUID("72fbd32a-fb2c-4f12-8d7c-eb13ed87de58")
BOKITO = "8d4dede2-751e-4475-b614-206a8415c577"


async def main() -> None:
    async with async_session_factory() as s:
        sig = await s.get(Signal, SID)
        print("signal", SID)
        print("status", getattr(sig, "status", None))
        print("active_turn", getattr(sig, "active_turn_json", None))
        print("channel", getattr(sig, "channel", None))
        rows = (
            await s.execute(
                text(
                    "select agent_id::text, role, streak, streak_at "
                    "from signal_participants where signal_id=:sid"
                ),
                {"sid": SID},
            )
        ).fetchall()
        print("participants", len(rows))
        for r in rows:
            print(" ", r)
        recent = (
            await s.execute(
                text(
                    """
                    select id::text, channel, kind, status,
                           left(coalesce(subject,''), 60),
                           created_at
                    from signals
                    where created_at > now() - interval '3 hours'
                      and (
                        id = :sid
                        or parent_signal_id = :sid
                        or channel = 'agent'
                      )
                    order by created_at desc
                    limit 25
                    """
                ),
                {"sid": SID},
            )
        ).fetchall()
        print("recent_signals")
        for r in recent:
            print(" ", r)


if __name__ == "__main__":
    asyncio.run(main())
