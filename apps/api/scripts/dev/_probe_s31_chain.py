"""Inspect three-agent S31 chain on internal host."""
from __future__ import annotations

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = "72fbd32a-fb2c-4f12-8d7c-eb13ed87de58"


async def main() -> None:
    async with async_session_factory() as s:
        row = (
            await s.execute(
                text(
                    "SELECT active_turn_json FROM signals WHERE id = :id"
                ),
                {"id": HOST},
            )
        ).first()
        print("active_turn", row)

        msgs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, role, author_agent_id::text,
                           left(coalesce(body_text,''), 180)
                    FROM signal_messages
                    WHERE signal_id = :id
                      AND created_at > now() - interval '20 minutes'
                    ORDER BY created_at ASC
                    """
                ),
                {"id": HOST},
            )
        ).fetchall()
        print("recent msgs:")
        for m in msgs:
            print(" ", m)

        evs = (
            await s.execute(
                text(
                    """
                    SELECT created_at, event_type,
                           left(coalesce(payload_json::text,''), 220)
                    FROM signal_events
                    WHERE signal_id = :id
                      AND created_at > now() - interval '20 minutes'
                    ORDER BY created_at ASC
                    """
                ),
                {"id": HOST},
            )
        ).fetchall()
        print("recent events:")
        for e in evs:
            print(" ", e)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
